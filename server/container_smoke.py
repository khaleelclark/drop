#!/usr/bin/env python3
"""Check the built root Docker image locally; always remove test containers/data."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("household_process_smoke", ROOT / "scripts/smoke.py")
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


def docker(*arguments, check=True):
    result = subprocess.run(["docker", *arguments], text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(f"Docker {arguments[0]} failed: {result.stderr.strip()}")
    return result


class ContainerServer(smoke.Server):
    def __init__(self, image, directory, name, volume):
        super().__init__(Path("unused"), directory)
        self.image, self.name, self.volume = image, name, volume
        self.created = False
        self.env_file = directory / "container.env"
        self.env_file.touch(mode=0o600)
        self.env_file.write_text(
            f"HOUSEHOLD_ADDR=127.0.0.1:{self.port}\n"
            f"HOUSEHOLD_PUBLIC_URL={self.origin}\n"
            f"HOUSEHOLD_TOKEN={self.token}\n"
            "HOUSEHOLD_DEV=1\n"
        )

    def start(self):
        if not self.created:
            docker("run", "-d", "--name", self.name, "--network", "host",
                   "--env-file", str(self.env_file), "--mount",
                   f"type=volume,src={self.volume},dst=/data",
                   "--security-opt", "no-new-privileges:true", "--cap-drop", "ALL", self.image)
            self.created = True
        else:
            docker("start", self.name)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            state = json.loads(docker("inspect", "--format", "{{json .State}}", self.name).stdout)
            if not state["Running"]:
                raise RuntimeError("Container exited: " + docker("logs", self.name).stdout)
            try:
                if self.request("GET", "/api/health", authenticated=False)[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(0.1)
        raise RuntimeError("Container health did not become ready")

    def stop(self):
        if self.created:
            docker("stop", "-t", "10", self.name)


def static_and_runtime_checks(server):
    state = json.loads(docker("inspect", server.name).stdout)[0]
    smoke.require(state["Config"]["User"].split(":")[0] in ("65532", "nonroot"), "Image does not default to nonroot")
    smoke.require(state["HostConfig"]["NetworkMode"] == "host", "Expected host networking")
    smoke.require(state["HostConfig"]["PortBindings"] in ({}, None), "Unexpected published port")
    mounts = [m for m in state["Mounts"] if m["Destination"] == "/data"]
    smoke.require(len(mounts) == 1 and mounts[0]["Name"] == server.volume and mounts[0]["RW"], "Fresh data volume not mounted read/write")
    uid_lines = docker("top", server.name, "-eo", "pid,uid").stdout.splitlines()[1:]
    smoke.require(uid_lines and all(line.split()[-1] == "65532" for line in uid_lines), "Runtime process is not UID 65532")
    status, headers, body = server.request("GET", "/", authenticated=False)
    smoke.require(status == 200 and b'<div id="root">' in body, "Built static UI missing")
    policy = headers.get("content-security-policy", "")
    smoke.require("script-src 'self' 'wasm-unsafe-eval'" in policy, "Static WebAssembly CSP missing")
    smoke.require("'unsafe-eval'" not in policy and "'unsafe-inline'" not in policy, "Overbroad CSP")
    smoke.require("connect-src 'self'" in policy and "object-src 'none'" in policy, "CSP isolation missing")
    asset_paths = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', body.decode())
    smoke.require(any(path.endswith(".js") for path in asset_paths) and any(path.endswith(".css") for path in asset_paths), "Built assets missing")
    for path in asset_paths:
        asset_status, _, asset = server.request("GET", path, authenticated=False)
        smoke.require(asset_status == 200 and len(asset) > 0, "Static asset unavailable")
    status, headers, _ = server.request("GET", "/api/health", authenticated=False)
    smoke.require(status == 200 and "'wasm-unsafe-eval'" not in headers.get("content-security-policy", ""), "API CSP unexpectedly weakened")
    print("PASS: distroless UID 65532, fresh named volume, loopback host networking, built UI/assets, narrow static/API CSP", flush=True)


def production_rejection(image, directory, base_name, token):
    cases = [
        ("defaults", [], "HTTPS origin required"),
        ("missing-token", ["HOUSEHOLD_PUBLIC_URL=https://household.invalid"], "HOUSEHOLD_TOKEN is required"),
        ("http-origin", [f"HOUSEHOLD_TOKEN={token}", "HOUSEHOLD_PUBLIC_URL=http://127.0.0.1:8787"], "HTTPS origin required"),
    ]
    for label, settings, expected in cases:
        name = base_name + "-" + label
        environment = directory / (label + ".env")
        environment.touch(mode=0o600)
        environment.write_text("HOUSEHOLD_DEV=0\n" + "\n".join(settings) + "\n")
        try:
            result = docker("run", "--name", name, "--network", "host", "--env-file", str(environment), image, check=False)
            smoke.require(result.returncode != 0 and expected in result.stderr + result.stdout, "Production misconfiguration did not fail closed: " + label)
            state = json.loads(docker("inspect", "--format", "{{json .State}}", name).stdout)
            smoke.require(not state["Running"] and state["ExitCode"] != 0, "Rejected container still running")
        finally:
            docker("rm", "-fv", name, check=False)
    print("PASS: production defaults, missing token with HTTPS, and token with HTTP all exit nonzero before serving", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="household-share:validation")
    parser.add_argument("--large-bytes", type=int, default=9 * 1024 * 1024)
    options = parser.parse_args()
    smoke.require(0 <= options.large_bytes <= 20 * 1024**3, "Large test must be between zero and 20 GiB")
    name = "household-container-check-" + secrets.token_hex(6)
    volume = name + "-data"
    with tempfile.TemporaryDirectory(prefix="household-container-check-") as directory:
        directory = Path(directory)
        server = ContainerServer(options.image, directory, name, volume)
        docker("volume", "create", volume)
        try:
            server.start()
            static_and_runtime_checks(server)
            smoke.exercise(server, options.large_bytes)
            production_rejection(options.image, directory, name, server.token)
        except Exception:
            if server.created:
                print(docker("logs", server.name, check=False).stdout, flush=True)
            raise
        finally:
            docker("rm", "-fv", name, check=False)
            docker("volume", "rm", volume)
            server.log.close()
        smoke.require(docker("container", "ls", "-aq", "--filter", "name=" + name).stdout.strip() == "", "Test container remains")
        smoke.require(docker("volume", "ls", "-q", "--filter", "name=" + volume).stdout.strip() == "", "Test volume remains")
        print("PASS: disposable test containers and volume removed", flush=True)


if __name__ == "__main__":
    main()
