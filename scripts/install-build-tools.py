#!/usr/bin/env python3
"""Install approved Go/Rust build tools locally; never edits shell profiles."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tarfile
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / ".tools"
DOWNLOADS = TOOLS / "downloads"


def read_url(url: str) -> bytes:
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in (502, 503, 504) or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
    raise RuntimeError("download failed")


def download(url: str, filename: str, expected_sha256: str) -> Path:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    destination = DOWNLOADS / filename
    if destination.exists() and hashlib.file_digest(destination.open("rb"), "sha256").hexdigest() == expected_sha256:
        return destination
    partial = destination.with_suffix(destination.suffix + ".partial")
    print(f"Downloading {filename}", flush=True)
    with urllib.request.urlopen(url, timeout=60) as response, partial.open("wb") as output:
        while block := response.read(1024 * 1024):
            output.write(block)
    with partial.open("rb") as source:
        actual = hashlib.file_digest(source, "sha256").hexdigest()
    if actual != expected_sha256:
        partial.unlink()
        raise RuntimeError(f"SHA256 verification failed for {filename}")
    partial.replace(destination)
    print(f"Verified {filename}", flush=True)
    return destination


def install_go() -> None:
    executable = TOOLS / "go" / "bin" / "go"
    if executable.exists():
        subprocess.run([str(executable), "version"], check=True)
        return
    if (TOOLS / "go").exists():
        raise RuntimeError("Existing partial .tools/go install: inspect it before replacing")
    releases = json.loads(read_url("https://go.dev/dl/?mode=json"))
    release = next(item for item in releases if item["stable"])
    artifact = next(item for item in release["files"] if item["os"] == "linux" and item["arch"] == "amd64" and item["kind"] == "archive")
    archive = download("https://go.dev/dl/" + artifact["filename"], artifact["filename"], artifact["sha256"])
    with tarfile.open(archive) as source:
        source.extractall(TOOLS, filter="data")
    subprocess.run([str(executable), "version"], check=True)
    (TOOLS / "go-install.json").write_text(json.dumps({"version": release["version"], "filename": artifact["filename"], "sha256": artifact["sha256"]}, indent=2) + "\n")


def install_rust() -> None:
    environment = dict(os.environ, CARGO_HOME=str(TOOLS / "cargo"), RUSTUP_HOME=str(TOOLS / "rustup"))
    environment["PATH"] = str(TOOLS / "cargo" / "bin") + os.pathsep + environment.get("PATH", "")
    rustc = TOOLS / "cargo" / "bin" / "rustc"
    if rustc.exists():
        subprocess.run([str(rustc), "--version"], env=environment, check=True)
        return
    base = "https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init"
    digest = read_url(base + ".sha256").decode().split()[0]
    installer = download(base, "rustup-init", digest)
    installer.chmod(0o700)
    subprocess.run([str(installer), "-y", "--no-modify-path", "--profile", "minimal", "--default-toolchain", "stable"], env=environment, check=True)
    subprocess.run([str(rustc), "--version"], env=environment, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--go", action="store_true")
    parser.add_argument("--rust", action="store_true")
    options = parser.parse_args()
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        parser.error("This optional installer currently supports Linux x86_64 only")
    if not options.go and not options.rust:
        parser.error("Select --go and/or --rust after approving local tool installation")
    TOOLS.mkdir(exist_ok=True)
    if options.go:
        install_go()
    if options.rust:
        install_rust()


if __name__ == "__main__":
    main()
