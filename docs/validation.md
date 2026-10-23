# Build and validation evidence

## Android full-height correction, 2026-10-23

Android 0.1.3/code1003 removes duplicate system-safe spacing inside the native
WebView. The shell still reserves measured system-bar/cutout margins. Bootstrap
marks only the packaged Android document before rendering; four CSS safe-area
properties become zero there. Browser and desktop retain their environment
insets. Native runtime code, inset listeners, IME dispatch, focus and transfer
behavior are unchanged. The new frontend is B4AqCHJa/BEt_jZmw; existing Mac/Linux
0.1.1 installers retain their accepted prior frontend and need no rebuild for
this Android-only branch.

The frontend owner passed 47 unit/component tests, eight Chromium fixtures and
the TypeScript/production build. Nonzero CDP insets of 36/28/48/24 px reproduce
the duplicated space in the previous CSS. With the fix, the Android fixture's
header/bar remain 64/72 px while the browser retains 100/120 px. These are
browser-engine fixtures, not physical-phone telemetry.

Root installed the exact x86_64 APK and passed cold launch, real native text
submission, exact native Copy/Android Paste, scale 1, no horizontal overflow and
zero browser API requests. The document marker and all four zero CSS properties
are present; actual header/bar measure 64/72 px. Actual OS keyboard, Back, Done,
same navigation DOM, draft/search preservation and last-action/menu clearance
pass. Native WebView bounds remain [0,136][1080,2337]; tab targets end at CSS
831.24 above the origin-adjusted system boundary 838.48, and editing targets end
at 363.29 above the actual IME boundary 526.10. Root viewed docked/keyboard ADB
screenshots. One initial harness run stopped after uiautomator wrote valid XML
but exited 137; narrow completion handling was corrected before the full pass.

Both Tauri ABIs and standalone built; all nine frozen assets, retained signing
identity, manifests and 16 KiB ZIP/ELF alignment passed packaging checks. Native
Kotlin tests/lint were not rerun because runtime source is unchanged. Exact
package hashes, full reports and limits are in `docs/evidence/android-full-height.json`.

The private Android download now serves the exact ARM64 0.1.3 APK. Root streamed
all 29,771,439 bytes through Tailscale HTTPS and matched SHA256
`fbc4681f00a1903ce48b819f080f7142c4aeb0f25905c4d0580116fc1bd7f1fc`.
The browser index and authenticated feed hashes stayed unchanged, anonymous
feed access remained 401 and health stayed OK. Only the APK download changed;
no service process, backend, persistent data or Serve configuration changed.

Physical-phone confirmation remains unperformed. This release adds no rotation,
binary-transfer, background/lock/recovery or Android 20 GB evidence; prior
0.1.2 rotation/Home and 0.1.1 SAF results remain separately labeled.

## Mobile bottom-tab release, 2026-10-23

The approved CS6EIQOV/DVPjc1UT frontend from source `57e26b4` is now served
through the existing private Tailscale HTTPS origin. Android **0.1.2/code1002**,
Mac **0.1.1** for Apple Silicon and Intel, and Linux **0.1.1** contain this exact
frontend. Root streamed all four live package downloads and matched their byte
counts and SHA256; the authenticated feed stayed unchanged, anonymous access
remained 401 and health stayed OK. No backend bytes, service process, persistent
data directory or Serve settings changed. See `docs/evidence/bottom-tabs-publication.json`.

