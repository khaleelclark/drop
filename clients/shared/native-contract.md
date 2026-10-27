# Installed client bridge v1

The shared React application lives in `web/`; desktop and Android bundle that local build. The native queue owns all file bytes, source/destination access, HTTP transfers and durable progress. This is an adapter to `docs/api-contract.md`, not a different server API.

## Bootstrap and transport

Before React renders, `web/src/main.tsx` detects `window.__TAURI__.core.invoke` on desktop or `window.__HOUSEHOLD_NATIVE__.invoke` on Android and installs a native PlatformAdapter. Android's bootstrap exports only the native call mechanism/config; it must not inject a second, stale PlatformAdapter that bypasses the shared adapter. An already installed `window.householdPlatform` must meet this entire contract. A detected installed runtime must never silently use browser transfer/fetch/EventSource/cookie-download behavior when native setup fails.

`invoke(command, args = {})` returns a Promise. Arguments below are flat camelCase. Native operation failures reject; HTTP application failures from `native_api` return their real HTTP status/body, allowing the shared API error handler to interpret them. Native credentials are stored privately and never returned to JavaScript. The bridge attaches a bearer token only for the paired origin and rejects redirects/cross-origin upload locations. HTTPS is required; explicit HTTP loopback is development-only. Android requires `allowInsecureLoopback: true` in configuration for that exception.

All feed/text/storage/mutations go through `native_api`; feed refresh uses bounded native polling plus focus/reconnect refresh. Uploads/downloads go through the durable native queue, never a JS File/Blob buffer or a browser download anchor. The browser fallback uses its separate same-origin cookie path.

## Commands

| Command | Arguments | Result |
| --- | --- | --- |
| `native_get_config` | `{}` | `{baseUrl:string, sourceDevice:string, connected:boolean}`; no token. Empty baseUrl or connected=false requires pairing. |
| `native_configure` | `{baseUrl:string, token:string, sourceDevice:string, allowInsecureLoopback?:boolean}` | Acknowledgement; adapter ignores result. Desktop returns null; Android returns redacted configuration. |
| `native_disconnect` | `{}` | null; pauses native work and erases saved token. Existing transfer destinations stay bound to their original server. |
| `native_api` | `{method:"GET"|"POST"|"PATCH"|"DELETE", path:string, body?:string|object, requestId?:string}` | `{status:number, body:string, headers:Record<string,string>}`. A string body is already serialized JSON; object bodies are serialized exactly once. Path must remain `/api/` on the paired origin. |
| `native_cancel_api` | `{requestId:string}` | null; cancels preparation I/O. UI rejects promptly with AbortError; native cancellation may wait until the next bounded read/timeout. |
| `native_list_transfers` | `{}` | TransferView[] below. Poll while queue UI is subscribed, typically every second. |
| `native_pick_uploads` | `{kind?:"file"|"text"|"folder", sourceDevice?:string, targetDeviceIds?:string[]}` | Opens native source picker, durably enqueues selected sources, resolves after intake. Adapter ignores the acknowledgement (desktop null, Android queued views). |
| `native_enqueue_upload` | `{path:string, kind?:"file"|"text", targetDeviceIds?:string[]}` | Direct native intake; acknowledgement ignored. Desktop path is a native file path; Android accepts a granted content URI. Shared JS uses the picker, not arbitrary browser File objects. |
| `native_download` | `{itemId:string, name:string}` | Opens native save picker, queues range download, returns transfer ID or null for picker cancellation. Suggested name is never trusted as a filesystem path. |
| `native_control` | `{id:string, action:"pause"|"resume"|"cancel"}` | Acknowledgement ignored (desktop null, Android view). Resume may require source/destination reselection on Android. |
| `native_copy_text` | `{text:string}` | Acknowledgement ignored (desktop null, Android `{ok:true}`), only after OS clipboard write succeeds. Failure rejects. |

Android additionally permits HEAD in its bounded API bridge. Cross-platform UI does not need it: file HEAD/range/tus operations belong to the native engine. Commands may return a richer acknowledgement without changing shared behavior; only config/API/queue/download results are consumed.

