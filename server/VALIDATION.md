# Server validation

## Text/Markdown/code upload metadata follow-up

Executed on 2026-10-23 with the existing approved project-local Go toolchain
(`go version go1.27.3 linux/amd64`) through `scripts/env.sh`, after rereading the
current API contract and root-owned shared classification fixture.

| Check | Actual result |
| --- | --- |
| `go test -count=1 ./internal/share -run 'Test(TextFile\|MarkdownText\|TextCandidate\|TextDownloadFormats)'` | Passed, 0.375s |
| `go test -count=1 ./...` from `server/` | Passed, `internal/share` 1.310s |
| `go test -race -count=1 ./...` from `server/` | Passed, `internal/share` 7.342s |
| `go vet ./...` from `server/` | Passed |
| `go build -trimpath -o bin/household-server ./cmd/household` from `server/` | Passed |

The existing file-preparation gate and export naming below remain in place.
This follow-up closes the separate creation-metadata gap: explicit kind=text
uploads now accept the same supported text/Markdown/code candidates rather
than only text/plain. General MIME syntax/length validation remains before
reservation, and explicit non-UTF-8 or empty charset declarations are rejected.
No API shape, database column, dependency or content conversion was added.

The fixture test now submits every shared example through tus creation, checking
eligible empty text uploads reach ready and unsupported candidates are rejected.
Additional malformed/ambiguous charset cases fail creation. A real loopback HTTP
test uploads a UTF-8/BOM/CRLF Markdown file as text/markdown, fetches its exact
body, saves an edit, and verifies byte-exact txt/md exports and download HEAD.
Completed tus HEAD and final-offset PATCH retain the original upload length and
leave edited bytes intact. The same HTTP test uploads a .md kind=file with a
malformed byte beyond 128 KiB: /text returns 415 JSON without any private body
prefix, and ordinary Download still returns every original byte.

Text-kind completion tests reject late malformed/truncated UTF-8 before ready;
valid code candidates retain legacy control-byte semantics. An 8 MiB+1 Markdown
text upload succeeds even with a 16-byte JSON text limit, proving the separate
file-preparation cap does not limit stored kind=text uploads. Existing focused
tests recheck all shared allowlists, exact 8 MiB/+1 file preparation, binary
controls/charset denial, descriptor rewind/snapshot consistency, format errors,
safe filename suggestions, unchanged bytes/ETag/HEAD/ranges and file export denial.
The complete suite retains the actual default 9 MiB streamed HTTP/hash check,
editing/recovery/migration/device tests and both auth-mode tests.

Changed files for this follow-up: `internal/share/uploads.go`,
`internal/share/textfiles_test.go`, `README.md` and this file. Rebuilt
`bin/household-server`; the shared fixture was read, not changed. The earlier
gate lives in `internal/share/{textfiles,complete,items}.go`, with export tests
in `internal/share/edits_test.go`; those were rechecked without further changes.

Not checked: live Serve/tailnet or household devices, browser/native integration,
deployment/upgrade/rollback, power loss, disk hardware faults, or a new 20 GB/GiB
transfer. Existing schema-3 backup/rollback and local-proxy trust limits remain.

## Optional Tailscale sign-in and final text-file safeguards

Executed on 2026-10-23 with the existing approved project-local toolchain,
`go version go1.27.3 linux/amd64`, after sourcing `scripts/env.sh`. The complete
root-owned API contract and `clients/shared/text-file-fixture.json` were read.
This section supersedes the earlier uploaded-file `/text` and export-suffix
descriptions below; those entries describe the prior build.

| Check | Actual result |
| --- | --- |
| Focused auth/text-file/export tests | Passed, `internal/share` 0.324s |
| `gofmt -l server/internal/share` | Empty; formatting clean |
| `go test ./...` from `server/` | Passed, `internal/share` 1.249s |
| `go test -race ./...` from `server/` | Passed, `internal/share` 6.752s |
| `go vet ./...` from `server/` | Passed |
| `go build -trimpath -o bin/household-server ./cmd/household` from `server/` | Passed |

Auth changes are limited to explicit configuration and the existing shared
middleware/session handlers. The tests use temporary stores and mocked TCP peers
and headers; they are not actual Tailscale Serve acceptance tests. They cover:

