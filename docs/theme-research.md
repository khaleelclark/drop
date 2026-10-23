# Zing: palette and mark recommendation

Research/design only · 23 October 2026 · Light appearance first

**Recommend Iris + Cloud, with an original ribbon Z mark.** Cool, almost-white surfaces remove the current olive cast; a measured violet gives the short name some energy. Keep content dark, metadata readable, and Copy/Download consistently iris. This is a design judgment suited to this brief, not evidence that a particular hue creates trust or improves task speed.

## What the existing app suggests

Reviewed the complete `docs/ui-brief.md`, `web/src/styles.css`, and `web/public/icon.svg`. Viewed existing screenshots with `view_image`: `.tools/ui-zing/browser-phone.png`, `.tools/ui-zing/browser-desktop.png`, and `.tools/validation/zing-android-menu/android-emulator-native.png`. These are existing captures, not proof of the current running build or physical-device behavior.

The compact rows and system type already suit a quiet utility. The visual system is less coherent: green-tinted canvas/sidebar/text, indigo actions, an olive in-app badge, and a bright-blue house launcher. A house describes the household but gives **Zing** little identity. Preserve the compact layout; unify the color roles and mark.

The CSS also has two concrete contrast problems worth avoiding in the new theme: placeholder `#858D7E` on white is **3.44:1**; uploading text `#697CAC` on `#F8F9F6` is **3.91:1**. Both are below the normal-text target. Existing metadata `#697066` on that canvas is **4.83:1** and passes. These are source-color calculations, not a full accessibility audit.

## Research applied

