# Household browser client

React + TypeScript + Vite client with a shared inbox, warm near-white surfaces, dark system typography, and an indigo action accent. A compact desktop sidebar gives way to four bottom navigation tabs on phones. Each item has one primary Copy or Download action; secondary text downloads, expansion and management live in a keyboard-accessible menu. The compact mobile composer stays in document flow so it cannot cover the feed, menus or last action. New share returns focus to it. Primary controls and menu actions are at least 44 px. The existing ItemMenu component serves both feed actions and the composer; no new runtime dependency was added, following the repository-local Ponytail guidance.

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

## Design and responsive behavior

The redesign follows the supplied *Hands-On UX Design for Developers* by Elvis
Canziba: proximity/common regions (printed pp. 70–81), typography and readable
measure (153–156), alignment/hierarchy/contrast/repetition/balance/space
(160–168), task clarity (217–220), and coherent palette/type/grid/components
(241–249). The source PDF and extracted textbook text are not part of this
client or its deliverables.

Item content has stronger type and contrast than source/time metadata. Shared
spacing, aligned edges, restrained surfaces and repeated action styles group
each item with its action. File name, readiness and Download sit together;
text previews keep whitespace intact and put Copy below the content. Text too
large for safe copy offers Download .txt directly. Setup, empty/filter/search,
server error and transfer recovery states each expose a next action.

