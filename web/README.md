# Household browser client

Light, neutral iOS-inspired React + TypeScript + Vite client with system typography, restrained blue, 44 px primary controls, secondary item action menus, and reduced-motion support. The mobile composer stays within thumb reach above the bottom navigation.

Client for `docs/api-contract.md`. All items come from
the connected API; the product interface has no demo feed or synthetic storage
values. The Playwright tests use an explicitly isolated API fixture.

## Build and run

Requires an existing Node.js 20.19+ / 22.12+ installation and pnpm 11. No OS packages or
language toolchains are installed by this project.

```sh
cd web
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:browser
```

`pnpm dev` binds only `127.0.0.1:5173` and proxies `/api` to
`http://127.0.0.1:8787`, the server's default port. Configure the backend's exact
`HOUSEHOLD_PUBLIC_URL=http://127.0.0.1:5173` and `HOUSEHOLD_DEV=1` when using this
proxy so browser mutation origin checks pass. This does not launch the server.
`HOUSEHOLD_API_PROXY` can set a different development backend target; the default
is the loopback address above. The production build never proxies API traffic.
For the final same-origin application, set `HOUSEHOLD_WEB_DIR` to the absolute
`web/dist` directory and open the backend's own address. Root-owned deployment
documentation describes private Tailscale HTTPS hosting.

The browser build deliberately uses its own origin. Open the private server's
HTTPS address to connect; it does not send household tokens to an arbitrary
cross-origin server. Connection setup exchanges the configured token for the
server's HttpOnly cookie. Tokens never enter URL query strings, localStorage,
queue records, or the service-worker cache. Native adapters can configure a
remote HTTPS origin and supply a bearer-authenticated HTTP bridge.

`pnpm test:browser` needs a Playwright-compatible Chromium already available.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing executable when needed.
It does not install a browser or system dependencies. Tests start an isolated
loopback Vite server on port 18173 (`HOUSEHOLD_TEST_PORT` overrides it), plus a
small authenticated attachment fixture on port 18174
(`HOUSEHOLD_DOWNLOAD_TEST_PORT` overrides it). They fail if either port is
occupied and never reuse an unrelated server. Most API responses are intercepted
contract fixtures. Download navigations bypass Chromium route mocks, so the
attachment travels through real HTTP and the same-origin Vite proxy instead.
They exercise the real Chromium DOM, clipboard, downloads, responsive layout,
keyboard dialog focus, and real tus-js-client requests. They do not validate the
Go server or any physical device.

## Browser behavior and limits

- Shared newest-first feed, cursor pagination, debounced metadata/preview search,
  text/file filters, pins, explicit shared deletion, SSE reconnect refresh,
  storage usage, disk free space, and the server's configured file-size limit.
  Filters and pin counts cover loaded items. Load older items to include them.
- Plain text is inert. Paste preserves spaces, tabs, Unicode, CRLF and trailing
  newlines. A small edit layer preserves existing line endings when a textarea
  exposes a normalized value. Ctrl/Cmd+Enter sends the exact composer state.
- Full text comes from `/text`, separately from the bounded feed preview. Text
  up to 64 KiB prepares automatically. Larger bodies use Prepare copy, followed
  by a fresh Copy text gesture. Success follows the fulfilled clipboard write.
  Preparation is cancellable. Expanded previews render at most 256 KiB. Loading is capped at 8 MiB for browser memory; larger stored UTF-8 text is
  still downloadable as `.txt`. OS clipboards can reject smaller bodies too.
- File downloads navigate to the authenticated attachment URL. They never
  fetch an entire file into a JavaScript Blob. Browser/download-manager support
  determines range-based download resume.
- Files use tus with 8 MiB chunks, cookie credentials, two concurrent queue
  slots, retry delays, and explicit queued/checking/uploading/paused/failed/
  needs-file/complete states. Upload completion means bytes sent; the feed's
  server-validated `ready` status controls download availability.
- A streaming SHA-256 reads each source in bounded slices before sending it.
  This adds one source read and can take time for a 20 GB file. The saved hash,
  original name, size and modified time prevent a changed reselected source
  from silently resuming against an existing upload. Local queue records also
  include destination server, upload URL, item ID, and confirmed offset. Resume
  URLs are restricted to that server's `/api/uploads/{id}` route. tus HEAD is
  authoritative after an interrupted request.
- Browser queue metadata survives reload when localStorage is available. File
  objects do not; reselect the original source to recover. Keep the page open
  while uploading. Browser/PWA transfers have no promise of running after
  closing the tab, locking the phone, or sleeping. Native transfer lifetimes
  are the native adapter's responsibility.
