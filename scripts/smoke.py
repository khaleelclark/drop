#!/usr/bin/env python3
"""Exercise a built server over real HTTP, including restart and byte integrity."""
from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from urllib.parse import urlsplit


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class Server:
    def __init__(self, executable: Path, directory: Path):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        self.executable = executable
        self.directory = directory
        self.origin = f"http://127.0.0.1:{self.port}"
        self.token = os.urandom(32).hex()
        self.process: subprocess.Popen | None = None
        self.log = (directory / "server.log").open("ab")

    def start(self):
        environment = dict(os.environ, HOUSEHOLD_ADDR=f"127.0.0.1:{self.port}", HOUSEHOLD_DATA_DIR=str(self.directory / "data"), HOUSEHOLD_PUBLIC_URL=self.origin, HOUSEHOLD_TOKEN=self.token, HOUSEHOLD_DEV="1")
        self.process = subprocess.Popen([str(self.executable)], env=environment, stdout=self.log, stderr=self.log)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError("Server exited. Inspect its log in " + str(self.directory))
            try:
                status, _, _ = self.request("GET", "/api/health", authenticated=False)
                if status == 200:
                    return
            except OSError:
                pass
            time.sleep(0.1)
        raise RuntimeError("Server did not become ready")

    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)

    def request(self, method, path, body=None, headers=None, authenticated=True):
        if path.startswith("http"):
            parsed = urlsplit(path)
            require(parsed.netloc == f"127.0.0.1:{self.port}", "Unexpected upload origin")
            path = parsed.path + ("?" + parsed.query if parsed.query else "")
        request_headers = dict(headers or {})
        if authenticated:
            request_headers["Authorization"] = "Bearer " + self.token
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=120)
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            data = response.read()
            return response.status, dict((key.lower(), value) for key, value in response.getheaders()), data
        finally:
            connection.close()

    def json(self, method, path, body=None, **kwargs):
        raw = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        status, headers, data = self.request(method, path, raw, {"Content-Type": "application/json"}, **kwargs)
        return status, headers, json.loads(data) if data else None

    def create_upload(self, length, name="fixture.bin", kind="file", mime="application/octet-stream", routing=None):
        fields = {"filename": name, "filetype": mime, "kind": kind}
        if routing:
            fields["sourceDeviceId"] = routing["sourceDeviceId"]
            fields["targetDeviceIds"] = json.dumps(routing["targetDeviceIds"])
        metadata = ",".join(key + " " + base64.b64encode(value.encode()).decode() for key, value in fields.items())
        status, headers, _ = self.request("POST", "/api/uploads/", headers={"Tus-Resumable": "1.0.0", "Upload-Length": str(length), "Upload-Metadata": metadata})
        require(status == 201, f"Upload creation failed: {status}")
        require("location" in headers and "x-item-id" in headers, "Upload response lacks location/item id")
        return headers["location"], headers["x-item-id"]

    def patch_upload(self, location, offset, data):
        return self.request("PATCH", location, data, {"Tus-Resumable": "1.0.0", "Upload-Offset": str(offset), "Content-Type": "application/offset+octet-stream"})

    def wait_status(self, item_id, expected="ready"):
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            status, _, result = self.json("GET", "/api/items/" + item_id)
            require(status == 200, f"Cannot read upload item: {status}")
            if result["item"]["status"] == expected:
                return result["item"]
            if result["item"]["status"] == "failed" and expected != "failed":
                raise AssertionError("Upload unexpectedly failed")
            time.sleep(0.1)
        raise AssertionError("Upload did not reach " + expected)

    def download_digest(self, item_id):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=120)
        digest = hashlib.sha256()
        count = 0
        try:
            connection.request("GET", f"/api/items/{item_id}/download", headers={"Authorization": "Bearer " + self.token})
            response = connection.getresponse()
            require(response.status == 200, f"Download failed: {response.status}")
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                digest.update(chunk)
            return count, digest.hexdigest()
        finally:
            connection.close()