The first 0.1.2 candidate failed actual Android system-bar clearance and was
rejected before publication. The replacement reserves measured native WebView
system-bar/cutout overlap while preserving existing inset listeners and IME
delivery. Root installed x86_64 APK
`e76bd738d1c155bf14e2f3a9acb7547654f8b2e8ebfabe795814785bff58f6d4`.
Cold launch, native text send, exact Copy/Android Paste and zero browser API
traffic passed. Actual WebView bounds are `[0,136][1080,2337]` physical pixels;
the CSS viewport is 412×839 at scale 1. Docked tab targets are 55.24 CSS px high
and end at 831.24, above the correctly offset native boundary at 838.48. The
actual keyboard leaves Share, four tabs and Done visible; Android Back retains
navigation/draft, Done redocks the same DOM, and search/section selection
preserves text. The final feed action and menu remain above the bar. Root viewed
actual ADB screenshots. See `docs/evidence/android-bottom-tabs.json` and
`scripts/android-bottom-tabs-smoke.cjs`. All three replacement APK hashes and
nine frozen assets were independently matched; v2 signatures, retained signer
and ZIP 16 KiB alignment passed. Android owner records 26 standalone plus five
plugin tests actually executed, zero failures/errors/skips; native rotation and
legacy delivery are distinct from the arithmetic regressions.

One additional API36 emulator landscape→portrait cycle and Home/return passed
at scale 1 without horizontal overflow; the portrait viewport returned to
412×839 without accumulated margins. This is a view/layout check, separate from
background transfers or physical-device acceptance.

Both Mac packages completed native CI run `39878431406` from a clean source
checkout, passed all 17 native tests each, and verified app/helper architecture,
system linkage, ad-hoc signatures, helper execution, signed DMG checksums,
read-only mounting and drag-install layout. Both generated nine-file manifests
match the frozen frontend. Exact provenance and checksums are in
`docs/evidence/macos-bottom-tabs.json`. Linux rebuilt in the existing isolated
Docker environment and embeds the same asset names; no new Linux GUI/lifecycle
run follows from that rebuild (`docs/evidence/linux-bottom-tabs.json`).

Physical phones, Mac GUI installation/Gatekeeper/Finder, macOS 11 runtime,
background/screen-lock and Mac/Android 20 GB checks remain unperformed. No new
0.1.2 binary transfer is inferred from these navigation checks; prior 0.1.1 SAF
and earlier Linux large-transfer evidence remain separate below.

## Interface update and private release, 2026-10-23

The reviewed Blip-inspired interface is frozen at source commit `d600445`
(`index-BRmFLqLf.js` / `index-BJCLriK5.css`). Root verified all 21 named web
deliverables and exact asset hashes, reviewed final pairing and transfer
screens, and passed the real Go-server/Chrome round trip again with exact
clipboard/text downloads, a 1,048,713-byte file integrity check, second-client
visibility and a fitting phone layout. The frontend owner's focused test/build
results are recorded in `web/README.md`; root evidence is in
`docs/evidence/ui-redesign.json`.

Android 0.1.1 retains the prior signer and package IDs; Tauri code 1001 updates
the prior code 1000. All nine frozen web files match all three APKs. Root
installed the exact x86_64 APK `c7d35a61839a861b031acca3d5ab2318099502e928fb905c9eb0d6264a56e5f0`
and passed cold launch, native text send and exact Copy/Android Paste with no
browser API traffic. It starts at scale 1 with no horizontal overflow and 16 px
inputs. The actual OS keyboard overlays the edge-to-edge WebView; the full Share
action remains above its inspected IME boundary. CDP synthetic pinch/double-tap
retained scale 1, but the previous emulator baseline also measured scale 1, so
the physical-phone report was not reproduced here. A native 33,555,133-byte
download and SAF export matched the source SHA256. The first-use notification
prompt initially stalled the harness; root accepted its inspected Allow control
and verified the same original transfer without restarting it. Separate final
evidence is in `docs/evidence/android-ui-update.json`.

The Linux desktop package rebuilt in the existing isolated Docker build and
contains the frozen JS/CSS names; SHA256
`b9545e099fe2c4a8ca515b797fa8f62b0b48e3bf7b9ba375e7f00ed9f19385aa`.
No new Linux GUI/lifecycle check follows from that rebuild.

