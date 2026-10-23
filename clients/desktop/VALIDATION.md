# Desktop native validation

Earlier Linux checks were recorded 2026-10-22 in the Linux build workspace. Final accepted ARM64 package evidence is recorded separately below. The native transfer engine, package checks and installed Tauri GUI behavior have distinct validation boundaries.

## Earlier Linux checks (2026-10-22)

- Approved project-local Rust 1.99.1/Cargo via `source scripts/env.sh`; project dependencies resolved and lockfiles retained in both native and Tauri crates. No system packages installed.
- `cargo test --locked --offline --manifest-path clients/desktop/native/Cargo.toml`: **15 passed**, 4 core unit + 11 real-loopback HTTP protocol tests, rerun after the host interruption. Checks private transport/origin policy, durable safe capture, exclusive queue lock, corrupt-state failure, secret redaction, multi-chunk upload/download restart/resume, explicit Quit pause, existing-target protection, changed source including restored timestamp/middle-byte modification, cancellation, invalid ranges/ETags, checksum mismatch before publication, zero-byte upload/download, 8 MiB preparation limit, and disconnect credential erasure. New regressions exercise destination-bound file/text capture with no spool credentials, rejected final text on Resume, pending validation retaining staged bytes across restart, and lost-final-ACK Cancel409 reconciliation.
- `cargo build --locked --offline --release --manifest-path clients/desktop/native/Cargo.toml`: current Linux native CLI builds. The same command with `--example live_roundtrip` builds the production queue integration driver. Both native and desktop-shell sources pass `cargo fmt --all -- --check` for their manifests.
- Real Go server/native queue small smoke: **33,555,133 bytes**, SHA-256 equality, queue pause/reopen/resume and server restart during both upload and download. Raw report: `native-live-small.json`.
- Post-QA-fix live smoke rerun: **33,555,133 bytes**, SHA-256 `c7a31f7b2cbbd482f545710ecb9edbd56ceb8552b204343ab8db905e12ab3b9a`, **0.50 seconds**, **26,212 KiB peak native RSS**, queue pause/reopen/resume and real server restart after 8 MiB in both directions. Raw report: `native-live-after-review.json`; the release integration driver was rebuilt with `--locked --offline` before this run.
- Independent reviewer real-Go-server/public-Rust-API probes closed all three defects: both file/text captures remain bound to server A after pairing B, rejected FF FE text remains failed with staged bytes retained through restart, and a real proxy-dropped final PATCH response followed by Cancel409 settles complete while preserving the ready household item. Exact evidence and limitations are in `quality/desktop-review.md`.
- Real Go server/native queue large test: **21,474,836,480 bytes (20 GiB)**, source/download SHA-256 `6cb118a8f8b3c19385874297e291dcbcdf3a9837ba1ca7b00ace2491adbff551`, **175.24 seconds**, **27,000 KiB peak native-process RSS** measured with `wait4`. Queue and actual server processes were restarted after the first 8 MiB in each direction. The final downloaded file had exactly the source size and digest. Raw report: `native-live-20gib.json`.
- The large fixture was a sparse zero-filled source. All 20 GiB payload bytes were transmitted over loopback HTTP into real server and download files; sparse source creation does not replace transfer/checksum work. This proves this native engine's local transfer/restart path with the tested fixture, not arbitrary device/network performance or installed UI/background behavior.
- The 20 GiB run predates the three targeted QA fixes. The then-current 15-test suite, independent real-server defect rechecks, and post-fix 32 MiB live round trip are separate evidence; the 20 GiB transfer was not repeated after those fixes.
- Tauri project CLI 2.12.4 installed as a project dependency. `tauri info` parsed the actual app config. JSON/TOML manifests parse and Tauri config passes the CLI JSON Schema. Rust sources pass rustfmt.
- Root's isolated `Dockerfile.desktop` build compiled and refreshed the actual Linux Tauri shell and native capture CLI using frozen pnpm locks. The successful `.tools/desktop-build.log` ends with a completed bundle/export. Verified at that record: `artifacts/linux-desktop/Household Share_0.1.0_amd64.deb` (**7,099,224 bytes**, 6.77 MiB) and separate `household-share-cli` (**5,389,072 bytes**). The exported Debian package is the exact package exercised in the separate GUI lifecycle check below. Read the Debian control/data archives directly: architecture amd64, executable `usr/bin/household-share`, launcher, icon, and GTK3/WebKit4.1/AppIndicator runtime dependencies are present. The refreshed executable contains the then-frozen shared UI asset names `index-CdZF0CLg.js` and `index-B_mvSAqO.css`, predating the final ARM64 UI below; this filename check is separate from Android's byte-for-byte asset comparison. Build libraries were installed inside the isolated image; host GUI packages were unchanged. Compilation/packaging and GUI execution are separate evidence.
- The server owner separately exercised a freshly generated Linux package in the existing dependency image, as documented in [server validation](../../server/VALIDATION.md#linux-desktop-runtime-in-an-isolated-dependency-container). Its tested package SHA-256 was `0499a46f34c059b4a6df2c494a2cf58989caf349acf662e46197f9084bd4a191`; this was that image's `/output` package, not the earlier host-extracted snapshot or an assertion that every generated package has identical bytes. A private cookie-authenticated Xvfb display, private D-Bus/XDG directories, UID 1000, `--network none`, dropped capabilities and `no-new-privileges` isolated the run. The existing image supplied GTK/WebKit; no additional packages, privileged container or WebKit sandbox-disable flag were used. The actual connection window rendered; normal `WM_DELETE_WINDOW` hid it while the same app and WebKit processes survived. `Ctrl+Shift+H` reopened it, and a second instance exited 0 while reopening the original resident window. Invoking the real tray menu's `Pause transfers and Quit` action through D-Bus exited the app/container 0; relaunch rendered the connection screen again. The owner inspected PNG captures and an empty valid-runtime log. This is actual unpaired, network-disabled shell lifecycle evidence, reused here without repeating the run. It does not test a desktop panel/tray pointer interaction, pairing, clipboard/dialog commands, or an in-progress transfer surviving window close.
- Current release Linux CLI was exercised through the actual file/text capture scripts with an isolated disposable XDG data directory: durable spool ingestion, exact BOM/CRLF/Unicode text bytes, token-free destination-bound spool, queued status and redacted output all passed. The absent GUI launcher left the captures safely queued. No user queue was touched.
- `bash -n` passed for the three Mac capture scripts. `python3 integrations/macos/test_capture.py` passed exact path argument and large UTF-8 stdin forwarding with spaces, Unicode, newlines, option-like strings and shell metacharacters. This Linux check uses a fake helper; it does not exercise Finder or Shortcuts.

Reproduce the live test from the repository root after building `bin/household-server`:

```sh
source scripts/env.sh
cargo build --release --manifest-path clients/desktop/native/Cargo.toml --example live_roundtrip
python3 clients/desktop/native/tests/live_roundtrip.py \
  --server bin/household-server --bytes 21474836480 \
  --report clients/desktop/native-live-20gib.json
```

The harness uses an isolated temporary data directory, explicit loopback development configuration and a fixed disposable test token. It starts/stops only its own server processes, compares checksums, deletes the test item, and cleans the temporary source/download/server data. It does not deploy, bind publicly, modify Tailscale, or install an app.

## Accepted final Apple Silicon package

The native lead accepted the final ARM64 package evidence without a concrete package/evidence blocker. This supersedes the earlier source-only Mac status below. Root verified successful CI job/run provenance and downloaded the final outputs; the independent review used those actual retained files, not the earlier ARM64 candidate.

This acceptance describes the current BRmFLqLf/BJCLriK5 release, which remains valid while the next mobile bottom-tab refinement is pending. That refinement is outside this record; refresh packages only after root announces the next exact frontend freeze, never from moving `web/dist`.

| Record | Accepted value |
| --- | --- |
| Clean source | `d600445d2996b9d49e685ab716237ae3ad4ff3f7`; `build-environment.log` lists no tracked working-tree changes |
| Successful native CI | Run `39875041794`, ARM64 job `120158944970` (verified by root) |
| Retained installer | `artifacts/macos/aarch64-apple-darwin/Household-Share_0.1.0_arm64.dmg` |
| DMG size | 9,063,055 bytes |
| DMG SHA-256 | `010c86da84c78fd63d1a5337661f6da8a32e916e5c2b0b209d4624471b8c09fe` |
| Native environment | `aarch64-apple-darwin`; macOS 15.7.9, Xcode 16.4 / SDK 15.5, Node 24.16.0, pnpm 11.10.0, Rust/Cargo 1.99.1 |

At acceptance, the complete `web-assets-sha256.txt` manifest matched all **9** names and SHA-256 values in the release's actual frozen `web/dist`, with no missing or extra files. Key release assets are:

| File | SHA-256 |
| --- | --- |
| `index.html` | `cae49b93fd6e129763426826d06b0a01400aff3d0081c1dcc02bfbf99b004b12` |
| `assets/index-BRmFLqLf.js` | `7b9d352b50cf22fe210ec3f2beefcc9aab69cfc031ca4ff07860366b200dbc0e` |
| `assets/index-BJCLriK5.css` | `923cdcd2d222832fd9d84862052b1353021ea69336aabe863511bffed0de553a` |

Actual native evidence retained beside the DMG:

- `native-tests.log`: **17 tests passed** (4 core + 13 protocol), zero failures or ignored tests. This is native Mac test execution, separate from the earlier Linux 15-test record.
- `app-verification.log`: thin arm64 app/helper, Apple-system-only dynamic linkage, strict executable/deep app ad-hoc signatures and resource seals pass; the app retains hardened-runtime flags.
- `dmg-verification.log`: image ad-hoc signature and `hdiutil` checksum verification pass; read-only mount, Applications drag-install link, included instructions/capture scripts, repeated mounted app/helper verification and clean detach pass.
- `helper-execution.log`: native helper prints expected no-argument usage. The audited successful build script requires exit status 1 from this execution before creating the DMG; it does not start a queue or launch the GUI.
- `INSTALL.txt`: byte-for-byte equal to `integrations/macos/INSTALL.txt` in the independent review. Architecture selection, drag/eject/open, per-app Open Anyway guidance, private Tailscale/token pairing and bundled-helper setup agree with the source packaging.

The bounded independent review on Linux completely read `SHA256SUMS`, `build-environment.log`, `web-assets-sha256.txt`, `native-tests.log`, `app-verification.log`, `dmg-verification.log`, `helper-execution.log` and `INSTALL.txt`, plus the packaging/verification/workflow/capture sources. It independently streamed the downloaded DMG SHA-256 and compared all 9 frontend manifest entries with actual frozen `web/dist`. Native signing, mounting, helper loading and test conclusions rely on the downloaded Mac logs and audited successful scripts, not local Mac reruns or independent DMG asset extraction. CI job/ZIP provenance remains root's verification.

**Intel acceptance is pending at this record.** Root owns Intel progress/download and final aggregate delivery. GUI installation/launch, downloaded-app quarantine/Gatekeeper approval, Finder/Shortcuts, native clipboard/dialogs, real household Mac/Tailscale operation, close/sleep/background behavior, macOS 11 runtime compatibility and Mac 20 GB transfers remain untested. A macOS 15 CI build and package verification do not establish those device behaviors.

## Host build limitations and historical Mac source checks

### Historical Mac installer source checks (2026-10-22)

Implemented `.github/workflows/macos-dmg.yml` and `integrations/macos/{versions.env,build-dmg.sh,verify-dmg.sh,INSTALL.txt}` against the existing locked desktop/Tauri project. The workflow runs native ARM64 (`macos-15`) and Intel (`macos-15-intel`) jobs, pins Node 24.16.0/pnpm 11.10.0/Rust 1.99.1 and GitHub action SHAs, and reuses the runners' installed Xcode SDKs. It uses frozen pnpm dependencies and locked Cargo resolutions. Only read access to the repository is granted; checkout credentials are not persisted. No Apple identity, notarization or household token is included.

At this source-only stage, the planned Mac checks were explicit: native core tests; app/helper release build; ad-hoc helper signing followed by app resource re-sealing with Tauri entitlements/flags preserved; architecture/app-identifier/deployment-target/system-dylib checks; strict executable and deep app signature verification; helper usage execution (before any user-state access); compressed DMG creation/signing; UDIF verification; read-only image mounting; bundled app/helper verification and Applications-link/instruction checks; SHA-256 output. Build source commit and actual OS/Xcode/SDK/tool versions are retained. These checks export artifacts; they do not publish a release or install an app on the host.

At that historical source-only handoff, the shared UI redesign was still an integration dependency. Each Mac build regenerates `web/dist` from its checkout and records exact generated assets in `web-assets-sha256.txt`; an earlier passing candidate could not establish final redesigned-package acceptance. The final selected source/UI and accepted ARM64 evidence are now recorded above.

Actually performed on Linux in that source-check follow-up:

- `bash -n` for `build-dmg.sh`, `verify-dmg.sh`, and `versions.env`: passed.
- Parsed workflow YAML; checked both native target/runner pairs, manual and `main` push triggers, full action commit pins and read-only repository permission: passed.
- Running `build-dmg.sh aarch64-apple-darwin` on this host: expected exit 1 with **DMG packaging requires macOS and an Apple SDK. No installer was built.** The guard runs before dependency installation, output creation or build/signing calls.
- Independent source review found one local-build blocker: unconditional `xcodebuild -version` required full Xcode solely for provenance reporting. Removed it from required commands and made that report conditional, falling back to `pkgutil` CLT package metadata (or an explicit unavailable note). The required `xcrun` SDK checks remain. No other concrete blocker was reported in the five reviewed automation/install files; this review is not Mac execution.
- The reviewer's focused source recheck closed that finding and reported no remaining concrete blocker in the bounded packaging review, including the updated documentation. It did not run a Mac build or repeat the Linux control-flow checks.
- The corrected optional-report branches (full Xcode, CLT fallback and unavailable metadata) all continued under `set -euo pipefail` in an isolated Linux shell check with explicit `xcodebuild`/`pkgutil` stubs. No Mac command was executed by this control-flow check.
- The frontend provenance script ran separately against the 9 current `web/dist` files; its streaming Node SHA-256 output matched independently computed Python hashes for every file. This reads the existing build only; no frontend rebuild, Mac packaging or final-design approval is inferred.

At that historical handoff there was no macOS runner result or actual DMG evidence; Linux source checks did not validate Mac signatures, helper loading or mounting. The accepted final ARM64 record above supersedes that package status with actual retained native logs/checksum tied to the frozen source. Hosted package evidence remains separate from household Mac acceptance, Gatekeeper approval and GUI behavior. See `README.md` and `integrations/macos/README.md` for exact run/install instructions.

### Linux workspace and cross-target attempts

- `cargo check --manifest-path clients/desktop/src-tauri/Cargo.toml` stops in GLib/GObject system dependencies because `pkg-config` and GTK/WebKit development packages are absent. No system-package installation was authorized or performed.
- Approved Rust macOS target component was added locally. `cargo check --manifest-path clients/desktop/src-tauri/Cargo.toml --target aarch64-apple-darwin` stops in `objc2-exception-helper`: the Linux C compiler cannot build Apple's Objective-C target (`-arch` / macOS SDK). No Apple SDK is present.
- The separate isolated Linux container build and unpaired shell lifecycle run passed as recorded above without changing host GUI packages. Direct host execution of an extracted package stopped in the dynamic loader with exit 127 because WebKit4.1/JavaScriptCore/Soup runtime libraries are absent; no app/display initialization occurred on that host path. Host installation, native clipboard/dialog commands, pairing and in-progress transfer residency remain unperformed. The shared frontend adapter has its own web-owner checks.

## Unperformed release checks

- macOS installed shell launch and lifecycle, including close/sleep/background behavior and macOS 11 runtime compatibility; actual household Linux installation, native dialogs/clipboard, desktop-panel tray interaction and paired API behavior. The isolated Linux run above covers window rendering, normal close-to-hide/process residency, hotkey/single-instance reopen and D-Bus tray Quit/relaunch; it does not establish an in-progress transfer continuing after window close.
- Downloaded, quarantined macOS app Gatekeeper approval, actual Finder Quick Action/Shortcuts and temporary export lifetimes. ARM64 ad-hoc app/CLI/image signing and package checks passed in CI as recorded above; installed GUI/device acceptance remains separate.
- Mac 20 GB transfers. The earlier Linux headless 20 GiB result is not Mac transfer evidence.
- Actual household Tailscale connectivity, Wi-Fi interruption, physical device performance/memory, sleep/lock/logout boundaries, destination filesystem/disk exhaustion and permissions.
- Android device behavior: see `clients/android/VALIDATION.md`; this headless Rust test is not Android evidence.

The full product is not release-validated by these checks. Native-engine transfer evidence and the isolated Linux shell lifecycle run are separate; they do not establish their combined behavior on household devices or Android lifecycle on physical phones.
