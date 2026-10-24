# Zing: Blip / LocalSend interface direction

Research and design handoff · 24 October 2026 · no application changes

**Recommendation: make Zing feel like a small sharing utility with a persistent inbox.** Use Blip’s plain search and named-device lists, LocalSend’s content/state grouping, and Zing’s existing navy, white and signal-red identity. The user has supplied enough direction to proceed. The main change should be composition: fewer stacked headings, recipient selection inside the send area, clearer action alignment and less visible control chrome.

## What the references actually show

- **Blip:** its developer-published iPhone screenshots show a plain name/email search, short avatar/device rows, and a destination sheet with a short list of actions. Controls belong to the task instead of appearing as equally weighted buttons. This is visual evidence from the [official App Store listing](https://apps.apple.com/us/app/blip-send-files-in-a-click/id6463305181), reached from the [Blip website](https://www.blip.net/). Borrow the plain list/picker language; Zing still needs explicit Copy and Download and its server-backed history.
- **LocalSend:** the [official desktop hero](https://localsend.org/img/hero-desktop.webp) groups each filename, progress bar and state together; Advanced/Cancel sit quietly at the bottom. The [phone hero](https://localsend.org/img/hero-mobile.webp) has a clear three-destination bottom bar. The actual [PC](https://localsend.org/img/screenshot-pc.webp) and [iPhone](https://localsend.org/img/screenshot-iphone.webp) transfer screens linked by its [GitHub README](https://github.com/localsend/localsend#screenshots) show the same readable filename/state hierarchy. Borrow that hierarchy, using Zing’s All shares / For you / Pinned destinations.

These are interface observations and design inferences, not findings from usability testing. LocalSend’s large device-name receive screen and roomy empty transfer window serve different tasks; copying those proportions would waste space in Zing’s history. The references’ transports, automatic receiving and presence conventions do not establish Zing behavior.

## Why the current layout feels awkward

Evidence: visually inspected `web/test-results/zing-navy-desktop.png` (1280 × 767) and `zing-device-picker-phone.png` (390 × 844), then read the complete current `App.tsx`, `styles.css`, UI brief and branding README; also checked `FeedCard.tsx`, `TransferQueue.tsx` and the existing LocalSend assessment.

| Visible issue | Current source/evidence | Practical correction |
| --- | --- | --- |
| Too many layers before content | `App.tsx:296–317`: household topbar, Shared inbox heading/New share, recipient row, composer, separate help row, Recent shares/filter, then search. First desktop text begins around y=448 in the supplied image. | Keep one compact utility header. Remove the repeated visible Shared inbox heading/New share when the composer is already present. Keep the required Recent shares heading/filter, with a semantic heading hierarchy. |
| Several different left edges | Desktop topbar starts at x≈268; content starts at x≈358; row text then at x≈366. CSS topbar padding is 44 px while `main` is centered with its own 36 px padding (`styles.css:82–90`). | Give the main header, composer, toolbar and list a shared content edge. Use 24 px desktop and 16 px phone gutters. |
| A small help sentence creates a large gap | `.transfer-note > button` has its own 44 px minimum height (`styles.css:119–120`). It occupies a whole band between sending and receiving. | Put help in Settings/the existing help entry. Show the browser foreground-transfer explanation inside the active transfer area when relevant; preserve its discoverability before a browser upload. |
| Recipient and content feel disconnected | `RecipientPicker` is a sibling before the composer (`App.tsx:304–305`); its standalone 44 px row uses a negative margin (`styles.css:344–346`). | Put the Send to control inside the composer footer, with files and Send. Selection and attached content remain visibly one task. |
| Input rectangles dominate the middle | Composer, 44 px select and 44 px search all use the essential-boundary color (`styles.css:106–130`). | Keep an identifiable composer and search field. Render the content filter as a labelled compact “All types ▾” text control with a full hit area. Do not draw a box around every action. |
| Actions drift away from their item | `.feed-row` always stacks content over a metadata/action footer (`styles.css:135–140`). Files use an icon-only Download while text uses labelled Copy (`FeedCard.tsx`). | Use the same right-side action alignment across rows; keep Copy / Download labels. Use a compact two-column row where space permits, falling back to a footer for long content or narrow widths. |
| Phone picker looks like a desktop overlay | The supplied phone image shows the 330 px popover cutting across the composer, filter and search (`styles.css:349`). | Keep an anchored compact popover on desktop; use a near-full-width phone sheet with its own heading, search, named device rows and Done. Keep it keyboard-safe. |

Several routine actions are **already transparent** (`.button.action-button`, `.icon-button`). The issue is not that every current button is filled. Preserve those useful controls and the existing strong keyboard focus indicator; the focused filter/search rings in the screenshots are necessary feedback, not decoration to erase.

## Desktop composition

Use a quiet 176–192 px navigation rail: Zing, All shares, For you, Pinned; Settings/help/device identity at the bottom. Preserve storage access; show a prominent warning when storage actually needs attention. No separate permanent household-description rail across the top of the content.

Main content has 24 px inset, a practical 760–920 px content width and shared edges. From top to bottom:

1. **One send area:** short input, then a single footer: Add files / more, Send to Everyone ▾, Send. Recipient selection stays inside this group. Drafts expand in flow; no duplicate New share action beside an already visible editor. Keep text/file selection and existing file enqueue semantics.
2. **Active transfers only when present:** compact rows immediately below, with filename, direction/state, progress and Pause/Resume/Cancel. Keep failures and reselect/recovery available. No empty queue panel.
3. **One history toolbar:** Recent shares + All types ▾ on the left; Search on the right where width allows. At intermediate widths search may use the next row. Scope stays in navigation; Text/Files stay in the kind filter.
4. **Continuous history:** content and a stable Copy/Download action, one quiet metadata line, thin separators. Short text remains fully readable; long text gets the existing bounded preview plus Expand/Collapse. Filenames wrap. Management stays in one overflow menu.

## Phone composition

Keep the requested three labelled bottom scope tabs. Use one 56 px utility header with the Zing mark/name and an accessible Settings/status action. An actual connection problem can expand into a clear recovery banner.

Use 16 px side gutters (12 px only at 320 px). The compact, in-flow composer sits immediately below the header, with Add files, Send to and Send together. Keep all controls reachable at 320 px, using a second footer line when necessary rather than shrinking touch targets. Below it: Recent shares + kind filter, then the user-requested **full-width search row**, then the history.

At 390 × 844 with a blank composer and no alerts/active queue, target the first ordinary share beginning by about y=320 and at least four short shares visible above the navigation bar. This is a proposed composition check, not a measured result. Ordinary phone rows should usually be about 80–100 px; full short notes, wrapping filenames, expanded text and errors may be taller.

Keep the composer in flow. While typing, hide scope tabs rather than moving them next to the draft; retain an explicit Done control. Preserve draft, focus, scope, kind and query through keyboard/Back transitions. Menus, sheet, toast and last action must clear the native safe area and bottom bar. Android already owns system-bar insets: do not add them twice. Browser fallback retains zoom.

## Small visual rules

| Element | Rule |
| --- | --- |
| Spacing | 4 / 8 / 12 / 16 / 24 px scale. 4 px within metadata; 8 px related controls; 12 px row padding; 16 px between functional groups; 24 px desktop section separation. Avoid one-off negative spacing. |
| Type | Existing system font. Body/input 16 px on phone; body 15–16 px desktop; metadata 12–13 px / 18 px line height; section heading 17–18 px semibold. Prefer readable type and less chrome to 10–11 px utility labels. |
| Shapes | Continuous list, no individual item cards or shadows. Composer/sheets about 14–16 px radius; input 10–12 px; small hover/press backgrounds about 8 px. Roundness supports grouping, not a pill behind every label. |
| Actions | Copy and Download use icon + visible label, navy text, transparent rest state and soft navy hover/press. Send may have the single small navy filled treatment. Overflow/Settings/Pause use familiar labelled-for-assistive-tech icons. Every primary hit area stays at least 44 × 44 CSS px. |
| Selection/focus | Weight + icon/indicator + a quiet selection surface. Retain visible keyboard focus and contrast; a transparent button can still have a large hit area. Essential input boundaries/meaningful icons need appropriate contrast, while decorative list separators can stay pale. [W3C explanation](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| Identity | Keep approved canvas `#F7F8FA`, white surface, navy ink `#18334A`, action `#244C6A`, muted `#5E6B78`, and red `#B42336` roles. Keep Ribbon Z and the small decorative wordmark signal. Red does not become a routine Send/selection color. No palette/logo redesign. |

For smoothness, use restrained 120–160 ms color/opacity feedback. Copy → Copied should occupy a reserved action width so it cannot move metadata. No spring/bounce, animated row reordering, automatic smooth scrolling on ordinary refresh, or large height animation when the keyboard appears. Preserve the existing reduced-motion rule: no nonessential transitions/animations; progress and busy states remain understandable through text and actual progress values. These timings are design choices, not measurements of the references. [W3C motion guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)

## Acceptance checks for the owner’s implementation

1. Compare the same populated desktop/phone fixture before and after: the repeated heading/help bands disappear, recipient and send tools are one group, and the default 390 × 844 composition meets the proposed content visibility target.
2. At 320/360/390/412 px and desktop 1024/1440 px, shared edges stay aligned, filenames wrap, inputs remain usable, and there is no horizontal page scrolling or clipped menu/action. Also check browser zoom and larger system text.
3. Every ready text/file item exposes a clear Copy or Download without hover; tap areas remain 44 × 44 px, focus is visible, keyboard/menu behavior works, and rendered normal-text contrast is at least 4.5:1 and meaningful control/state cues at least 3:1. The 44 px project target aligns with [W3C enhanced target guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html); this is not a claim of full WCAG conformance.
4. All shares / For you / Pinned intersect correctly with All types / Text / Files, search and paging. Never present a loaded-page count as the total household count. Typing never relocates feed tabs into the composer.
5. Short notes, whitespace and code remain inert and readable. Long previews are bounded with Expand; Copy uses full stored text and confirms only after success. Preparation/failure/copy-budget fallback and exact text-file Download remain available.
6. Everyone/named-device selection, queue controls, uploading/not-ready, paused, failed, storage-full and offline recovery remain explicit. No invented online presence, delivery receipts, hidden recipient privacy, or automatic downloads.
7. Review real installed keyboard/Back/Done behavior, safe areas, phone sheet and last-item access separately from browser screenshots. Failed edits retain their drafts. Delete requires its established explicit destructive confirmation.
8. With reduced motion on, no nonessential motion remains; copying, refresh and filter changes do not unexpectedly steal focus or jump the scroll position. Ready-state changes still have readable feedback.

Scope limits: this handoff changes no application file, theme, logo or build. Existing official screenshots may represent older reference versions; no Blip/LocalSend install or usability study was run. No native/device, screen-reader, rendered-contrast, transfer or 20 GB check was performed. Blip’s homepage was browsed; its local headless capture returned 403, so concrete Blip visual observations above are limited to the inspected developer-published App Store images. No reference assets or source code were copied into Zing. The reported Mac Delete/no-confirmation issue in 0.1.4 remains unresolved by this research and needs its own owner validation.
