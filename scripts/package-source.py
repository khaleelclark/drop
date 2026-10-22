#!/usr/bin/env python3
"""Create a source archive from Git-visible files, excluding local build/data state."""
from __future__ import annotations

from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "artifacts" / "household-source.tar.gz"
EXCLUDED = {".git", ".tools", "node_modules", "data", "bin", "dist", "artifacts", "__pycache__", ".gradle", "target"}


def main():
    names = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0")
    OUTPUT.parent.mkdir(exist_ok=True)
    count = 0
    with tarfile.open(OUTPUT, "w:gz") as archive:
        for name in sorted(set(filter(None, names))):
            relative = Path(name)
            path = ROOT / relative
            if EXCLUDED.intersection(relative.parts) or not path.is_file() or path.is_symlink():
                continue
            if path.name == ".env" or (path.name.startswith(".env.") and path.name != ".env.example"):
                continue
            if path.suffix in {".jks", ".keystore", ".p12", ".pem", ".pyc", ".log"}:
                continue
            archive.add(path, arcname=str(Path("household") / relative), recursive=False)
            count += 1
    print(f"Packaged {count} source files: {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
