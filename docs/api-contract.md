# Household Share API v1

Root-owned contract. Coordinate changes with all client/server owners before changing routes or shapes.

## Transport and auth

Base path `/api`. Same-origin browser app. In deployed mode Tailscale Serve terminates HTTPS and forwards to loopback.

Server accepts configured `HOUSEHOLD_TOKEN` via `Authorization: Bearer <token>` or an HttpOnly SameSite=Strict session cookie set by `POST /api/session` with JSON `{ "token": "..." }`. Missing configured token is permitted only in explicit local-development mode (`HOUSEHOLD_DEV=1`) with loopback bind. Session DELETE logs out. Native clients use bearer token. `/api/health` and static UI are public; data APIs require auth. Mutating browser requests must pass origin/CSRF validation, allowing same configured origin and native bearer-auth requests without Origin.

Cookie contract: Path=/api, HttpOnly, SameSite=Strict, maximum age 30 days, Secure whenever the configured external origin is HTTPS (including behind loopback Serve). Plain HTTP is for explicit local loopback development/testing only. Use HOUSEHOLD_PUBLIC_URL as the trusted external origin; never infer security from arbitrary forwarded headers. Session creation/deletion require the configured same Origin, as do cookie-authenticated writes. Reject absent, null, or foreign Origin on cookie writes. Native bearer requests without Origin are allowed; a foreign Origin is not legitimized by also carrying a bearer token. Logout clears the cookie with matching path/security attributes; rotating the configured token invalidates old sessions.

Installed frontend transport: the bundled local webview must use native HTTP commands/plugin for all remote API operations (metadata, full text, storage, mutations, upload protocol, and streamed downloads), with bearer authentication. It must not rely on browser cross-origin fetch, EventSource, or cookie download links. Native feed refresh can use native polling with reconnect/focus refresh rather than SSE initially. Configure a narrow destination scope for the paired HTTPS server; do not add wildcard CORS, token query parameters, or arbitrary remote browsing privileges. The browser fallback remains same-origin with session cookies.

JSON errors: `{ "error": { "code": "...", "message": "..." } }`. Dates RFC3339 UTC, sizes bytes as JSON integer within safe JS range (20 GB), random server IDs. Never use names as filesystem paths.

## Items

`Item`: `{id, kind:"text"|"file", name, size, createdAt, updatedAt, status:"uploading"|"ready"|"failed", preview?:string, pinned:boolean, sourceDevice?:string, mimeType?:string}`. Text body is not in feed; preview maximum 512 Unicode code points. Page limits keep payload bounded.

- `GET /api/items?limit=50&before=<opaque-cursor>&q=<query>` → `{items: Item[], nextCursor: string|null}`. Search metadata and bounded preview initially. Sort `(createdAt DESC, id DESC)` with an opaque cursor encoding that pair and a strict matching comparison. Clients use the returned cursor verbatim. Timestamp-only cursors are insufficient when timestamps tie.
- `GET /api/items/{id}` → `{item:Item}`.
- `POST /api/text` JSON `{text:string, sourceDevice?:string, name?:string}` → `201 {item:Item}`. Configurable text-body limit defaults 32 MiB; preserve full stored text. For larger text files use the upload route with kind text and content type text/plain. Do not parse arbitrary multi-GB JSON.
- `GET /api/items/{id}/text` → raw UTF-8 `text/plain`, ready text items only. Exact stored content.
- `GET /api/items/{id}/download` → attachment bytes, Content-Length, ETag, HEAD and Range support. Both text and files. UTF-8 filename support plus safe ASCII fallback. Browser uses normal download navigation/cookie, not huge Blob buffers; native clients stream to disk with ranges.
- `PATCH /api/items/{id}` JSON `{pinned?:boolean}` → `{item:Item}`.
- `DELETE /api/items/{id}` → `204`. Delete associated blob and any upload state safely. A pinned item may be deleted explicitly.

## Resumable uploads

