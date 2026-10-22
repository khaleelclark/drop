# Household Share server

Go API server for the shared household feed. The server embeds tusd 2.8.0 with
a custom SQLite/disk datastore. It does not run the tusd standalone executable.
Metadata and upload reservations live in SQLite; byte offsets come from the
ordinary blob file length. All download and upload endpoints require app auth.

Requires Go **1.23 or newer**. SQLite is pure Go; CGO and a system SQLite package
are not required. The approved project-local toolchain is available by sourcing
`../scripts/env.sh`; no system package installation is required.

From `server/`:

```sh
go mod tidy
go test ./...
go test -race ./...
go vet ./...
go build -trimpath -o ../bin/household-server ./cmd/household
```

The dependency lockfile (`go.sum`) is included. The two direct dependencies are
pinned in `go.mod`. Actual validation results are recorded in `VALIDATION.md`.

Local development, with the built web application in `../web/dist`:

```sh
HOUSEHOLD_DEV=1 HOUSEHOLD_WEB_DIR=../web/dist go run ./cmd/household
```

This explicit development mode allows a missing token and listens only on
127.0.0.1. To exercise pairing, set `HOUSEHOLD_TOKEN` to at least 16 bytes and
enter that token in the web interface. Native clients send it as a bearer token.

For the intended Linux/Tailscale arrangement, configure an HTTPS origin, token,
and persistent directory before starting the executable. Deployment and host
configuration are outside this directory's implementation scope:

```sh
HOUSEHOLD_ADDR=127.0.0.1:8787 \
HOUSEHOLD_PUBLIC_URL=https://your-server.your-tailnet.ts.net \
HOUSEHOLD_TOKEN='replace-with-a-long-random-secret' \
HOUSEHOLD_DATA_DIR=/path/to/persistent/household-data \
HOUSEHOLD_WEB_DIR=/path/to/web/dist \
../bin/household-server
```

The server refuses a public bind address. It does not enable Tailscale Serve or
Funnel itself. Tailscale supplies transport/access restrictions; the configured
app token remains required in production. Tailscale identity headers are not
used as a substitute for app authentication. Keep this token private; every
authenticated household client has the same feed and deletion permissions.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `HOUSEHOLD_ADDR` | `127.0.0.1:8787` | Explicit loopback IP and port |
| `HOUSEHOLD_PUBLIC_URL` | `http://127.0.0.1:8787` | Exact browser origin; HTTPS required outside dev; no trailing slash |
| `HOUSEHOLD_TOKEN` | empty | Required outside dev; 16–4096 bytes |
| `HOUSEHOLD_DEV` | unset | Set `1` to permit loopback HTTP and optional token |
| `HOUSEHOLD_DATA_DIR` | `./data` | Persistent metadata and blobs |
| `HOUSEHOLD_WEB_DIR` | empty | Built static asset directory; empty serves API only |
| `HOUSEHOLD_MAX_FILE_BYTES` | `21474836480` | 20 GiB upload limit, configurable |
| `HOUSEHOLD_MAX_TEXT_BYTES` | `33554432` | Decoded JSON text limit; maximum configurable value 128 MiB |
| `HOUSEHOLD_MAX_STORAGE_BYTES` | `0` | Content quota; `0` means unlimited by app quota |
| `HOUSEHOLD_MIN_FREE_BYTES` | `268435456` | Minimum free disk headroom |
| `HOUSEHOLD_UPLOAD_TTL` | `168h` | Expire abandoned/failed transfers; `0s` disables expiry |

The large-file default is **20 GiB (21,474,836,480 bytes)**. Set the file limit
to `20000000000` for decimal 20 GB. The text limit applies to `POST /api/text`;
larger UTF-8 text files use tus with kind `text` and MIME type `text/plain`.
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
cookies. Logout clears the browser cookie. Browser mutations require the exact
configured Origin. Bearer requests without Origin support native HTTP clients.
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

Tests cover auth/CSRF and loopback constraints, strict Unicode preservation and
JSON limits, ready gating, tus offsets/restarts, checksum/download byte equality,
HEAD/ranges, metadata paths, invalid uploaded text, split UTF-8 block boundaries,
pending completion recovery, stale cleanup, concurrent storage reservations,
pagination, bounded SSE subscribers, and a default 9 MiB streamed HTTP transfer.

An opt-in streamed transfer test uses a deterministic source and compares
SHA-256 after download. It requires enough free disk and time:

```sh
HOUSEHOLD_TEST_LARGE_BYTES=21474836480 go test -run '^TestStreamedTransfer$' -timeout 2h -v ./internal/share
```

That test alone does not prove client interruption/restart, Android background
operation, or a physical-device transfer. Those are separate integration checks.
The implementation task has **not** demonstrated a 20 GB/GiB transfer or a
native/device run. See the canonical handoff for actual commands executed.
