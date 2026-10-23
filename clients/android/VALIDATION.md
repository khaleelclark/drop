# Android validation record

Checked 2026-10-22–23 in the shared Linux build workspace. This record distinguishes standalone Gradle packaging, Tauri Android packaging and actual device evidence.

## Installed viewport and page zoom correction

The user reported an enlarged initial layout and pinch zoom in the installed Android app. Inspection found neither wrapper configured viewport or zoom settings. The generated Tauri `MainActivity` only calls `enableEdgeToEdge()` and its superclass; Wry creates a `RustWebView`, then Tauri's plugin manager delivers that actual WebView to `HouseholdPlugin.load`, including late registration. The durable correction lives in shared checked-in Kotlin source, not in generated Activity/framework files.

Root measured the prior x86_64 APK (`41be98fc...`) in the isolated `Household_UI_API36` Pixel 7/API36 emulator. The complete `.tools/ui-redesign/android-baseline.json` records CSS inner/client/scroll/screen width 412, DPR 2.625 and `visualViewport.scale` 1 before and after a DevTools touch-pinch attempt at scale 1.8, with no pinch error. That single gesture did not reproduce the user's physical-phone behavior; it also cannot establish that zoom is disabled. The native policy is an explicit requested setting, while final cold-launch/layout/safe-area/keyboard metrics and gesture checks remain root-owned runtime evidence. The Android engineer has not interacted with this emulator.

`AppWebViewPolicy.kt` is called on the UI thread by both `MainActivity.onCreate` (before `loadUrl`) and `HouseholdPlugin.load`. It enables viewport-meta support, disables overview shrinking, sets initial scale to Android's default document/density calculation (0), and disables support/built-in/display zoom controls. The shared HTML/CSS owner supplies the responsive viewport and input sizing. The policy leaves `textZoom`, font sizes, touch events, focus, selection, scrolling and IME behavior alone; there is no body shrink/transform or gesture interception. Android system magnification is outside app page zoom.

The existing APK signer certificate SHA-256 was recorded before rebuilding: `d0904d093ae1b5f11d5aab2376a2592c9a9b97cfa0c0e376165a6d6a12de4e9a`. All three final 0.1.1 APKs retain this certificate. Final regression checks pass with the policy compiled: 22 standalone plus 5 plugin tests (0 failures/errors/skips), standalone assembly, standalone lint (0 errors/6 warnings), plugin lint (0/14) and Tauri app lint (0/37 plus 1 hint). Commands match the offline Gradle checks below; final logs are `build/zoom-final-standalone-check.log` and `build/zoom-final-plugin-check.log`. No new JVM test claims gesture behavior: the change uses Android WebSettings directly, and root owns installed gesture/layout verification. Root approved the coordinated frontend freeze, and all three 0.1.1 packages below match it. Root's final installed cold-launch/text/clipboard/layout/keyboard, synthetic gesture and 33,555,133-byte download/SAF checks now pass. Runtime evidence below distinguishes 0.1.1 from the prior 0.1.0 APK.

