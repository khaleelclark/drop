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

    def create_upload(self, length, name="fixture.bin", kind="file", mime="application/octet-stream"):
        metadata = ",".join(key + " " + base64.b64encode(value.encode()).decode() for key, value in {"filename": name, "filetype": mime, "kind": kind}.items())
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
