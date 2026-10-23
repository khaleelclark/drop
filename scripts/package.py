#!/usr/bin/env python3
"""Package source and the current Linux server build without local state/secrets."""
import hashlib
import gzip
import json
import pathlib
import subprocess
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifacts'
EXCLUDED_DIRS = {
    '.git', '.tools', 'node_modules', 'target', 'build', 'dist', '.gradle',
    '.gradle-home', '.kotlin', '.idea', '.vite', '.tauri', '__pycache__', 'data',
    'artifacts', 'bin', 'test-results', 'playwright-report', 'jniLibs',
}
EXCLUDED_SUFFIXES = {'.log', '.pyc', '.tsbuildinfo', '.keystore', '.jks', '.pem', '.p12', '.apk', '.deb'}


def source_files(directory=ROOT):
    for path in sorted(directory.iterdir()):
        if path.is_symlink():
            continue
        if path.is_dir():
            if path.name not in EXCLUDED_DIRS:
                yield from source_files(path)
        elif path.is_file():
            if path.name in {'local.properties', '.DS_Store'}:
                continue
            if path.name.startswith('.client-probe-'):
                continue
            if path.name.startswith('.env') and path.name != '.env.example':
                continue
            if path.suffix in EXCLUDED_SUFFIXES:
                continue
            # Tauri regenerates these with local Cargo registry locations.
            if path.name in {'tauri.settings.gradle', 'tauri.build.gradle.kts', 'tauri.properties'}:
                continue
            yield path


def archive(name, files):
    output = OUT / name
    def portable(info):
        info.uid = info.gid = info.mtime = 0
        info.uname = info.gname = ''
        info.mode = 0o755 if info.mode & 0o111 else 0o644
        return info
    with output.open('wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as bundle:
                for path in files:
                    bundle.add(path, arcname='household/' + str(path.relative_to(ROOT)), recursive=False, filter=portable)
    # Reopen the completed archive: check names and every recorded payload size.
    with tarfile.open(output, 'r:gz') as bundle:
        members = bundle.getmembers()
        if not members or any(not m.isfile() or not m.name.startswith('household/') or '..' in pathlib.PurePosixPath(m.name).parts for m in members):
            raise RuntimeError('Invalid package contents')
        for member in members:
            with bundle.extractfile(member) as stream:
                count = sum(len(block) for block in iter(lambda: stream.read(1024 * 1024), b''))
            if count != member.size:
                raise RuntimeError('Incomplete archive member: ' + member.name)
    return output


def main():
    OUT.mkdir(exist_ok=True)
    required = (ROOT / 'docs/required-deliverables.txt').read_text().splitlines()
    for relative in required:
        path = ROOT / relative
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError('Required deliverable missing or empty: ' + relative)
    with (ROOT / 'bin/household-server').open('rb') as stream:
        header = stream.read(20)
    if header[:6] != b'\x7fELF\x02\x01' or header[18:20] != b'\x3e\x00':
        raise RuntimeError('The server bundle requires a Linux x86_64 executable')
    source = list(source_files())
    server = [ROOT / 'bin/household-server', ROOT / '.env.example', ROOT / 'README.md',
              ROOT / 'docs/deployment.md', ROOT / 'docs/validation.md', ROOT / 'server/README.md']
    server += sorted(p for p in (ROOT / 'web/dist').rglob('*') if p.is_file() and not p.is_symlink() and p.suffix != '.map')
    outputs = [archive('household-source.tar.gz', source), archive('household-server-linux-x86_64.tar.gz', server)]
    outputs += [ROOT / relative for relative in [
        'artifacts/linux-desktop/Household Share_0.1.1_amd64.deb',
        'artifacts/linux-desktop/household-share-cli',
        'clients/android/build/outputs/household-share-tauri-aarch64-debug.apk',
        'clients/android/build/outputs/household-share-tauri-x86_64-debug.apk',
        'clients/android/app/build/outputs/apk/debug/app-debug.apk',
        'artifacts/macos/0.1.1/aarch64-apple-darwin/Household-Share_0.1.1_arm64.dmg',
        'artifacts/macos/0.1.1/x86_64-apple-darwin/Household-Share_0.1.1_x86_64.dmg',
    ]]
    rows = []
    for path in outputs:
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        rows.append({'file': path.name, 'bytes': path.stat().st_size, 'sha256': digest})
    revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True)
    state = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True, text=True)
    (OUT / 'package-manifest.json').write_text(json.dumps({'packages': rows, 'sourceFiles': len(source), 'requiredFilesVerified': required, 'gitCommit': revision.stdout.strip() if revision.returncode == 0 else None, 'workingTreeClean': state.returncode == 0 and not state.stdout.strip()}, indent=2) + '\n')
    (OUT / 'SHA256SUMS').write_text(''.join(f"{row['sha256']}  {row['file']}\n" for row in rows))
    print(json.dumps(rows, indent=2))


if __name__ == '__main__':
    main()
