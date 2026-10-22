# Household Share quality review

Initial review: 2026-10-22. This is a design review and a proposed black-box plan, not a record of passing tests. No server, browser, native build, device, or 20 GB transfer was tested in this review.

Reviewed: `AGENTS.md`, `docs/api-contract.md`, `household-share-architecture.md`, and both referenced architecture artifacts. The workspace architecture adds explicit Android visible-activity scheduling and continuous state persistence beyond the older artifacts.

## Contract findings to resolve before integration

1. **High: choose the installed frontend transport explicitly.** The API requires a same-origin browser, a strict session cookie, and permits native bearer mutations without Origin (`docs/api-contract.md:7-9`), while the architecture bundles the installed frontend locally. Reusing browser `fetch`, `EventSource`, and cookie download links from that local frontend does not implement the native bearer path. Define native HTTP commands/adapter coverage for feed, text, events or polling, session setup, uploads, and streamed downloads; alternatively specify narrow origin/CORS behavior for installed webviews. Do not solve this by allowing arbitrary origins or putting the token in URLs. Tauri's HTTP plugin also requires explicit destination scopes: [official HTTP plugin documentation](https://v2.tauri.app/plugin/http-client/).

2. **High: bound Copy/Expand preparation separately from stored text size.** The contract permits a text item through the 20 GiB upload path (`docs/api-contract.md:19,27`), then instructs clients to fetch the full body for Copy (`:46`). A valid large text item can therefore exhaust the receiving app's memory if these instructions are implemented literally. Specify a conservative copy/expand preparation limit using the known byte size, cancellable preparation, and a clear full `.txt` download action above that limit. Never silently copy a preview or truncate the item. Whole-item storage and practical clipboard capability must remain distinct, as the architecture already explains.

3. **Medium: the pagination cursor needs a unique tie-breaker.** `before=<RFC3339>` and newest-first order (`docs/api-contract.md:17`) cannot reliably paginate items with equal creation timestamps. Specify an opaque cursor containing `(createdAt,id)` and the matching stable sort/comparison, with clients passing it verbatim. Add an acceptance case with more than one page created at the same timestamp.

4. **Medium: pin down session cookie/proxy rules.** The contract says HttpOnly and SameSite=Strict but omits Secure, path, lifetime, and how HTTPS is determined behind loopback Serve (`docs/api-contract.md:9`). Require Secure for the configured HTTPS origin, a narrow Path, explicit expiration, origin checks on session creation/deletion, and rejection of missing/foreign Origin on cookie-authenticated mutations. Keep the explicit bearer-without-Origin path. Any trusted external scheme/host must come from configured origin or a specifically trusted proxy, not arbitrary forwarding headers. Test this through the reverse-proxy shape; direct HTTP development is a separate explicit mode.

## Additional implementation acceptance requirements

