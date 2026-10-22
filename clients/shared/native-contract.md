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