- Absent/token configuration and legacy anonymous token-mode development,
  explicit Tailscale mode without a token, optional valid/invalid fallback,
  unknown/case/padded mode rejection, explicit loopback binding, and HTTPS even
  in Tailscale development. Environment parsing checks the default and explicit
  mode. Existing production token requirements remain tested.
- IPv4/IPv6/mapped loopback identity acceptance; missing/tagged, empty, blank,
  duplicate, oversized, invalid UTF-8 and control-containing logins are denied.
  LAN/tailnet/nonloopback/malformed peers are denied regardless of spoofed
  Forwarded/X-Forwarded-For/Host/Proto or display-name headers. The identity
  value is bounded to 1024 bytes and has no effect in token mode.
- Exact-Origin proxy/browser mutations; rejected foreign/null/empty/duplicate
  Origin; missing-Origin proxy writes rejected with any Sec-Fetch-* header,
  including an empty value. Native proxy writes without browser metadata work.
  Existing bearer rules and fallback cookie Origin checks are retained.
- Verified exact-Origin session POST returns 204 without a cookie. Optional
  token exchange keeps the secure cookie attributes; key rotation invalidates
  it. Empty keys do not mint cookies or authenticate in Tailscale mode, even
  with Dev enabled. DELETE clears the old cookie while proxy identity still
  authenticates the next request.
- Anonymous protection for feed/storage/events/download/text/tus/registry/
  arrivals/ACK/For you routes, public health, and identity-authenticated tus
  creation/PATCH/HEAD, exact download, registry registration and SSE setup.
  The general suite retains existing token-mode auth/CSRF tests.

The final text refinements reuse the bounded streamed validator and immutable
descriptor. Tests compare both allowlists exactly with the root-owned fixture,
run all ten classification examples and every listed application type/suffix,
then check the actual authenticated preparation endpoint. Exact BOM/CRLF/tabs/
Unicode/code bytes and split UTF-8 runes survive; unsupported metadata, explicit
non-UTF-8 charset, NUL/DEL/C1/other binary controls, truncated/malformed UTF-8
and late invalid bytes fail before any content body. Exact 8 MiB succeeds; one
byte over returns 413. Validation of an unexpectedly growing descriptor reads
at most 8 MiB+1. Rejected preparation leaves the ready file and ordinary download
intact. A prepared descriptor is rewound and remains readable after a concurrent
display rename and deletion. Existing kind=text control-byte semantics remain
unchanged; its larger-body behaviour is not narrowed by this file-only gate.

Text export tests now require final non-leading extension replacement (including
code suffixes), dotfile preservation and an empty-stem fallback, while retaining
exact bytes/length/ETag/HEAD/ranges, bounded UTF-8 names and safe ASCII fallback.
Uploaded kind=file format selection is rejected with 404 even for valid textual
files. Full migration/edit/crash-boundary/arrival/tus compatibility tests and the
actual default 9 MiB streamed HTTP/hash test passed again in the full suite.

Changed source files for this follow-up:
`internal/share/{auth,auth_test,config,complete,edits,edits_test,items,textfiles,textfiles_test}.go`.
Updated `README.md` and this file; rebuilt `bin/household-server`. No dependencies,
root/client source, Git state, service configuration, ACLs, deployed data, host
packages or devices were changed. The shared fixture was read, not modified.

Not checked: real Tailscale Serve header stripping/user identity, actual tailnet
or household devices, browser/native integration, deployment/upgrade/rollback,
power loss, hardware disk faults, or a new 20 GB/GiB transfer. Tailscale mode
trusts local server-host processes and the intended Serve proxy; retain the
explicit loopback bind and HTTPS origin, and do not enable Funnel. Tagged
devices need a configured token fallback. Schema-3 backup/rollback requirements
from the editing release still apply.

## Shared entry editing and text exports

Executed on 2026-10-23 after reading the final root-owned API contract, using
only the existing approved project-local Go toolchain (`go version go1.27.3
linux/amd64`) via `scripts/env.sh`:

| Check | Actual result |
| --- | --- |
| `gofmt -w server/internal/share` | Completed successfully |
| `go test ./...` from `server/` | Passed; `internal/share` 0.916s |
| `go test -race ./...` from `server/` | Passed; `internal/share` 5.415s |
| `go vet ./...` from `server/` | Passed |
| `go build -trimpath -o bin/household-server ./cmd/household` from `server/` | Passed |

