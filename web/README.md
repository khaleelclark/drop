# Zing browser client

React + TypeScript + Vite client with a shared inbox, neutral white surfaces, navy typography/actions, and a restrained red wordmark detail. The original Ribbon Z replaces the house in the interface and install icons using root’s `branding/zing-mark.svg` geometry; the user approved the final navy, soft-white and signal-red preview after removing teal. A compact desktop sidebar gives way to three bottom scope tabs (All shares, For you, Pinned) on phones. Each text entry has a visible Copy action, and every file has Download. Text downloads and management live in a keyboard-accessible menu; long text has an inline Expand/Collapse control. Routine actions use light icon/label controls with no filled blocks. The compact mobile composer stays in document flow so it cannot cover the feed, menus or last action. New share returns focus to it. Primary controls and menu actions are at least 44 px. The existing ItemMenu component serves both feed actions and the composer; no new runtime dependency was added, following the repository-local Ponytail guidance.

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
cross-origin server. A successful protected feed fetch through configured Tailscale Serve opens the inbox directly, without a login form. Installed apps use saved configuration supplied by the native bridge before rendering; a preconfigured client opens the feed directly. Network failures and access denials on configured installed clients keep the feed visible with Retry and Settings, without automatically opening setup. Unconfigured installed clients and explicit Disconnect open the inbox shell with a nonblocking Configure connection action; the connection dialog opens only when requested. Native API calls wait until a connection is saved. Browser same-origin authentication recovery is unchanged. The web interface supplies no default server or configuration migration. Optional token entry is behind Advanced; token servers exchange it for the server's HttpOnly cookie. Tokens never enter URL query strings, localStorage,
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
  independent All types/Text/Files content filtering within All shares/For you/Pinned, explicit shared deletion, SSE reconnect refresh,
  storage usage, disk free space, and the server's configured file-size limit.
  Filters and pin counts cover loaded items. Load older items to include them.
- Plain text is inert. Paste preserves spaces, tabs, Unicode, CRLF and trailing
  newlines. A small edit layer preserves existing line endings when a textarea
  exposes a normalized value. Ctrl/Cmd+Enter sends the exact composer state.
- Full text comes from `/text`, separately from the bounded feed preview. Text
  up to 64 KiB prepares automatically. Larger bodies use Prepare copy, followed
  by a fresh Copy text gesture. Success follows the fulfilled clipboard write.
  Preparation is cancellable. Expanded previews render at most 256 KiB. Loading is capped at 8 MiB for browser memory; larger stored UTF-8 text is
  still downloadable as `.txt` or `.md`. File metadata classification matches the root-owned `clients/shared/text-file-fixture.json` allowlists/cases. Eligible files up to 8 MiB show Prepare copy until the server has validated the full immutable UTF-8 body with no NUL/binary controls and the client has completed its bounded fatal-UTF-8 read; only then is Copy available. Explicit non-UTF-8 charsets and larger/unsupported candidates keep ordinary Download. Metadata alone is not proof of textual content. OS clipboards can reject smaller bodies too.
- File downloads navigate to the authenticated attachment URL. They never
  fetch an entire file into a JavaScript Blob. Browser/download-manager support
  determines range-based download resume.
- Files use tus with 8 MiB chunks, cookie credentials, two concurrent queue
  slots, retry delays for resumable requests, and explicit queued/checking/uploading/paused/failed/
  needs-file/complete states. Upload completion means bytes sent; the feed's
  server-validated `ready` status controls download availability. Ambiguous tus
  creation POSTs are not retried automatically; existing upload retries still use
  saved URLs and HEAD offsets.
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

`src/native-platform.ts` automatically detects the desktop Tauri invoke bridge and Android `__HOUSEHOLD_NATIVE__` bridge, maps native queue snapshots, calls native pickers/clipboard/download/API commands, and polls metadata every five seconds. No Tauri npm package is needed by the browser build. Native shells provide `native_get_config` with redacted origin/device and a `connected` flag; no token is returned to JS. A missing address or `connected: false` opens the inbox with explicit connection settings, without issuing native API calls. Saving settings remembers the address through the existing native configuration store; explicit Disconnect remains disconnected across relaunch. Validation remains pausable, retry waits expose Resume, completed downloads can be cleared, and missing sources use native Resume/reselection instead of a browser file picker.

