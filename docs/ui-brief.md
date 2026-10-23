# Interface brief

## Current redesign request

The user rejected the first interface and requested a more modern redesign grounded in Elvis Canziba's *Hands-On UX Design for Developers* (2018), supplied at `/home/phoenix/khaleel/ux-design.pdf`. They also reported that the Android installed app initially appears zoomed and allows unwanted page zoom. This request supersedes the first pass's composition; its working transfer and clipboard behavior remains required.

The relevant textbook material has been read from the supplied PDF: grouping and Gestalt relationships (printed pp. 70–81), typography and readable measure (153–156), alignment/hierarchy/contrast/repetition/proximity/balance/space (160–168), task clarity in interface design (217–220), and coherent palettes/type/grids/components (241–249). Printed pages are 12 pages behind PDF page numbers. Text and reference renders remain in ignored local tooling directories; do not publish the textbook or extracted passages.

| Principle | Application in Household |
| --- | --- |
| Hierarchy and figure/ground | The shared content and its Copy/Download action lead. Connection, storage, help, and management stay secondary. Avoid a second headline, breadcrumb, and repeated description for the same feed. |
| Proximity and common region | Keep item preview/name, source, state and action visually related. Separate the composer, feed and active transfers without boxing every small label. |
| Alignment, balance and space | Use a consistent spacing scale and shared edges. Desktop has a compact navigation area and readable content column; phone has one column. White space supports scanning without pushing useful content below oversized headers. |
| Repetition and similarity | Use one coherent system for typography, buttons, focus, menus, dialogs, surfaces, status colors and radii. Same actions look and behave the same in every state. |
| Contrast and typography | Readable body text and metadata; one restrained accent for key actions/selection. Use contrast and weight instead of a wall of equally strong outlines and tiny pale labels. |
| User tasks | Send text/files and copy/download should be apparent without explanatory marketing text. Reveal advanced help and technical configuration when requested. |

The refreshed layout must visibly improve composition, not only recolor the old screen. Use quiet neutral surfaces, dark text and a restrained contemporary accent. Keep transfer progress and failure recovery real, and make pairing, empty, disconnected, ready, uploading and failed states intentional.

For phones, prioritize a compact header/filter/search area, full-width content, and a composer within thumb reach. Avoid duplicated navigation and never cover the last item, menu or action with the composer. Inputs must be at least 16 CSS px on mobile. Check 320, 360, 390 and 412 CSS px widths, both empty and populated, with the keyboard open as well as closed. Preserve usable safe areas and native system font settings.

Android installed clients must start with a device-width layout at scale 1 and disable app page pinch/double-tap zoom in the native WebView. Fix the native configuration durably rather than masking overflow with CSS transforms. The browser fallback retains accessibility zoom. Web and native owners coordinate viewport and inset handling.

Root reviews rendered desktop/phone screens, then checks the updated installed Android APK when the emulator is available. A screenshot, browser emulation or source setting alone does not establish physical-phone behavior. Final Android and Mac packages must consume the same reviewed frontend build.

User direction: “smooth modern ui, think clean ios type. intentional actions, thoughtfully placed. and clean and functional”.

Latest mobile direction (2026-10-23): “for mobile i prefer a bottom tab design”.
Move the existing four phone sections into a bottom navigation bar with clear
icons, labels and active state. Keep the approved desktop layout and in-flow
composer. Reserve room for the bar and safe area so it cannot cover the final
item, menu, toast or transfer action; check actual keyboard behavior separately
from browser viewport-height fixtures. This supersedes the previous frontend
freeze for mobile navigation; root reviews the exact new build before updating
the installed packages and live release.

## Blip reference