`native_api` excludes `/api/uploads`, `/api/events`, and item `/download` bodies. Text preparation responses are bounded to **8 MiB**, ordinary metadata to **2 MiB**, and submitted JSON request bytes to **40 MiB** (the server has its own decoded text limit). Copy/expansion also check item size before requesting. Expanded DOM content is bounded separately to **256 KiB**. Above the preparation budget, offer a full native `.txt` download. Never copy a truncated preview. Response headers include the original Content-Type/Content-Length and ETag when present, and must be passed to the Response wrapper. HTTP 204/205/304 use a null Response body. Tokens never enter URLs or browser storage.

For cancellable preparation, the shared wrapper assigns a requestId, forwards it to native_api, listens to AbortSignal, calls native_cancel_api, rejects AbortError immediately, and removes the signal listener when done. Native command failure is a visible recoverable error, never an excuse to fall back to a browser transfer.

## Queue views and status mapping

```ts
type TransferView = {
  id: string; direction: 'upload'|'download'; name: string;
  size: number; offset: number; status: string;
  error?: string|null; itemId?: string|null;
  preparationBytes?: number; preparationTotal?: number; preparationEntries?: number;
};
```

Offsets and sizes use native 64-bit integers and remain within JavaScript's exact integer range at 20 GiB. Unknown Android source size may be -1 before explicit staging/picker metadata resolves; render that as unknown, not negative progress. Queue views omit tokens, source URIs/paths, resumable upload URLs and other private fields.

| Native state | Shared TransferStore state |
| --- | --- |
| queued | queued |
| checking, hashing, staging, validating | checking |
| running, exporting | uploading |
| paused, retry_wait | paused |
| needs_source | needs-file, with native Resume/reselection |
| error | failed |
| cancelling | cancelling |
| complete, completed | complete |
| cancelled | hide finished cancelled row |

Native Cancel terminates incomplete content. If final upload completion raced with Cancel or its final acknowledgement was lost, tus termination can return 409: native code reconciles the application item. Already-ready content settles to complete and remains in the household until the user explicitly uses Delete. Cancel never silently deletes ready shared content. Failed validation remains an error; a full tus offset alone is not success. Pending validation retains staged content and polls/retries until ready/failed. Source capture keeps its intended server; switching the configured server cannot migrate an acknowledged private capture.

## Verification

- `clients/desktop/native`: Rust unit/protocol tests cover destination capture, app validation, lost final acknowledgement/cancellation, source identity, ranges/checksums, persistence, text budgets and secret erasure. The native engine also has real-server restart/20 GiB evidence; see its VALIDATION.md for the exact boundary.
- `web/src/native-platform.test.ts`: meaningful mock-bridge tests cover full exact text through native API, origin/path rejection, cancellation routing, native picker/download without file bytes, clipboard failure, configuration and HTTP response behavior. The interface owner runs its actual frontend suite/typecheck/build.
- `clients/android`: Kotlin/adapter tests and build/lint/signature checks are recorded in its VALIDATION.md. Device UIDT/notifications/source-grant and screen-lock checks remain separate.
- `native-contract-fixture.json`: representative redacted config/API/queue values and status mappings for cross-platform adapter tests. This fixture contains no secrets or file bytes.

## Device/arrival extension

Use the registered-device, send-routing, For you and arrival endpoints in
`docs/api-contract.md` exactly; root owns that wire contract. This is additive.
Existing app identifiers, signing identities, `ProjectDirs`/Android DB paths,
browser origin/storage keys, CLI/binary names and queued transfers survive the
visible rename to **Drop** (previously Zing). No secret is returned to JavaScript.

`native_get_config` additionally returns `deviceId` (32 lowercase hex characters)
and `platform: "macos"|"linux"|"android"` for the current server origin. Generate
and persist the identity outside the WebView before registration; reuse it on
upgrades/rename and share it with native capture. UI registers that identity
using native_api; background workers also idempotently ensure registration when
needed. Startup/reconnect and worker requests set preserveExisting=true, creating
the entry only if absent and preserving its current label/platform atomically.
Only explicit user naming uses the default upsert; a saved transfer/capture label
must never rename a registry entry. Configure keeps its existing argument shape; refresh redacted config
after changing server so the UI cannot retain the previous server's identity.
No identity header or new PUT operation is needed.

`native_pick_uploads` and `native_enqueue_upload` additionally accept optional
`targetDeviceIds:string[]`. Resolve the source ID from native state, and capture
source ID, exact targets and destination before picker/handoff/enqueue. Persist
them with queue/spool rows and emit the defined tus metadata on retries. Omitted
targets means Everyone. Legacy queue entries retain their previous behavior.
Direct CLI/Finder capture defaults to Everyone using the same native identity;
do not silently adopt a later GUI recipient selection.

