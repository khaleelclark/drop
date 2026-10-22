# Server validation

Executed with the approved project-local Go toolchain, reporting
`go version go1.27.3 linux/amd64`, on 2026-10-22:

| Check | Actual result |
| --- | --- |
| `gofmt -w server/cmd server/internal` | Completed successfully |
| `go mod tidy` (from `server/`) | Completed; `go.sum` generated |
| `go test ./...` | Passed after static-app CSP fix; `internal/share` 0.314s |
| `go test -race ./...` | Passed after review fix; `internal/share` 2.538s |
| `go vet ./...` | Passed |
| `go build -trimpath -o bin/household-server ./cmd/household` | Passed; binary built under `server/bin/` |

The suite includes an actual 9 MiB streamed HTTP upload/download with matching
SHA-256, direct API lifecycle tests, a close/reopen of SQLite/blob storage during
a partial upload, and recovery of bytes written before the ready transition.
The timestamp-tie pagination test gives all records the same timestamp and
walks every cursor page without omissions or duplicates.

The read-only review found one recovery gap, now fixed: a temporary error during
the final ready transition could leave complete bytes pending until restart.
`TestFinalizationRetryWithoutServerRestart` injects a SQLite trigger that rejects
the ready update after all bytes have been synced. Once that fault is cleared,
both HEAD and final-offset PATCH retries revalidate and publish the item without
reopening the server, preserving exact downloaded bytes. The full test suite,
race check, vet, and build were rerun successfully after this fix.

The static app now allows the WebAssembly-specific `'wasm-unsafe-eval'` script
source needed by its incremental upload hasher. API responses retain the
stricter script policy. `TestStaticCSPAllowsWasmWithoutJavaScriptEval` checks the
actual static-page/API response headers, rejects broad eval/inline/wildcard
exceptions, and preserves same-origin connections and blocked objects. The full
Go suite, vet, build, and formatting checks passed after this policy fix. The
root-owned `scripts/browser-smoke.cjs` supplies the real built-app upload and
download test under this production policy; its post-fix rerun is pending at
this checkpoint. The earlier race check remains the latest race result.

The root-owned Python process/restart smoke harness and optional 20 GiB transfer
have not been run by the server owner at this checkpoint. The root owner is
performing integration validation separately. No native client/device,
Tailscale Serve deployment, Android background behavior, or 20 GB/GiB transfer
is demonstrated by these results. No deployment was performed.

## Container packaging validation

Executed on the local Linux Docker host on 2026-10-22 using Docker 29.9.1:

```sh
docker build --progress=plain -t household-share:validation .
python3 server/container_smoke.py --image household-share:validation --large-bytes 9437184
```

Both commands passed. The clean multi-stage root Dockerfile built its interface
with the frozen pnpm lockfile and workspace policy permitting the esbuild install
script. Go built the static API binary; the resulting distroless image defaults
to UID 65532 and was 24,611,269 bytes in Docker's image-size report.

`server/container_smoke.py` reuses the root-owned process smoke's real HTTP
exercises with a Docker-backed lifecycle. It starts a fresh random named volume
and a disposable host-network container with an unused explicit loopback port,
a random configured app token in a mode-0600 temporary environment file,
`HOUSEHOLD_DEV=1`, no published ports, dropped capabilities, and
`no-new-privileges`. Actual results:

- The running server process was UID 65532. SQLite/blob writes succeeded on the
  fresh writable named volume, including after container stop/start.
- The built HTML, JavaScript, and CSS assets were served. Static responses
  included the narrow WebAssembly CSP exception, same-origin connections, and
  blocked objects; API responses retained their stricter script policy.
- Anonymous feed access was denied; authenticated exact Unicode/CRLF text,
  pinning, HEAD/ranges, wrong-offset rejection, incomplete-download gating,
  restart/resume with confirmed offsets, cookie-authenticated direct download,
  hostile-Origin rejection, and invalid-UTF-8 ready gating all passed.
- A separate 9,437,184-byte tus upload and streamed download matched SHA-256.
  This container check did not attempt a 20 GiB transfer.
- Production defaults, an HTTPS origin without a token, and a token with an HTTP
  origin each exited nonzero with the expected configuration rejection before
  serving. These checks used `HOUSEHOLD_DEV=0`.
- All disposable containers and both named/anonymous test volumes were removed;
  final Docker container/volume listings for the test prefix were empty. The
  requested local validation image remains available.

This checks packaged static delivery and real API behavior. It does not run a
browser, validate native clients, configure Tailscale, or deploy the service.
No Dockerfile, compose file, or root script was edited for these checks.

An independent bounded source review of the Dockerfile, Compose configuration,
build exclusions/example environment, API contract, and server configuration,
startup, and authentication found no actionable packaging security or fresh
named-volume/nonroot permission defect. This review supplements the actual
container checks above; it does not add device or deployment evidence.

## Extracted Linux desktop runtime prerequisite check

