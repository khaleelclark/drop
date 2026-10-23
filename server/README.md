# Zing server

Go API server for the shared household feed. The server embeds tusd 2.8.0 with
a custom SQLite/disk datastore. It does not run the tusd standalone executable.
Metadata and upload reservations live in SQLite; byte offsets come from the
ordinary blob file length. All download and upload endpoints require app auth,
using a token or the explicitly configured Tailscale Serve identity mode.

Requires Go **1.23 or newer**. SQLite is pure Go; CGO and a system SQLite package
are not required. The approved project-local toolchain is available by sourcing
`../scripts/env.sh`; no system package installation is required.

From `server/`:

```sh
go mod tidy
go test ./...
go test -race ./...
go vet ./...
go build -trimpath -o bin/household-server ./cmd/household
```

The dependency lockfile (`go.sum`) is included. The two direct dependencies are
pinned in `go.mod`. Actual validation results are recorded in `VALIDATION.md`.

Local development, with the built web application in `../web/dist`:

```sh
HOUSEHOLD_DEV=1 HOUSEHOLD_WEB_DIR=../web/dist go run ./cmd/household
```

In default token mode, explicit development permits a missing token and listens
only on 127.0.0.1. To exercise pairing, set `HOUSEHOLD_TOKEN` to at least 16 bytes and
enter that token in the web interface. Native clients send it as a bearer token.

For the intended Linux/Tailscale arrangement, explicitly select Tailscale mode
and configure an HTTPS origin and persistent directory. Deployment and host
configuration are outside this directory's implementation scope:

```sh
HOUSEHOLD_ADDR=127.0.0.1:8787 \
HOUSEHOLD_PUBLIC_URL=https://your-server.your-tailnet.ts.net \
HOUSEHOLD_AUTH_MODE=tailscale \
HOUSEHOLD_DATA_DIR=/path/to/persistent/household-data \
HOUSEHOLD_WEB_DIR=/path/to/web/dist \
bin/household-server
```