- The service worker caches only the public app shell/static assets. It never
  caches private API responses, full text, or transfer bytes. Offline sending
  and background browser transfers are not advertised. The manifest and PNG
  icons support installation where the browser allows private HTTPS PWAs.

## Native platform adapter

`src/native-platform.ts` automatically detects the desktop Tauri invoke bridge and Android `__HOUSEHOLD_NATIVE__` bridge, maps native queue snapshots, calls native pickers/clipboard/download/API commands, and polls metadata every five seconds. No Tauri npm package is needed by the browser build. Native shells provide `native_get_config` with redacted origin/device and a `connected` flag; no token is returned to JS. A saved server with `connected: false` opens pairing again. Validation remains pausable, retry waits expose Resume, completed downloads can be cleared, and missing sources use native Resume/reselection instead of a browser file picker.

`src/platform.ts` exports `PlatformAdapter`; `src/transfers.ts` exports
`TransferStore` and `Transfer`. Before `src/main.tsx` executes, an installed
shell can set `window.householdPlatform`:

```ts
interface PlatformAdapter {
  kind: 'browser' | 'native'
  requiresConnection?: boolean
  disconnect?(): Promise<void>
  copyText(text: string): Promise<void>
  download(request: { url: string; name: string; itemId: string }): Promise<void>
  transfers: TransferStore
  chooseFiles?(kind: 'file' | 'text', sourceDevice: string): Promise<void>
  request?: typeof fetch
  baseURL?: string
  configureConnection?(origin: string, token: string, sourceDevice?: string): Promise<void>
  openEvents?(refresh: () => void, status: (connected: boolean) => void): () => void
}
```

`TransferStore` must provide stable snapshots until changed, a subscription
unsubscribe function, enqueue, pause, resume, cancel, reattach and clearCompleted. Optional reselect delegates missing-source recovery to a native picker.
Native pickers enqueue durable native file paths/URIs directly into their native
queue and publish snapshots, rather than reading a whole native file into JS.
`download` must stream to a native destination; resolve only after the native
operation is accepted/succeeds according to its implementation. `copyText`
resolves only after the native clipboard write succeeds. `request` supplies the
same API contract through a native streaming HTTP bridge and bearer credentials;
`configureConnection` handles secure native credential storage. `openEvents`
may implement native SSE and must call refresh on initial connect/reconnect.
The browser adapter is the default and does not require Tauri dependencies.
Unexpected native bootstrap failures show a recoverable startup screen; they
never fall back to browser API or transfer behavior.

## Validation scope

See the canonical implementation handoff for the final executed check counts.
Executed frontend validation: **38 unit/component tests in 8 files**, all passing, and the TypeScript/Vite production build. Native adapter tests load `../clients/shared/native-contract-fixture.json` at test runtime, including pairing/disconnect, queue controls/reselection, exact text, headers, and empty HTTP responses. Run tests from `web/` in the complete checkout; production web-only builds do not need the fixture. Native bridge tests use JavaScript command doubles; no native binary has run in frontend validation.

Latest Chromium fixture run: **4 tests passed** with the existing Chromium 1243 executable via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (8.6 seconds). It exercised exact Unicode/whitespace clipboard copy and paste, pin/search/delete, authenticated HTTP attachment download with exact bytes, 9 MiB tus upload as 8 MiB + 1 MiB chunks with matching SHA256, phone width and 44 px primary/menu targets, dialog keyboard focus, and automatic installed-bridge detection with zero browser API fetches. Desktop/phone screenshots are `test-results/household-desktop.png` and `test-results/household-mobile.png` (contract fixture content). An earlier download test timed out because Chromium bypasses Playwright download route mocks; the final harness serves its bounded attachment from a dedicated loopback HTTP fixture. No application download workaround was needed. No browser or system package was installed.

Storage CSP follow-up: the storage indicator uses a native `<meter>` with stylesheet-only appearance. After this change, all **38 unit/component tests** and the TypeScript/Vite production build passed again. A separate Chromium 1243 probe against the built interface and real Go server verified a visible 4 px meter at 131,072 / 1,048,576 bytes, no inline style attribute, the unchanged `style-src 'self'` response policy, and zero CSP violations. The probe used disposable loopback server data and removed it afterward; it did not deploy a service.

Final regressions also cover cancellation on manual text-preparation unmount/item replacement, late-response suppression, active tus termination 404/410 cleanup, retained 409/500 cancellation failures, and a native bootstrap failure screen without browser transport fallback. Native validation/retry/completion/reselection controls are tested through the shared fixture at the rendered interface boundary.

No 20 GB/GiB transfer, Tailscale deployment, actual PWA installation, native
background transfer, Mac/Android clipboard, or physical-device validation has
been claimed. Frontend browser tests use contract fixtures; root integration checks cover the actual server separately. This frontend handoff does not claim native/device execution.