`src/platform.ts` exports `PlatformAdapter`; `src/transfers.ts` exports
`TransferStore` and `Transfer`. Before `src/main.tsx` executes, an installed
shell can set `window.householdPlatform`:

```ts
interface PlatformAdapter {
  kind: 'browser' | 'native'
  requiresConnection?: boolean
  deviceIdentity?: { id: string; platform: 'macos'|'linux'|'android'|'browser' }
  getArrivalSettings?(): Promise<ArrivalSettings>
  setArrivalEnabled?(enabled: boolean): Promise<ArrivalSettings>
  takeArrivalTarget?(): Promise<{ baseUrl: string; itemId: string }|null>
  disconnect?(): Promise<void>
  copyText(text: string): Promise<void>
  download(request: { url: string; name: string; itemId: string }): Promise<void>
  transfers: TransferStore
  chooseFiles?(kind: 'file' | 'text', sourceDevice: string, targetDeviceIds?: string[]): Promise<void>
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

The chosen display name is **Zing**. Existing API, native command/bridge,
pairing/config and queue identifiers remain stable; the visible rename applies in the brand, setup/help/startup text, page title and PWA name. The
public-shell cache revision advances to v13 so cached PWA metadata can refresh;
its existing cache namespace and PWA id/start URL/scope are preserved.

The user’s compact-utility direction (2026-10-23) replaces boxed feed cards with
content-first rows, one quiet source/size/time line, adjacent Copy or Download,
and a secondary action menu. Thin separators replace card frames and duplicate
file tiles. The live [Blip app demo](https://blip.net/) was read and viewed on
2026-10-23 for its short rows, plain search and focused panel; no Blip assets are
used. The supplied UX brief still guides readable hierarchy and grouping.

Short notes show their full content rather than a two-line clamp. Collapsed long text has a six-line visual limit and obvious Expand; rendered expanded text remains capped at 256 KiB. Filenames wrap across the recovered row width. Metadata and subtle Copy/Download actions share one footer; all actions remain at least 44×44 px.
The resting composer is 100 px; entering a draft expands its textarea from 44
to 80 px. It stays expanded while a draft exists, avoiding blur-induced layout
movement during clicks. Long filenames, errors, progress, deletion confirmation
and expanded text can grow. Expand,
full exact Copy, the 256 KiB rendered-text budget and 8 MiB preparation budget
are unchanged. Oversized stored text offers Download .txt.

The smaller page title, composer and desktop header remove repeated type,
readiness, newest-first, caught-up and privacy boilerplate. Browser transfer
lifetime guidance remains beside sending; full transfer help and storage limits
remain available. Transfers retain filename, direction, real progress and
pause/resume/reselect/cancel recovery.

The single mobile bottom navigation contains only All shares, For you and Pinned.
Content kind is an independent All types/Text/Files selector beside the Recent
shares heading. Search fills its own row below the heading/filter. Kind and
scope intersect over loaded items; search and opaque pagination keep their
existing server semantics. Load older items remains available even when no
loaded item matches the local kind/pin filter. A notification selection resets
the content kind so its addressed item can be seen.

Focusing a text field inside the workspace hides the browsing tabs, including
composer, feed/device search and inline editors. A separate sticky Done editing
control stays reachable by scrolling above an occluding keyboard. Done or a
handled Escape restores the existing navigation node and focuses its selected
scope, preserving draft, recipients, kind and search. Menu Escape is consumed by
the menu, and IME composition Escape leaves editing intact. The mobile feed tabs
never move under the composer. No viewport-based keyboard detection was added.
Browser zoom, safe areas and 16 px mobile fields remain.

Only packaged `window.__HOUSEHOLD_NATIVE__?.platform === 'android'` sets
`data-native-android` before rendering, including startup failures. Its native
shell owns system-bar bounds, so the four CSS safe-area aliases become zero.
Browser and desktop retain `env(safe-area-inset-*, 0px)`. This safe-area ownership boundary is unchanged; the additive device/arrival
contracts are described below.

## Validation scope

The final combined review is recorded below. All browser API routes use isolated
contract fixtures, and native cases use JavaScript bridge doubles. These checks
exercise actual Chromium DOM, clipboard and authenticated HTTP downloads, but do
not prove a real Tailscale deployment or installed-device behavior. CDP safe-area
injection and the unchanged-viewport occlusion stand-in verify browser layout,
not a device IME, native Back, OS notifications or background transfer.

Root owns visual acceptance, integration, packaging and installed-device checks.
No 20 GB transfer, actual PWA installation, native package, physical device,
CI, deployment, system installation or Git operation was performed here.

## Registered destinations and arrivals

The Zing device extension uses the root-owned API/native contracts. All shares
is the full household feed; For you queries durable server arrivals independently
of ACK. Search and opaque pagination keep the same device filter. Recipient
selection routes attention, not access: every authenticated household client can
still retrieve every share. Everyone targets other devices registered at ready
time. Old content does not generate registration-time notifications.

Browser identity is a cryptographic 32-hex ID, stored per origin in IndexedDB.
Atomic read/write transactions make simultaneous tabs share one identity. Native
identity/platform come only from redacted native config; configure refreshes it.
Startup/reconnect registration uses atomic preserveExisting=true after authentication, so an older configured/queued name cannot undo a current rename. Explicit naming alone uses normal upsert; UI labels reflect the returned registry metadata. Settings list/forget stale
registrations; forgetting a device does not revoke the household credential.
Text and tus sends snapshot source ID, targets and destination before creation,
file picker or enqueue. Saved browser queues retain those exact targets across
reload/reselection; old rows retain legacy Everyone semantics. Native picker
arguments pass a copied flat targetDeviceIds array to the native intake owner.

Notifications start off. Explicit Enable requests permission and keeps For you
usable after denial. Browser arrivals use serviceWorker.showNotification only
while a page runs, elect a single processor with Web Locks (atomic IndexedDB
lease fallback), use stable per-sequence tags, persist string cursors before
ACK and retry ACK without reposting completed progress. OS display/persistence
are not atomic; this is best-effort dedupe and at-least-once processing, not an
exactly-once or visible-delivery promise. Titles/body are generic: Zing / New
share available, without names, text or filenames. Native clients own their
arrival processor and never post a second notification from shared JavaScript.

The service worker validates internal item IDs and opens only the same-origin
/?item= target, or focuses a same-origin Zing page and passes the internal ID.
The UI authenticates/refetches ready metadata, selects For you, clears search,
reveals/highlights the item and offers offline/deleted recovery. Native persisted
click targets are consumed after bootstrap, on focus and by a bounded five-second native-only check (including clicks while already focused), and checked against the paired origin.
Neither click path copies, downloads nor follows a supplied remote URL.

Desktop Close leaves its resident checks running; Quit/sleep/process exit stops
them. Android background checks run no more often than the 15-minute OS periodic
minimum and can be delayed further by Doze/OEM/Tailscale; reboot and force-stop both require reopening Zing. No reboot-persistent job or 15-minute delivery deadline is implied.
Browser Close stops checks; there is no Web Push or closed-browser delivery.
Permission status never proves OS presentation. These limits appear in settings.

LocalSend reference review: pinned revision
6e37efd5fe750299758b6778d2b150b31af3b95d, app/lib/pages/send_page.dart,
app/lib/pages/receive_page.dart and app/lib/widget/list_tile/device_list_tile.dart.
The named platform-icon rows and separated sending/receiving tasks informed this
interaction. No LocalSend code/assets were copied or adapted; the reference is
Apache-2.0. Zing retains its existing React components, native platform adapter,
private server transport and resumable queues.

## Shared board editing and text exports

Ready text entries support inline editing and explicit Save/Cancel; all ready
entries support name edits. File bodies and text above 8 MiB are not loaded into
an editor. The opening updatedAt is captured before fetching full text and is
kept through feed refreshes, failure and conflict. PATCH carries that exact
expectedUpdatedAt; no autosave, resend, automatic retry or new arrival is created.
Conflicts/failures keep the draft and offer an explicit Reload latest entry
(replace draft) action. Reload fetches current metadata before body bytes. Native
and browser editors use the existing 8 MiB text budget and reject encoded JSON
above 40 MiB. Existing textarea helpers preserve Unicode, whitespace, BOM, CRLF
and pasted code. Save can be ambiguous after a connection failure: the UI keeps
the draft and directs the user to reload before retrying.

Text downloads offer TXT/MD as filename choices without conversion or rendering. Suggested names replace the final non-leading extension, preserve dotfiles, and truncate only the UTF-8 stem to remain within 255 bytes. File entries never offer TXT/MD format selectors.
Browser downloads navigate to /download?format=txt|md and stream outside JS;
native downloads pass the original itemId and matching suggested extension to
the existing native command. Uploaded textual files have explicit bounded Copy
and retain Download, but only rename (no binary body editor).

Tailscale sign-in requires a successful protected fetch, rather than a VPN flag
or the public health route. Offline/server failure shows recovery; 401 offers
Advanced / Use app token. Tokens never enter browser persistence or URL secrets.
Disconnect clears local application state; it cannot revoke Tailscale access.

## Final combined verification

The user-approved navy direction supersedes the unfinished teal revision and the
earlier Iris preview. Canvas `#F7F8FA`, ink `#18334A`, muted/placeholders `#5E6B78`,
actions/progress/focus `#244C6A`, hover `#18334A`, soft `#EAF0F5`, separator
`#DCE3EA` and essential input boundary `#788795` match `branding/README.md`.
Success uses `#23764A` on `#EAF7EE`; errors use `#B42336` on `#FFF0F1`.
A small aria-hidden red line beneath Zing adds the requested brand detail.
Routine Copy/Download/send and progress remain navy. Launchers use the canonical
white Ribbon Z on navy without a red overlay. PWA metadata matches the neutral
canvas; shell cache v13 retains the existing shell-only caching boundary.

