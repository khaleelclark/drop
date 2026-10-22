# Build and validation evidence

Recorded 2026-10-22. These are observed build/runtime results, separated from source implementation and unperformed device checks. No service has been deployed and no public listener or Tailscale configuration was created.

## Environment and packages

Linux x86_64; Node24.16.0/pnpm11.10.0; approved project-local Go1.27.3 and Rust1.99.1; pre-existing Java17/Android SDK36/NDK27 and API36 AVD. Host GTK/WebKit development/runtime dependencies are incomplete. Docker builds supplied those dependencies inside the isolated build image; no host system packages were installed. The Apple Objective-C compiler/SDK is unavailable.

`Dockerfile` builds a static server and local web assets. Its distroless runtime uses UID65532 with a writable persistent data volume. `Dockerfile.desktop` builds the actual Tauri Linux shell, Debian package and capture helper. Android builds produce separate Tauri ARM64/x86_64 APKs and a standalone diagnostic Kotlin wrapper. All three Android APKs contain all nine current web assets byte for byte. Root independently verified ABI contents, package hashes, primary Tauri signatures and ZIP16KiB alignment; the native owner additionally checked ELF16KiB segments and all three signatures/alignment checks.

## Server and browser

- Root Go build, `go test -race ./...` (internal/share3.534s), and `go vet ./...` passed after the narrow static CSP fix. The release build disables CGO so the Linux server does not require a matching host libc. Root rebuilt that static executable and reran the actual HTTP/restart/auth/integrity smoke successfully.
- `python3 scripts/smoke.py` exercises real HTTP authentication, exact Unicode/whitespace text, attachments, authenticated HEAD/ranges, pins, wrong tus offsets, incomplete/invalid ready gating, process restart/confirmed-offset resume, browser sessions, CSRF/foreign-Origin rejection, and matching downloaded bytes.
- `/usr/bin/time -v python3 scripts/smoke.py --large-bytes 21474836480` passed a streamed **21,474,836,480-byte (20GiB)** upload/download with matching SHA256. Elapsed1m17.01s; reported maximum RSS35,488KiB is the tool/test-child maximum, not summed concurrent memory or a target-device measurement. This large round trip and the smaller restart test were separate checks.
- The server owner built `household-share:validation` and ran `server/container_smoke.py --large-bytes 9437184`: UID65532 wrote a fresh named volume, container stop/start preserved offsets, actual static/API/auth checks passed, and a9,437,184-byte streamed round trip matched SHA256. Production rejected absent token and insecure origin configurations before serving. Disposable containers/volumes were removed. See `server/VALIDATION.md`.
- `node scripts/browser-smoke.cjs` passed against the actual current built interface and Go server: pairing, UI text submission, full exact clipboard contents, exact .txt attachment, WebAssembly hashing under production CSP, real browser file upload/download with SHA256 equality, second-client feed visibility, and a390px phone layout without overflow/runtime errors. Root inspected desktop/phone screenshots against the neutral iOS-inspired brief.
- The interface owner passed **38 unit/component tests in8 files**, TypeScript/Vite build, and **4 Chromium fixture tests**. They cover exact copy/paste,9MiB upload in8MiB+1MiB chunks, native command/response/state fixtures, cancellation, search/pins/deletion, focus and44px targets. The reviewer independently passed19 focused regressions closing both web findings. A separate built-app probe verified the storage meter under unchanged stylesheet CSP without inline styles or violations. See `web/README.md` and `quality/client-review.md`.

Static pages permit only the narrow `wasm-unsafe-eval` needed by the incremental browser hasher. No broad JavaScript eval, wildcard origin or public service was added.

## Desktop native engine and Linux shell

- Root independently passed **15 Rust tests** (4unit+11 real-loopback protocol tests). The reviewer closed all three reproduced defects against real Go servers: captured destination changes, rejected full-offset validation, and lost-final-acknowledgement/Cancel409 reconciliation. Ready content is retained until explicit Delete; staged sources remain while validation is pending/failed.
- The native queue passed an actual **20GiB** upload/download with queue pause/reopen and actual server process restart after8MiB in each direction. Source/download SHA256 `6cb118a8f8b3c19385874297e291dcbcdf3a9837ba1ca7b00ace2491adbff551`;175.24s; native process peak RSS27,000KiB measured by `wait4`. The source was a sparse zero-filled file; every payload byte crossed HTTP into real server/download files. This predates the targeted review fixes. After those fixes, a33,555,133-byte round trip with both queue/server restarts and matching hashes passed (`native-live-after-review.json`,0.50s/26,212KiB). See `clients/desktop/VALIDATION.md` and raw reports.
- Clean isolated builds compiled the actual Tauri shell and produced the amd64 Debian package (~6.77MiB) and capture CLI (~5.2MiB). Root inspected executable, launcher, icon and GTK/WebKit/AppIndicator dependency declarations; final assets are `index-CdZF0CLg.js` / `index-B_mvSAqO.css`.
- Direct execution of the extracted package on this host is blocked by missing WebKit4.1/libsoup3/JavaScriptCore4.1 runtime libraries. No host install was attempted.
- A bounded alternative ran the actual fresh package nonroot in the existing build image with network disabled, separate XDG state and a new private cookie-authenticated Xvfb display. It rendered the native connection screen. Normal WM_DELETE_WINDOW hid the window while its PID/subprocesses survived; Ctrl+Shift+H and a second-instance launch reopened the same window. The real D-Bus tray Quit action exited0; restarting rendered the app again. No additional packages, privileged mode or WebKit sandbox-disable flag was used. The exported deliverable is that exact tested package, SHA256 `0499a46f34c059b4a6df2c494a2cf58989caf349acf662e46197f9084bd4a191`. See the exact method and limits in `server/VALIDATION.md`. This was an unpaired shell lifecycle check, not an in-progress transfer/background or physical-desktop-panel test.
- Mac capture scripts passed shell syntax and exact argument/stdin tests on Linux. The release CLI passed durable isolated Unicode/BOM/CRLF capture and redacted destination-bound intake. Finder/Shortcuts and ad-hoc signing have not run on macOS.