New commands (flat camelCase arguments):

| Command | Arguments / result |
| --- | --- |
| `native_get_arrival_settings` | `{}` -> `{enabled:boolean,permission:"granted"|"denied"|"prompt"|"unknown"|"unavailable",mode:"resident"|"scheduled",lastCheckedAt?:string,lastError?:string}` |
| `native_set_arrival_enabled` | `{enabled:boolean}` -> same settings; requests permission only from explicit visible Enable, and disables/cancels only arrival work when false |
| `native_take_arrival_target` | `{}` -> `{baseUrl:string,itemId:string}|null`; consume a persisted internal notification-click target after UI bootstrap |

Notifications start disabled until explicit Enable; do not reprompt on startup
or turn permission denial into an unusable feed. One native processor owns OS
posting and ACK; shared JavaScript must not also post native notifications.
Desktop permission APIs may report Granted without an observable OS permission
check: report unknown rather than promising presentation where appropriate.
The arrival worker is independent of the serial transfer worker, single-flight,
bounded, backed off on error and stopped/erased appropriately on disconnect.
Retain separate cursor/settings state by server origin and device ID. Android's
foreground and JobScheduler paths share serialization, cancellation and dedupe;
never reuse transfer job IDs or keep a permanent transfer service alive.

Register notification actions before posting. Persist an internal origin/item
target before opening/focusing the window/Activity. Validate exact current paired
origin and item ID; reject mismatched/stale pairing targets. Consume through the
command only after bootstrap, keeping it through cold startup; UI refetches the
item, selects For you, makes it visible above navigation, and offers recoverable
offline/deleted-item handling. No remote URL, token, filename or text is carried
in the click target, and no automatic clipboard/file operation occurs.

Arrival notifications use stable internal IDs and bounded metadata from the
existing authenticated GET /api/items/{id}, never full text or download bytes.
Only the latest item in the existing at-most-50 batch is fetched. A single share
shows “{sender} shared text” plus its preview, or “{sender} shared file” plus
filename and IEC size. Summaries show the exact page count and latest details;
they do not claim that count covers later catch-up pages. Missing sender uses
Someone; empty preview uses Text share. Missing, malformed, trashed, incomplete
or unavailable metadata uses Drop / New share available (or the exact batch
count). Existing bounded paired-origin transports/timeouts apply; cancellation
or changed pairing after lookup prevents posting. A detail failure does not
prevent generic delivery. Details are not saved to the cursor store, click
target, settings errors or logs.

Strings collapse controls/whitespace and invisible formatting characters to
spaces, trim edges and truncate by Unicode scalar values: sender 48, filename
96 and preview 160, with a trailing ellipsis on truncation. Android also removes
unpaired UTF-16 surrogates. Linux body markup is escaped; macOS uses checked
NUL-free CString values across the matching UTF-8 FFI. Notification content is
inert and cannot supply an action or remote URL. Shared examples are in
arrival-banner-fixture.json. Desktop
posting must return actual backend acceptance/failure before cursor/ACK; an
asynchronously queued send is insufficient. Replacement IDs are used where the
backend supports them; macOS replacement is not guaranteed and replay can repeat
a banner. Acceptance never proves visible OS presentation. Android uses
a distinct normal-importance arrivals channel, immutable explicit PendingIntent,
AutoCancel, private visibility and a generic public fallback. Existing transfer
notifications may retain useful unlocked progress, with a generic lock-screen
public representation. Respect runtime permission/channel denial in both Tauri
and standalone wrappers. Browser fallback owns its own elected notifier and
service-worker click handler, only while a page runs; it shares neither native
cursor ownership nor a fictional closed-browser push service.

Document/test actual platform limits from the API contract. Desktop Close keeps
the resident listener; Quit stops it. Android background checks are periodic
and may be delayed; force-stop cannot deliver until reopen. The current Android
arrival job also requires reopening after reboot. No new developer account,
external push infrastructure, public service or system installation
is required by this extension.

## Shared editing compatibility

