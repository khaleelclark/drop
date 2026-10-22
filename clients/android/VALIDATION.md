# Android validation record

Checked 2026-10-22 in the shared Linux build workspace. This record distinguishes standalone Gradle packaging, Tauri Android packaging and actual device evidence.

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

Both Tauri target builds compile the Rust shell and real Kotlin mobile plugin against the same native queue, using the shared UI build. Rebuilt both targets and standalone after the lifecycle, Resume and network-estimate corrections. Final logs are `build/scheduler-tauri-aarch64.log`, `build/scheduler-tauri-x86_64.log`, `build/scheduler-standalone-check.log` and `build/scheduler-plugin-check.log`. `build-tauri.sh` retains one APK per ABI and recreates the generated APK to avoid stale AGP incremental ZIP holes. Rust debug information stays outside the installable APK; ELF load segments use 16 KiB alignment. Build output warnings about inability to strip an already reduced native library are recorded separately from actual signing/alignment verification.

## Deliverables verified at final handoff

- Standalone APK: `app/build/outputs/apk/debug/app-debug.apk`, application ID `household.share.android`.
- Primary Tauri ARM64 APK: `build/outputs/household-share-tauri-aarch64-debug.apk`, application ID `net.household.share.mobile`.
- Emulator Tauri x86_64 APK: `build/outputs/household-share-tauri-x86_64-debug.apk`, same Tauri application ID.
- Both wrappers use separate app-private queues/config when their application IDs differ; no migration between the standalone and Tauri application is claimed.
- Kotlin application, services, store, source access, API cancellation registry, upload readiness gate, shared `TransferControlCommand.kt`, Android resources/manifest and three JUnit test files.
- Tauri `src-tauri/` shell/config/capability/lockfile and generated Android Gradle project; `tauri-plugin/` Rust/Kotlin plugin, `ResumedActivityGate.kt`, its lifecycle regression test, init script, permission files and manifest; `build-tauri.sh`.
- Gradle wrapper/configuration, `README.md`, this record and preserved runtime evidence `validation/api36-emulator.json`.

All named files above were checked with file tools. After the corrections and runtime documentation update, checked 45 named source/configuration/doc/test/evidence files and all three APKs; the full record is `build/final-package-verification.json`. The old `native-adapter.js` is absent from both source and all three APKs. Every `web/dist` file in the standalone and both Tauri APKs matches the final shared build byte for byte (`index-CdZF0CLg.js` / `index-B_mvSAqO.css`). The new command and estimate classes are present in all three APKs, and the lifecycle gate is present in both Tauri APKs.

`apksigner verify --verbose <apk>` passes for all three, with one signer and APK Signature Scheme v2. `zipalign -c -P 16 4 <apk>` passes for all three. Both packaged native ELF files were read directly from their APK: each has four LOAD segments with alignment 16384 and congruent virtual/file offsets. `bash -n build-tauri.sh` and `node --check tauri-plugin/src/init.js` pass.

| APK | Bytes | SHA-256 |
| --- | ---: | --- |
| Standalone `app-debug.apk` | 3,099,252 | `9670b88dce02f9ffa690a800894f05ca85b4b0c534f34ba55184c35ec46766ac` |
| Tauri ARM64 | 29,752,391 | `2394e711cafd06c3996875418ec4566cea0ca0d06a6995c1cc472010ce6dfc70` |
| Tauri x86_64 | 29,428,348 | `41be98fc9a8161397d5dbd0ba6f0f5c2a2ca86602a1221262f6e473ef55f0cae` |

## Device and release boundary

`adb devices -l` initially showed no devices. Root subsequently started the existing disposable API36 x86_64 AVD as `emulator-5580`; the Android engineer observed it via ADB and prepared its x86_64 Tauri APK. No emulator was started or physical phone installed/modified by the Android engineer.

Root installed the final x86_64 APK with SHA-256 `41be98fc9a8161397d5dbd0ba6f0f5c2a2ca86602a1221262f6e473ef55f0cae` and reported both runtime blockers closed by execution. The Android owner read the complete saved `.tools/validation/android-emulator.json` and `.tools/validation/android-download.json` reports and preserved them, with APK provenance and remaining limits, in `validation/api36-emulator.json`. The installed APK hash comes from root's runtime result; its retained bytes were independently checked by the Android owner.

- Cold launch after force-stop/fresh Activity start, without a Home/return cycle: automatic native bootstrap, explicit loopback development pairing, redacted config, actual UI text submission through Kotlin native HTTP, exact text/headers, native Copy plus Android Paste preserving Unicode/whitespace, and no browser API requests passed.
- Actual Android Save picker, unknown-length UIDT scheduling, native range download into the private resumable file and completed SAF export passed for **33,555,133 bytes**. The final row is `completed` with offset equal to size. The exported device file matches the original/source/server SHA-256 `7e4bf9b31f038d63cc3acd6f742d39e933ca01b57b17dcbed1cb017a68f22967`.
- Root's reproduction harnesses are `scripts/android-emulator-smoke.cjs` and `scripts/android-emulator-download.cjs`. The earlier test-driven webview reload was removed from the cold-launch harness; it is not part of the final passing evidence. No new emulator runs, unit tests or builds were performed by the Android owner when incorporating these reports; package bytes remained unchanged.

No Android 20 GB transfer, memory measurement, locked-screen transfer, physical-device share/clipboard test, UIDT stop/reschedule, transfer recovery after reboot/force-stop, provider-grant recovery or legacy Android 8–13 foreground-service run is established by this record. A cold launch after force-stop proves that launch path, not recovery of an interrupted transfer. Background Resume rejection and zero-byte/sub-chunk estimate cases have source/JVM evidence, not runtime JobScheduler evidence. No Android live-server end-to-end transfer was performed by the Android engineer; the reported 32 MiB runtime check was performed by root. Follow the actual-phone checklist in `README.md` before calling Android release ready.

Downloads keep a private resumable file until export succeeds and may need another full file worth of destination storage. An interrupted SAF export can leave visible partial destination bytes while the queue remains unfinished. Non-seekable/temporary source staging requires explicit consent and available storage. Full SHA-256 source checks add local I/O; mutable providers need stable content or deliberate staging. A lost initial tus creation response can leave an orphaned server upload because creation has no idempotency key. Disconnected cancellation remains pending until the original server can be reached. No boot receiver or automatic restart after force-stop is claimed; reopening renews user initiation.
