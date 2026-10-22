# Client integration review

Reviewed 2026-10-22, with a final focused web follow-up the same day. Bounded, read-only implementation review of the shared web/native adapter and Android Tauri bridge/lifecycle. Only this report was written by the reviewer. This follows the interrupted review; earlier server findings and large-transfer measurements were not rerun.

## Remaining actionable findings

No remaining actionable defect found in the two cases assigned for the final follow-up. Both earlier Medium web findings below are closed by current source and passing focused regressions. This is a bounded closure, not a claim of complete application or device validation.

## Closed web findings — final focused follow-up

1. **Closed — manual text preparation cleanup.** `web/src/FeedCard.tsx:14–23` now registers cleanup for every effect instance, including text over the 64 KiB automatic-preload threshold. Cleanup aborts both automatic preload and any manual preparation, then clears the manual controller. The response path checks its own signal before setting the body or notifying. `web/src/FeedCard.test.tsx:64–83` exercises a 100,000-byte item with a deferred response for both unmount and item replacement: the signal becomes aborted, and resolving the late response produces neither a notification nor a stale Copy text button. Both variants passed in the reviewer's focused run.

2. **Closed — active browser Cancel on tus 404/410.** `web/src/transfers.ts:140–146` now catches `DetailedError` from the active upload's `abort(true)`, normalizes only an original response status of 404 or 410, and then removes the local row/source/upload references and persisted row. Other errors still reach the failure path and are rethrown. The installed tus 4.3.1 `lib/upload.js:124–157,456–486` and `lib/error.js` confirm that termination rejects non-204 responses with this error type and original response shape. `web/src/transfers.test.ts:43–67` covers active 404 and 410 responses, checking local/persisted removal and one feed refresh; negative controls 409 and 500 remain failed and persisted. All four variants passed in the reviewer's focused run. These regressions mock the active abort result; no new live browser/server cancellation probe was run.

## Shared bridge and fixes checked

- `web/src/main.tsx` detects the installed bridge and awaits adapter installation before rendering. Installed API, polling, pickers, downloads and clipboard use native commands. A failed native operation does not invoke a browser transfer, remote EventSource or cookie download as fallback.
- Android's actual `tauri-plugin/src/init.js` exports only `__HOUSEHOLD_NATIVE__` and delegates to `plugin:household|dispatch` with `{command,argsJson}`. Rust dispatch and Kotlin dispatch agree on that shape. The pinned Tauri 2.12.5 Kotlin `Invoke` and `PluginManager` code registers `JsonOrgModule`; JSON objects/arrays sent with `resolveObject` retain their JSON shape. Null acknowledgements, string download IDs and rejection paths align with the shared contract.
- The Android Tauri capability is restricted to the local main window and does not grant remote origins. Its navigation callback admits the packaged app origin. The standalone intake WebView also restricts navigation/resource loading to packaged assets. The shared adapter supplies the same command surface to both entry points.
- Native config responses omit tokens. Android API calls check the paired destination and connected state, attach its bearer token and disable redirects. Upload locations are constrained separately to the paired origin/tus path. Metadata, text and submitted JSON use separate bounded budgets. Native text/clipboard preparation is 8 MiB, metadata 2 MiB; all binary transfer bodies remain in native code.
- `native_cancel_api` reaches Android socket cancellation without queuing behind API reads, with abort-before-registration and disconnect generation handling. `native_disconnect` pauses work, cancels API calls/jobs/services and removes the token. Native errors propagate; clipboard success follows the actual clipboard write.
- During this review, the interface owner added the previously missing `validating => checking` state mapping, changed `retry_wait => paused` to match the contract, and honored `native_get_config.connected === false` during onboarding. The final source includes fixture-driven tests for these cases. These are closed source findings in the reviewed snapshot.

## Earlier native findings

