# Android installed client

This Android client has a native Kotlin transfer queue and two packaging entry points: the standalone Gradle application under `app/`, and the Tauri 2 Android shell under `src-tauri/` with a real Kotlin mobile plugin under `tauri-plugin/`. Both reuse the same queue/service/source-access files, with a locally bundled copy of the common React interface. Distinguish the standalone `app-debug.apk` from the Tauri Android APK; build and validation evidence for each is recorded in `VALIDATION.md`. Neither queue depends on JavaScript or a WebView staying alive. Minimum supported Android is 8.0 / API 26; target/compile SDK is 36.

## Build and local installation

Prerequisites: JDK 17, Android SDK platform 36 and Android build tools, Node/project frontend dependencies. Do not install absent toolchains or SDK packages without the operator's approval. Gradle/project dependencies are ordinary project dependencies.

From the repository root, build the frontend with `pnpm --dir web build`. Then:

```sh
cd clients/android
export ANDROID_HOME=/path/to/Android/Sdk
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
# Updating the same signing identity:
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The default debug build is locally signed using Android's local debug keystore. It needs neither an app store nor a developer account. Preserve the signing key for compatible future updates; use a dedicated locally held release key before household distribution beyond experimentation. Installing an APK onto a device is a separate operator action, not performed by the build. ADB/USB debugging setup is documented by [Android](https://developer.android.com/tools/adb); Google's [verification FAQ](https://developer.android.com/developer-verification/guides/faq) describes the account-free ADB exemption. Android's future non-ADB installation paths may vary by region/software.

The UI/zoom update uses version name `0.1.1`: standalone version code `2`, Tauri version code `1001`. The previous Tauri APK actually used code `1000` (Tauri's default semver mapping), so code `2` would downgrade that installed app. Tauri's code is now explicit in `src-tauri/tauri.conf.json`; both application IDs and the existing signing certificate are retained.

For the Tauri shell, additionally use the approved project-local Rust toolchain, installed `aarch64-linux-android` target and NDK 27.1.12297006 (or explicitly configured compatible NDK). The existing desktop CLI dependency is reused. After building `web/dist`, run `ANDROID_HOME=/path/to/Android/Sdk ./build-tauri.sh` from this directory. The retained ARM64 APK is `build/outputs/household-share-tauri-aarch64-debug.apk`. For an x86_64 emulator, use an already installed `x86_64-linux-android` target and `HOUSEHOLD_ANDROID_TARGET=x86_64 ANDROID_HOME=/path/to/Android/Sdk ./build-tauri.sh`; its separate output is `build/outputs/household-share-tauri-x86_64-debug.apk`. This script does not install toolchains, targets or SDKs. The checked-in generated project is pinned to Gradle 8.13, AGP 8.12, SDK36/min26 and disables broad debug cleartext access. The script preserves 16 KiB ELF alignment with NDK27. Tauri's plugin dispatch is granted only to the bundled main window; the Kotlin native API still enforces the paired destination.

The plugin adapts metadata commands directly and hands Android document pickers/source reselection to the same native intake Activity. Picking files may briefly open that Activity; it returns to Tauri when the picker finishes. ACTION_SEND still enters the native intake Activity, and jobs continue independently. Tauri host and standalone identifiers differ and consequently have separate app-private queues/configuration; install the intended variant rather than expecting cross-app queue migration.

The Tauri plugin observes its owning Activity lifecycle, including registration after that Activity has already resumed. Copy, picker opening and visible transfer starts check the current resumed state on the UI thread; background commands cannot infer visibility from a stale plugin callback. Lifecycle registration also rereads the durable queue on cold launch and later resumes, including after the native Save picker returns. Both wrappers serialize Resume's small queue mutation and scheduling on the UI thread, checking visibility before changing persisted state and again before starting work. A rejected background Resume preserves the paused row; background Pause/Cancel remain available. This boundary has JVM lifecycle and command regression coverage; emulator and physical-device execution remain distinct checks.

Both installed wrappers apply the same `AppWebViewPolicy.kt` on the UI thread. It enables viewport-meta support, uses the document's initial scale and Android display density, disables overview shrinking and turns off built-in pinch/double-tap/page-zoom controls. Standalone applies it before navigation; Tauri applies it to the actual WebView in its checked-in Kotlin plugin's `load` callback. No generated Activity patch is needed. The shared HTML supplies `width=device-width, initial-scale=1`; responsive CSS must fit the viewport instead of shrinking the body. WebView/system text scaling, selection, scroll, focus and keyboard handling are retained: the policy does not force `textZoom`, intercept gestures or disable input focus. Android screen magnification remains an OS accessibility feature. See `VALIDATION.md` for the exact packaged-build and gesture checks performed.

Open the app, enter the HTTPS Tailscale Serve origin and configured application token, then connect. Tokens remain in this app's private preferences and native HTTP requests use bearer authentication. Android backup is disabled. For emulator/local development only, explicitly pass `allowInsecureLoopback: true` to `native_configure` for an HTTP `localhost`, `127.0.0.1`, or `[::1]` origin; public cleartext addresses are rejected. Use `adb reverse` for an already authorized local development server if needed. The client does not configure Tailscale, bind a public server, or enable Funnel.

## Transfers and source access

- Android 14+ uses a native user-initiated `JobService`, scheduled while the activity is visible, with mandatory progress notification, network constraint and estimated remaining bytes. The minimum network chunk is the lesser of 8 MiB and the remaining known bytes; it is omitted for unknown lengths or zero remaining bytes. This avoids Android rejecting an unknown-size download or a final remainder smaller than one chunk. Each transfer is independently scheduled. Scheduling failure is reported, never represented as successful background execution.
- Android 8–13 uses a visible-started `dataSync` foreground service with a partial wakelock and notification. Its lock is renewed while work progresses. Connection failures in this fallback require visible Resume. The modern path avoids Android 15+ `dataSync` time budgets and Android 16 long-running WorkManager quota issues.
- SQLite stores IDs, 64-bit size/confirmed offset, state, source/destination, original server, tus URL/item ID, ETag and source fingerprint. Per-chunk progress is committed; no shutdown callback is required for recovery. On reboot or force-stop, reopen the app to restart queued work. Explicit Pause remains paused. Job/queue persistence and source permissions are distinct concerns.
- Uploads stream using 64 KiB buffers and 8 MiB tus PATCH requests. Each retry performs HEAD and validates offset/length before sending. A dropped PATCH response does not cause blind repetition. Redirects and cross-origin upload locations are rejected; tokens never follow redirects.
- A full tus offset is followed by an item-status probe. Only a matching `ready` item becomes `completed`; `failed` validation remains an error on Resume, and `uploading` becomes `validating` with its staged source retained until ready/failed. This includes text whose final PATCH returned 422 for invalid UTF-8. A Cancel racing with final completion probes the item after tus DELETE 409/422: already-ready content settles complete and remains shared. Cancel never silently invokes the item Delete API. Pending validation/cancellation stays visible, with delayed retries.
- Full source SHA-256 is read with bounded memory before every start/resume and again before the final upload chunk. A saved fingerprint must match before resumption. This adds local read time (particularly for 20 GB files) rather than accepting a same-size changed source. Metadata is checked while transferring. An actively changing provider cannot offer an immutable snapshot; use a stable source or explicitly stage one.
- Android Share supports ACTION_SEND/ACTION_SEND_MULTIPLE files and EXTRA_TEXT. The document picker uses ACTION_OPEN_DOCUMENT and takes persistent read access. Non-seekable/unknown-size sources or temporary share permissions trigger an explicit choice: stage one durable private copy, select a document with persistent access, or cancel. No multi-GB staging copy is made silently. Staging is streamed, enforces 20 GiB maximum and a 64 MiB free-space reserve, and restarts rather than appending after interruption. A source that disappears or loses permission becomes `needs_source`; Resume opens native reselection. The full fingerprint is checked before resuming a reselected upload.
- Downloads use a Save dialog with persistent destination permission. They stream byte ranges into a private `.part`, require a strong unchanged ETag and exact range/length, fsync each chunk, and commit the corresponding offset. The server's `"sha256-…"` ETags also trigger a bounded-memory full checksum comparison before export. They then stream the completed private file to the selected destination and report success only after closing that output. This final export may need an additional full file's worth of destination storage, and is restarted after interruption. The selected destination is initially empty and may show a partial file during an interrupted export; the queue remains unfinished until export succeeds. The private resumable copy is kept until completion/cancellation. Destination provider failures can require selecting a different destination.
- Pause/Cancel/Resume are available through the queue and notification. Notification Resume opens the activity, providing explicit user initiation. Cancel removes the incomplete server upload when connected; failed termination remains visibly pending. Cancelling while offline does not pretend the server has removed its partial data. A lost response to initial tus creation can leave an orphaned server upload; server abandoned-upload retention/cleanup is needed because tus creation itself has no idempotency key in the current API.

The local client limit is 20 GiB (21,474,836,480 bytes), which includes a 20 decimal GB file. Server configured limits can be lower. Android/system/user interruption, loss of Tailscale, low storage, provider removal, and user force-stop can stop work. Persistent resume is the recovery mechanism; uninterrupted execution under every OS condition is not promised.

## Interface bridge

Only packaged frontend files execute in the privileged standalone WebView, at `https://appassets.androidplatform.net`. Remote privileged navigation, remote subresources, frames, file:// and content:// loading are blocked. External user-clicked web links open outside the app. Tauri uses its own bundled local origin, restrictive CSP and main-window-only plugin capability. Native HTTP is independent and authenticates the configured server. Both wrappers expose `window.__HOUSEHOLD_NATIVE__`; the shared `web/src/native-platform.ts` adapter consumes it before React loads. The Android-specific duplicate adapter was removed. The adapter carries metadata, bounded text and commands, never file bytes or transfer lifetime.

