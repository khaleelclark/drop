# Desktop native review

Reviewed 2026-10-22. Read-only review of the Rust queue/library, CLI, protocol
tests, Tauri shell/config/capabilities, and `integrations/macos/` against the
current API contract. No owner source was modified.

## Recheck after fixes

Rechecked 2026-10-22 against the updated library. **All three findings below are
resolved in the exercised paths.** The original reproductions are retained as
historical evidence, not open defects.

Recovery handoff on the same date: reread the current capture, ingestion,
completion, staging cleanup and cancellation code plus the four regression
tests. Also read the retained real-server probe sources (`probe.rs`, `run.py`)
and complete `results.json` at the temporary directory listed below. The saved
results confirm all three successful scenarios, including actual HTTP 422 and
409 responses, server A/B item counts, preserved rejected bytes and the exact
ready-item download. Reused these completed checks after the host interruption;
no additional build, test or real-server run was performed for this recovery
handoff. The reviewed library and protocol-test files predate those saved
results. No remaining defect was found within these three cases.

- Destination binding (`src/lib.rs:208-221,278-362,507-580`): public API probes
  captured both a file and stdin text while paired with real server A, paired
  with separate real server B, then consumed the spool. Both rows retained A's
  origin, had empty saved spool tokens, and paused with a reconnect message.
  `tick()` found no runnable transfer. After explicitly reconnecting A and
  resuming, both completed on A; A had two ready items and B had zero items.
- Validation (`src/lib.rs:855-903,904-997`): a staged FF FE text upload to the
  actual Go server first returned HTTP 422. Resume/HEAD at the full offset now
  retained `error` with `Server rejected upload validation; original source
  retained`. Reopening the queue and retrying did the same. The server item
  remained `failed`; the staged file retained the exact two original bytes.
- Lost final acknowledgement (`src/lib.rs:1177-1209`, merge at `727-745`): a
  loopback proxy forwarded the real server's successful final PATCH, consumed
  its 204 response, then closed the client connection without forwarding it.
  The client was `queued` with a network error. Resume, Cancel, and one tick
  issued a real tus DELETE returning 409, followed by GET of the bound item.
  The queue settled to `complete`, offset 24/24, no error. The household item
  remained `ready` and its downloaded bytes exactly matched the captured
  `acknowledged then lost\r\n` text. Staging was removed only after readiness;
  the next tick found no runnable work.

Recheck validation:

- `source scripts/env.sh && cargo test --locked --offline --manifest-path clients/desktop/native/Cargo.toml`
  passed all **4 unit + 11 HTTP protocol tests** (15 total), including the four
  added regressions; CLI/doc targets had no tests. Protocol tests use the
  repository's local Rust HTTP fixture, independently of the real Go probes.
- Built a fresh temporary Go executable from current `server/` source with
  `go build -o <temporary executable> ./cmd/household`.
- Compiled an isolated Rust probe against the just-tested library using public
  `Queue`, `Config`, `spool_upload`, and `spool_text` APIs; no private library
  functions or owner-source edits. The Python driver used the existing smoke
  `Server` helper to create four isolated loopback servers and a standard-library
  HTTP proxy. It asserted the queue states, spool credentials, stage bytes, real
  item states, and exact retained download bytes described above.
- Temporary probe directory:
  `/home/phoenix/.p-prod-tmp/desktop-recheck-oLDpfo/` (`probe.rs`, `run.py`, and
  `results.json`). Servers were stopped after the checks. No dependency or
  toolchain installation, deployment, Tauri GUI run, macOS/device validation,
  background/window-close check, or repeat of the separate 20 GiB test occurred.

No remaining actionable defect was found within these three recheck cases.
Only this reviewer-owned report was changed in the checkout.

## Original findings (resolved by the recheck above)

### Medium: pending capture loses its destination server

Locations: `clients/desktop/native/src/lib.rs:206-219,282,299-306,501-524`.

Capture reads configuration but does not store it in either Inbox variant.
Ingestion later reads the current global configuration. A file acknowledged as
locally queued for server A can therefore be sent to server B after re-pairing,
without an explicit action moving that capture between servers.

