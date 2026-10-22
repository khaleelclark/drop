# Interface brief

User direction: “smooth modern ui, think clean ios type. intentional actions, thoughtfully placed. and clean and functional”.

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
