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

The approved project-local Rust/Cargo toolchain compiled the native engine and CLI. The current suite passes **15 Rust tests** (4 unit + 11 protocol). The reviewer independently reproduced and closed all three destination/validation/cancellation defects against real Go servers; see `quality/desktop-review.md`. After those fixes, a **33,555,133-byte** live round trip passed with both queue/server restarts and matching SHA-256 (`native-live-after-review.json`).

An earlier actual **20 GiB (21,474,836,480 bytes)** native-engine upload/download against the real Go server passed with queue and server restarts in both directions, matching source/download SHA-256. Peak native RSS was **27,000 KiB** and elapsed time **175.24 seconds**. That run predates the three targeted QA fixes; the post-fix 32 MiB round trip and regression tests verify the updated paths separately. The deterministic source was a sparse zero-filled file; every payload byte traveled through HTTP to real server/download storage. See `VALIDATION.md` and `native-live-20gib.json` for the boundary and reproducible command.

The Tauri CLI parsed the configuration, which also passed its JSON Schema. Host Linux shell compilation stopped at absent pkg-config/GTK/WebKit prerequisites; root then compiled and refreshed the actual Tauri shell and CLI in the isolated `Dockerfile.desktop` build without installing host GUI packages. The verified current outputs are `artifacts/linux-desktop/Household Share_0.1.0_amd64.deb` (7,099,224 bytes, 6.77 MiB) and a separate `household-share-cli` (5,389,072 bytes). The exported Debian package is the exact package used in the isolated GUI lifecycle check below (SHA256 `0499a46f34c059b4a6df2c494a2cf58989caf349acf662e46197f9084bd4a191`). The Debian archive contains the executable, launcher, icon and declared runtime dependencies; its executable contains the frozen `index-CdZF0CLg.js` / `index-B_mvSAqO.css` asset names. A macOS-target check stopped at missing Apple Objective-C compiler/SDK.

The server owner also ran the actual Linux GTK/WebKit shell from a separately generated package in the existing dependency container, as recorded in [server validation](../../server/VALIDATION.md#linux-desktop-runtime-in-an-isolated-dependency-container). With a private Xvfb display, UID 1000, separate XDG/D-Bus state and networking disabled, the connection window rendered, normal close hid it while its process survived, the hotkey and a second instance reopened it, the actual tray Quit action invoked over D-Bus exited 0, and relaunch succeeded. No extra packages or sandbox-disable flag were used. This unpaired container run did not exercise an active transfer, clipboard/dialog commands, desktop-panel tray interaction or host installation. Direct host execution still lacks WebKit runtime libraries. Mac installation/signing/Quick Actions and household-device lifetime remain unperformed; the native-engine transfer and isolated shell results do not establish their combined behavior under screen lock or network interruption.

`native/tests/protocol.rs` contains real-loopback HTTP tests for multi-chunk upload/download, restart, pause/resume, source changes, tus cancellation, invalid ranges, changed ETags and protecting existing destinations. Core unit tests cover private-origin validation, private durable capture, exclusive process ownership, redacted transfer views and corrupt queue handling. Run them with the Cargo command above when the toolchain is available. `integrations/macos/test_capture.py` verifies exact safe argument/stdin passage with a fake helper on Linux; it does not validate macOS facilities.

Before release: compile on macOS, exercise the paired desktop native adapter with the shared React UI, test active-transfer window-close/Quit/recovery and original path lifetime on household desktops, build/sign/install ad-hoc on the Mac, test Quick Actions and representative sharing apps, repeat the actual 20 GB/GiB transfer on household devices and Tailscale across network loss, and test destination disk exhaustion. The headless loopback queue/server restart/checksum checks and isolated Linux shell lifecycle checks have passed separately; physical-desktop and active-transfer UI lifetime remain unperformed. Android has its own engine/build/validation report under `clients/android/`, including root's separately executed API36 emulator checks.