Platform behavior references: [Android WebSettings](https://developer.android.com/reference/android/webkit/WebSettings) documents viewport-meta support, overview mode and zoom controls; [WebView.setInitialScale](https://developer.android.com/reference/android/webkit/WebView#setInitialScale(int)) documents the default viewport-based calculation.

Versioning for this user-visible update is `0.1.1`. The standalone code increases from 1 to 2. The actual prior Tauri APK and generated `tauri.properties` use code 1000, not 1, because Tauri derives its default code from semver. Its next explicit code is 1001 so normal `adb install -r` does not require a downgrade. Root retains all emulator/ADB interactions; no Android device calls are performed by this source/build work.

## Source and contract checks

Read `AGENTS.md`, the full architecture proposal, `docs/api-contract.md`, `clients/shared/native-contract.md` and its fixture. All Android writes are under `clients/android/`; the app consumes the shared `web/dist` build without editing it.

The native queue persists 64-bit offsets, original server, source fingerprint, tus URL/item ID, destination and ETag in SQLite. File transfer buffers are 64 KiB and tus chunks are 8 MiB. Neither wrapper sends file contents through JavaScript. Both expose the command mechanism to the shared `main.tsx` / `native-platform.ts` bootstrap; the old Android-specific PlatformAdapter and its tests were removed rather than shipped as a bypass.

Final upload completion probes the matching application item after a full HEAD/PATCH. Invalid UTF-8 validation stays failed after Resume even when the tus offset is full. Pending validation retains staging. Cancel after a lost final acknowledgement reconciles tus DELETE 409/422 by probing the item: ready settles completed without deleting household content, failed stays an error, pending stays visible. Reopening recovers running/hashing/staging/exporting rows only when no worker or pending OS job owns them. The legacy service serializes completion and new start commands, drains newly queued work and delays validation polling rather than spinning.

Both wrappers implement `native_disconnect`, `native_cancel_api({requestId})`, redacted config including `connected`, response headers, native source/save pickers and clipboard error propagation. Disconnect pauses work, cancels requests and erases the sole saved token; transfer rows do not contain tokens and keep their original server. API text responses/clipboard are bounded to 8 MiB, metadata to 2 MiB, submitted JSON to 40 MiB. Expanded DOM text is bounded separately by the shared interface to 256 KiB.

Root's installed API36 x86_64 Tauri smoke exposed an actual cold-launch defect: the plugin's callback-only `visible` flag stayed false when plugin creation happened after the Activity's first `onResume`, so Copy rejected `Open the app to copy`. The plugin now observes the owning AndroidX lifecycle, catches up at late registration, recovers queued work on resume and checks current `RESUMED` state on the UI thread before Copy, picker opening or transfer start. Finishing/destroyed activities are rejected. This does not relax visible-start UIDT scheduling. Root subsequently confirmed the rebuilt final APK's cold-launch Copy/picker paths by actual emulator execution, separately from the JVM tests; details are below.

The Save helper may receive `onActivityResult` while still paused, persist a queued download and immediately finish its handoff. Scheduling therefore does not rely on that helper resuming: the returning Tauri Activity's lifecycle observer rereads `QueueStore.all()`. Root's rebuilt-APK Save/UIDT/SAF export check passed on the API36 emulator.

Root also reproduced Android's `Minimum chunk size can't be greater than estimated network usage` rejection on an unknown-size queued download. `TransferPolicy.networkEstimate()` is now consumed directly by `TransferScheduler.startVisible()`: unknown bytes stay -1 with no minimum chunk, known zero remaining bytes use estimate 0 with no minimum, and positive known estimates/minimum chunks derive from remaining bytes rather than original total size. Invalid lengths/offsets reject before JobInfo creation. The quality reviewer separately found Resume changed a paused row before its foreground check; both wrappers now invoke shared `TransferControlCommand` synchronously on the UI thread, checking visibility before mutation and next to scheduling. Background Pause/Cancel still persist control without starting new background work. No device execution of these corrections is inferred from the policy tests.

## Actual build and unit evidence

Used the pre-existing OpenJDK 17.0.20.1, Android SDK platform/build-tools 36, NDK 27.1.12297006, Gradle 8.13, AGP 8.12.0 and Kotlin 2.2.10. The approved project-local Rust toolchain was reused, including its approved ARM64 target; only the approved project-local `x86_64-linux-android` standard-library component was added for the existing emulator. No OS package, language toolchain or Android SDK/NDK installation was performed by the Android engineer. Ordinary project dependencies were resolved through Cargo/Gradle.

From `clients/android/`:

```sh
ANDROID_HOME=/home/phoenix/Android/Sdk ./gradlew --offline --no-daemon :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
ANDROID_HOME=/home/phoenix/Android/Sdk ./build-tauri.sh
HOUSEHOLD_ANDROID_TARGET=x86_64 ANDROID_HOME=/home/phoenix/Android/Sdk ./build-tauri.sh
```

The final standalone command succeeded. JUnit reports contain **22 tests, 0 failures, 0 errors**:

- `TransferPolicyTest`: 11 tests covering HTTPS/explicit loopback, origin restrictions, 64-bit offsets, exact ranges, safe names, all orphaned active states, preservation of pauses/live ownership, new work versus delayed retries, unknown download estimates, zero/full lengths, sub-chunk final remainders and invalid estimate inputs.
- `ApiCallsTest`: 4 tests covering abort-before-registration, active socket cancellation, disconnect racing with registration and reconnect generations.
- `UploadCompletionTest`: 7 tests covering repeatedly failed validation after full offset, pending-to-ready validation with cleanup gated on readiness, lost final acknowledgement/Cancel conflict, failed/pending Cancel conflicts, mismatched item metadata and missing/unknown item states.

These are JVM unit/policy tests with mocked item metadata, not Android device or live-server reproductions. The completion tests exercise the same readiness gate used by the engine; they do not establish Android service behavior.

After the corrections, ran `:tauri-plugin-household:testDebugUnitTest :tauri-plugin-household:lintDebug` from the generated Tauri Gradle project, with the same offline/native-task exclusions and ABI properties shown below. The plugin's **5 additional `ResumedActivityGateTest` tests pass with 0 failures/errors/skips**, for **27 total Kotlin tests** across standalone and plugin reports. Tests use a real AndroidX `LifecycleRegistry`: already-resumed late registration requires no background/foreground cycle; pause rejects and resume reopens the gate; early registration cannot start before resume; destruction and observer removal prevent stale starts. Command coverage uses the production shared command boundary with a `Transfer` row: background Resume leaves every paused/error/retry/attempt field unchanged and schedules nothing; visible Resume schedules; background Pause/Cancel can change control state without scheduling. The test row is in memory, not real Android SQLite or JobScheduler. Plugin lint remains **0 errors / 14 warnings**. The plugin test dependency is ordinary JUnit; no SDK/toolchain was installed for this fix.

Standalone lint reports **0 errors, 6 warnings**: target API36 rather than the newest platform, JavaScript required for bundled React, and four conservative free-space checks instead of system-cache allocation. No lint baseline/suppression was added. The installed SDK XML reader-version warning does not prevent compilation.

The first Tauri lint invocation in offline mode could not resolve uncached Android test dependencies. A normal project dependency resolution completed. Lint then found two generated-template Android TV declarations without matching TV resources; this household phone app no longer advertises the unused TV launcher. No lint suppression was used.

Final Tauri checks succeeded with `ANDROID_HOME=/home/phoenix/Android/Sdk ./gradlew --offline --no-daemon :tauri-plugin-household:testDebugUnitTest :tauri-plugin-household:lintDebug :app:lintUniversalDebug -x :app:rustBuildUniversalDebug -PabiList=x86_64 -ParchList=x86_64 -PtargetList=x86_64` from `src-tauri/gen/android/`. The excluded task would rerun native compilation; both actual CLI target builds had already compiled Rust. Reports show **0 errors / 37 warnings / 1 hint** in the generated Tauri app, and **0 errors / 14 warnings** in the Kotlin plugin. Remaining diagnostics cover dependency/tool updates, unused template resources, generated-code style/view constructors, JavaScript and conservative free-space checks; they are not suppressed.

Both Tauri target builds compile the Rust shell and real Kotlin mobile plugin against the same native queue, using the shared UI build. Rebuilt both targets and standalone for 0.1.1 after the shared viewport policy, version bump and final approved web freeze. Final logs are `build/zoom-tauri-aarch64.log`, `build/zoom-tauri-x86_64.log`, `build/zoom-final-standalone-check.log` and `build/zoom-final-plugin-check.log`. `build-tauri.sh` retains one APK per ABI and recreates the generated APK to avoid stale AGP incremental ZIP holes. Rust debug information stays outside the installable APK; ELF load segments use 16 KiB alignment. Build output warnings about inability to strip an already reduced native library are recorded separately from actual signing/alignment verification.

## Deliverables verified at final handoff

- Standalone APK: `app/build/outputs/apk/debug/app-debug.apk`, application ID `household.share.android`.
- Primary Tauri ARM64 APK: `build/outputs/household-share-tauri-aarch64-debug.apk`, application ID `net.household.share.mobile`.
- Emulator Tauri x86_64 APK: `build/outputs/household-share-tauri-x86_64-debug.apk`, same Tauri application ID.
- Both wrappers use separate app-private queues/config when their application IDs differ; no migration between the standalone and Tauri application is claimed.
- Kotlin application, services, store, source access, API cancellation registry, upload readiness gate, shared `TransferControlCommand.kt` and `AppWebViewPolicy.kt`, Android resources/manifest and three JUnit test files.
- Tauri `src-tauri/` shell/config/capability/lockfile and generated Android Gradle project; `tauri-plugin/` Rust/Kotlin plugin, `ResumedActivityGate.kt`, its lifecycle regression test, init script, permission files and manifest; `build-tauri.sh`.
- Gradle wrapper/configuration, `README.md`, this record and preserved runtime evidence `validation/api36-emulator.json` (0.1.0) and `validation/api36-ui-0.1.1.json`.

All named files above were checked with file tools. After the corrections and runtime documentation update, checked 47 named source/configuration/doc/test/evidence files and all three APKs; the full record is `build/final-package-verification.json`. The old `native-adapter.js` is absent from both source and all three APKs. Every `web/dist` file in the standalone and both Tauri APKs matches the final shared build byte for byte (`index-BRmFLqLf.js` / `index-BJCLriK5.css`). The shared WebView policy, command and estimate classes are present in all three APKs; the lifecycle gate is present in both Tauri APKs. Both native ELF files also contain the final embedded JS/CSS asset names.

`apksigner verify --verbose <apk>` passes for all three, with one signer and APK Signature Scheme v2. `zipalign -c -P 16 4 <apk>` passes for all three. Both packaged native ELF files were read directly from their APK: each has four LOAD segments with alignment 16384 and congruent virtual/file offsets. `bash -n build-tauri.sh` and `node --check tauri-plugin/src/init.js` pass.

| APK | Bytes | SHA-256 |
| --- | ---: | --- |
| Standalone `app-debug.apk` | 2,601,988 | `8fba39fa1dcedb8cb9034b4c621b47d9773f4d32268d98474f859192093daedb` |
| Tauri ARM64 | 29,751,811 | `2f604eebec1e4ff747d971a5ffd906030a0a55825ddac21486eb4169db916719` |
| Tauri x86_64 | 29,427,752 | `c7d35a61839a861b031acca3d5ab2318099502e928fb905c9eb0d6264a56e5f0` |

Root-approved frozen frontend SHA-256: `index.html` = `cae49b93fd6e129763426826d06b0a01400aff3d0081c1dcc02bfbf99b004b12`; `assets/index-BRmFLqLf.js` = `7b9d352b50cf22fe210ec3f2beefcc9aab69cfc031ca4ff07860366b200dbc0e`; `assets/index-BJCLriK5.css` = `923cdcd2d222832fd9d84862052b1353021ea69336aabe863511bffed0de553a`. The full nine-file digest manifest is in `build/final-package-verification.json`. Actual APK badging confirms standalone code 2 and both Tauri codes 1001, all version name 0.1.1 and minSdk 26.

## Root-owned 0.1.1 emulator evidence

Root installed the retained x86_64 APK `c7d35a61839a861b031acca3d5ab2318099502e928fb905c9eb0d6264a56e5f0` over the previous app with code 1001 in the isolated `Household_UI_API36` Pixel 7/API36 emulator. The Android engineer read the complete saved text/keyboard, synthetic zoom and final download reports and preserved them in `validation/api36-ui-0.1.1.json`, without running device commands or rebuilding.

- Cold launch passes native bootstrap, actual UI send through Kotlin HTTP, exact Unicode/whitespace Copy followed by Android Paste, and zero browser API requests.
- Initial scale is 1, CSS/content width is 412 with no horizontal overflow, and both visible inputs measure 16 CSS px.
- The actual OS keyboard is visible and the full Share action remains uncovered: its bottom is about 374.52 CSS px, above the measured IME top at 577.90 CSS px. The edge-to-edge WebView keeps `innerHeight` 915; the passing check measures actual IME bounds instead of assuming the viewport shrinks. No resize claim is made.
- CDP synthetic touch pinch and double tap leave scale 1 and width 412. The old APK baseline also stayed at scale 1, so these results do not reproduce or prove the user's physical-phone behavior.

Root's separate `.tools/ui-redesign/android-download-final.json` confirms actual Save, notification permission, unknown-length UIDT scheduling, native range download, private resumable storage and completed SAF export of **33,555,133 bytes** on this same 0.1.1 APK. The exported file matches the original SHA-256 `7e4bf9b31f038d63cc3acd6f742d39e933ca01b57b17dcbed1cb017a68f22967`. The first harness timeout occurred at the first-use notification permission prompt; root inspected and allowed it, then verified the same original transfer without restarting it. This was a server-seeded fixture, not an Android upload. The older `android-download.json` remains separate 0.1.0 history. Physical-phone, actual touch-gesture, screen-lock, memory and 20 GB checks remain unperformed.

## Prior 0.1.0 runtime evidence and release boundary

`adb devices -l` initially showed no devices. Root subsequently started the existing disposable API36 x86_64 AVD as `emulator-5580`; the Android engineer observed it via ADB and prepared its x86_64 Tauri APK. No emulator was started or physical phone installed/modified by the Android engineer.

In the prior 0.1.0 validation cycle, root installed the x86_64 APK with SHA-256 `41be98fc9a8161397d5dbd0ba6f0f5c2a2ca86602a1221262f6e473ef55f0cae` and reported both runtime blockers closed by execution. The Android owner read the complete saved `.tools/validation/android-emulator.json` and `.tools/validation/android-download.json` reports and preserved them, with APK provenance and remaining limits, in `validation/api36-emulator.json`. The installed APK hash comes from root's runtime result; its retained bytes were independently checked by the Android owner.

- Cold launch after force-stop/fresh Activity start, without a Home/return cycle: automatic native bootstrap, explicit loopback development pairing, redacted config, actual UI text submission through Kotlin native HTTP, exact text/headers, native Copy plus Android Paste preserving Unicode/whitespace, and no browser API requests passed.
- Actual Android Save picker, unknown-length UIDT scheduling, native range download into the private resumable file and completed SAF export passed for **33,555,133 bytes**. The final row is `completed` with offset equal to size. The exported device file matches the original/source/server SHA-256 `7e4bf9b31f038d63cc3acd6f742d39e933ca01b57b17dcbed1cb017a68f22967`.
- Root's reproduction harnesses are `scripts/android-emulator-smoke.cjs` and `scripts/android-emulator-download.cjs`. The earlier test-driven webview reload was removed from the cold-launch harness; it is not part of the final passing evidence. No new emulator runs, unit tests or builds were performed by the Android owner when incorporating these reports; package bytes remained unchanged.

No Android 20 GB transfer, memory measurement, locked-screen transfer, physical-device share/clipboard test, UIDT stop/reschedule, transfer recovery after reboot/force-stop, provider-grant recovery or legacy Android 8–13 foreground-service run is established by this record. A cold launch after force-stop proves that launch path, not recovery of an interrupted transfer. Background Resume rejection and zero-byte/sub-chunk estimate cases have source/JVM evidence, not runtime JobScheduler evidence. No Android live-server end-to-end transfer was performed by the Android engineer; the reported 32 MiB runtime check was performed by root. Follow the actual-phone checklist in `README.md` before calling Android release ready.

Downloads keep a private resumable file until export succeeds and may need another full file worth of destination storage. An interrupted SAF export can leave visible partial destination bytes while the queue remains unfinished. Non-seekable/temporary source staging requires explicit consent and available storage. Full SHA-256 source checks add local I/O; mutable providers need stable content or deliberate staging. A lost initial tus creation response can leave an orphaned server upload because creation has no idempotency key. Disconnected cancellation remains pending until the original server can be reached. No boot receiver or automatic restart after force-stop is claimed; reopening renews user initiation.
