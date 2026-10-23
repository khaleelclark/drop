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
| `native_pick_uploads` | `{kind?:"file"|"text", sourceDevice?:string}` | Opens native source picker, durably enqueues selected sources, resolves after intake. Adapter ignores the acknowledgement (desktop null, Android queued views). |
| `native_enqueue_upload` | `{path:string, kind?:"file"|"text"}` | Direct native intake; acknowledgement ignored. Desktop path is a native file path; Android accepts a granted content URI. Shared JS uses the picker, not arbitrary browser File objects. |
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

## Zing device/arrival extension

Use the registered-device, send-routing, For you and arrival endpoints in
`docs/api-contract.md` exactly; root owns that wire contract. This is additive.
Existing app identifiers, signing identities, `ProjectDirs`/Android DB paths,
browser origin/storage keys, CLI/binary names and queued transfers survive the
visible rename to **Zing**. No secret is returned to JavaScript.

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

Arrival notifications use generic content and stable internal IDs. Desktop
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