def exercise_devices(server: Server):
    sender, recipient, other = (character * 32 for character in ("1", "2", "3"))
    for device_id, label in ((sender, "Sender"), (recipient, "Recipient"), (other, "Other")):
        status, _, result = server.json("POST", "/api/devices/register", {"id": device_id, "label": label, "platform": "browser"})
        require(status == 200 and result["device"]["id"] == device_id, "Device registration failed")
    status, _, _ = server.request("GET", "/api/devices", authenticated=False)
    require(status == 401, "Anonymous registry access must be denied")
    status, _, result = server.json("POST", "/api/devices/register", {"id": sender, "label": "Renamed sender", "platform": "browser"})
    require(status == 200, "Explicit device rename failed")
    status, _, result = server.json("POST", "/api/devices/register", {"id": sender, "label": "Old queued name", "platform": "linux", "preserveExisting": True})
    require(status == 200 and result["device"]["label"] == "Renamed sender" and result["device"]["platform"] == "browser", "Background registration undid a device rename")

    def arrivals(device_id, after=None):
        path = f"/api/devices/{device_id}/notifications"
        if after is not None:
            path += "?after=" + after
        status, _, result = server.json("GET", path)
        require(status == 200, "Arrival fetch failed")
        require(all(set(row) == {"sequence", "itemId", "createdAt"} and isinstance(row["sequence"], str) for row in result["notifications"]), "Arrival contains private content or a non-string sequence")
        return result

    routing = {"sourceDeviceId": sender, "targetDeviceIds": [recipient]}
    exact_text = "  Targeted, still household-visible.\r\n家 🏠\n"
    status, _, result = server.json("POST", "/api/text", {"text": exact_text, **routing})
    require(status == 201, "Targeted text creation failed")
    require(result["item"]["sourceDevice"] == "Renamed sender", "Send did not snapshot the current registry name")
    text_id = result["item"]["id"]
    page = arrivals(recipient)
    require([row["itemId"] for row in page["notifications"]] == [text_id], "Recipient did not receive exactly one arrival")
    require(not arrivals(sender)["notifications"] and not arrivals(other)["notifications"], "Targeted send alerted another device")
    status, _, result = server.json("GET", "/api/items")
    require(status == 200 and text_id in [item["id"] for item in result["items"]], "Targeting hid content from All shares")
    status, _, body = server.request("GET", f"/api/items/{text_id}/text")
    require(status == 200 and body == exact_text.encode(), "Targeted text bytes changed")
    original = server.json("GET", "/api/items/" + text_id)[2]["item"]
    edited_text = "\ufeff  Edited code/Markdown\r\n```go\nfmt.Println(\"家 🏠\")\n```\n"
    status, _, result = server.json("PATCH", "/api/items/" + text_id, {"name": "Snippet.md", "text": edited_text, "expectedUpdatedAt": original["updatedAt"]})
    require(status == 200, "Shared text edit failed")
    edited = result["item"]
    require(edited["id"] == text_id and edited["createdAt"] == original["createdAt"] and edited["sourceDeviceId"] == sender and edited["targetDeviceIds"] == [recipient], "Edit changed identity, source or routing")
    require(edited["updatedAt"] > original["updatedAt"] and edited["size"] == len(edited_text.encode()), "Edit version/byte length did not advance correctly")
    require([row["itemId"] for row in arrivals(recipient)["notifications"]] == [text_id], "Editing sent another arrival")
    status, _, result = server.json("PATCH", "/api/items/" + text_id, {"text": "Stale editor overwrite", "expectedUpdatedAt": original["updatedAt"]})
    require(status == 409 and result["error"]["code"] == "edit_conflict", "Stale editor overwrote shared content")
    for extension in ("txt", "md"):
        status, headers, body = server.request("GET", f"/api/items/{text_id}/download?format={extension}")
        require(status == 200 and body == edited_text.encode() and f"Snippet.{extension}" in headers.get("content-disposition", ""), "Text format export changed bytes or filename")
    status, _, _ = server.request("GET", f"/api/items/{text_id}/download?format=html")
    require(status == 400, "Unknown text export format was accepted")
    cursor = page["nextCursor"]
    status, _, result = server.json("POST", f"/api/devices/{recipient}/notifications/ack", {"through": cursor})
    require(status == 200 and result["ackCursor"] == cursor, "Arrival acknowledgement failed")
    server.stop()
    server.start()
    require(not arrivals(recipient)["notifications"], "Restart lost the notification acknowledgement")
    status, _, result = server.json("GET", "/api/items?forDevice=" + recipient)
    require(status == 200 and text_id in [item["id"] for item in result["items"]], "Acknowledgement removed For you history")

    payload = b"durable recipient routing" * 8193
    location, upload_id = server.create_upload(len(payload), routing=routing)
    split = 65537
    status, _, _ = server.patch_upload(location, 0, payload[:split])
    require(status == 204 and not arrivals(recipient)["notifications"], "Incomplete upload generated an arrival")
    server.stop()
    server.start()
    status, _, _ = server.patch_upload(location, split, payload[split:])
    require(status == 204, "Targeted upload did not resume after restart")
    server.wait_status(upload_id)
    status, _, _ = server.request("HEAD", location, headers={"Tus-Resumable": "1.0.0"})
    require(status == 200, "Completed upload HEAD failed")
    require([row["itemId"] for row in arrivals(recipient)["notifications"]] == [upload_id], "Completion replay duplicated or lost the upload arrival")
    require(not arrivals(other)["notifications"], "Resumed upload lost its selected recipients")
    count, digest = server.download_digest(upload_id)
    require(count == len(payload) and digest == hashlib.sha256(payload).hexdigest(), "Targeted resumed download failed integrity")

    text_location, uploaded_text_id = server.create_upload(3, "original.md", "text", "text/markdown", routing)
    status, _, _ = server.patch_upload(text_location, 0, b"old")
    require(status == 204, "Text file upload failed")
    uploaded = server.wait_status(uploaded_text_id)
    status, _, _ = server.json("PATCH", "/api/items/" + uploaded_text_id, {"text": "", "expectedUpdatedAt": uploaded["updatedAt"]})
    require(status == 200, "Uploaded text could not be edited to empty")
    status, headers, _ = server.request("HEAD", text_location, headers={"Tus-Resumable": "1.0.0"})
    require(status == 200 and headers.get("upload-length") == "3" and headers.get("upload-offset") == "3", "Editing changed original completed tus length/offset")
    status, _, _ = server.patch_upload(text_location, 3, b"")
    require(status == 204, "Original final-offset PATCH failed after editing")
    status, _, body = server.request("GET", f"/api/items/{uploaded_text_id}/text")
    require(status == 200 and body == b"", "Final-offset replay replaced the edited content")
    require(sum(row["itemId"] == uploaded_text_id for row in arrivals(recipient)["notifications"]) == 1, "Edited upload completion replay sent another arrival")

    status, _, result = server.json("POST", "/api/text", {"text": "Everyone", "sourceDeviceId": sender})
    require(status == 201, "Everyone send failed")
    broadcast_id = result["item"]["id"]
    require(broadcast_id in [row["itemId"] for row in arrivals(recipient)["notifications"]] and broadcast_id in [row["itemId"] for row in arrivals(other)["notifications"]], "Everyone did not fan out to registered recipients")
    require(not arrivals(sender)["notifications"], "Everyone alerted its sender")
    status, _, _ = server.json("POST", "/api/text", {"text": "Reject self", "sourceDeviceId": sender, "targetDeviceIds": [sender]})
    require(status == 400, "Explicit self-target silently became Everyone")
    for item_id in (text_id, upload_id, uploaded_text_id, broadcast_id):
        status, _, _ = server.request("DELETE", "/api/items/" + item_id)
        require(status == 204, "Targeted item cleanup failed")
    require(not arrivals(recipient, "0")["notifications"], "Deleted item retained an actionable arrival")
    status, _, result = server.json("POST", f"/api/devices/{recipient}/notifications/ack", {"through": cursor})
    require(status == 200 and result["ackCursor"] == cursor, "Deleting all arrivals lost the issued cursor high-water")
    for device_id in (sender, recipient, other):
        status, _, _ = server.request("DELETE", "/api/devices/" + device_id)
        require(status == 204, "Device cleanup failed")
    print("PASS: real HTTP device routing, shared visibility, ready-only arrivals, durable ACK/For you, editing/conflicts/TXT+MD bytes, completed tus after edits, restart/resume, dedupe, Everyone/self exclusion and deletion", flush=True)


