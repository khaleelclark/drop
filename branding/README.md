# Zing mark

`zing-mark.svg` is the original Ribbon Z selected for replacing the house logo.
Its four path points are `(6, 6.5)`, `(18, 6.5)`, `(6, 17.5)`, `(18, 17.5)` in a
24-unit view box, with a 3-unit round-ended stroke. At 16 px the stroke becomes
2 px. Keep this silhouette consistent in the interface, launcher, notification
and desktop tray. It is an asset, not a new runtime dependency.

The mark uses `currentColor`. Launcher assets place a white mark on the chosen
accent field; monochrome notification and template tray assets use its alpha
shape without a colored square. Native owners generate their platform assets
from the same geometry using existing project tools. Do not use the old house,
generic Android foreground, or plain colored tray square.

## Navy / nautical direction

The user approved the navy, soft white and signal-red preview ("there we go.
much better") after requesting a nautical feel and removing Sea Glass/teal.
The roles below are the selected implementation palette. This supersedes both
the Sea Glass direction and the earlier Iris preview.

| Role | Color |
| --- | --- |
| Neutral canvas | `#F7F8FA` |
| Surface / accent foreground | `#FFFFFF` |
| Navy ink / navigation / filenames | `#18334A` |
| Muted / placeholders | `#5E6B78` |
| Navy action / focus / progress / launcher field | `#244C6A` |
| Accent hover | `#18334A` |
| Accent soft | `#EAF0F5` |
| Decorative separator | `#DCE3EA` |
| Essential boundary | `#788795` |
| Signal red / error foreground | `#B42336` |
| Error background | `#FFF0F1` |
| Success foreground / background | `#23764A` / `#EAF7EE` |
| Warning foreground / background | `#8A5900` / `#FFF4D6` |

Use navy for content, navigation and routine Copy/Download/send/focus/progress.
Red is a small decorative brand detail, such as a short line beneath the
wordmark, plus clearly labelled destructive/error states. The brand detail is
aria-hidden and is not an unread/status dot. Preserve the Ribbon Z silhouette.
Launchers use white Z on navy, without extra red details; notification and macOS
template tray assets remain monochrome. No teal or violet brand colors remain.

Information/uploading uses action navy on soft navy; neutral/paused/offline
uses muted on canvas. Preserve explicit state labels, visible focus and existing
44 px action targets. See [the preview](navy-nautical-preview.svg) and
[contrast check](navy-nautical-contrast.txt): 13 intended primary color pairs
pass their source-color targets. These calculations do not establish rendered
state accessibility or installed-device appearance. Older Iris and Sea Glass
studies and reports retain their historical scope.