Reproduced through the actual public Rust API: configure A, `spool_upload`,
configure B, `consume_spool`, inspect persisted `queue.json`. The pending
capture's transfer contains B's origin. No payload was sent for this probe.

Persist the intended server/configuration identity with each captured Inbox
message and preserve it during ingestion. Apply the same policy to file and
stdin-text capture. If credentials later change for that same origin, updating
them can remain an explicit configuration operation; changing the origin should
not silently migrate pending captured content.

### Medium: retry marks rejected content complete using only the final offset

Location: `clients/desktop/native/src/lib.rs:859-866` (completion also triggers
staging cleanup at `691-692`).

The final tus offset describes transferred bytes, independently of application
validation. The server retains the final offset of invalid UTF-8 content while
its item is `failed`. The client retries HEAD and reports `complete` without
reading that item status. A failed staged text transfer can also lose its local
staging file through completion cleanup.

Reproduced against a freshly built actual Go server: enqueue two bytes FF FE as
kind `text`; the first `tick` records `error`, `HTTP 422`. Resume and tick again:
the queue records `complete` and clears the error, while `GET /api/items` still
reports that same item as `failed`.

Reconcile the associated item before publishing transfer completion and cleaning
staged content. Preserve an accurate validation error for failed items and wait
or retry explicitly while validation is pending. This is narrower than the
documented distinction between transferred bytes and feed readiness: the
observed retry hides a known rejected upload as success.

### Medium: Cancel cannot settle after a lost final acknowledgement

Location: `clients/desktop/native/src/lib.rs:1070-1083`; the merge at
`681-687` retains `cancelling` after this error.

If the server finishes the final PATCH but its response is lost, the queue
remains retryable while the server item is already ready. Cancel then sends tus
DELETE; the server returns the contract's 409 for an already-ready item. This
path accepts only success/404/410, so the row remains `cancelling` with HTTP 409.
Further cancellation steps cannot change the outcome.

Reproduced using the actual Rust queue and fresh Go server behind a loopback
proxy that forwards the final PATCH, reads its successful server response, then
closes the client connection without forwarding that response. First result:
`queued` with a network error. After resetting the retry delay via Resume, then
Cancel and tick: `cancelling`, `HTTP 409`. The proxy preserved the real server's
DELETE semantics; it did not synthesize that error.

Reconcile this already-completed case to an accurate terminal state. If Cancel
is intended to remove completed household content, use the item deletion API
under an explicitly defined policy; do not repeatedly issue impossible tus
termination requests.

## Validation actually run

- `source scripts/env.sh && cargo test --locked --offline --manifest-path clients/desktop/native/Cargo.toml`
  passed: 3 unit tests and 8 protocol tests, plus CLI/doc targets with no tests.
- The available project toolchain reports Cargo 1.99.1 and rustc 1.99.1. The
  original request's absent-toolchain observation is no longer current.
- `bash -n integrations/macos/send-files.sh integrations/macos/send-text.sh integrations/macos/send-clipboard.sh`
  passed.
- `python3 integrations/macos/test_capture.py` passed exact argument/Unicode
  stdin checks with a fake helper on Linux.
- Additional temporary Rust probes linked the library just built by Cargo,
  using `rustc --edition=2021 -L dependency=<native target/debug/deps> --extern
  household_native=<built rlib>`. The probe used public Queue/capture methods,
  isolated temporary queue directories, and placeholder credentials where no
  server access was needed.
- Actual server probes built a temporary executable with `go build -o
  <temporary server> ./cmd/household` from `server/` after sourcing
  `scripts/env.sh`. The existing smoke-harness Server helper supplied isolated
  loopback process/data configuration. A standard-library Python HTTP proxy
  dropped only the final PATCH response for the lost-acknowledgement case.
- Temporary probe/build/data files were removed by Python TemporaryDirectory
  cleanup. The Rust test build updated generated target artifacts, not owner
  source or dependency lockfiles.

No additional concrete range/ETag, bounded-file-buffer, source-fingerprint,
clipboard-success, shell quoting, or remote-webview privilege defect was found
in this bounded review. These checks do not compile or execute the Tauri GUI,
exercise macOS facilities, prove native window-close/background behavior, or
independently repeat the owner's separate native 20 GiB report. No installation
or deployment was performed.