Use tus 1.0 protocol at `/api/uploads/` with creation and termination enabled, maximum default 20 GiB (configurable). Server implementation uses tusd. Uploader sends `Tus-Resumable: 1.0.0`, `Upload-Length`, and base64 `Upload-Metadata` fields `filename`, `filetype`, `kind` (file or text), and `sourceDevice` as appropriate. Server validates metadata and budgets before reserving a transfer. Text uploads must be valid UTF-8 before becoming ready.

- `POST /api/uploads/` → tus `201`, `Location` upload URL and `Upload-Offset`. Custom `X-Item-ID` header identifies an uploading feed item.
- `HEAD /api/uploads/{uploadId}` → tus confirmed offset and length.
- `PATCH /api/uploads/{uploadId}` with application/offset+octet-stream and correct Upload-Offset → tus `204` with confirmed offset.
- `DELETE /api/uploads/{uploadId}` → tus `204`; remove corresponding incomplete item.
- On complete validate length, stream a checksum without whole-file buffering, and transition to ready. Item only downloadable after completion. Server recovers pending completions after restart. A failed integrity/UTF-8 validation becomes failed with safe error handling.

Client chunks default 8 MiB; retry/resume from HEAD offset and persist upload URL, item ID, source identity, and destination server. Do not assume browser source file survives page restart. Never resume against a changed source silently.

## Feed events and storage

- `GET /api/events` → SSE, event `items` with small JSON `{type:"created"|"updated"|"deleted", id:string}`. Heartbeat comment periodically. On connect/reconnect, refresh feed; no huge content or guaranteed event replay.
- `GET /api/storage` → `{usedBytes:number, freeBytes:number, maxFileBytes:number, maxTextBytes:number, maxStorageBytes:number|null}`. Used includes unfinished upload data; enforce configured budget and minimum free disk.
- `GET /api/health` → `{status:"ok", version:string}` without secrets or filesystem details.

## Client requirements

- Shared feed, prominent Copy/Download, paste composer, drag/drop, multiple file queue, progress, pause/resume/cancel, errors, server connection setup, storage display.
- Text copy fetches the full body only within a conservative client preparation budget (initially 8 MiB), checked against item size and response length while reading. Preparation is cancellable. Larger bodies offer the full .txt download instead of an unbounded in-memory Copy/Expand operation. Bound expanded in-page previews separately (initially 256 KiB). Never silently copy a truncated preview. Preserve user activation (prepare then Copy for unloaded text where needed); report success only after clipboard write. OS clipboard/destination limits may be lower and must produce a recoverable failure.
- Native runtime is a platform adapter, never a second incompatible API. Browser continues to work without Tauri installed. Browser state must not imply background guarantees.
- Native Android queue uses Android14+ UIDT scheduled while sender activity is visible, with native JobService, notification, durable URI/source access and offsets. Older versions need a documented fallback. Queue state lives outside JS/webview lifecycle.
- Desktop native queue survives window close, but explicit Quit pauses transfers. Mac Quick Actions enqueue locally. No guarantee through sleep, logout, shutdown or force-stop.

## Transfer integrity and lifecycle

Persist strong source identity for resume (full or sufficiently strong sampled digest plus metadata/access identity); filename and length alone must not silently authorize a changed source. Do not treat URI permission as immutable content. For native downloads persist destination, length, ETag and written offset. Append only after validating 206 and exact Content-Range; a 200 response on resume safely restarts, and changed ETag invalidates the partial download. Publish destination only after exact expected length and available integrity verification.

Use the configured public HTTPS origin or a same-origin relative URL for tus Location, never backend loopback HTTP. Atomically account declared remaining reservations against quota/free-space to prevent concurrent oversubscription. Reconcile after crash/deletion/termination and clean abandoned uploads after a documented configurable interval. Creation and completion paths must handle zero-byte files and lost responses. Final tus offset means transferred bytes; the application ready state additionally requires successful validation.