- **Consistent meaning:** Apple advises consistent use of color for interaction/status, alternatives to color-only meaning, and real-device/lighting checks. Use one action hue and explicit labels/checks/warnings. The precise hex values below are original custom web-theme choices, not hard-coded copies of Apple's changing system colors. [Apple HIG: Color](https://developer.apple.com/design/human-interface-guidelines/color)
- **Role pairs:** Material separates surfaces, accents, outlines, and their foreground colors. Pair foreground with its intended fill; do not treat a pale accent container as a text color. Adopt that useful role discipline without importing a larger component system. [Material 3: Color roles](https://m3.material.io/styles/color/roles), [Google's color-role explanation](https://codelabs.developers.google.com/codelabs/apply-dynamic-color#3)
- **Readability:** Normal text, including placeholders, needs at least 4.5:1. Meaningful component/state graphics need at least 3:1 against adjacent colors. A decorative separator can remain subtle; it cannot be the only way to identify an input or state. Color must have another cue. [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- **Utility character:** Retain the direct select/send/receive emphasis of the user-selected references. Their product sites reinforce simple actions, rather than a decorative dashboard; neither their brand assets nor privacy/transport claims are proposed for reuse. [Blip](https://blip.net/), [LocalSend](https://localsend.org/)

## Three complete light palettes

| Role | Iris + Cloud — recommended | Sea Glass — calm alternative | Ember + Paper — warmer alternative |
| --- | --- | --- | --- |
| Background / canvas | `#F7F8FC` | `#F5F9F8` | `#FAF8F5` |
| Surface / menus / composer | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| Ink / content / filenames | `#202331` | `#1D2C2A` | `#302922` |
| Muted / metadata / placeholder / secondary icons | `#5F6577` | `#5A6D68` | `#706253` |
| Accent / actions / progress / focus | `#5B4BDA` | `#0B746C` | `#B5481E` |
| Accent foreground | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| Accent hover / pressed fill | `#4938BB` | `#085D57` | `#913613` |
| Accent soft / selection / hover surface | `#EEEBFF` | `#E4F4F0` | `#FFF0E8` |
| Border / decorative separators | `#DDE0EB` | `#D9E6E1` | `#E5DDD3` |
| Strong border / essential input boundary | `#7C8294` | `#6F8981` | `#9A8572` |
| Success foreground / background | `#23764A` / `#EAF7EE` | `#23764A` / `#EAF7EE` | `#23764A` / `#EAF7EE` |
| Warning foreground / background | `#8A5900` / `#FFF4D6` | `#8A5900` / `#FFF4D6` | `#8A5900` / `#FFF4D6` |
| Error / destructive foreground / background | `#B42336` / `#FFF0F1` | `#B42336` / `#FFF0F1` | `#B42336` / `#FFF0F1` |
| Information / uploading foreground / background | `#5B4BDA` / `#EEEBFF` | `#0B746C` / `#E4F4F0` | `#B5481E` / `#FFF0E8` |
| Neutral / paused / offline foreground / background | `#5F6577` / `#F7F8FC` | `#5A6D68` / `#F5F9F8` | `#706253` / `#FAF8F5` |

**Iris + Cloud:** crisp and slightly playful, with good separation from success green and warning amber. It builds on the existing indigo action language while removing unrelated olive hues. Best balance for an everyday clipboard/file utility.

**Sea Glass:** softer and more domestic; teal actions feel quieter. Suitable if the household prefers a subdued appearance. Because teal is near success green, distinguish “uploading” and “complete” with progress/check glyphs and words; hue alone is insufficient.

**Ember + Paper:** warm and energetic, with a small amount of orange making Zing more distinctive. Use the deep burnt-orange value, not a bright orange with white text. Its proximity to warning/error colors makes semantic separation less effortless; always retain amber/red state labels and icons. Third choice for this brief.

## Calculated contrast

Ratios use exact opaque sRGB values. Two decimals are shown; pass/fail used unrounded values. A slash means **canvas / white surface**, not a foreground blend.

| Foreground / background pairing | Iris | Sea Glass | Ember | Target |
| --- | ---: | ---: | ---: | ---: |
| Ink / canvas and white | 14.70 / 15.60 | 13.69 / 14.52 | 13.51 / 14.33 | 4.5 |
| Muted / canvas and white | 5.47 / 5.81 | 5.18 / 5.49 | 5.56 / 5.90 | 4.5 |
| Accent / canvas and white | 5.71 / 6.06 | 5.31 / 5.63 | 5.07 / 5.37 | 4.5 |
| Accent / accent-soft | 5.19 | 4.96 | 4.83 | 4.5 |
| White / accent | 6.06 | 5.63 | 5.37 | 4.5 |
| White / accent-hover | 8.18 | 7.74 | 7.66 | 4.5 |
| Strong border / canvas and white | 3.61 / 3.83 | 3.55 / 3.77 | 3.32 / 3.52 | 3.0 |
| Decorative border / canvas | 1.24 | 1.21 | 1.27 | Decoration only |

Shared status foregrounds on their matching status backgrounds: **success 5.06:1; warning 5.46:1; error 5.87:1**. Those foregrounds also pass on white (5.58, 5.98, 6.49) and every canvas (minimum 5.26, 5.64, 6.12 respectively). Information and neutral pairs are covered by the accent/soft and muted/canvas rows. A white label on a solid error fill is 6.49:1.

Method: normalize each 8-bit channel to `c` in 0–1; linearize as `c/12.92` when `c <= 0.04045`, otherwise `((c+0.055)/1.055)^2.4`. Relative luminance is `0.2126R + 0.7152G + 0.0722B`. Contrast is `(lighter+0.05)/(darker+0.05)`. Calculated locally using double-precision arithmetic; `contrast-values.json` records the raw results. Reference: [W3C contrast-ratio definition](https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio).

## Apply the accent sparingly

Use accent for Copy and Download glyphs/labels, the send control, selected navigation/filter glyphs, progress, and a visible 3 px focus outline with a neutral gap. Give Copy and Download the same emphasis. Routine row actions stay borderless with their existing 44 px hit areas; a soft hover surface is enough. A filled accent button is appropriate for a single consequential confirmation, not every row.

Keep content, file-type icons, inactive navigation, timestamps, and the device picker neutral. Use canvas for the background/sidebar, white for the composer and popovers, and fine decorative row separators. Avoid colored feed cards, gradients, colored body text, and extra shadows. Active navigation also gets weight/shape and a visible icon change; “Copied” includes a check and text after the clipboard write succeeds. Transfer states keep their explicit status wording and recovery actions.

Use strong border only where an input boundary is needed to identify the control. If a softer decorative border is used elsewhere, visible text/icon content must independently identify the action. Focus always remains visible. Do not lower essential metadata or icons with opacity.

## Two original mark directions

**A. Ribbon Z — recommended.** One substantial Z-shaped path with flat horizontal terminals and a quick diagonal, subtly softened outside corners. The Z is the identity; no house, document, cloud, lock, or generic share-node embellishment. A 24-unit sketch uses a ~3-unit stroke and a 4-unit inset; a 16 px optical version uses a 2 px stroke with pixel-aligned terminals. Keep the same silhouette in one color for the tray/menu bar; use white on an iris field for the launcher. The supplied study intentionally stays simple enough to read at 16 and 24 px.

**B. Exchange strokes.** Two short opposed strokes, offset vertically, with open arrow turns: one moving right, one left. Their shared diagonal rhythm suggests the back-and-forth of a household clipboard. Use a single color and a generous central gap, not two brand colors or overlapping links. At 16 px, shorten the arrowheads and preserve at least 2 px clear separation; at 24 px, retain ~2.5–3 px strokes. More descriptive of exchange, but less ownable and more likely to resemble a refresh/sync command than A.

The accompanying vector study shows both ideas at large size and at 16/24 px in color and monochrome. They are design studies, not installed app assets. Use separate optical-size vector paths if needed, rather than shrinking a detailed launcher image. A final mark still needs launcher-mask, tray, notification, and physical-device checks; no trademark clearance has been done.

## Scope and limits

No application edits, builds, dependencies, or tests were run. No new Agents, AI bitmaps, or third-party brand assets were created/reused. This is a light-first proposal; dark mode is not required by the current brief and is not supplied here. Apple has broader adaptive-appearance advice; this custom web palette does not claim complete native HIG conformance. Exact pair calculations are evidence for these colors, not proof that all rendered states are accessible. Check focus adjacency, system high contrast, disabled states, actual typography, launcher masks, and lighting on real hardware during integration.