The user also requested inspiration from [Blip](https://blip.net/). Its app demo uses a compact device list, plain search, short rows and a single-purpose panel. Apply that directness to the household feed: keep sending close at hand, make file identity and progress easy to scan, and give each item one obvious Copy or Download action. Preserve the approved shared inbox and its offline receiving behavior. Use the reference for interaction clarity and density; keep Household’s own assets and visual system.

Latest direction (2026-10-23): the user likes the current interface but finds it
too heavy, with individual entries occupying too much space. Move toward a
compact utility on both desktop and phone. Replace tall boxed cards and repeated
heading/body/footer structure with short content-first rows, one quiet metadata
line, thin separators and an immediately visible Copy or Download action. Aim
for roughly 80–100 CSS px for ordinary short phone entries; long filenames,
expanded text, errors and recovery controls may need more room. Reduce the
oversized page heading, composer spacing and repetitive feed boilerplate.
Keep readable text, at least 44 px action targets, the existing mobile bottom
tabs, accessible menus and full text/streaming behavior. Preserve Android's
native safe-area ownership and real keyboard/Back/Done/draft/search behavior.
This supersedes the earlier instruction to retain desktop composition where
that composition conflicts with the requested lighter density.

The user subsequently supplied Blip's compact menu-bar device list and requested
a registered household device picker, arrival notifications, and a cute, short
name suggesting quickness. Keep that picker small and searchable, with named
phone/computer rows and an Everyone destination. Do not invent online presence,
delivery receipts or automatic downloads. Arrival notifications must refer only
to ready content and open the corresponding item. System permission, privacy,
deduplication, offline recovery and closed-app behavior need a real platform
implementation, not a browser-only visual mock. The user chose **Zing** as the
new visible app name; preserve app identifiers, signing identity, pairing and
saved transfers when rebranding. The user confirmed one shared household feed
plus a **For you** view for items addressed to the current device. **All shares**
shows everything; **Send to** chooses registered device recipients or Everyone.
Targeting routes inbox entries and alerts without hiding content from other
household devices. Notification selection opens the corresponding ready item.
Do not retroactively alert for existing history or claim private access controls.
Root coordinates the
server/native contract before the interface owner implements these controls.
Compact density work continues while the contracts are resolved.

The user also explicitly requested inspiration and suitable implementation
reuse from [LocalSend](https://localsend.org/) and its
[source](https://github.com/localsend/localsend). The reviewed reference checkout
is pinned at `6e37efd5fe750299758b6778d2b150b31af3b95d`; its root license is
Apache-2.0. Apply its straightforward content selection, named device picker,
send/receive separation and transfer feedback where they fit. Any copied or
adapted code must retain applicable license/attribution notices and identify
the source revision and modifications. UI inspiration alone does not imply
that code has been ported. Preserve Zing's Tailscale/loopback server, shared
history, offline receiving and bounded resumable transfers when evaluating
LocalSend's different device-to-device transport.

## Experience

Household is a quick shared inbox for plain text and files. The most common jobs take very few actions: paste/send; drop/send; copy; download. Make the shared feed the primary screen with an easy-to-reach composer and visible transfer status. On a phone, essential actions remain within thumb reach and do not depend on hover.

## Visual direction

- Latest user preference: use judgment about lightweight icon actions versus
  labels; avoid large filled blocks for routine Copy, Download and composer
  controls without turning everything into an icon. Retain clear accessible names, visible focus,
  feedback and 44 px tap areas without drawing a large block around each one.
  Use the saved space for content: show ordinary short notes in full, give long
  text a generous bounded preview with a visible Expand/Collapse control, and
  allow filenames to wrap. Compactness must come from less chrome rather than
  aggressive two-line truncation.
- Light neutral iOS-inspired interface with a restrained blue accent, system typography, precise spacing, soft corners, subtle separators, and readable contrast.
- Use deliberate hierarchy and whitespace, avoiding decorative dashboard metrics or a wall of equal-weight buttons.
- Each card has one clear primary action: Copy for text or Download for files. Expand and secondary management actions are quieter.
- The connection/setup state is a purposeful screen; show technical server settings only where users configure them.
- Transfer rows show filename, progress, pause/resume/cancel, and clear failure recovery. Never label a pending upload ready.
- Motion should be short, subtle, and useful. Respect reduced-motion and avoid layout jumping while typing or copying.
- Support keyboard navigation, visible focus, semantic controls, accessible labels, and at least 44 px primary touch targets.
- Keep large previews bounded. Long text must not make the page or feed unusable.

## Product behavior

- The inbox is a shared board of entries. Text entries support explicit inline
  editing with Save/Cancel; entry names can be changed. Preserve an unsaved draft
  on failure/conflict, and never silently overwrite another household edit.
  Root coordinates the edit API and crash-safe storage before implementation;
  edits retain the entry's identity/routing and do not resend arrival alerts.
- Copy always targets full stored text; the preview is clearly a preview. “Copied” appears only after success.
- Pasted code and Markdown remain inert text with a visible Copy action. Short
  notes are readable; long code stays collapsed by default with Expand so it
  does not dominate the board. Offer exact-byte text downloads as `.txt` or
  `.md`; files retain Download. Format choices name the saved file, without
  converting whitespace or rendering/executing the content.
- Download starts a normal/native streamed transfer; it does not fetch a huge JavaScript Blob first.
- Make multi-file uploads, clipboard paste, and drag/drop discoverable without crowding the composer.
- Empty, disconnected, uploading, failed, and storage-full states need intentional designs.
- Browser fallback should explain its foreground transfer behavior in context, without scattering implementation details throughout the interface.

Root reviews the rendered desktop and mobile layouts before calling the interface complete.