- **Desktop destination capture:** fixed in source. Both inbox variants persist a destination Config with token cleared. Ingestion preserves that destination and pauses it when a different household is paired. The regression verifies capture under server A followed by pairing B, for both file and text spools.
- **Desktop failed validation/full offset:** fixed in source. `reconcile_upload()` fetches the bound item, distinguishes ready/failed/uploading, and only completion releases staged source. Pending validation retains staging and survives reopening. The relevant protocol regressions pass.
- **Desktop lost final acknowledgement/Cancel 409:** fixed in source. Cancellation probes the item's application state; already-ready content becomes complete without deleting the household item. Failed validation becomes error, and pending validation stays pending. The protocol regression passes.
- **Android reboot recovery and legacy drain:** fixed in source. Visible startup reconciles interrupted running/hashing/staging/exporting states only without an active worker/pending job, then filters runnable entries. Explicit paused/cancelled entries stay unchanged. Legacy completion is serialized on the main thread, checks new runnable entries after the initial snapshot, and waits for delayed validation without looping on future network retries.
- **Android readiness/cancel completion:** the current engine calls `UploadCompletion.requireReady()` after a full HEAD/PATCH and after conflicting termination. Ready content settles complete without item deletion; failed/pending states retain source appropriately. The Android owner owns execution of these regressions; this reviewer inspected their source but did not run an Android build/device test.

Desktop conclusions above use current source and the existing executable unit/protocol suite. This bounded pass did **not** repeat the earlier real-Go-server/public-API probes or lost-final-response proxy. Previous reports and the native lead's live transfer evidence retain their own validation boundaries.

## Actual checks in the final follow-up

- `npm --prefix web test -- src/FeedCard.test.tsx src/transfers.test.ts`: **19 tests in 2 files passed** (10 FeedCard, 9 transfers). This includes the two unmount/replacement variants, both already-removed termination statuses and both retained-failure controls described above. No dependency installation was needed.
- Read the complete current `FeedCard.tsx`, `FeedCard.test.tsx`, `transfers.ts`, `transfers.test.ts` and `web/package.json`; checked the installed tus termination/error implementation for the response/error contract used by the fix.
- Read the complete current `clients/android/README.md` and `clients/android/VALIDATION.md` to close the earlier stale-documentation follow-up. Their build/unit results are owner-reported evidence, not independently rerun or artifact-verified by this reviewer.
- Only `quality/client-review.md` was edited. No owner source edits, full-suite rerun, desktop/server probes, dependency/toolchain installation, APK/native build, emulator/device execution, deployment or large-transfer run occurred in this follow-up.

## Actual checks in the earlier integration pass

- `npm --prefix web test`: initial snapshot passed all **27 tests in 6 files**. Reran once after the owner's fixture/state/onboarding changes: **31 tests in 7 files passed**, including the fixture-driven adapter and interface-boundary checks. Those earlier tests did not cover the two web findings; the final focused run above covers their fixes.
- `source scripts/env.sh` then `cargo test --locked --offline --manifest-path clients/desktop/native/Cargo.toml`: **4 unit + 11 protocol tests passed**; binary/doc targets contained no tests. This includes the three desktop fixes, pending validation, source identity, ranges/checksums, and text/disconnect checks.
- Read-only Node VM probe of the actual Android `tauri-plugin/src/init.js`: **passed** command namespace/flat JSON arguments, exact Promise result, rejection propagation, frozen bridge and absence of a stale preinstalled PlatformAdapter. An initial probe assertion compared cross-VM object prototypes and was corrected to compare serialized values; that harness assertion was not an application failure.
- Read current `docs/api-contract.md`, `clients/shared/native-contract.md` and fixture; requested web source/tests; desktop command handlers and relevant native APIs; Android Tauri/plugin/config/build/manifest files, native activity/intake, HTTP/cancellation, queue, source access, completion policy, services and policy tests. Pinned local Tauri and tus dependency source was used to confirm serialization/termination behavior.

No writer implementation edits, dependency/toolchain installation, deployment, Android/Tauri build, installed-client run, device lifecycle execution, clipboard device test or 20 GB transfer was performed by this reviewer in this pass. No claim is made that source or mocked bridge tests establish real UIDT/source-grant/screen-lock behavior.

## Documentation follow-up — closed

The earlier stale Android documentation has been refreshed. The current `clients/android/README.md` and `clients/android/VALIDATION.md` describe both standalone and Tauri packaging, the shared bridge and removal of the old duplicate adapter, 8 MiB text/clipboard preparation, and application readiness as a requirement for completed uploads. The validation record separates the Android owner's 18 JVM tests, standalone checks and Tauri ARM64/x86_64 builds from root-owned emulator evidence and still-unperformed physical-device/lifecycle/20 GB checks. This reviewer read those documents; no APK integrity, build, unit-test or emulator result was independently revalidated in this web follow-up. No remaining stale-documentation defect was found within the earlier requested follow-up.
