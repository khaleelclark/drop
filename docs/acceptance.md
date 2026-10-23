# Acceptance and validation status

This is the integration checklist. A source implementation does not establish device behavior; check items only with evidence.

## Required product behavior

- [x] Connected shared feed works with real server data.
- [x] Paste/send text preserves full stored Unicode and whitespace.
- [x] Copy uses the full body, reports real success/failure, and offers .txt download (real browser success; failure behavior has frontend tests).
- [ ] Multi-file upload queue has progress, pause/resume/cancel and actionable errors.
- [x] Completed files download without loading the full file into JavaScript memory (browser attachment and headless native streaming checks).
- [ ] Metadata updates appear on a second client and recover after reconnect.
- [ ] Search, pins, deletion and storage usage operate against the server.
- [x] Clean iOS-inspired interface reviewed at desktop and phone sizes; 44px targets and dialog focus pass browser checks, reduced-motion rules are present.

## Server and transfer evidence

- [x] Go build and meaningful server tests pass, including race/vet after the CSP fix.
- [x] Production fails closed without token/configuration; anonymous content access denied.
- [x] Browser session, CSRF/origin checks and direct authenticated download tested.
- [x] Wrong-offset upload rejected without corrupting bytes.
- [x] Partial upload survives server restart and resumes to matching downloaded bytes.
- [x] Incomplete/invalid content cannot be downloaded as ready.
- [x] Authenticated HEAD and range downloads return correct bytes.
- [ ] Concurrent upload budgets and disk-full behavior tested.
- [x] A full 20 GiB upload/download passes streamed byte-integrity verification on the Linux host.

## Native and platform evidence

- [x] Actual Tauri Android adapter invokes native API, clipboard/paste, SAF upload and download/export paths on the API36 emulator.
- [x] Native engine queue persistence/restarts pass; actual Linux shell stays resident after normal window close in an unpaired isolated GUI test. In-progress transfer plus GUI-close remains unperformed.
- [x] Queue Quit/checkpoint behavior passes Rust tests; the actual Linux tray Quit action exits cleanly and relaunch works in the isolated GUI test. These are separate checks.
- [x] Final 0.1.1 Apple Silicon and Intel Mac DMGs build on native Mac runners; native tests, ad-hoc signatures, helper execution, read-only image mount and exact frozen frontend hashes pass. See `docs/evidence/macos-bottom-tabs.json`.
- [ ] Mac installation/Gatekeeper approval, GUI lifecycle and capture Quick Action on a household Mac.
- [x] Android Tauri ARM64/x86_64 and standalone APKs build with local signing; runtime-fix cold launch and native download/export pass on the emulator.
- [ ] Android native share receiver acquires durable source access or stages content explicitly.
- [x] API36 emulator native upload and unknown-size download UIDT jobs execute; physical-phone/stop/reschedule and notification UX remain unperformed.
- [ ] Android uploads continue under screen lock/background and recover after permitted interruptions.
- [x] Native 20 GiB headless Linux engine transfer/restart passed; Mac/Android target-device large-file checks explicitly remain outstanding.

## Handoff

- [x] Linux run/deployment guide matches actual environment variables and extracted-server-bundle relative paths.
- [x] Linux/Android paths match actual build outputs; final Apple Silicon and Intel Mac installers exist and are verified.
- [x] Source archive, Linux server/desktop packages and primary Android APKs imported into Project files; checksum manifest supplied.
- [x] Reviewed source published to the user-approved public `khaleelclark/household-share` repository, with commits attributed to khaleelclark and remote file contents verified.
- [x] Known limitations and unperformed checks recorded with the exact release evidence.
- [x] No deployment or public exposure performed without separate authorization.

## Current evidence

- Project-local Go1.27.3 and Rust1.99.1 installed from official distributions, with downloaded installer/archive SHA256 verification.
- Python smoke/tooling scripts compile; shell build/test/environment scripts pass syntax checking.
- Real built browser/server round trips, 20 GiB server/native checks, updated Rust regressions, Linux shell lifecycle and Android emulator checks passed. Source and runnable Linux/Android packages are published in Project files; reviewed source is also published on GitHub. Unavailable target-device checks remain; see `docs/validation.md`.