## Installed Android emulator

Root installed the actual Tauri x86_64 APK on the pre-existing API36 AVD in read-only/no-snapshot mode. No physical phone or saved AVD state was modified. ADB reverse maps the disposable loopback API; development pairing explicitly opts into loopback HTTP. Source and file bytes stay native.

The initial runtime tests exposed two defects that source/build checks missed: late plugin creation left an inactive visibility flag, and unknown/resumed lengths produced illegal JobInfo byte estimates. The owners fixed actual lifecycle observation, visible Resume ordering and remaining-byte estimates, then rebuilt the APKs. **Both reproduced blockers are closed by root execution.**

- Installed final x86_64 APK SHA256 `41be98fc9a8161397d5dbd0ba6f0f5c2a2ca86602a1221262f6e473ef55f0cae` passed force-stop/fresh cold launch without a Home/return cycle: automatic native bootstrap, redacted config, real UI text submission/native API headers, exact native Copy followed by Android Paste preserving Unicode/whitespace, and zero browser API requests. The final cold-launch harness avoids an artificial WebView reload.
- An actual SAF file picker/native UIDT upload sent **33,555,133 bytes** and the server download matched original SHA256 `7e4bf9b31f038d63cc3acd6f742d39e933ca01b57b17dcbed1cb017a68f22967`. That upload was on the pre-fix APK after a Home/return cycle; it is preserved with this boundary in the raw report.
- On the final APK, the actual Android Save dialog, unknown-length UIDT scheduling, native range download into a resumable private file, readiness/completion and SAF export passed for the same33,555,133-byte payload. The final device file matched the original/source/server SHA256 and the queue offset equaled its size.
- Root independently parsed **27 passing Kotlin test results**:22 standalone policy/API/completion tests and5 lifecycle/control plugin tests, no failures/errors/skips. The owner built both ABIs and standalone, and ran lint with zero errors (standalone6warnings; generated Tauri app37warnings/1hint; plugin14warnings). Warnings are unsuppressed; see `clients/android/VALIDATION.md`.

Reproduction scripts: `scripts/android-emulator-smoke.cjs` and `scripts/android-emulator-download.cjs`, using the existing disposable emulator, installed debug APK and explicitly forwarded test API. Preserved reports are in `docs/evidence/` and `clients/android/validation/api36-emulator.json`. The package audit records exact APK hashes, ABI files and matched web assets.

## Packaging and remaining limits

`python3 scripts/package.py` checks the named deliverable manifest, excludes toolchains, dependencies, runtime data, generated caches and signing material, creates source/server archives, records SHA256, then reopens and reads every archive member. Root extracted an initial server archive, ran its included executable using the documented relative paths, verified static UI/CSP, anonymous denial and authenticated feed, then stopped it and removed the temporary directory. Final packages are refreshed after the owner handoffs.

The code and observed builds are not full target-device release validation. Still unperformed:

- macOS app/CLI compilation and local ad-hoc signing, Gatekeeper installation, Finder/Shortcuts/share inputs, clipboard and native queue/window behavior on a Mac. The Apple toolchain is unavailable here; Mac source and build instructions are supplied.
- Physical Android20GB transfer/memory, lock/background continuation, UIDT stop/reschedule, interrupted transfer recovery after reboot/force-stop, temporary-provider grants, and Android8–13 foreground-service runtime. Cold launch after force-stop does not establish interrupted-transfer recovery. Unknown download scheduling passed; zero-byte/sub-chunk scheduling controls have JVM/source evidence only.
- Actual household Tailscale access, cross-network throughput/loss, sleeping devices, real disk exhaustion/filesystem/provider edge cases and in-progress Linux UI-close transfers. Linux shell residency and the separate headless engine's transfer/restart paths passed independently.

Android downloads may need a second full destination copy during SAF export; interrupted export can leave partial visible destination bytes while the queue stays unfinished. Source staging is explicit. Native capture keeps original paths until transfer completion; temporary Mac exports must first be saved durably. Tokens are app-private disk credentials, not OS-keychain-backed. See each client README for recovery behavior.

No deployment, public binding or system-wide installation was performed.