- Persist a strong enough source identity to reject a changed source before resume; filename and length alone are insufficient. A stable Android URI is access, not proof of immutable bytes.
- Persist download target, written offset, expected size and ETag; append only after validating `206` and the exact `Content-Range`. A `200` response to a resumed request must trigger a safe restart rather than append. Publish a completed destination only after exact length/integrity checks.
- Make upload `Location` usable through HTTPS Serve; a loopback or HTTP URL must not leak into a remote client. The tus creation protocol returns this URL to the client: [tus specification](https://tus.io/protocols/resumable-upload).
- Count outstanding length reservations atomically against storage/free-space limits, not just bytes already written. Reconcile reservations and orphaned upload data after crash, deletion, termination, and a lost creation response. Specify abandoned-upload cleanup.
- Treat final upload offset and application-ready state separately; a native queue must not report content available merely because the final PATCH succeeded. Include zero-length creation, completion validation failure, and restart during validation.
- Android must checkpoint outside `onStopJob`, schedule UIDT while allowed, and keep source permission/staging viable after the intake activity closes. The OS can terminate work without that callback: [official Android UIDT documentation](https://developer.android.com/develop/background-work/background-tasks/uidt).

## Black-box release checks

Record command/browser/device versions, observed results, file sizes and hashes. Mark unavailable checks unperformed. Use a disposable test data directory and explicit development configuration; do not deploy or change system settings for these checks.

| Area | Stimulus | Required observation |
| --- | --- | --- |
| Exposure and auth | Start with missing token outside dev; try non-loopback bind; request each data API without auth | Fail closed; no data from items, text, download, uploads, events, or storage; static UI/health alone may be public |
| Browser origin | Valid cookie plus foreign Origin, absent Origin, `Origin: null`, and hostile forwarded headers on each mutation including session routes | Denied; same configured browser origin succeeds; valid native bearer without Origin succeeds |
| Session behavior | Pair through HTTPS proxy, refresh, log out, then revisit data and download URLs | Secure/HttpOnly/Strict cookie has intended path/lifetime; logout removes browser access; no token appears in URL, logs, feed, or events |
| Stored text | Send leading/trailing whitespace, CRLF and LF, tabs, non-BMP Unicode, combining marks and HTML/script text; retrieve and copy on another device | Exact body/whitespace retained; script inert; full content copied; success appears only after clipboard write |
| Copy failure and size | Deny clipboard access; delay body fetch beyond activation; open text above preparation limit | Recoverable failure or Prepare then Copy; no false success, preview copying, or unbounded preparation; `.txt` download remains available |
| Feed bounds | More than one page of items sharing a creation timestamp; long metadata; huge text item; SSE reconnect | No missing/duplicate pagination; bounded feed/events; no body in metadata; reconnect refreshes current feed |
| tus correctness | Incorrect/missing version, offset, length, content type; oversized metadata; partial PATCH connection loss | Protocol errors leave confirmed offset truthful; HEAD resumes exactly; invalid input does not reserve unbounded storage |
| Transfer completion | Download during upload/validation; zero-byte upload; invalid UTF-8 text upload; kill server during finalization | No incomplete downloadable bytes; zero-byte file completes; invalid text fails; restart converges to one consistent item |
| Capacity and cleanup | Concurrent reservations exceeding budget; interrupted upload; delete/cancel during writes/finalization; storage failure using an isolated constrained test store | Admission is atomic; no completed corrupted content; no resurrected deleted item; blobs and reservations reconcile |
| Source mutation | Resume after replacing source with equal-length content; remove source; revoke Android URI access | Queue refuses unsafe resume, explains source problem, and does not silently concatenate different content |
| Download resume | Interrupt, restart client, resume with matching/changed ETag; server returns 200/206/416; destination already exists | Validated ranges; safe overwrite/conflict policy; no duplicate append, silent truncation, or premature completion |
| 20 GB end to end | Real 20,000,000,000-byte source, upload/download interruptions plus server/client restarts, then source/destination checksum | Exact size/hash match; server/native memory remains bounded; progress/offsets exceed signed 32-bit range correctly |
| Configured maximum | Item at configured limit (default 21,474,836,480 bytes), then one byte above | Exact documented acceptance/rejection; product UI distinguishes decimal GB and GiB |
| Desktop lifetime | Close window mid-transfer; reopen; explicit Quit and relaunch; invoke Finder/Shortcut intake | Closing preserves native queue; explicit Quit checkpoints; relaunch resumes; Quick Action enqueues without a blocking shell upload |
| Android lifetime | Share temporary URI, picker persistent URI, screen lock, activity dismissal, OS process stop and permitted relaunch; no staging space | Native UIDT/notification/offsets work independently of webview; access survives or durable staging is explicit; lack of space is recoverable |
| Local installation | Ad-hoc macOS app on actual Mac; APK signed with retained key installed/updated via ADB on actual phone | Installation, launch, permissions, sharing, and updates observed on named devices; no store/developer account requirement |

Release evidence must include installed clients and real device lifetime checks. Browser checks or source inspection cannot substitute for them. Sender/destination checksum comparison is needed to validate the 20 GB round trip; a server-computed digest alone does not establish end-to-end equality.