The current feed UX separates All shares/For you/Pinned scope from content kind
and hides browsing tabs during text editing. Leaving the editing controls or backgrounding the window restores browsing; Android’s actual IME-hidden signal restores tabs even when Back retains field focus and neither viewport resizes. Done editing or handled Escape still restores selected-scope focus. Draft, recipients, kind, search and identity are retained. The event is `household-keyboard-visibility` with boolean `detail.visible`, consumed only for detected native Android; browser input blur and explicit Done remain recovery paths without guessing keyboard visibility from viewport heights. Existing configured startup/recovery, bounded
text/copy/editing/downloads, menus, arrivals and transfer behavior are preserved.

The original 94/94 unit/component and 36/36 Chromium results predate the connection/navigation follow-up. Current focused results, any failures and corrections, TypeScript/build evidence and native/device limitations are recorded in FINAL-REVIEW.md; they do not imply a repeated full browser suite. Screenshots, exact changed paths, all nine
production asset hashes and remaining checks are recorded in
[FINAL-REVIEW.md](./FINAL-REVIEW.md). Rendered role checks cover text/action
contrast, essential input boundaries and 3 px focus; they are not a complete
accessibility audit. API/native/keyboard fixtures are not installed-device
acceptance. Root owns final rendered/device acceptance and matching packages.