def exercise(server: Server, large_bytes: int):
    status, _, _ = server.request("GET", "/api/items", authenticated=False)
    require(status == 401, "Anonymous feed access must be denied")
    text = "  first line\r\nsecond line\n\tUnicode: café 🏠 日本語\n" * 250
    status, _, response = server.json("POST", "/api/text", {"text": text, "name": "Exact clipboard text"})
    require(status == 201, "Text creation failed")
    text_id = response["item"]["id"]
    status, _, data = server.request("GET", f"/api/items/{text_id}/text")
    require(status == 200 and data == text.encode(), "Text was modified or truncated")
    status, _, data = server.request("GET", f"/api/items/{text_id}/download", headers={"Range": "bytes=3-28"})
    require(status == 206 and data == text.encode()[3:29], "Range download returned incorrect bytes")
    status, _, _ = server.json("PATCH", f"/api/items/{text_id}", {"pinned": True})
    require(status == 200, "Pin failed")

    payload = bytes(range(251)) * 1031
    location, item_id = server.create_upload(len(payload))
    split = 71329
    status, headers, _ = server.patch_upload(location, 0, payload[:split])
    require(status == 204 and int(headers.get("upload-offset", -1)) == split, "First upload chunk not committed")
    status, _, _ = server.patch_upload(location, 0, b"wrong offset")
    require(status == 409, "Wrong upload offset must fail without corrupting content")
    status, _, _ = server.request("GET", f"/api/items/{item_id}/download")
    require(status != 200 and status != 206, "Incomplete upload became downloadable")
    server.stop()
    server.start()
    status, headers, _ = server.request("HEAD", location, headers={"Tus-Resumable": "1.0.0"})
    require(status == 200 and int(headers.get("upload-offset", -1)) == split, "Restart lost confirmed upload offset")
    status, _, _ = server.patch_upload(location, split, payload[split:])
    require(status == 204, "Resume after restart failed")
    server.wait_status(item_id)
    count, digest = server.download_digest(item_id)
    require(count == len(payload) and digest == hashlib.sha256(payload).hexdigest(), "Resumed file failed byte integrity check")
    status, headers, body = server.request("HEAD", f"/api/items/{item_id}/download")
    require(status == 200 and int(headers.get("content-length", -1)) == len(payload) and not body, "Download HEAD invalid")

    status, headers, _ = server.request("POST", "/api/session", json.dumps({"token": server.token}).encode(), {"Content-Type": "application/json", "Origin": server.origin}, authenticated=False)
    require(status in (200, 204) and "set-cookie" in headers, "Browser session creation failed")
    cookie = headers["set-cookie"].split(";", 1)[0]
    status, _, _ = server.request("GET", f"/api/items/{item_id}/download", headers={"Cookie": cookie}, authenticated=False)
    require(status == 200, "Cookie-authenticated direct download failed")
    status, _, _ = server.request("POST", "/api/text", b'{"text":"cross origin"}', {"Cookie": cookie, "Content-Type": "application/json", "Origin": "https://untrusted.invalid"}, authenticated=False)
    require(status == 403, "Cross-origin cookie write must be rejected")

    location, invalid_id = server.create_upload(2, "invalid.txt", "text", "text/plain")
    status, _, _ = server.patch_upload(location, 0, b"\xff\xfe")
    require(status in (204, 400, 422), "Invalid UTF-8 upload produced unexpected status")
    server.wait_status(invalid_id, "failed")
    status, _, _ = server.request("GET", f"/api/items/{invalid_id}/download")
    require(status not in (200, 206), "Invalid text must not become ready")
    print("PASS: authentication, exact text, range/HEAD downloads, pin, upload offsets, restart/resume, byte integrity, browser session, CSRF, invalid UTF-8", flush=True)

    exercise_devices(server)

    if large_bytes:
        location, large_id = server.create_upload(large_bytes, "large-integrity-test.bin")
        chunk = os.urandom(8 * 1024 * 1024)
        digest = hashlib.sha256()
        offset = 0
        milestone = 0
        while offset < large_bytes:
            part = chunk[:min(len(chunk), large_bytes - offset)]
            status, headers, _ = server.patch_upload(location, offset, part)
            require(status == 204, f"Large upload failed at {offset}: {status}")
            digest.update(part)
            offset += len(part)
            require(int(headers.get("upload-offset", -1)) == offset, "Large upload offset mismatch")
            if offset // (1024 ** 3) > milestone:
                milestone = offset // (1024 ** 3)
                print(f"Uploaded {milestone} GiB", flush=True)
        server.wait_status(large_id)
        downloaded, downloaded_digest = server.download_digest(large_id)
        require(downloaded == large_bytes and downloaded_digest == digest.hexdigest(), "Large-file download integrity mismatch")
        print(f"PASS: streamed {large_bytes} bytes through upload and download with matching SHA256", flush=True)
        server.request("DELETE", "/api/items/" + large_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default="bin/household-server", type=Path)
    parser.add_argument("--large-bytes", default=0, type=int)
    options = parser.parse_args()
    require(options.server.is_file(), "Build the server first")
    require(options.large_bytes >= 0, "Large test size must be nonnegative")
    with tempfile.TemporaryDirectory(prefix="household-smoke-") as directory:
        server = Server(options.server.resolve(), Path(directory))
        try:
            server.start()
            exercise(server, options.large_bytes)
        except Exception:
            server.stop()
            print(server.directory.joinpath("server.log").read_text(errors="replace"))
            raise
        finally:
            server.stop()
            server.log.close()


if __name__ == "__main__":
    main()