On 2026-10-22, inspected root's actual
`artifacts/linux-desktop/Household Share_0.1.0_amd64.deb` (7,099,430 bytes,
SHA-256 `662a49a862949a7d004008a5c2420551e040c659c195f6f9ac0ba2327541c266`).
Root refreshed the bundle during the first prerequisite check; the final check
copied a stable snapshot of the refreshed package and verified its digest.
`dpkg-deb -x` extracted it into a private disposable directory without installing
the package. The host provides `Xvfb`, `xdotool`, `xwininfo`, `xprop`, and
`dbus-run-session`, but `ldd` on the extracted `usr/bin/household-share` reports:

```text
libwebkit2gtk-4.1.so.0 => not found
libsoup-3.0.so.0 => not found
libjavascriptcoregtk-4.1.so.0 => not found
```

Running that executable with separate empty mode-0700 XDG config, data, cache,
state and runtime directories exits **127** in the dynamic loader:

```text
error while loading shared libraries: libwebkit2gtk-4.1.so.0: cannot open shared object file: No such file or directory
```

The isolated XDG directories remained empty. The process could not reach app or
display initialization, so no Xvfb app session, UI screenshot, close-to-hide,
process-residency, tray Quit, or relaunch check was performed. This is a host
runtime prerequisite blocker, not an observed app logic failure. The Debian
package declares the relevant GTK/WebKit/AppIndicator runtime dependencies; its
successful isolated build remains separate evidence. No system packages were
installed, no client/web/root source or user data/display was modified, and no
Android emulator or root test server was touched. The extraction and temporary
XDG directories were removed after recording the result.

## Linux desktop runtime in an isolated dependency container

On 2026-10-22, a bounded alternative successfully exercised the actual packaged
desktop shell without installing host libraries:

```sh
docker build --progress=plain -f Dockerfile.desktop --target build -t household-desktop:validation .
```

The existing Dockerfile and all root/client/web sources stayed unchanged. The
cached image supplied its existing GTK/WebKit runtime dependencies; no extra
container or host packages were installed. Its build regenerated the current
`index-CdZF0CLg.js` and `index-B_mvSAqO.css` web assets and produced a new package
under `/output`. The tested package SHA-256 was
`0499a46f34c059b4a6df2c494a2cf58989caf349acf662e46197f9084bd4a191`.
This check used that image's fresh package, not the earlier host extraction.

A new cookie-authenticated host `Xvfb :510 -screen 0 1280x900x24 -nolisten tcp`
provided a private display. A disposable container mounted only that display's
Unix socket, its private cookie/scratch directory, and a read-only passwd entry
for the test UID. The container used `--network none --user 1000:1000
--cap-drop ALL --security-opt no-new-privileges`, separate initially empty XDG
directories, X11 and software rendering. The passwd entry permits the private
D-Bus session to identify the nonroot UID; the image does not itself define
UID 1000. No WebKit sandbox-disable flag or privileged container was used.
`dpkg-deb -x /output/*.deb /check/extracted` extracted the package without an
installation, and `dbus-run-session -- /check/extracted/usr/bin/household-share`
ran its real binary. `ldd` reported no missing libraries in this environment.

Observed results:

- The actual GTK/WebKit app and its web/network subprocesses ran as UID 1000.
  The 1100x800 `Household Share` window rendered the native connection screen;
  full-screen PNG captures were inspected. The valid runtime's log was empty.
- A direct X11 `WM_PROTOCOLS`/`WM_DELETE_WINDOW` ClientMessage, after confirming
  the window advertises that protocol, changed its map state from
  `IsViewable` to `IsUnMapped`. The same app PID 1692160 and its WebKit
  subprocesses remained running. No destroying `xdotool windowclose` call was
  used.
- `xdotool key --clearmodifiers ctrl+shift+h` remapped the same window as
  `IsViewable`. After another normal close event, launching the same binary
  in its existing private D-Bus session exited 0 as a second instance and
  reopened the original window without replacing its resident process.
- The app exported a real Ayatana `com.canonical.dbusmenu` menu with
  `Open Household Share` (item 2) and `Pause transfers and Quit` (item 3).
  Sending `Event 3 clicked <int32 0> 0` through its D-Bus interface returned
  successfully, then the app/container exited 0 and the private display had
  no child windows. This validates the actual tray menu action; a visible
  desktop panel and pointer interaction with a tray icon were not tested.
- Restarting that stopped test container launched a new app PID 1694788 and
  rendered the connection screen again. Native queue metadata and WebKit
  storage were created only inside the isolated XDG directory.

This was an unpaired, network-disabled shell lifecycle test. It did not test
API pairing, native transfers, in-progress transfer residency, a desktop panel,
Mac, Android, a physical device, or 20 GiB desktop transfers. The earlier
missing-host-library result remains accurate for direct execution on this host.
The isolated app container/display and extraction/XDG data were removed after
evidence capture; the requested local validation image remains available.
No existing display, user data, Android emulator, or root test API was touched.
