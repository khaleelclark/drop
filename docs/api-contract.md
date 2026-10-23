# Household Share API v1

Visible product name: **Zing**. Existing API paths, environment variables,
application identifiers and persisted data locations remain compatible.

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

## Registered devices, For you and arrivals (additive v1 extension)

This section is the implementation contract for the Zing device release.
**All shares** retains the complete shared household feed. **For you** filters
ready items addressed to the current registered client. Recipient selection is
attention/routing metadata, never an item-access permission or private inbox.
Every authenticated household member can still fetch every item. Device IDs
are not credentials: anyone holding the household credential can manage or
claim a registry ID. No online/delivered/read indicator is implied.

### Registry

`Device = {id,label,platform,createdAt}`. IDs are cryptographically random,
32-character lowercase hexadecimal strings, generated and persisted by the
client before registration. Platform is `macos|linux|android|browser`. Labels
are nonempty, at most 128 UTF-8 bytes, and use the existing inert-label/control
character validation. Duplicate labels are allowed; identity is the ID.

- `POST /api/devices/register` JSON `{id,label,platform,preserveExisting?:boolean}` -> `200 {device:Device}`.
  Idempotently upsert by ID; preserve original createdAt and acknowledgement.
  With preserveExisting=true, atomically create only if absent and return an
  existing entry without changing its label/platform. Background registration
  and startup/reconnect use this mode so an older queued/configured name cannot
  undo an explicit rename. Explicit user naming uses the default upsert mode.
  Maximum body 16 KiB and registry 64 clients; a new entry at capacity returns
  `409 device_limit`. Existing entries may still update at capacity.
- `GET /api/devices` -> `{devices:Device[]}`; no token, address or online flag.
- `DELETE /api/devices/{id}` -> idempotent `204`, removing its registry and
  arrivals. Forgetting a client is not credential revocation; a configured
  installation can register again. A malformed ID is a validation error.

Native identity is durable outside the WebView, scoped to the normalized paired
server origin and shared by the GUI, native worker and capture helper. Browser
profiles persist a separate identity per server origin; tabs share that identity.
Android Tauri and standalone sandboxes remain separate installations. Renaming,
normal app upgrades and notification toggles must not replace an existing ID.

### Immutable send routing

`POST /api/text` additionally accepts `sourceDeviceId?:string` and
`targetDeviceIds?:string[]`. Tus metadata additionally accepts `sourceDeviceId`
(base64 ASCII ID) and `targetDeviceIds` (base64 UTF-8 JSON array). The same optional
fields are returned on `Item` and in tus GetInfo metadata. Omitted or empty
targets means **Everyone**: clients registered when the item becomes ready,
excluding the sender. Explicit targets mean exactly those destinations.

Validate no more than 64 unique, registered target IDs and a registered source
ID before reserving storage. Explicit targeting requires sourceDeviceId. Reject
malformed, duplicate, unknown or explicit self-target IDs with 400; never turn
a rejected/self-only target list into Everyone. When sourceDeviceId is supplied,
snapshot its registered label into sourceDevice rather than accepting a
conflicting caller label. Legacy sends without an ID retain sourceDevice and
Everyone behavior; reliable self-exclusion is unavailable for those sends.

Persist source ID, exact target selection and server origin before enqueue or
item creation. Resume, picker return, configuration changes and captured-file
handoff must use that saved routing, not current UI selection. Existing pending
queue rows remain compatible as legacy Everyone sends. If an explicitly targeted
device is forgotten before completion, omit its arrival; never redirect the
share to Everyone. Broadcast recipient membership is resolved at ready time.
Old ready items get no backfilled arrival rows when upgrading/registering.
The saved sender label is not a registry update: workers ensure registration
with preserveExisting=true, leaving current registry metadata authoritative.