Use the additive PATCH/version/download rules in docs/api-contract.md. The UI
editor reuses bounded native_api (8 MiB text preparation, 40 MiB encoded JSON)
and preserves the opening expectedUpdatedAt through failures/conflicts. No new
bridge command, arbitrary file-body editor or enlarged clipboard budget is
needed. Text .txt/.md exports use the existing native_download suggested name
and original itemId bytes. Explicit Copy on recognized textual file entries may
prepare the ready /text endpoint, with fatal UTF-8 validation and existing limits.

Completed uploaded text can later change size legitimately. After confirming
original tus length/offset completion (or already-ready termination recovery),
reconcile the saved item ID/kind/ready status without requiring its current edited
size to equal the original queued source size. Keep source/offset/length checks
while incomplete. This must reach desktop reconcile_upload and Android
UploadCompletion, including lost-final-ack/cancel reconciliation. Server schema3
retains the original upload_length for completed tus HEAD/GetInfo/final PATCH.


## Folder and arbitrary-file intake (0.2.4 source)

`native_pick_uploads({kind:"folder", sourceDevice?, targetDeviceIds?})` selects one
folder using the desktop directory picker or Android document-tree picker. Android
retains the tree's document permission. `native_enqueue_upload({path,kind:"file",
targetDeviceIds?})` also detects desktop directory paths / Android document-tree
URIs and queues the same preparation. `kind:"text"` with a directory rejects.
Direct desktop path drops and Finder's existing `enqueue <paths...>` helper share
this intake; no file bytes or archive bytes cross JavaScript. Ordinary file
pickers accept all types with no extension filter or automatic text conversion.

Capture server origin, source identity/name and targets **before** opening the
picker and persist them with the preparation row. Queued preparation is durable,
uses `checking` (desktop) / `staging` (Android). Desktop reports preparation bytes
through `offset`/`size` once the total is known; preflight can be 0/0. Android
keeps upload `offset`/`size` separate (initially 0/-1), and exposes optional
`preparationBytes`, `preparationTotal` (-1 when unknown), and `preparationEntries`
fields plus a bounded progress message in `error`. The shared adapter may ignore
these extra fields and show indeterminate checking; they are not upload progress.
Native pause/resume/cancel controls apply; preparation restarts
from the original folder after interruption, never appends to a partial ZIP.
Once fully finished, the managed archive becomes the stable ordinary `kind:file`,
`application/zip`, `<folder-name>.zip` upload source. Upload progress restarts at
zero against the final ZIP length; resumable tus state belongs to that archive.
Failed preparation removes partial files and keeps an actionable queue error.
Cancel removes local managed output; completed upload cleanup waits for confirmed
ready content. The shared feed/API gains no folder kind or extraction behavior.
Failed local cleanup remains a visible `error` row with Resume available; native
state retains the confirmed completion/cancellation outcome across restart.
Resume then retries local deletion without another upload or remote termination.
Missing managed files are already clean; other unlink failures must be reported.

Nested/empty directories, Unicode and zero-byte files are preserved inside a
single top-level folder entry. ZIP64 uses maintained Rust `zip` 9.1.0 with default
features disabled / Android's platform ZIP streams; native input/output is bounded
and the finished ZIP must fit the existing 20 GiB client limit. Desktop uses Stored
entries (no compression), 64 KiB buffers, 10,000 entries, 1 MiB aggregate entry-name
bytes, 4,096 bytes per relative path, depth 64 and a 64 MiB local disk reserve.
Unsafe names, duplicates, changed files/membership and exhausted budgets fail
with a named entry/error; they are not silently omitted. Desktop rejects
symlinks/special entries. Android rejects advertised virtual/partial/symlink or
special types and non-regular descriptors; SAF has no portable lstat/symlink
attribute, so provider-hidden symlinks and hostile unchanged-metadata content
changes cannot be independently detected. Providers lacking known file lengths,
change metadata or regular descriptors fail explicitly.
Desktop metadata/resource forks, ownership, original permissions and symlinks are
not archived; an app/package directory containing unsupported entries fails.
Android provider and preparation limits are documented in its README. Actual
pickers, permissions and OS lifecycle remain separate device acceptance checks.
Android limits are 100,000 entries, depth 128, 255 UTF-8 bytes per component,
4,096 bytes per relative path, 16 MiB estimated inventory, 64 KiB buffers and
a 64 MiB disk reserve; source and final ZIP each must fit 20 GiB. Expired folder
permission requires Cancel and selecting the folder again. Existing resumable
upload bytes must never be replaced by an archive of a newly selected tree.

## Mac login and menu-bar quick sharing (next source)

Desktop `native_get_config` adds `canOpenAtLogin:boolean` and
`canQuickShare:boolean`, true only on macOS. Missing/false capabilities hide the
corresponding UI; browser, Linux and Android must not invoke these commands.
The shared Settings row uses optional `getOpenAtLogin`/`setOpenAtLogin` adapter
methods. The bundled `index.html?quick-share=1` renders the separate panel only
with a native quick-share capability; otherwise normal application bootstrap
continues. No remote page gains native IPC and no credential enters JavaScript.

| Command | Arguments | Result |
| --- | --- | --- |
| `native_get_open_at_login` | `{}` | `{enabled:boolean}` from the real saved app-owned entry |
| `native_set_open_at_login` | `{enabled:boolean}` | Same envelope, after persistence and readback; failure rejects |
| `native_quick_context` | `{}` | `{baseUrl,sourceDeviceId,sourceDevice,devices:[{id,label,platform}]}`; normalized paired origin and bounded validated registry (at most 64) |
| `native_quick_paste` | `{}` | Exact nonempty plain-text string, at most 8 MiB UTF-8; unsupported/empty/oversized clipboard rejects without truncation |
| `native_quick_send_text` | `{baseUrl,sourceDeviceId,targetDeviceIds:string[],text:string}` | `{itemId:string}` only after a confirmed HTTP 201 ready-text receipt |
| `native_quick_pick` | `{baseUrl,sourceDeviceId,targetDeviceIds:string[],kind:"file"|"folder"}` | `{queued:number,cancelled:boolean}`; cancellation is `{queued:0,cancelled:true}` |
| `native_quick_drop` | `{baseUrl,sourceDeviceId,targetDeviceIds:string[],paths:string[]}` | `{queued:number,cancelled:false}` after local queue intake; 1–100 valid absolute paths, duplicates ignored within that call |
| `native_quick_resize` | `{detail:boolean}` | null; request compact list/detail geometry clamped to the icon's display work area |
| `native_quick_hide` | `{}` | null; hide the retained panel without unmounting its draft or stopping work |
| `native_quick_open` | `{}` | null; hide the panel and show the existing main window with Settings/pairing reachable |
| `native_quick_quit` | `{}` | null; shut down the resident queue and exit |

Login defaults off. Explicit enable requires the installed executable under
`/Applications/*.app/Contents/MacOS/household-share` or the user's
`~/Applications` equivalent. Native writes only the canonical, user-owned
`~/Library/LaunchAgents/net.household.share.login.plist` with `--background` and
RunAtLoad. It uses a private temporary file, sync, atomic replacement and readback;
unsafe, linked, foreign or oversized existing entries fail unchanged. Reading
does not create directories. Disable removes only that owned entry and leaves
the current process running. No launchctl, KeepAlive, account or startup-setting
mutation occurs during build/tests. Installed login launch remains a macOS
acceptance check.

The retained Mac webview is labelled `quick-share`. Left-click toggles it;
Escape/hide/outside blur dismiss it, with a native picker-focus guard. Right-click
retains Open Drop and Pause transfers and Quit Drop. The panel uses the one
existing `Arc<Queue>`/resident worker, ordinary streaming file intake and folder
preparation. Queue acceptance is not upload completion. Partial or ambiguous
intake errors name the confirmed earlier count and direct the user to Transfers
before adding anything again. Dismissal cannot cancel or duplicate accepted work.

Refresh context on focus, exclude the sender, and search the registry locally.
Everyone is an empty target array. Preserve an explicit stale target and draft;
never reinterpret it as Everyone. Native validates current paired origin,
sender identity and registered targets before text send/drop/picker, and saves
the immutable route before opening a picker or enqueuing. Reconfiguration while
a picker is open cannot retarget its captured sources. Forgotten recipients fail
validation or remain explicit in queued routing, never broadcast.

Clipboard reads occur only after explicit Paste, populating a reviewable draft;
they do not send or overwrite a retained draft. Text is preserved verbatim,
including whitespace, BOM and line endings, within the existing 8 MiB budget.
Send performs one non-idempotent POST with no automatic retry. Any unconfirmed
response rejects with possible-already-shared guidance; keep the draft until a
confirmed receipt, with errors/preparation visible and an explicit retry path.
See `native-contract-fixture.json` for additive redacted login/quick examples.
