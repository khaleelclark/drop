# Zing layout refresh — reviewed production freeze

24 October 2026. Root inspected the actual desktop/phone after renders and
accepted the shared edges, grouped composer, quieter list and four complete
phone rows at y=308. Root then authorized the exact Mac menu correction and
**one combined production build**, now completed. Current assets are
`index-8QCwuAnd.js`, its source map and `index-CJq1Hml4.css`.
[The final manifest](test-results/ui-refresh/final-freeze.json) records all nine
assets, exact authored files, source-map consistency and evidence receipts.

Root's real-browser diagnostic on macOS arm64, run **40053889772**, source
`3dfbd083aa0b6c57501485a361309c72572897d2`, artifact **12543943857**, loaded the
same nine hashed 0.1.4 baseline files in both modes. Baseline default and last
item traces show trusted Delete mousedown, focusout to the enclosing
`DIV#share-native-{note,last}` with tabindex=-1, menu unmount, then pointerup
elsewhere: no confirmation or DELETE. Attribute-only tabindex=0 moves focus to
Delete, preserves its click and opens confirmation in both cases; Keep makes
zero mutations and Escape returns to the trigger. This is Playwright WebKit on
macOS, not installed Tauri/WKWebView acceptance. Both differential cases later
time out after HTTP 500 with its error below the viewport; confirmation
visibility and safe Keep focus also fail on that old baseline. **No complete
Mac delete-flow pass is claimed.** Earlier AppKit diagnostics failed setup/input
and supply no app-behavior result.

The final source adds `tabIndex={0}` only to the ItemMenu trigger and FeedCard
menu actions, as root directed. It retains the existing pointer guard, ordinary
focus/outside/key dismissal and safe Keep/scroll confirmation correction. The
refreshed layout passes a new phone error-visibility check without additional
error-scrolling code.

The approved navy/white/red Ribbon Z identity is unchanged. The send area now
groups files, recipient selection and Send; the repeated Shared inbox/New share,
separate recipient row and help band are removed. Browser foreground-transfer
information remains visible inside the composer before choosing files. Settings
also exposes Help. Desktop uses a 192 px navigation rail, shared header/content
edges and one history toolbar. Phone retains three bottom scope tabs and a
full-width search row. Continuous rows align visible Copy/Download actions;
metadata is 12 px/18 px and wraps. The native HTML device dialog is a compact
anchored picker on desktop and a bottom sheet on phone, with search, explicit
Done, focus containment, Escape/outside dismissal and restored trigger focus.

| Same populated fixture | Before | After |
| --- | ---: | ---: |
| First share, 390×844 phone | y=436 px | y=308 px |
| Complete rows above phone tabs | 3 | 4 |
| First ordinary phone row | 85 px | 97 px |
| First share, 1440×900 desktop | y=434 px | y=268 px |
| Desktop toolbar height | 104 px | 44 px |
| Desktop content left edge | x=438 px | x=372 px |

Measurements are CSS pixels, from the real React app in Chromium with isolated
API fixtures; this is neither installed-device evidence nor a usability study.
Four visible rows include one file and one whitespace-preserving note. Blank
composer, no active queue/alert. Browser information is included in the target.

Rendered comparisons: [desktop before](test-results/ui-refresh/before-desktop.png),
[desktop after](test-results/ui-refresh/after-desktop.png),
[phone before](test-results/ui-refresh/before-phone.png),
[phone after](test-results/ui-refresh/after-phone.png).
The interface owner inspected these plus phone empty, focused/error, Settings,
transfers/offline, long code/filenames, and phone/desktop picker renders in the
same directory. Exact geometry is in before/after-composition.json.

Validation actually run:

- Source typecheck passed. FeedCard/edit units **22/22** passed; bootstrap/native
  interface units **14/14** passed. These are mocked interface boundaries.
- **20 relevant browser cases ultimately passed across focused runs**, with
  failures corrected and only affected cases rerun. They cover exact inert
  copy/paste, pin/search/download/delete, safe visible confirmation/Keep without
  mutation, narrow/last menus, text export, recipient routing/picker snapshots,
  scope/kind/search/paging, failed/conflicting edit draft/reload/save, 320–412 px
  layouts, keyboard overlays/Done, single safe-area application, reduced motion,
  larger-text fixture, constrained picker, and computed rendered palette/focus
  contrast. No broad full browser suite was rerun.
- Focused review tests additionally inspect 1024/1440 px, 44 px primary targets,
  full-width phone search, no horizontal page overflow, sheet search focus,
  Tab containment, Escape/outside dismissal and focus return. Browser viewport,
  larger-text and Android bridge/keyboard fixtures do not validate OS keyboards,
  browser zoom, actual device font scaling, screen readers or installed apps.
- The measured blank-phone target passes at y=308 with four complete shares.
  Source colors measured from the rendered app pass 4.5:1 for tested normal text
  and 3:1 for tested boundaries/focus; no full accessibility claim is made.
- A real pointer Save after editing originally lost its click when blur removed
  the mobile editing toolbar. Keeping that toolbar through entry-editor actions
  resolves the tested event order while preserving drafts and explicit Done.
- Final menu/confirmation/recovery selection: **4/4 passed, 6.4 s**. The
  strengthened narrow 390×600 error-recovery case then passed **1/1, 2.8 s**;
  three unaffected passed cases were not rerun. Both desktop paths assert
  explicit trigger/action tabindex, visible safe confirmation/Keep, zero
  cancellation mutations, structured 500 with visible enabled retry/no false
  success, empty 204 and failed-feed-refresh recovery without duplicate DELETE.
  The synthetic null-blur case remains controlled Chromium coverage, not Mac
  runtime evidence. Keyboard menu navigation/Escape and composer actions pass.
- Final `pnpm typecheck` passed. **One `pnpm build` passed**: TypeScript +
  Vite 6.4.5, 1620 modules, 1.93 s Vite build. No second production build ran.
  All 20 local application sources embedded in the JS source map match current
  files exactly; HTML asset references resolve and all five copied public files
  match their sources. The immutable ten-file baseline remains unchanged.
- New confirmation, desktop 500 and phone 500 renders were visually inspected.
  Current final source/test hashes and the nine-asset freeze are in
  `test-results/ui-refresh/final-freeze.json`. No native/API/server/Android/
  package/CI change, dependency, system install or deployment was performed.

Evidence incident: the first capture command used Playwright's default output
folder, which cleared older ignored web/test-results evidence before failing to
launch the newly expected browser revision. This was reported immediately.
Existing Chromium 1243 was then selected explicitly; no browser was installed.
The runner now writes transient traces to test-runs/ while retained evidence
stays in test-results/. The immutable baseline and production bundle were never
changed. The historical required-deliverables audit identifies **22 irrecoverable older
web evidence paths**, plus previous non-required diagnostic receipts. Root's
reviewer exhausted the permitted archives and found no recoverable originals.
The missing inventory is preserved unchanged; no new capture is relabelled as
historical evidence. Current renders and final checks are separately retained.
The three old hashed JS/map/CSS names in root's manifest are now superseded by
the current build, with their originals still present in the immutable baseline.

This completes the assigned web source/build handoff. Root owns required-manifest
integration, native packaging and installed acceptance. Installed Mac, Linux,
Android, physical-device, 20 GB, full browser zoom, system text scaling, screen
reader and full accessibility acceptance remain unperformed by this task.