`GET /api/items` additionally accepts `forDevice=<registered-id>`. It joins that
device's durable arrival rows to ready items and returns the same `{items,
nextCursor}` shape, search behavior and opaque `(createdAt,id)` pagination.
It is independent of notification acknowledgement. Unknown registered IDs return
404; invalid IDs return 400. Omitting forDevice retains the existing All shares
behavior, including upload/failed states. The new filter is not an ACL.

### Durable arrivals

- `GET /api/devices/{id}/notifications?after=<sequence>&limit=50` ->
  `{notifications:[{sequence:"124",itemId:"...",createdAt:"..."}],
  nextCursor:"124",ackCursor:"123",hasMore:false}`.
  Omitted after starts at the device's stored acknowledgement. Explicit after
  permits replay. Limit 1–100; return at most that many and use one extra row to
  determine hasMore. nextCursor is the last returned sequence, or the starting
  cursor when empty. Unknown registered IDs return 404.
- `POST /api/devices/{id}/notifications/ack` JSON `{through:"124"}` ->
  `200 {ackCursor:"124"}`. Atomically retain max(previous,through); retries and
  out-of-order acknowledgements cannot move backward. Limit body to 16 KiB.

Sequences/cursors are canonical nonnegative decimal strings within signed SQLite
64-bit range, not JS numbers. Reject malformed, negative and future cursors.
The issued global sequence high-water survives deletion of all notification
rows (use SQLite's retained AUTOINCREMENT sequence, not MAX of remaining rows).
Clients acknowledge only a returned cursor after processing all preceding rows.
ACK means processed, not displayed/read/downloaded. Retain acknowledged records
for For you history; delete them with the corresponding item or forgotten device.
Arrival queries join ready items so failed, deleting or deleted content cannot
be returned as a fresh ready arrival. No body, file bytes or preview is included.

Schema version 2 adds `devices(id,label,platform,created_at,ack_sequence)`, bounded
source/target columns on items, and `notifications(sequence INTEGER PRIMARY KEY
AUTOINCREMENT,device_id,item_id,created_at,UNIQUE(device_id,item_id))` with a
`(device_id,sequence)` index. Migrate existing data transactionally before
recovery, without notification backfill; reject newer unsupported schemas.
After streamed validation/hash, one transaction inserts intended arrivals and
updates uploading -> ready; emit the existing small updated SSE event only
after commit. Repeated HEAD/complete/startup recovery must not duplicate arrivals.
Transient finalization/commit failures leave an item recoverable as uploading;
invalid content remains failed. In particular, text completion must not mark
all transient DB failures permanently failed. Coordinate deletion/tombstones
and arrivals under the existing item lock/transactions.

### Notification ownership and limits

SSE is a refresh hint, not durable delivery. Each native installation has one
native arrival processor independent of WebView timers and file-transfer work.
Browser tabs elect one notifier for their shared identity. Permission requests
follow explicit Enable interaction; permission denial retains For you access.
Arrival banners contain **Zing — New share available** (or a generic batch),
without sender, filename, text or preview. Opening an alert authenticates and
refetches its item, opens/highlights it in For you and handles offline/deleted
states. It never automatically copies, downloads or navigates to a remote URL.

Dedupe by server origin + device ID + sequence; use stable internal notification
keys and backend replacement IDs where supported, persist processed progress,
then ACK. The desktop adapter must report actual OS/backend send acceptance or
failure before checkpointing, not success merely because a send was queued on
a thread. Backend acceptance does not prove visible presentation. macOS backend
replacement is not guaranteed; retries can still create another banner.
Serialize concurrent Android job/foreground
processing and batch catch-up. OS display and persistence are not atomic, so
delivery is at least once with best-effort dedupe, not exactly-once banners.
Do not retry ambiguous item creation automatically; registration/ACK/completion
idempotence does not make a new POST text/upload creation idempotent.

Desktop polls about every five seconds while its resident app runs; explicit
Quit, sleep and process exit stop reception. Android polls while visible and
uses short network-constrained JobScheduler checks in the background, at the
OS minimum periodic interval (15 minutes), with no arrival deadline and further
Doze/OEM/Tailscale delays. Catch up on Resume; force-stop requires reopening.
The current periodic job is not persisted across reboot; reopen Zing after
reboot as well as force-stop to resume checks. No boot permission is added. No perpetual
UIDT/dataSync listener, Firebase/APNs account, public listener or battery
exemption is introduced. Browser notifications require the page to run; no Web
Push or closed-browser guarantee is part of this release. Settings must explain
these limits without claiming notification permission proves OS presentation.

## Shared entry editing and text downloads

The inbox is a shared board, with explicit Save/Cancel rather than autosave.
All authenticated household members can edit a ready text entry or rename a
ready entry. Existing routing is not an edit ACL. Edits retain item ID, kind,
createdAt, MIME type, source snapshot/IDs, targets, For you membership and ACK.
They do not create arrivals or resend notifications.

`PATCH /api/items/{id}` additionally accepts
`{pinned?:boolean,name?:string,text?:string,expectedUpdatedAt?:string}` and returns
`200 {item:Item}`. Require at least one mutation; reject unknown fields, nulls
and wrong types. Any name/text edit requires the exact updatedAt from when the
editor opened: missing/invalid token is 400; stale token is 409 edit_conflict.
Keep legacy unversioned `{pinned}` supported; enforce a supplied token for
pin-only changes too. Apply mixed fields atomically. Name/text edits require
ready status (409 not_ready); names use existing safeLabel(name,255,true).
Replacement text is allowed only on kind=text (400 invalid_kind otherwise);
empty text is valid. File entry editing changes its display filename, not
binary file bytes. Advance updatedAt strictly beyond its previous value even
for pin changes, so clock ties/backsteps cannot bypass conflict checks.
Publish one existing small updated event after commit.

Validate replacement text with strictString; decoded UTF-8 is bounded by
configured maxTextBytes, and encoded PATCH JSON by 6*maxTextBytes+16 KiB.
Oversize is 413. Recompute exact size/checksum and the bounded 512-code-point
preview/search metadata. The shared editor uses the existing 8 MiB preparation
budget and checks the existing native 40 MiB encoded-request budget before Save;
it does not change Copy's 8 MiB or expanded-DOM 256 KiB limits. Larger entries
remain renameable and fully downloadable, without loading multi-GB bodies into
an editor. Keep the opening version while dirty; on conflict/failure preserve
the draft and offer explicit reload, never silently refresh its token or retry
an ambiguous Save as a new item.

Schema 3 adds internal blob_id and immutable upload_length. Transactionally set
blob_id=id for existing rows, upload_length=size for existing uploads before
recovery; no blob copying, arrival backfill or public Item-field addition.
Reserve/check the full replacement alongside old bytes, pending-upload promises
and retired/unreferenced bytes before writing, including shrink edits. Write a
fresh private O_EXCL blob with bounded buffers, fsync file/directory, then commit
its pointer plus metadata in one transaction under the item lock. Never replace
committed bytes in place. Precommit errors keep the old ready content; postcommit
cleanup errors keep the committed Save successful. An ambiguous commit retains
both files until its pointer can be confirmed/recovered. Startup follows only
committed pointers and cleans unreferenced blobs. Never markFailed or invoke
complete for an editing error. Storage accounting includes temporary/retired
bytes and unfinished promises; no old committed file is deleted for headroom.

Read/open/stat the immutable committed blob with its metadata under the item
lock, then stream from that descriptor after releasing the lock. Downloads use
the same snapshot for length, ETag, name and time; old readers remain consistent
while later edits commit. Delete/tombstone/recovery and the defensive tus reader
must use committed pointers without re-entering tusd's held item lock. Ready tus
GetInfo/HEAD/final-offset PATCH report the original immutable upload_length for
size and offset; they remain completed no-ops after text edits. Native upload
reconciliation must accept the known ready item ID/kind after verifying original
tus completion, without comparing its subsequently edited content size with the
old queued source size. Keep length checks while an upload is incomplete.
Schema upgrades require a consistent stopped DB/blob backup; newer schemas are
rejected. No edit-history/merge feature or file-binary editor is introduced.

`GET /api/items/{id}/download?format=txt|md` selects a safe fixed extension for
the suggested filename, with exact original bytes and normal streaming/ranges.
No query retains the original filename. For kind=text, reject empty, duplicate
or unknown format values with 400 invalid_format; replace the final non-leading
extension or append the chosen suffix, preserve a dotfile stem, and truncate
only the stem at a UTF-8 boundary to keep the safe filename within 255 bytes.
Use a fixed safe fallback for an empty stem. Preserve ASCII/UTF-8 header escaping.
For kind=file, format is rejected with 404 not_text; ordinary download is unchanged.
The UI offers this
for text, including Markdown/code; it does not render, convert or execute it.
Native save dialogs use the same suggested extension with their existing
itemId-based streamed download, without a new bridge command.

The authenticated ready-item `/text` endpoint may also prepare a file as plain
text when metadata identifies a supported text/code candidate. The shared
classification examples and allowlists are clients/shared/text-file-fixture.json.
Explicit kind=text upload creation also accepts those text/Markdown/code
metadata candidates rather than only text/plain; completion still validates
the entire UTF-8 body with bounded streaming before ready. This does not impose
the file-preparation 8 MiB limit on stored/uploaded kind=text content.
Metadata is an eligibility hint, never content validation. Reject explicit
non-UTF-8 charset declarations. This new kind=file path is limited to 8 MiB by
both record and opened length (413 text_too_large); validate the complete
immutable descriptor as UTF-8 with no NUL/binary controls before sending any
body, rewind, then stream the same descriptor. TAB/CR/LF are allowed. Unsupported
or invalid/binary candidates return 415 not_text. Preserve BOM, whitespace and
all original bytes; no encoding conversion. Existing kind=text raw endpoint
semantics remain compatible. The UI exposes Prepare copy for eligible small
files and actual Copy after successful preparation, with its own response/read
ceiling and fatal UTF-8 decoding. Files always retain ordinary Download; larger
or unsupported candidates keep that recovery path. In-place body editing
remains for kind=text; file entries remain renameable.

## Optional Tailscale Serve sign-in

For the user's household deployment, explicit HOUSEHOLD_AUTH_MODE=tailscale
allows URL-only connection through Tailscale Serve. Absent/`token` mode retains
the existing token/cookie/development behavior. Reject unknown modes. Tailscale
mode requires the existing explicit loopback bind and an exact HTTPS public
origin even in development; it never enables a public bind, Funnel or CORS.
Keep an optional configured token as an explicit legacy/advanced fallback.

In Tailscale mode only, a request may authenticate through exactly one bounded,
nonempty Tailscale-User-Login header from a loopback TCP peer. Reject duplicate,
empty/control-containing or oversized identity values and nonloopback peers.
Trust no arbitrary forwarded IP/host/proto header for authentication. This is a
trusted-local-proxy boundary: Tailscale Serve strips incoming identity headers
and supplies the connection's user identity; other local processes remain in
the host trust boundary. Tailscale grants/ACLs and device sharing determine who
can reach the app; do not change them automatically or describe this as a new
private per-device ACL. Tagged clients have no user header and require the
explicit token fallback; missing identity never becomes anonymous access.

Verified proxy requests can use native HTTP without Authorization. Preserve
exact-Origin checks on every mutating browser request, rejecting foreign/null
Origin even with identity/bearer. A no-Origin request may use the trusted proxy
native path only when browser Sec-Fetch-* metadata is absent; browser writes
with missing Origin stay rejected. Existing bearer rules remain unchanged.
Never accept a cookie signed with an empty token; development anonymous mode
remains the old explicit token-mode loopback exception only.

POST /api/session from the exact configured browser Origin can return 204 for
a verified Tailscale request without minting a cookie; identity is checked on
every subsequent request. Otherwise retain the normal token exchange when a
nonempty fallback token is configured. DELETE clears the old cookie but cannot
sign a device out of Tailscale. Settings explain Disconnect is local application
state, not tailnet access revocation. Browser initial authenticated fetch works
without setup through Serve; installed apps save the server origin once and
configure an empty token using the existing bridge (both engines already omit
an empty Authorization value). Show token entry under an optional advanced
control rather than make it a required everyday login step. On a token-only
server, retain a clear token recovery path without silently weakening auth.

This mode follows Tailscale's documented identity headers:
https://tailscale.com/docs/features/tailscale-serve#identity-headers . Test both
modes and preserve actual anonymous/foreign-Origin denial. Real Serve and actual
household-device checks must be recorded separately from mock-header tests.