## Desktop delete and device naming follow-up

The shared item menu retains a pointer-initiated action through a null-focus
blur until the click can arrive. Normal keyboard focus departure, outside
pointer dismissal and explicit destructive confirmation remain in place. Native
DELETE uses the existing bridge and accepts an empty HTTP 204; failures keep the
confirmation available for retry. A failed feed refresh after successful delete
shows the feed error and Retry without issuing another delete.

A capable native desktop with the automatic `Desktop` registry label shows a
small **Name this device** form in the inbox. It never opens connection Settings,
autofocuses or blocks the inbox. **Not now** is remembered in app storage per
server origin and durable device ID. A custom registry label skips the form.
Settings keeps an explicit **Save device name** action. Both name saves use
optional native metadata `canRenameDevice: true` and the desktop-only
`native_rename_device({sourceDevice: name})` command before the registry upsert.
No configure/disconnect or queue-control command is used for renaming. The
adapter updates its cached display name only after the native save resolves.
A failed registry step reports that the local name was saved, keeps the input,
and offers the same explicit Save to finish. After reload, a saved local custom name prefills a still-generic registry prompt, so it can finish that registration without losing the requested name. Success is shown after both writes.
Legacy and Android shells are never sent the desktop rename command; browser
registry naming remains compatible. App-storage deletion can reset a dismissed
prompt, and a reset native device identity gets its own naming choice.

Current checks and exact asset/source hashes are in FINAL-REVIEW.md. Chromium
bridge fixtures cover these flows but do not establish macOS WebKit, installed
protocol or package behavior. The existing WebKit2359 executable could not
launch in this environment because system libraries including libevent were
missing; no system dependencies were installed.
