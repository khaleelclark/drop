# Installed desktop client

The Tauri 2 shell bundles `web/dist`; a Rust transfer worker owns file bytes, HTTP and persisted queue state. It stays resident when its window closes. The tray/menu offers **Open Household Share** and **Pause transfers and Quit**; `Ctrl/Command+Shift+H` opens the window. Explicit Quit checkpoints active transfers as paused. Reopen and Resume to continue. Sleep, logout, shutdown, OS kill and unavailable Tailscale can interrupt work; the next run reconciles confirmed offsets.

## Build from source

Prerequisites must already be installed: a supported Rust toolchain/Cargo, Node + pnpm, and [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) (Xcode command-line tools on macOS; GTK/WebKit and native build packages on Linux). Project package installation below does not install OS toolchains.

From the project root:

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir clients/desktop install --frozen-lockfile
cargo test --locked --manifest-path clients/desktop/native/Cargo.toml
cargo build --locked --release --manifest-path clients/desktop/native/Cargo.toml
pnpm --dir clients/desktop dev
# Or create a local installed bundle:
pnpm --dir clients/desktop build
```

Tauri invokes the shared web build, then bundles it locally. The installed shell never loads the configured server into a privileged webview. Local app data APIs use the bounded `native_api` bridge, while large transfer bytes remain entirely in Rust. Release CSP permits only native IPC. Native HTTP follows no redirects, attaches the bearer token only to the configured origin, and accepts HTTPS or explicit HTTP loopback. Config paths and transfer locations are origin-checked. No public listener is created.

On macOS, `tauri.conf.json` uses ad-hoc signing (`-`), with no account or notarization requirement. The CLI must be built for the same platform. To install that helper yourself:

```sh
mkdir -p "$HOME/.local/bin"
cp clients/desktop/native/target/release/household-share-cli "$HOME/.local/bin/"
codesign --force --sign - "$HOME/.local/bin/household-share-cli"
```

See `integrations/macos/README.md` for Quick Action/Shortcut capture. The helper is separate from the Tauri app bundle in this source build; there is no automatic system install. Linux users may run the helper from its build location or copy it to their own user bin directory.

## macOS DMG build

The account-free installer path is `.github/workflows/macos-dmg.yml`. It builds the existing desktop app on separate native GitHub runners: `macos-15` for Apple Silicon and `macos-15-intel` for Intel. These are [standard GitHub-hosted runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). A matching-source push to `main` starts both jobs; **Actions → macOS DMG → Run workflow** starts them manually. Repository Actions must be enabled. The workflow uploads build artifacts and does not create a release or deploy a server. The current 0.1.1 packages below both use the approved frozen UI; earlier candidates do not establish current package acceptance.

Build tools are pinned in `integrations/macos/versions.env`: Node **24.16.0**, pnpm **11.10.0**, Rust **1.99.1**. Both pnpm installs use frozen locks; the helper tests/build and Tauri Cargo build use `--locked`. GitHub actions are pinned to full commit SHAs with read-only repository permissions and no persisted checkout credential. Hosted jobs install the pinned project tools in their disposable environment and use the runner's existing Xcode/Apple SDK. No SDK or system-package installer runs. Standalone Command Line Tools with a usable macOS SDK are sufficient locally; full Xcode is optional. The exact OS/SDK/tool versions, available Xcode or CLT package metadata, source commit and tracked working-tree changes are saved with the output; a runner label does not pin an immutable OS image.

On a Mac that already has those tools and Xcode prerequisites, run from the repository root:

```sh
# Use the target matching this Mac; no cross-executed test claims:
bash integrations/macos/build-dmg.sh aarch64-apple-darwin
# Intel Mac instead:
# bash integrations/macos/build-dmg.sh x86_64-apple-darwin
```

The script runs the native engine tests, builds the helper and Tauri `.app`, embeds the helper at `Household Share.app/Contents/Helpers/household-share-cli`, and includes the three capture scripts under `Contents/Resources/capture`. It signs the helper first and re-signs the modified app with ad-hoc identity `-`, retaining Tauri's entitlements and flags. It checks Mach-O architecture, Apple-system-only dynamic dependencies, app metadata and strict/deep code signatures, then creates a compressed HFS+ DMG with an **Applications** drag-install link and `INSTALL.txt`. It signs and verifies the DMG, mounts it read-only, and rechecks the bundled app/helper before export. The helper's no-argument usage path is executed to check native loading without opening a queue; the GUI is not launched by this script. No account or notarization credentials are required or accepted.

Successful jobs export these files in **Artifacts → household-share-macos-arm64** or **household-share-macos-x86_64**:

- `Household-Share_0.1.1_arm64.dmg` or `Household-Share_0.1.1_x86_64.dmg`;
- `SHA256SUMS`, `INSTALL.txt`, `web-assets-sha256.txt` recording the exact generated frontend files, and dependency/build/test/signature/DMG verification logs, including `build-environment.log` with source/toolchain provenance.

The same outputs are under `artifacts/macos/<Rust-target>/` for a local build. A pre-existing DMG makes the script stop rather than replace it. `bash integrations/macos/verify-dmg.sh /path/to/installer.dmg arm64` (or `x86_64`) repeats the native package checks without building or launching the GUI. Verify the downloaded DMG with `shasum -a 256 -c SHA256SUMS` from its download directory.

Install by opening the matching DMG, dragging the app into Applications, ejecting the image, and opening the installed app. [Ad-hoc signing](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing) does not supply Apple's notarization or developer identity. If macOS blocks it, use the per-app **Privacy & Security → Open Anyway** path described in [Apple's instructions](https://support.apple.com/en-us/102445). Package signature checks do not prove Gatekeeper approval on a downloaded, quarantined app. Pair using your own Tailscale HTTPS origin and app token; neither is baked into the package. See the Mac integration README for the optional helper symlink/Quick Actions.

The accepted current **0.1.1 Apple Silicon and Intel installers** were built from clean source `57e26b4e8707eff13dabb5725d15b1ec7c67c6e4` in successful run `39878431406`, jobs `120169690452` (ARM64) and `120169690572` (Intel):

| Retained installer | Bytes | SHA-256 |
| --- | ---: | --- |
| `artifacts/macos/0.1.1/aarch64-apple-darwin/Household-Share_0.1.1_arm64.dmg` | 9,064,284 | `8d86401ff54f6c98ef82f80eff73031c3867466be9e4a4156279848bf4203c6c` |
| `artifacts/macos/0.1.1/x86_64-apple-darwin/Household-Share_0.1.1_x86_64.dmg` | 9,532,266 | `07d430cdcd9c43920bba1860c460fe2c64ab06ea5103b3d30d3246fe0c52ea60` |

Both packages contain the approved `index-CS6EIQOV.js` / `index-DVPjc1UT.css` frontend freeze, including the mobile bottom tabs. Each complete 9-file frontend manifest matched actual frozen `web/dist` at acceptance. The retained native logs for **each architecture** record **17 tests passing** (4 core + 13 protocol), thin app/helper verification for its native architecture, strict ad-hoc signatures with the app's hardened-runtime flags retained, image signature/checksum, read-only mount/drag-install layout, mounted bundle verification/clean detach, and helper usage execution with expected status 1. Acceptance is tied to this exact source/freeze, not future `web/dist` changes.

The native lead's bounded independent Linux review streamed both retained DMG hashes, compared both complete frontend manifests, read both sets of native logs/install instructions and audited the packaging scripts, finding no concrete package/evidence blocker. Native signing/mount/helper/test results come from the downloaded Mac logs; CI job/ZIP provenance was verified by root. This was not independent DMG asset extraction or a local Mac rerun. Exact frontend hashes and evidence are in [VALIDATION.md](VALIDATION.md#accepted-current-mac-packages). The earlier accepted 0.1.0 ARM64 package from source `d600445d2996b9d49e685ab716237ae3ad4ff3f7`, with the BRmFLqLf/BJCLriK5 UI, is preserved there as history alongside the earlier Linux automation/source checks.

Installed Mac GUI launch, close-to-hide, menu-bar Quit/reopen, native clipboard/dialogs, Finder/Shortcuts, quarantined-download Gatekeeper approval, real household Mac/Tailscale operation, close/sleep/background behavior and Mac 20 GB transfers remain unperformed. The deployment target is macOS 11; runtime compatibility on it or other physical Mac versions is not inferred from the target setting or the macOS 15 CI build.

## Headless queue and capture

Configure via the app, or configure the standalone worker before starting the GUI. Token input is stdin, never a CLI argument. This command waits for token input until EOF:

```sh
clients/desktop/native/target/release/household-share-cli configure https://your-box.your-tailnet.ts.net Desktop
```

`household-share-cli enqueue /absolute/path/a /absolute/path/b` durably spools file sources, then starts the installed app in background. `household-share-cli text` streams stdin to a single private staging file before enqueueing it. Capture acknowledgement means **queued locally**, not uploaded. If launching fails, open the app later; the spool survives. Temporary exported files must be saved durably before using file capture. Capture records file size, modification time, inode/device on Unix, and SHA-256 of the first/last 64 KiB quickly. The worker computes and persists a full streaming SHA-256 before the first network upload, and checks that full fingerprint again after process restart before resuming. It checks metadata/sampled content around each subsequent chunk. Full verification runs in the worker, so capture returns quickly; pause/cancel interrupts verification. This source-change protection is separate from end-to-end sender/server digest comparison, which the API does not currently provide.

`household-share-cli run` runs the native worker in a terminal without the UI. Do not run it alongside the GUI: an exclusive per-user lock prevents two processes corrupting the queue. `list` reads redacted transfer views while no queue owner runs. Queue corruption fails visibly rather than discarding resumable state. Credentials and queue files live in the platform's per-user local application-data directory (`ProjectDirs("net","household","HouseholdShare")`), mode 0700 directories/0600 JSON on Unix. Tokens are stored on disk there; OS keychain integration is not implemented.

## Transfer behavior

Uploads use tus creation, HEAD reconciliation, sequential ≤8 MiB PATCH bodies, and termination. The client retains the server/upload URL, item ID, source identity, acknowledged offset, status and server configuration in atomic, synced JSON. Server offset wins after a lost ACK/restart. Creation is saved before sending bytes. A crash between server creation and saving Location can leave an abandoned empty server upload; server-side expiry is the cleanup path. A full tus offset is followed by application item validation: only `ready` becomes complete and permits staged-source cleanup. Pending validation remains `validating`; rejected validation retains the original staged source and an error, including after Resume/restart.

File and text capture bind the intended server before acknowledging the local spool write. Spool messages contain no token. If another server is paired before ingestion, those captures stay paused for their original server; reconnect that server and Resume. Cancel terminates incomplete uploads. If a lost final acknowledgement races with Cancel and tus DELETE returns 409, the client reconciles the item: already-ready content becomes complete and remains shared until explicitly deleted; pending validation retries, and failed validation stays an error.

Downloads issue HEAD, require a strong ETag, fetch bounded byte ranges, validate Content-Range/length/ETag, and sync data before checkpointing. A changed ETag/200 response invalidates the partial rather than appending; explicit Resume starts cleanly. Server `"sha256-<digest>"` ETags are incrementally verified against the entire local file before publication. Resume reconciles actual partial-file length. A private `.household-<id>.part` in the chosen destination directory is published by atomic hard link only when complete; existing destination files are never replaced. The destination filesystem must support hard links (ordinary APFS/ext4 do). Unsupported filesystems report an error and retain the partial for retry. Cancellation removes partial data; interrupted cancellation remains visible/retryable until tus DELETE succeeds. Files are limited to 20 GiB and retain 16 MiB minimum local free space per download step. Text capture also checks available disk space while streaming. Network/HTTP 5xx/429 errors use capped backoff and become visible errors after eight retries; authentication, source, protocol and disk errors require explicit Resume after correction.

One worker processes queued transfers serially with bounded buffers; no full-file in-memory buffering or base64 file transport. Base64 is used only for short tus metadata. A pause/cancel takes effect after the current bounded request, up to the request timeout. Requests time out after 120 seconds, then reconcile before retry. The app window and webview do not own this worker.

## Shared UI bridge

Use `window.__TAURI__.core.invoke` (enabled by `withGlobalTauri`) with flat camelCase arguments:

| Command | Arguments / result |
| --- | --- |
| `native_configure` | `{baseUrl, token, sourceDevice}` → void |
| `native_get_config` | `{}` → `{baseUrl,sourceDevice,connected}` without token; connected=false requires pairing |
| `native_disconnect` | `{}` → pause work and erase saved credentials |
| `native_list_transfers` | `{}` → transfer array |
| `native_pick_uploads` | `{kind?:"file"|"text",sourceDevice?:string}` → opens picker, enqueues files, resolves void |
| `native_enqueue_upload` | `{path, kind?:"file"|"text"}` → void |
| `native_download` | `{itemId,name}` → opens save picker, transfer ID or null |
| `native_control` | `{id,action:"pause"|"resume"|"cancel"}` → void |
| `native_copy_text` | `{text}` → resolves only after OS clipboard write |
| `native_api` | `{method,path,body?,requestId?}` → `{status,body,headers}` with raw UTF-8 body |
| `native_cancel_api` | `{requestId}` → cancel a preparation read at the next bounded read |

Transfer views contain `{id,direction,name,size,offset,status,error,itemId}`. Status is queued/checking/running/validating/paused/cancelling/cancelled/complete/error; size/offset are 64-bit byte counts safely representable at this target. The UI polls the queue and feed. Native API excludes upload/download/event bodies and caps text responses at 8 MiB, metadata responses at 2 MiB, and JSON request bodies at 40 MiB (server defaults to 32 MiB decoded text). Larger stored text should download through the queue. The shared UI bounds expansion separately to 256 KiB; command cancellation is checked between bounded native reads (a stalled read may wait until its request timeout). UI expansion/copy remains explicit and bounded. Native API returns HTTP status/body, including errors; transport errors reject the command. The full common bridge contract and redacted test values are in `clients/shared/native-contract.md` and `native-contract-fixture.json`.

## Validation and remaining platform checks

The approved project-local Rust/Cargo toolchain compiled the native engine and CLI. The earlier Linux suite passed **15 Rust tests** (4 unit + 11 protocol); current Mac 0.1.1 source passed **17 on each native architecture** as recorded above. The reviewer independently reproduced and closed all three destination/validation/cancellation defects against real Go servers; see `quality/desktop-review.md`. After those fixes, a **33,555,133-byte** live round trip passed with both queue/server restarts and matching SHA-256 (`native-live-after-review.json`).

An earlier actual **20 GiB (21,474,836,480 bytes)** native-engine upload/download against the real Go server passed with queue and server restarts in both directions, matching source/download SHA-256. Peak native RSS was **27,000 KiB** and elapsed time **175.24 seconds**. That run predates the three targeted QA fixes; the post-fix 32 MiB round trip and regression tests verify the updated paths separately. The deterministic source was a sparse zero-filled file; every payload byte traveled through HTTP to real server/download storage. See `VALIDATION.md` and `native-live-20gib.json` for the boundary and reproducible command.

In the earlier Linux validation, the Tauri CLI parsed the configuration, which also passed its JSON Schema. Host Linux shell compilation stopped at absent pkg-config/GTK/WebKit prerequisites; root then compiled and refreshed the actual Tauri shell and CLI in the isolated `Dockerfile.desktop` build without installing host GUI packages. The verified outputs at that record were `artifacts/linux-desktop/Household Share_0.1.0_amd64.deb` (7,099,224 bytes, 6.77 MiB) and a separate `household-share-cli` (5,389,072 bytes). The exported Debian package is the exact package used in the isolated GUI lifecycle check below (SHA256 `0499a46f34c059b4a6df2c494a2cf58989caf349acf662e46197f9084bd4a191`). The Debian archive contains the executable, launcher, icon and declared runtime dependencies; its executable contains the then-frozen `index-CdZF0CLg.js` / `index-B_mvSAqO.css` asset names, predating the Mac packages above. A Linux cross-target Mac check stopped at missing Apple Objective-C compiler/SDK; the later native ARM64 and Intel builds passed separately.

The server owner also ran the actual Linux GTK/WebKit shell from a separately generated package in the existing dependency container, as recorded in [server validation](../../server/VALIDATION.md#linux-desktop-runtime-in-an-isolated-dependency-container). With a private Xvfb display, UID 1000, separate XDG/D-Bus state and networking disabled, the connection window rendered, normal close hid it while its process survived, the hotkey and a second instance reopened it, the actual tray Quit action invoked over D-Bus exited 0, and relaunch succeeded. No extra packages or sandbox-disable flag were used. This unpaired container run did not exercise an active transfer, clipboard/dialog commands, desktop-panel tray interaction or host installation. Direct host execution still lacks WebKit runtime libraries. Mac GUI installation/Quick Actions and household-device lifetime remain unperformed; the native-engine transfer and isolated shell results do not establish their combined behavior under screen lock or network interruption.

`native/tests/protocol.rs` contains real-loopback HTTP tests for multi-chunk upload/download, restart, pause/resume, source changes, tus cancellation, invalid ranges, changed ETags and protecting existing destinations. Core unit tests cover private-origin validation, private durable capture, exclusive process ownership, redacted transfer views and corrupt queue handling. Run them with the Cargo command above when the toolchain is available. `integrations/macos/test_capture.py` verifies exact safe argument/stdin passage with a fake helper on Linux; it does not validate macOS facilities.

Before device acceptance: install/open the matching accepted ad-hoc 0.1.1 package on household Apple Silicon and Intel Macs, exercise the paired desktop native adapter with the shared React UI, test active-transfer window-close/Quit/recovery and original path lifetime on household desktops, test Quick Actions and representative sharing apps, repeat the actual 20 GB/GiB transfer on household devices and Tailscale across network loss, and test destination disk exhaustion. The headless loopback queue/server restart/checksum checks, isolated Linux shell lifecycle checks and both native Mac package checks have passed separately; physical-desktop and active-transfer UI lifetime remain unperformed. Android has its own engine/build/validation report under `clients/android/`, including root's separately executed API36 emulator checks.
