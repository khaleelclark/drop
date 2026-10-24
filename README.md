## Current UI refresh candidate — 24 October 2026

The reviewed navy/white/red layout, Mac menu focus and last-row delete-error
visibility correction are built. Current freeze:
`web/test-results/ui-refresh/error-visibility-freeze.json`; bundles are
`index-Cak_AnQS.js`/map and `index-Dw3Gk6BF.css`. Root verified all 81 recorded
hash entries and 20 embedded source matches. The exact regression failed on the
prior desktop assets and passes after correction; all five focused cases,
typecheck and one newly authorized production build passed.

The previous macOS WebKit candidate passed 23/24 checks but failed because the
last-row HTTP 500 error was below the window. Its failed report is preserved in
`docs/evidence/zing-ui-refresh-macos-webkit.json`. New-asset Mac WebKit,
matching replacement packages and installed Mac acceptance remain pending.
Existing desktop 0.1.5 and Android 0.1.7 packages predate this final correction.
No service deployment is part of this task.

Twenty-two required historical evidence files remain absent after attempted
recovery; no originals were fabricated. See
`docs/evidence/historical-evidence-unavailable.json`. The aggregate
`artifacts/package-manifest.json` and `artifacts/SHA256SUMS` are historical;
use version-specific receipts and immutable Project downloads.

# Zing

The Mac Delete/device-name follow-up has a verified Apple Silicon household
0.1.4 installer. Native macOS CI passed 42 tests, ad-hoc signing, helper execution
and read-only DMG checks; root matched the downloaded package and all nine frozen
web assets. The user reports Delete still shows no confirmation on Mac 0.1.4,
while Android deletion works; the Mac fix remains open. Naming acceptance is
unverified. See
[package evidence](docs/evidence/zing-delete-name-macos-package.json).

The current UI refresh has accepted desktop and phone previews and a corrected production build; replacement installers remain pending. A macOS WebKit diagnostic reproduced the missed Delete click and isolated an explicit menu-focus correction. This is browser-engine evidence with synthetic data; installed Mac acceptance remains open. See [diagnostic evidence](docs/evidence/zing-mac-delete-webkit-diagnosis.json).

The connection/navigation correction has verified **Apple Silicon household
0.1.3** and **Android Tauri 0.1.6/code1006** packages. The Mac installer includes
the household address; missing/disconnected configuration opens the inbox with
explicit Settings instead of a login dialog. Android API36 emulator checks verify
real keyboard Back and Home/resume restore the bottom tabs without losing drafts
or filters. API26–29 retains the partial Done fallback. Linux 0.1.3 and standalone
Android 0.1.5 are earlier navy candidates. Household Mac installation and
physical-phone acceptance remain unverified. No new deployment occurred. See
[current validation](docs/validation.md).

Zing is a private shared inbox for household text and files, designed for Linux hosting behind Tailscale and Mac, Linux, Android, and browser clients.