Under the user's separate hosting authorization, root atomically switched the
existing private release to the reviewed interface and audited ARM64 APK
`2f604eebec1e4ff747d971a5ffd906030a0a55825ddac21486eb4169db916719`.
Actual Tailscale HTTPS responses matched the index and streamed APK hashes;
the protected feed stayed unchanged, anonymous access remained 401 and health
was OK. The backend bytes, service process, persistent data and Serve settings
were retained. See `docs/evidence/ui-publication.json`.

The final Apple Silicon Mac installer passed native CI run `39875041794`, job
`120158944970`, from the frozen `d600445` source. Its nine frontend hashes match
the browser and Android build exactly. All 17 native tests passed on macOS;
the app/helper architecture, Apple-system linkage, ad-hoc signatures, native
helper usage execution, signed DMG checksum, read-only image mount and mounted
bundle checks passed. Root verified the downloaded archive/DMG hashes and the
native lead independently accepted the package evidence. The 9,063,055-byte
installer has SHA256
`010c86da84c78fd63d1a5337661f6da8a32e916e5c2b0b209d4624471b8c09fe`
and is available through the existing private HTTPS downloads. See
`docs/evidence/macos-arm64.json`. These Mac execution conclusions come from
the actual downloaded CI logs, with separate Linux checksum/manifest review.

The Intel Mac installer and aggregate package refresh remain pending. The
historical release evidence below describes earlier packages and tests; its
no-deployment and unavailable-Mac-build statements apply to that earlier stage.
No new 20 GB transfer, physical phone, Mac GUI/Gatekeeper installation or
background/screen-lock acceptance is established by this update.

## Earlier release evidence

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

`python3 scripts/package.py` checks the named deliverable manifest, excludes toolchains, dependencies, runtime data, generated caches and signing material, creates source/server archives, records SHA256, then reopens and reads every archive member. Root extracted an initial server archive, ran its included executable using the documented relative paths, verified static UI/CSP, anonymous denial and authenticated feed, then stopped it and removed the temporary directory. Final packages were refreshed after the owner handoffs. The independent final audit verified all 162 required files, all seven package sizes/checksums, archive inputs, clean Git state and the corrected GUI-tested Debian package; no concrete secret inclusion was found in its bounded inspection.

With explicit user approval for public source, the connected GitHub account published six implementation and validation commits to [khaleelclark/household-share](https://github.com/khaleelclark/household-share). GitHub attributes both author and committer to `khaleelclark`. All 219 reviewed source files, their blob hashes and executable modes matched the local tree exactly before this documentation update. Runtime data, tokens, signing keys, local toolchains and built packages are excluded from Git. The local checkout tracks the published `main`; the original local preparation history is retained in `local-prepublication`.

The code and observed builds are not full target-device release validation. Still unperformed:

- macOS app/CLI compilation and local ad-hoc signing, Gatekeeper installation, Finder/Shortcuts/share inputs, clipboard and native queue/window behavior on a Mac. The Apple toolchain is unavailable here; Mac source and build instructions are supplied.
- Physical Android20GB transfer/memory, lock/background continuation, UIDT stop/reschedule, interrupted transfer recovery after reboot/force-stop, temporary-provider grants, and Android8–13 foreground-service runtime. Cold launch after force-stop does not establish interrupted-transfer recovery. Unknown download scheduling passed; zero-byte/sub-chunk scheduling controls have JVM/source evidence only.
- Actual household Tailscale access, cross-network throughput/loss, sleeping devices, real disk exhaustion/filesystem/provider edge cases and in-progress Linux UI-close transfers. Linux shell residency and the separate headless engine's transfer/restart paths passed independently.

Android downloads may need a second full destination copy during SAF export; interrupted export can leave partial visible destination bytes while the queue stays unfinished. Source staging is explicit. Native capture keeps original paths until transfer completion; temporary Mac exports must first be saved durably. Tokens are app-private disk credentials, not OS-keychain-backed. See each client README for recovery behavior.

No deployment, public binding or system-wide installation was performed.