```ts
window.__HOUSEHOLD_NATIVE__.platform // 'android'
window.__HOUSEHOLD_NATIVE__.invoke(command, args) // Promise<JSON>
```

| Command | Arguments / result |
| --- | --- |
| `native_configure` | `{baseUrl,token,sourceDevice?,allowInsecureLoopback?}` → `{baseUrl,sourceDevice}` |
| `native_get_config` | `{}` → saved `{baseUrl,sourceDevice,connected}`, without token; retained origin is available after disconnect |
| `native_disconnect` | `{}` → void; pauses all active/queued entries, cancels active API requests and erases the saved token |
| `native_list_transfers` | `{}` → `[{id,direction,name,size,offset,status,itemId,error?}]` |
| `native_pick_uploads` | `{kind?:'file'|'text',sourceDevice?:string}` → void after native picker |
| `native_enqueue_upload` | `{path: contentURI,kind?:'file'|'text'}` → void; Android accepts document URIs, not arbitrary filesystem paths |
| `native_download` | `{itemId,name}` → transfer ID, or null on Save-picker cancel |
| `native_control` | `{id,action:'pause'|'resume'|'cancel'}` → transfer; Resume on `needs_source` invokes native picker |
| `native_copy_text` | `{text}` → `{ok:true}` only after clipboard write returns successfully |
| `native_api` | `{method,path:'/api/...',body?:string|object,requestId?:string}` → `{status,body:string,headers}` |
| `native_cancel_api` | `{requestId}` → void; best-effort OkHttp cancellation, including abort-before-start races |

