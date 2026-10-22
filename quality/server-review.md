# Server and packaging review

Reviewed 2026-10-22. Scope: all Go source and tests under `server/`, current
`docs/api-contract.md`, `Dockerfile`, `compose.yaml`, and `scripts/smoke.py`.
Also read the architecture, server documentation, environment helper, and Docker
context exclusions. This review made no changes to server or root implementation.

## Result

**No open actionable defect found in the reviewed snapshot.** This is a bounded
source review plus the checks below, not a proof against every failure mode.

The previously reported **Medium** finalization-recovery defect is fixed:

- `server/internal/share/uploads.go:108-120` retries completion when a full blob
  is still `uploading`. Existing-upload HEAD/PATCH calls execute this under the
  tusd item lock; genuine validation failures remain failures.
- `server/internal/share/server_test.go:321-366` injects a SQLite trigger that
  rejects the ready transition after the final bytes are written. After the
  trigger is removed, separate HEAD and final-offset PATCH cases recover through
  the same Server instance and verify exact downloaded bytes.
- Both cases passed in the independently executed race-enabled suite. This
  reproduces the original fault and verifies recovery without restarting.

## Areas inspected

| Area | Evidence in the reviewed source/checks |
| --- | --- |
| Authentication and CSRF | `auth.go:44-98,129-156`: constant-time token comparison; HMAC cookies tied to the configured token; explicit configured Origin; cookie writes reject missing/foreign Origin; native bearer writes allow absent Origin. Secure cookie behavior derives from configuration. |
| Production exposure | `config.go:61-87`: explicit loopback bind, required production token and HTTPS origin. `compose.yaml:5` uses host networking with that loopback listener; no published public bind or automatic Serve/Funnel configuration. |
| Reservation accounting | `storage.go:61-113`: one mutex spans declared reservation checks and durable insertion; remaining declared bytes count against available disk. Concurrent quota test accepts exactly five 20-byte reservations in a 100-byte quota. |
| Upload offsets and readiness | `uploads.go:124-183`: fixed buffers, offset/remaining-length checks, per-item tusd lock, fsync before success. `complete.go:15-100`: exact size, streamed SHA-256, UTF-8 validation, bounded preview, ready transition after validation. |
| Deletion and crash recovery | `storage.go:148-239,266-309`: tombstone before unlink, directory sync, startup reconciliation, stale cleanup under item locks, ready items excluded from expiry. Partial-upload close/reopen and complete-pending recovery are covered by the suite. |
| Downloads | `items.go:315-385`: ready/type/length gating, generated blob paths, exact bytes, checksum ETag, standard HTTP ranges/HEAD, attachment filename encoding and JSON error adaptation. |
| Text/feed bounds | `items.go:18-64,233-312`: strict Unicode JSON handling and a separately configured text limit. `complete.go:59-83` caps previews to 512 code points. Feed pagination uses the timestamp/ID pair; events contain only type/ID and have bounded subscriber queues. |
| Packaging | Multi-stage static Go/server and web build, nonroot runtime, persistent data volume, dropped capabilities and no-new-privileges. Compose interpolation/configuration validation passed. Image build/runtime were not exercised by this reviewer. |

The pinned local tusd 2.8.0 source in the Go module cache was inspected to verify
HEAD/PATCH/DELETE locking, final-offset PATCH behavior, creation handling, and
the memory-lock release callback. No upstream source change was made.

## Validation actually executed

Commands were run from the workspace unless a working directory is shown.

| Command | Result |
| --- | --- |
| `source scripts/env.sh && go version` | `go version go1.27.3 linux/amd64` |
| `source scripts/env.sh && cd server && go test -race -count=1 ./...` | PASS; `internal/share` 3.236s; command package has no tests. Includes real HTTP 9 MiB streamed upload/download with checksum comparison, transient finalization injection, strict text, offsets/reopen, ranges, concurrent quota, cursor ties, and bounded event checks. |
| `source scripts/env.sh && cd server && go vet ./...` | PASS; no output. |
| `go build -trimpath -o <temporary-directory>/household-server ./cmd/household` from `server/` after sourcing `scripts/env.sh` | PASS. The temporary build was removed through Python's `TemporaryDirectory` cleanup. |
| `python3 scripts/smoke.py --server <temporary-directory>/household-server` | PASS against that fresh build over real loopback HTTP: auth, exact text, range/HEAD, pin, wrong offsets, process stop/restart/resume, byte integrity, browser session, hostile-Origin CSRF denial, invalid uploaded UTF-8. |
| `HOUSEHOLD_TOKEN=review-placeholder-123456789 HOUSEHOLD_PUBLIC_URL=https://household.test docker compose config --quiet` | PASS; no output. Placeholder values were used for this read-only configuration check. |

The suite was inspected for meaningful assertions rather than inferred from the
command exit alone. The default streamed test is **9 MiB**, not 20 GiB. The smoke
run used its default small fixture; its restart is graceful process termination.

## Limits and remaining validation

No software was installed, no service deployed, and no server/root source was
modified. This reviewer did not repeat the root's separately reported 20 GiB
round trip, build/run the production image, configure Tailscale Serve, or test a
native client or physical device. Real power-loss/filesystem failures and actual
disk exhaustion were not induced. The SQLite ready-transition failure was the
fault injection actually executed. The complete 20 GB interruption matrix,
including abrupt client loss and resumed native downloads, remains an integration
and device validation task rather than evidence supplied by this review.