The full suite still performs the actual default 9 MiB streamed HTTP transfer
and SHA-256 comparison. New/extended tests use isolated temporary SQLite/blob
stores and cover:

- Schema 1/2 -> 3 migration, old ready/pending content, original uploaded length,
  device ACK/arrival sequence preservation, no arrival backfill, schema-1/2
  rollback after partial ALTER failure, repaired reopen, and rejection of schema 4.
- Strict strings/types/nulls/unknown fields, missing/stale opening tokens,
  configured UTF-8 byte limits, escaped JSON and the encoded request ceiling
  (also without Content-Length), empty edits, Unicode/CRLF/tabs/code/Markdown,
  bounded preview/search, file-body rejection, file rename, larger uploaded text
  remaining renameable, and legacy pin compatibility with clock rollback.
- Atomic mixed fields and conflict rejection, unchanged immutable routing/source/
  creation/For you/ACK/arrival state, one small event after success and none after
  a failed Save, new hash/length/ETag/ranges after edits, unchanged ETag on rename,
  and cancellation preserving old content and removing the candidate.
- Real SQLite UPDATE failures and a deferred-foreign-key COMMIT rejection after
  the UPDATE succeeds. The rejected connection is discarded before checking
  committed data; a replacement connection still enforces foreign keys. Injected
  file-sync/directory-sync boundary failures, lost COMMIT response after a real
  successful commit, and old-blob cleanup failure verify old/new ready content,
  metadata, response/event semantics, accounting and reopen cleanup.
- Reconstructed durable precommit/postcommit crash states with a synced orphan
  or retired blob. Reopening follows the committed pointer and removes only the
  unreferenced generated file. These are restart-state simulations, not power-loss
  or hardware fsync-fault tests.
- Full replacement headroom even for shrink edits, unfinished promises plus
  unreferenced bytes (the prior max(sum,used) rule would undercount), fresh free
  space with pending promised remainders, and retired bytes in usedBytes.
- A real HTTP response paused after opening its old immutable descriptor while a
  same-length edit commits and the item is deleted. Its original bytes/name
  remain consistent; a separately opened defensive tus reader also survives
  unlink. Concurrent saves admit one winner/one conflict; edit/delete and edit/
  upload-completion races preserve the final state without orphaned edit blobs.
- Original tus HEAD length/offset and final-offset PATCH after larger, smaller,
  empty and originally zero-length text edits, including reopen. Ready uploads
  reject new WriteChunk bytes and retries do not create another arrival.
- Exact byte-preserving txt/md download suggestions, omitted/empty/unknown/
  duplicate/invalid formats, .txt/.md replacement versus other-extension append,
  dotfiles, multibyte/255-byte names, HEAD/ranges/If-Range and unchanged ETag/length.
  Ready uploaded file `/text` preparation returns exact bytes as inert plain text,
  including invalid UTF-8/binary bytes for client fatal-decoding rejection.

Changed and verified source files: `internal/share/{auth,complete,devices_test,
items,model,schema,server,storage,uploads}.go`, plus new `edits.go` and
`edits_test.go`. Updated documentation: `README.md` and this file. Built output:
`bin/household-server`. No dependencies, LocalSend source, client/root files,
Git state, live database, running services or system packages were changed.

Schema 3 requires the new binary; preserve a consistent stopped SQLite/blob
backup before upgrading, and restore its matching binary/data for rollback.
Old ready readers remain consistent using Linux open-descriptor/unlink semantics.
The final contract leaves the 8 MiB preparation ceiling and fatal UTF-8 validation
for uploaded-file Copy with clients; the server streams the authenticated ready
file without certifying its bytes or loading it into memory. Native completed-
upload reconciliation must use original tus completion plus known ready ID/kind,
not the subsequently edited size. UI/native work belongs to their owners.

Not checked: live deployment/upgrade/rollback, browser or native integration,
physical devices, OS notification presentation, actual power loss, disk hardware
failure, or a new 20 GB/GiB transfer. The injected durability boundaries and
reconstructed restart states do not claim those checks. Earlier validation below
remains historical evidence for its original builds.

## Device registry and durable arrivals release