The live [Blip website](https://blip.net/) was read as a design reference on
2026-10-22. Its focused send flow, clear transfer identity and visible recovery
informed the final small refinement: transfer filenames and progress use readable
14/12 px type, and every row says “To household” or “To this device”, including
paused and source-reselection states. The approved composer and feed retain
their spacing and single primary actions. This app still uses its private
persistent server feed and configured limits. Completed uploads say “Upload sent”;
the feed's server-controlled readiness determines when Download is enabled.

The viewport uses device-width, initial scale 1, viewport-fit=cover, and
interactive-widget=resizes-content. All mobile text inputs use at least 16 CSS
px. Safe-area padding, bottom-bar clearance and a normal-flow composer let the
document reflow when available height changes. Browser accessibility zoom is unrestricted. Installed
Android WebView page zoom is configured by the native owner; web CSS never
scales the page or disables browser touch zoom. Actual keyboard, safe-area and
physical-phone behavior require device validation.

Packaged Android marks the document with `data-native-android` before app or
startup-error rendering, only when `window.__HOUSEHOLD_NATIVE__?.platform` is
`'android'`. Its native shell already bounds the WebView inside the system bars,
so all four CSS safe-area variables become zero there. Browsers and desktop
clients retain `env(safe-area-inset-*, 0px)` values. Regular spacing, zoom and
editing/Done/Back behavior are unchanged; this adds no keyboard detector.

The 2026-10-23 mobile follow-up moves the existing All shares / Text / Files /
Pinned filters into a single bottom navigation bar at widths up to 800 CSS px.
Icons, labels, selected state, visible keyboard focus and 44 px targets remain
available at 320 px. The page reserves the bar height plus the bottom safe area;
notifications appear above the bar. Desktop navigation and item/transfer actions
use the approved composition.

Root's installed Android API36 evidence showed that the IME could cover the
screen below 577.9 CSS px while both `innerHeight` and `visualViewport.height`
stayed 915 px. This frontend therefore makes no keyboard-visibility inference
from viewport dimensions. Focusing the mobile composer or search moves the same
navigation into document flow below the composer, with an explicit **Done
editing** action. It sticks below the top safe area when scrolling past a tall
transfer queue to search. Selecting a section, Done editing, or Escape returns it to the
bottom and focuses the selected section. Draft/search values are preserved.
The navigation remains rendered if Android Back dismisses the keyboard but
retains field focus; it never hides waiting for a blur event. This uses ordinary
focus/click events without pointer interception, transforms, inline style or a
native bridge change. Actual installed IME behavior still needs root's check.

## Validation scope

Android duplicate-inset fix (2026-10-23): **47 unit/component tests in 8 files
passed** (1.71 s), including Android startup failure and browser/desktop/native
adapter marker boundaries. **Six focused Chromium 1243 checks passed** (15.9 s).
The two new CDP `Emulation.setSafeAreaInsetsOverride` checks inject top/right/
bottom/left insets of 36/28/48/24 px at 412×806. The packaged Android JS fixture
retains a 64 px header and 72 px bar, while the browser retains 100/120 px; both
keep four uncovered targets of at least 44 px. They check side padding, main and
scroll clearance, toast/modal spacing, editing navigation and preserved draft.
Existing narrow, phone/dialog, native-bridge and unchanged-viewport occlusion
checks also passed. Two desktop/pairing fixtures passed (7.0 s), retaining exact
copy/paste, authenticated HTTP download and the seven review screenshots.
`pnpm build` passed TypeScript checking and the Vite production build.
These are browser-engine tests with JS native doubles,
not an installed WebView, OS keyboard or physical-phone check. Root owns the
Android rebuild and installed acceptance; no other platform rebuild is needed
for this Android-only marker behavior.

Mobile-bottom-navigation candidate (2026-10-23): all **42 unit/component tests
in 8 files passed** (1.77 s); five affected Chromium1243 fixtures passed
(13.7 s), followed by four desktop/mobile/overlay/pairing checks (11.9 s) after
adding notification clearance and empty-width assertions. The browser assertions
cover a single bottom navigation with icons/selection/44 px targets at
320/360/390/412 px, eight long shares plus pagination, uncovered final-menu and
recovery controls, preserved failed drafts and reachable Share at each width
with 420 px available height. Enter/Space select sections; Done editing and
Escape restore focus to the selected section. Pairing keeps full Connect
visibility and internal-scroll recovery. A new browser-only occlusion fixture
covers the page below 577.9 px in a 360×915 viewport, verifies neither viewport
height changes and hit-tests Share, all four tabs and Done editing above it.
Removing the stand-in overlay retains textarea focus and leaves navigation
reachable. The QA follow-up passed two focused browser checks (9.7 s), covering
a ten-row transfer queue with focused search, sticky navigation reachability,
maximum 180 px textarea height plus a failed draft, Tab access to the same nav
DOM, preserved search/draft, and composition/menu Escape handling. Enlarged
composer/error content can require scrolling; the fixture verifies that the
actions can be reached, without claiming unconditional IME clearance. This fixture is **not an actual IME/device check**. The desktop test
also retains exact text/paste, pin/search/delete and a direct HTTP download.
TypeScript checking, production build and `git diff --check -- web` passed.
That candidate's assets were `index-CS6EIQOV.js` and `index-DVPjc1UT.css`.
The final QA correction also passed all 42 unit/component tests (1.84 s), then
three phone/native-fixture/pairing browser checks (9.2 s), and the production
build. This is a review candidate; root owns coordinated freeze and installed packages.

Current redesign validation: **42 unit/component tests in 8 files passed**.
**7 Chromium fixture tests passed** (33.2 seconds) using Chromium 1243.
The final compact pairing follow-up passed the two native interface tests and
four affected Chromium fixtures (two runs of two tests: 10.1 s and 6.2 s).
The 360×740 token-error state keeps the entire Connect button in view without
scrolling; 360×420 checks usable internal scroll and a fully reachable action.
The reviewer's disabled-first-menu-action issue is fixed in the shared menu;
the regression checks enabled initial focus, wrap, Home and Escape. Two affected
Chromium menu/responsive fixtures passed again (4.5 seconds). An initial
`pnpm exec playwright` invocation selected a mismatched runner and failed before
collecting tests; the configured local `@playwright/test` CLI passed.
The Blip-reference follow-up passed all 42 unit/component tests again (the pnpm
test invocation ran the complete suite), plus four affected Chromium fixtures
in 19.2 seconds: bounded upload, native bridge/transfer presentation, narrow
recovery layout, and pairing/error states. Their assertions distinguish upload,
server validation and download progress; native data remains a JS bridge fixture.
The native bridge fixture passed once more in 3.0 seconds after dismissing its
copy notification for the transfer screenshot and asserting the paused-download
Resume target is fully visible, at least 44 px and uncovered at 360×740.
The final QA wording follow-up passed the two native interface tests (3.53 s)
and the bounded 9 MiB Chromium upload fixture (8.0 s), including scoped
direction-labelled completion and enabled Download assertions. Native validation
phases and indeterminate progress remain intact; completed uploads no longer
claim that the server is still finalizing indefinitely.
The prior TypeScript/Vite production build passed. Root accepted compact pairing
and the Blip refinement. The mobile navigation change reopens that frontend
freeze; root reviews the new exact source/dist before another packaging freeze. Native adapter tests load
`../clients/shared/native-contract-fixture.json` at test runtime, including
pairing/disconnect, queue controls/reselection, exact text, headers, and empty
HTTP responses. Run tests from `web/` in the complete checkout; production
web-only builds do not need the fixture. Native bridge tests use JavaScript
command doubles; no native binary has run in frontend validation.

The Chromium fixture suite uses the existing Chromium 1243 executable through
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. It verifies exact Unicode/whitespace
clipboard copy and paste, pin/search/delete, authenticated HTTP attachment
download with exact bytes, and a 9 MiB tus upload in 8 MiB + 1 MiB chunks with
matching SHA256. It also checks phone 44 px primary/menu targets, dialog and
item-menu keyboard focus, native bridge detection with zero browser API
requests, persisted-source recovery, no horizontal overflow at 320/360/390/412
CSS px, 16 px mobile inputs, uncovered item actions, filtering, a focused
normal-flow composer, and reflow at a 320×420 viewport. The short viewport
approximates available layout height; it does not simulate an OS keyboard.
Setup rejection, empty inbox, no pins/search results and recoverable server
errors are exercised separately. These tests use isolated contract fixture
content; the product never inserts demo shares.

Screenshots are `test-results/household-desktop.png`,
`household-mobile.png`, `household-pairing.png`, `household-empty.png`, and
`household-narrow-keyboard-layout.png`. The reference follow-up also provides
`household-transfers.png` with upload, validation and paused-download rows.
The mobile follow-up refreshes these images and adds
`household-editing-overlay-layout.png` (360×915, browser-only occlusion stand-in). They
are review evidence using test
content, not screenshots of a household's real private data.

CSP remains stylesheet-only: storage uses a native `<meter>`, transfer bars
use `<progress>`, and dialog scroll locking uses a body class. No inline style
attribute is required. The earlier release's real Go-server probe passed with
`style-src 'self'` and zero policy violations; that prior probe is not claimed
as a new redesign test.

Regressions retain cancellation on manual text-preparation unmount/item
replacement, late-response suppression, active tus termination 404/410
cleanup, retained 409/500 cancellation failures, and a native bootstrap failure
screen without browser transport fallback. Native validation/retry/completion/
reselection controls are tested at the rendered boundary.

No 20 GB/GiB transfer, Tailscale deployment, actual PWA installation, native
background transfer, Mac/Android clipboard, or physical-device validation has
been performed by this frontend owner. Root integration checks cover the
actual server and installed emulator separately. Native packaging and live
host publication belong to their assigned owners.