States: `queued`, `running`, `hashing`, `staging`, `exporting`, `validating`, `retry_wait`, `paused`, `needs_source`, `error`, `cancelling`, `cancelled`, `completed`. `completed` upload requires a matching application item with status `ready`, including successful integrity/UTF-8 validation. UI polls native transfers/feed metadata and routes native requests through `native_api`. The API bridge rejects file upload/download and SSE routes; native transfers handle bytes. Text preparation and native clipboard writes are capped at 8 MiB; metadata responses at 2 MiB; request JSON at 40 MiB. Larger text uses full `.txt` download. The shared interface separately limits expanded in-page text to 256 KiB. No truncated preview is copied. The bridge does not convert file contents to JavaScript or base64 (only small tus metadata fields use protocol-required base64).

## Verification boundary

Actual checks are recorded in `VALIDATION.md`. Unit tests cover 64-bit offsets/ranges, URL/token destination boundaries, explicit loopback opt-in, unsafe names, request cancellation races, disconnect generations, legal remaining-byte estimates and real AndroidX lifecycle registration/resume command gating (27 total Kotlin tests). Build/lint do not establish Android lifecycle behavior or successful 20 GB transfers.

Root's final 0.1.1 x86_64 APK passed installed cold launch, native text submission, exact Copy followed by Android Paste, zero browser API requests, scale 1 with no horizontal overflow and 16 px inputs. With the actual OS keyboard visible, the full Share action remains above the measured IME bounds; the edge-to-edge WebView does not shrink its layout height. CDP synthetic pinch and double tap retain scale 1, but the old APK baseline did too, so the user's physical-phone zoom issue is not reproduced or proven by this emulator. Evidence is `validation/api36-ui-0.1.1.json`. The same final APK also passed actual Save/unknown-length UIDT/range download/SAF export of 33,555,133 bytes matching the original SHA-256. The first harness timeout stopped at a first-use notification permission prompt; root allowed the inspected prompt and verified the original transfer without restarting it. The fixture was seeded through the server API, so this is download evidence rather than an Android upload.

The prior 0.1.0 APK separately passed Save/unknown-length UIDT download/SAF export of 33,555,133 bytes with the original SHA-256, preserved in `validation/api36-emulator.json`. This older result is not relabeled as a 0.1.1 transfer. The actual-phone and large-file checks below remain open.

Before claiming release readiness, use the actual household phone and server to:

1. Install/update using the preserved local key and ADB without a developer account; test share from actual sending apps and text/Unicode clipboard failure behavior.
2. Upload and download a 20 GB file; compare a SHA-256 checksum of original and final downloaded file. Observe memory use rather than inferring it from code.
3. Lock screen, dismiss the activity, lose/recover Wi-Fi and Tailscale, kill the process, restart server, reboot device, and resume. Treat Task Manager Stop/force-stop as explicit user interruption requiring reopening.
4. Pause/resume/cancel online and offline, including races with creation/final chunk, expired URI grants, changed/replaced same-size sources, non-seekable providers, and unknown lengths.
5. Exhaust local/server storage and deny authentication; confirm no unfinished file is marked ready. Check failed/partial destination export and provider reselection.
6. Exercise Android 8–13 fallback and Android 14+ UIDT separately, including notification permission denial and OS stop/reschedule.

Primary platform references: [UIDT scheduling/stopping](https://developer.android.com/develop/background-work/background-tasks/uidt), [document persistence](https://developer.android.com/training/data-storage/shared/documents-files#persist-permissions), [FGS start limits](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [FGS timeout limits](https://developer.android.com/develop/background-work/services/fgs/timeout).
