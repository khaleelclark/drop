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

## Blip reference

The user also requested inspiration from [Blip](https://blip.net/). Its app demo uses a compact device list, plain search, short rows and a single-purpose panel. Apply that directness to the household feed: keep sending close at hand, make file identity and progress easy to scan, and give each item one obvious Copy or Download action. Preserve the approved shared inbox and its offline receiving behavior. Use the reference for interaction clarity and density; keep Household’s own assets and visual system.

## Experience

Household is a quick shared inbox for plain text and files. The most common jobs take very few actions: paste/send; drop/send; copy; download. Make the shared feed the primary screen with an easy-to-reach composer and visible transfer status. On a phone, essential actions remain within thumb reach and do not depend on hover.

## Visual direction

- Light neutral iOS-inspired interface with a restrained blue accent, system typography, precise spacing, soft corners, subtle separators, and readable contrast.
- Use deliberate hierarchy and whitespace, avoiding decorative dashboard metrics or a wall of equal-weight buttons.
- Each card has one clear primary action: Copy for text or Download for files. Expand and secondary management actions are quieter.
- The connection/setup state is a purposeful screen; show technical server settings only where users configure them.
- Transfer rows show filename, progress, pause/resume/cancel, and clear failure recovery. Never label a pending upload ready.
- Motion should be short, subtle, and useful. Respect reduced-motion and avoid layout jumping while typing or copying.
- Support keyboard navigation, visible focus, semantic controls, accessible labels, and at least 44 px primary touch targets.
- Keep large previews bounded. Long text must not make the page or feed unusable.

## Product behavior

- Copy always targets full stored text; the preview is clearly a preview. “Copied” appears only after success.
- Download starts a normal/native streamed transfer; it does not fetch a huge JavaScript Blob first.
- Make multi-file uploads, clipboard paste, and drag/drop discoverable without crowding the composer.
- Empty, disconnected, uploading, failed, and storage-full states need intentional designs.
- Browser fallback should explain its foreground transfer behavior in context, without scattering implementation details throughout the interface.

Root reviews the rendered desktop and mobile layouts before calling the interface complete.