Source repository: [khaleelclark/household-share](https://github.com/khaleelclark/household-share). The source is public; a running household instance uses private Tailscale access and its explicitly configured authentication mode.

The app has one shared feed, explicit Copy and Download actions, resumable native transfer queues, and a browser fallback. See [validation evidence](docs/validation.md) for the exact builds and checks performed. Mac packaging and physical-phone background behavior require checks on those devices.

## Start on the Linux host

Use a built Linux server bundle, or build the source with the tools below:

```sh
pnpm --dir web install --frozen-lockfile
bash scripts/build.sh
cp .env.example .env
```

Edit `.env`: set `HOUSEHOLD_AUTH_MODE=tailscale` for URL-only access through the
local Tailscale Serve proxy, and set `HOUSEHOLD_PUBLIC_URL` to its exact HTTPS
origin. Keep the loopback address and restrict Tailscale access to the household.
For explicit token mode instead, set `HOUSEHOLD_AUTH_MODE=token` and a strong
private `HOUSEHOLD_TOKEN` of at least 16 bytes. From the project or unpacked server-bundle directory:

```sh
set -a
source .env
set +a
./bin/household-server
```

In another terminal on the same host, configure the private HTTPS entry point:

```sh
tailscale serve --bg http://127.0.0.1:8787
```

Open that HTTPS address on a household device connected to Tailscale. In
Tailscale mode, no app token is needed; token mode retains its explicit login.
The server must remain awake and online. Files stay until explicitly deleted;
storage budgets and abandoned-upload expiry are configurable. See
[hosting and storage](docs/deployment.md) and [server configuration](server/README.md).
No deployment is performed by building the project.

## Install clients

- **Browser / Mac fallback:** open the private HTTPS address; install it from the browser's app menu where available. Keep the page open during uploads.
- **Mac and Linux desktop:** see [desktop build/install instructions](clients/desktop/README.md). The Tauri app keeps its native queue running when the window closes; explicit Quit pauses transfers. Mac builds use local ad-hoc signing, without a developer account. [Mac Quick Actions and Shortcuts](integrations/macos/README.md) send files or clipboard text into that local queue.
- **Android:** see [APK build and ADB installation](clients/android/README.md). The Tauri APK uses a Kotlin transfer service independent of the interface. Authorize USB debugging, then use `adb install app.apk` or `adb install -r app.apk` for an update signed with the same retained key. An app store or developer account is not required for this path.

The Android Tauri and standalone diagnostic variants have separate app-private data. Use the intended Tauri package for the common installed interface. Preserve your APK signing key outside this repository.

## Project layout

| Path | Purpose |
| --- | --- |
| `server/` | Go API, durable metadata, disk content, resumable transfers |
| `web/` | React interface and browser fallback |
| `clients/` | Installed clients and native transfer queues |
| `integrations/` | Capture integrations such as Mac Quick Actions |
| `docs/api-contract.md` | Shared API and transfer contract |
| `docs/ui-brief.md` | User-approved interface direction |
| `quality/` | Review findings and validation evidence |

## Build tools

Node and pnpm are required for the interface. Go is required for the server. Native Tauri clients require Rust and each target platform's native build dependencies. Android needs an appropriate JDK, Android SDK and NDK; macOS packages must be built and tested on a Mac.

`scripts/env.sh` supports optional Go/Rust tools under `.tools/` without modifying system paths permanently. Source it in a shell before using those tools. Keep local toolchains, data, tokens, and signing keys out of source control.

The user approved project-local Go and Rust installation for this build. `python3 scripts/install-build-tools.py --go --rust` installs those tools under `.tools/` from official distributions and verifies download checksums. It does not edit shell profiles. OS/system-package installation and deployment remain outside this approval.

## Development and hosting

Configuration uses the variables in `.env.example`. Explicit Tailscale mode
requires a trusted local Serve identity on every request; default token mode
requires a configured token, exchanged for a browser session or sent privately
by the installed client. Keep the application on loopback and use Tailscale
Serve as the HTTPS entry point. Tagged clients need the advanced token fallback;
see the hosting guide for the local proxy trust boundary.

The intended production layout is a server binary, built web assets, and a persistent data directory. Downloads are streamed; feed updates contain metadata; incomplete uploads remain unavailable until validated. Storage budgets count unfinished transfers.

`bash scripts/test.sh` runs frontend and Go tests. Component-specific checks are in their READMEs. The real-server browser smoke is `node scripts/browser-smoke.cjs`; it requires a disposable configured loopback test server and token file, as described in [validation](docs/validation.md). The separately approved private deployment and its validation are recorded in [validation](docs/validation.md).

After the final source and web/server build, `python3 scripts/package.py` creates a source archive, a Linux x86_64 server bundle, and their SHA256 manifest under `artifacts/`. The server bundle contains `bin/household-server`, `web/dist`, configuration example and hosting instructions; unpack it and run from its `household/` directory. The source archive excludes local toolchains, queues, credentials, signing keys, dependencies and build outputs. Native packages are built separately using the platform instructions above.

Packaging selects the current native versions and rejects Android APKs with a
different frontend. It requires both current Mac installers; while those are
pending, `python3 scripts/package.py --allow-missing-macos` creates an explicitly
incomplete candidate whose manifest lists the missing installers. Older Mac
packages are never substituted. Check all included bytes from the project root
with `sha256sum -c artifacts/SHA256SUMS`. The existing aggregate manifest and checksum file are stale snapshots and must be regenerated before they can validate a current release. Use version-specific evidence for previously delivered packages. The [historical evidence inventory](docs/evidence/historical-evidence-unavailable.json) records 22 unavailable older evidence files; no whole-project completion is claimed.

## Interaction

Paste text or add files to the shared feed. Copy always targets the full stored text; text also has a `.txt` download. Large file transfers use resumable queues. Installed clients are intended to continue when their window is closed or the phone is locked, subject to OS conditions; explicit Quit or force-stop can pause work.

The interface uses system typography, neutral surfaces, restrained blue, and primary Copy/Download actions. Text is stored intact. Copy preparation is capped at 8 MiB to protect client memory; larger text remains available as a full `.txt` download. Downloads and native file transfers stream without loading a 20 GB file into JavaScript memory.