Executed on 2026-10-23 with the existing approved project-local toolchain
(`go version go1.27.3 linux/amd64`), after sourcing `scripts/env.sh`:

| Check | Actual result |
| --- | --- |
| `gofmt -w server/internal/share` | Completed successfully |
| `go test ./...` from `server/` | Passed; `internal/share` 1.037s |
| `go test -race ./...` from `server/` | Passed; `internal/share` 4.656s |
| `go vet ./...` from `server/` | Passed |
| `go build -trimpath -o bin/household-server ./cmd/household` from `server/` | Passed; output under `server/bin/` |

Rename follow-up on the same date: `POST /api/devices/register` now accepts
`preserveExisting:true`. Its existing transaction uses a conditional SQL
conflict update, atomically creating an absent entry or returning the current
one without changing its label/platform. The focused regression checks initial
creation, stale background names after a user rename, overlapping background
ensures and an explicit rename, preserved creation time/ACK, and authoritative
sender-label snapshots. After that change, `go test ./...` passed (1.136s),
`go test -race -run '^TestDeviceEnsureRegistrationPreservesRename$'
./internal/share` passed (1.118s), and vet plus the server-local build passed.
No live service or client registration flow was exercised for this follow-up.

The full suite retains the default actual 9 MiB streamed HTTP transfer with
matching SHA-256. New/extended tests use isolated temporary SQLite/blob stores
and exercise:

- Schema-1 data migration to schema 2 before completion recovery; existing
  ready and full-pending text remain accessible, with no alert backfill on
  registration/reopen. An injected table conflict after the ALTER statements
  rolls back both columns and schema version; the failed open releases its
  lock so a repaired store can start. Schema 3 is rejected.
- Idempotent registry updates preserving creation time/ACK, duplicate labels,
  64-client capacity, updates at capacity, validation/body limits, and repeated
  forgetting. The largest possible explicit fanout in a full registry sends
  to all 63 other devices through tus metadata.
- Text/tus routing validation before blob/reservation creation, including
  invalid/null/unknown sources, missing sender for explicit targets, self,
  duplicate, malformed, unknown and excessive recipients. Source labels are
  snapshotted from the registry; Everyone excludes the sender, while legacy
  new sends fan out without reliable self-exclusion.
- Persisted routing across store close/reopen, ready-time broadcast membership,
  forgotten explicit destinations being omitted without broadcast fallback,
  no arrivals while uploading, zero-byte readiness, invalid UTF-8 exclusion,
  tus termination, item deletion, and no duplicate arrivals on HEAD/recovery.
- Ready-update and arrival-insert SQLite failures roll back all arrivals and
  emit no ready SSE event. Full text remains uploading rather than permanently
  failed; reopening revalidates, commits exactly one arrival per intended
  destination, and preserves exact UTF-8/CRLF/tab bytes. Existing final-offset
  HEAD and PATCH fault tests now also verify arrival rollback and recovery
  without restarting the server.
- Limited notification pages and hasMore, explicit replay after ACK, default
  stored ACK, concurrent/out-of-order monotonic ACKs, invalid/future cursors,
  and decimal sequences above JavaScript's safe-integer range. High-water and
  strictly increasing new sequences survive deletion of every notification
  through both item and device deletion, including a server restart.
- For you timestamp ties, search and opaque pagination without omissions or
  duplicates, retained acknowledged history, and exclusion of incomplete or
  failed content. Invalid device IDs return 400, unknown valid IDs 404.
  All shares and direct item access remain household-wide.
- New registry, arrival, ACK and filtered-feed endpoints require app auth.
  Registry/ACK/deletion writes reject foreign-Origin bearer requests and
  missing-Origin cookie requests, preserving the existing auth boundary.

Updated source: `internal/share/{schema,devices,devices_test,model,server,storage,
complete,items,uploads,server_test}.go`; documentation: `README.md` and this file.
No dependencies were added, and no LocalSend source was copied or adapted.
Schema 2 is additive for API clients, but an older schema-1 server cannot open
the migrated database; preserve a consistent stopped backup before upgrading.

These checks do not migrate the live database or deploy/restart any service.
No new 20 GB/GiB transfer, native client, physical device, OS notification
presentation, Tailscale configuration, or browser integration check was run for
this extension. Earlier container/shell results below describe their original
builds and do not validate the new client release.

## Earlier implementation checks

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