The server refuses a public bind address. It does not enable Tailscale Serve or
Funnel itself. In Tailscale mode it requires HTTPS even with `HOUSEHOLD_DEV=1`.
It accepts exactly one nonblank `Tailscale-User-Login` value of at most 1024 UTF-8
bytes, without control characters, from a loopback TCP peer. It ignores forwarded
IP/host/protocol hints. This trusts processes on the server host: a local process
can supply that header. Only enable this mode behind the intended Serve proxy.
[Tailscale documents](https://tailscale.com/docs/features/tailscale-serve#identity-headers)
that Serve strips caller identity headers and supplies the requesting user's
login. Tagged devices lack this identity and need an optional configured
`HOUSEHOLD_TOKEN` fallback. Tailscale grants/ACLs and device sharing determine
who can reach Serve; this app does not change them. Every authenticated household
client has the same feed and editing/deletion permissions.

Absent/`token` mode preserves the existing token setup and ignores Tailscale
identity headers. A production token-mode server still requires a nonempty
token. An optional token in Tailscale mode uses the same bearer/cookie flow;
keep it private. Neither mode is selected from request headers.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `HOUSEHOLD_ADDR` | `127.0.0.1:8787` | Explicit loopback IP and port |
| `HOUSEHOLD_PUBLIC_URL` | `http://127.0.0.1:8787` | Exact browser origin; HTTPS required outside token-mode dev; no trailing slash |
| `HOUSEHOLD_AUTH_MODE` | `token` | `token` or explicit `tailscale`; unknown modes are rejected |
| `HOUSEHOLD_TOKEN` | empty | Required outside dev in token mode; optional Tailscale fallback; 16–4096 bytes when set |
| `HOUSEHOLD_DEV` | unset | Set `1` to permit loopback HTTP and anonymous access only in token mode |
| `HOUSEHOLD_DATA_DIR` | `./data` | Persistent metadata and blobs |
| `HOUSEHOLD_WEB_DIR` | empty | Built static asset directory; empty serves API only |
| `HOUSEHOLD_MAX_FILE_BYTES` | `21474836480` | 20 GiB upload limit, configurable |
| `HOUSEHOLD_MAX_TEXT_BYTES` | `33554432` | Decoded JSON text limit; maximum configurable value 128 MiB |
| `HOUSEHOLD_MAX_STORAGE_BYTES` | `0` | Content quota; `0` means unlimited by app quota |
| `HOUSEHOLD_MIN_FREE_BYTES` | `268435456` | Minimum free disk headroom |
| `HOUSEHOLD_UPLOAD_TTL` | `168h` | Expire abandoned/failed transfers; `0s` disables expiry |

The large-file default is **20 GiB (21,474,836,480 bytes)**. Set the file limit
to `20000000000` for decimal 20 GB. The text limit applies to `POST /api/text` and replacement text in item PATCH;
larger UTF-8 text files use tus with kind `text`. Creation accepts text/Markdown/
code metadata candidates from `clients/shared/text-file-fixture.json` (text MIME,
listed application MIME or filename suffix), with no explicit non-UTF-8 charset.
These are eligibility hints: completion still validates the entire UTF-8 body
before ready. The 8 MiB uploaded-file Copy gate does not limit kind `text` uploads.
JSON request bytes are separately capped at six times the text limit plus 16 KiB
to permit escaped content. The JSON path buffers only this configured small-text
envelope. Uploads, downloads, checksum calculation, and large-text validation
use bounded buffers independent of total file length.

Storage quota checks reserve the entire declared length before accepting each
transfer. Actual blob bytes, including unfinished/failed bytes, are reported in
`usedBytes`. Available disk is checked before reservation and during each write;
filesystem write errors preserve partial upload offsets. External filesystem
changes can still exhaust the disk. Minimum disk headroom also leaves room for
metadata/WAL growth. The data directory must be local storage supporting SQLite
WAL, fsync, advisory locks, and atomic filesystem operations. One process owns a
directory; a second process is refused by an advisory lock.

New uploads are visible as `uploading`. The server fsyncs each received chunk
before confirming its offset. Completion checks the exact length and streams
SHA-256 across the file. Text additionally validates UTF-8 and produces at most
512 code points of preview. Only then does SQLite publish `ready`. Invalid text
becomes `failed`, remains unavailable to downloads, and can be deleted. A server
digest is a stored-byte identity, not proof of equality with the sender's source;
clients should compare source/download digests for an end-to-end transfer test.
Final validation may take time for large files. If a client times out after the
last chunk, refresh the item and HEAD the saved upload URL before deciding what
to retry. HEAD and PATCH retries also reattempt finalization for a full blob
left pending by a temporary read, fsync, or metadata error; a server restart is
not required. Content that actually fails UTF-8/length validation remains failed.

On startup, complete pending files are revalidated, incomplete files retain their
disk offset, missing/incorrect-length content is marked failed, and deletion
tombstones are finished. Unknown generated blob files are removed. An hourly
cleanup removes abandoned uploads and failed items older than the TTL, based on
last server write activity. Ready items remain until explicitly deleted, even
when pinned. Back up SQLite and blobs consistently while the process is stopped;
do not edit blob files in place or run multiple replicas against this directory.

Browser sessions are HMAC-signed cookies with 30-day expiry, HttpOnly,
SameSite=Strict, and Secure for HTTPS. Rotating the app token invalidates all
cookies. An empty token never signs or authenticates a session cookie. A verified
Tailscale request to `POST /api/session` with the exact browser Origin returns
204 without setting a cookie; identity is checked again on every request.
Logout clears any old browser cookie but does not log a device out of Tailscale.
Browser mutations require the exact configured Origin, including when identity
or bearer auth is supplied. Verified proxy requests without Origin support native
HTTP only when all `Sec-Fetch-*` headers are absent. The existing bearer path
also permits native HTTP without Origin. Missing-Origin cookie writes and
foreign/null/duplicate Origins are rejected.
Cross-origin browser access is not enabled. Static assets are public; content is
authenticated. Text is served as UTF-8 text/plain with nosniff. Filenames never
become filesystem paths. Downloads have authenticated HEAD, ETag and byte-range
support, Unicode attachment filenames, and a safe ASCII fallback.

The static app's script policy permits `'wasm-unsafe-eval'` for its bundled
incremental WebAssembly upload hasher. JavaScript eval, inline scripts, and
cross-origin script/connection sources remain blocked. API responses keep the
stricter script policy without the WebAssembly compilation exception.

SSE messages contain only a change type and item ID. Each subscriber has a
32-message queue; overflow disconnects it so the client reconnects and refreshes
the feed. There are at most 128 active SSE subscribers, with 20-second heartbeat
comments and bounded write deadlines. No replay guarantee is advertised.

## Registered devices and arrivals

The additive v1 device routes follow `../docs/api-contract.md`. Authenticated
clients register a durable random 32-character lowercase hexadecimal ID with
`POST /api/devices/register` (`id`, `label`, `platform`, optional
`preserveExisting`). By default registration updates the label/platform while
preserving creation time and acknowledgement. With `preserveExisting:true`,
the same atomic SQL operation creates an absent device or returns the existing
entry without changing its label/platform. Startup and background workers use
this mode so an old saved name cannot undo an explicit user rename. Labels
are inert, at most 128 UTF-8 bytes; platforms are `macos`, `linux`, `android`,
or `browser`. The registry permits 64 clients. `GET /api/devices` lists them;
`DELETE /api/devices/{id}` forgets an entry and its arrivals, idempotently.
Registration and acknowledgement JSON bodies are capped at 16 KiB.

Text JSON and tus metadata accept `sourceDeviceId` and `targetDeviceIds`.
Tus encodes the source ID as base64 ASCII and the target JSON array as base64
UTF-8. The sender and up to 64 unique targets must already be registered;
explicit targets require a sender and cannot include it. Validation occurs in
the reservation transaction before creating a blob. The sender's registered
label is snapshotted into `sourceDevice`; routing stays unchanged across resume.
Omitted/empty targets mean Everyone registered when content becomes ready,
excluding the sending ID. Legacy sends retain their caller label and Everyone
behavior, without reliable self-exclusion. A forgotten explicit recipient is
skipped at completion, never replaced by Everyone.

`GET /api/items?forDevice={id}` is the ready-only For you feed, with the same
search and opaque timestamp/ID pagination as All shares. It uses retained
arrival rows and is independent of acknowledgement. Targeting is routing, not
an access restriction: every authenticated household client can still fetch,
modify, or delete every item and manage every registry entry. IDs are not
credentials. Registering a client never backfills existing ready content.

`GET /api/devices/{id}/notifications?after={sequence}&limit=50` returns bounded
ready arrivals (`sequence`, `itemId`, `createdAt`), `nextCursor`, `ackCursor`,
and `hasMore`. Limits are 1–100. Omitted `after` starts at the stored ACK;
explicit `after` permits replay. Cursors are canonical decimal strings within
SQLite's signed 64-bit range; never convert them to JavaScript numbers.
`POST /api/devices/{id}/notifications/ack` with `{"through":"124"}` advances
the ACK monotonically, including under concurrent/retried requests. Invalid
or future cursors return 400. ACK means processed, not read or downloaded.
ACKed rows stay available for For you history; item/device deletion removes
them. The global AUTOINCREMENT high-water survives deleting every arrival.

Schema 2 added devices, bounded item routing columns, and indexed durable
arrivals with cascading deletion. Startup now transactionally migrates schemas
1/2 to schema 3 before recovery, without ready-item arrival backfill, and rejects
newer schemas.
After streamed hash/UTF-8 validation, arrivals and the ready transition commit
together; only then is the small SSE update emitted. Failed transactions leave
full bytes uploading and recoverable. HEAD/PATCH retries repair pending tus
completion; startup retries pending text completion. A failed text creation
response must not trigger an automatic new POST, which could duplicate content.
Before an upgrade, preserve a consistent stopped SQLite/blob backup; an older
schema-1 or schema-2 binary cannot read a database already migrated to schema 3.

These routes supply durable inbox state, not OS notification delivery, online
presence, receipts, or automatic downloads. Client notification scheduling and
device-specific limits are outside the server.

## Shared entry editing and text exports

`PATCH /api/items/{id}` accepts `name`, `text`, `pinned`, and
`expectedUpdatedAt`. At least one mutation is required. Name/text changes need
the exact opening `updatedAt` token, and only work for ready items; stale tokens
return `409 edit_conflict`. A supplied token is checked for pin-only changes too,
while legacy unversioned pinning remains supported. Unknown fields, nulls and
wrong types are rejected. Replacement text must be strict UTF-8 within the
configured JSON text limit; an empty string is valid. Files support display-name
changes, with no binary body editing. Mixed changes commit together, timestamps
advance monotonically, and preview/size/SHA-256/search follow the saved text.
Item identity, creation order, routing, source snapshot, arrivals and ACK stay
unchanged. Only the existing small updated SSE event is emitted after Save.

Schema 3 adds an internal immutable-content pointer (`blob_id`) and original
`upload_length`, initialized transactionally from existing IDs/upload sizes.
It copies no blob data. Each replacement is a fresh mode-0600 O_EXCL blob;
file/directory fsync precede the transactional pointer/metadata swap. The ready
entry continues to reference the old content until commit. Precommit failures
leave it intact. Old-blob cleanup is best effort after confirmed commit, and
cleanup errors do not fail a committed Save. Failed/ambiguous COMMIT connections
are discarded before confirming from a fresh committed view, with the connection's
foreign-key, busy-timeout and full-sync settings reapplied. Uncertain blobs are
retained for startup recovery; only unreferenced generated blobs are removed.
There is no edit history or merge feature. Keep a consistent stopped SQLite/blob
backup before upgrading; rollback requires that backup and its matching binary.

Quota and disk checks include the full new text alongside old content, every
unfinished promise, and unreferenced/retired bytes, even for shrink edits. Upload
block writers keep their free-space checks and never wait on the edit reservation
mutex. Reads open/stat the committed immutable blob with its metadata under the
item lock, release the lock, then stream the descriptor. Existing Linux readers
stay consistent across a later edit/delete. No whole-file download buffer is
introduced. Completed tus HEAD/final-offset PATCH retain the original upload
length/offset after growing, shrinking or emptying uploaded text. Native queue
reconciliation must therefore accept a known ready item after verifying original
tus completion rather than compare its edited size to the old source size.

`GET|HEAD /api/items/{id}/download?format=txt|md` changes only a text entry's
attachment filename suggestion. The final non-leading extension is replaced;
a dotfile stem is preserved. Only the stem is truncated on UTF-8 boundaries to
fit 255 bytes, with safe ASCII and UTF-8 header forms. Empty, unknown or duplicate
formats return 400. Files reject format selection with `404 not_text`, including
textual uploaded files; their ordinary download stays available. Omitting format
retains the original name.
Exact bytes, SHA-256 ETag, length, Range and If-Range behavior are preserved.
No Markdown rendering, execution or conversion occurs.

The authenticated ready-item `/text` route also prepares eligible uploaded files
as inert `text/plain; charset=utf-8` with nosniff. Metadata hints follow
`../clients/shared/text-file-fixture.json`: `text/*`, the documented textual
application MIME allowlist, or a common text/code suffix. An explicit charset
must be UTF-8. Hints alone do not validate bytes: before sending any content the
server scans the entire immutable descriptor, at most 8 MiB, rejecting malformed
UTF-8, NUL and control characters other than TAB/CR/LF. It rewinds and streams
the same descriptor unchanged, preserving BOM and whitespace. Unsupported/binary
files return `415 not_text`; oversized candidates return `413 text_too_large`.
Ordinary Download remains available after preparation fails. Validation reuses
the bounded 128 KiB scanner; no whole-file server buffer or DB capability field
is added. Existing kind=text raw endpoint semantics remain unchanged. Clients
also retain their 8 MiB response ceiling and fatal UTF-8 decoding.
Client editor/Copy limits remain 8 MiB, expanded DOM text 256 KiB; the server's
configured text limit is independent. Larger entries remain renameable and
stream-downloadable. UI Save/Cancel, conflict drafts, native bridge limits and
completed-upload reconciliation are implemented by the client owners.

Tests cover auth/CSRF and loopback constraints, strict Unicode preservation and
JSON limits, ready gating, tus offsets/restarts, checksum/download byte equality,
HEAD/ranges, metadata paths, invalid uploaded text, split UTF-8 block boundaries,
pending completion recovery, stale cleanup, concurrent storage reservations,
pagination, bounded SSE subscribers, and a default 9 MiB streamed HTTP transfer.
Device tests additionally cover schema migration/rollback, registry limits,
recipient validation, fanout snapshots, replay/ACK, For you pagination, retained
high-water after deletion/restart, large decimal cursors, and atomic arrival
recovery after injected database errors.

An opt-in streamed transfer test uses a deterministic source and compares
SHA-256 after download. It requires enough free disk and time:

```sh
HOUSEHOLD_TEST_LARGE_BYTES=21474836480 go test -run '^TestStreamedTransfer$' -timeout 2h -v ./internal/share
```

That test alone does not prove client interruption/restart, Android background
operation, or a physical-device transfer. Those are separate integration checks.
The implementation task has **not** demonstrated a 20 GB/GiB transfer or a
native/device run. See the canonical handoff for actual commands executed.
