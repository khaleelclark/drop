# Final web review — navy branding and feed controls

The two reported navy contrast defects are fixed, with the requested focused validation complete. The nine replacement files below are frozen for root’s acceptance and packaging; no further web edits/builds are planned. This build supersedes index-CdQGPkh0.js / b7cbd85b… (original navy), index-fO7oZNrK.js / 575626ec… (Iris), index-CUqDSOpD.js / 6b455edc… (configured startup) and every earlier web freeze. The user approved the final navy, soft-white and signal-red preview after removing teal; branding/README.md records that selection. The interrupted teal revision never produced a production build. The configured-startup fix and prior menu/text/editing/device/arrival/transfer work remain included. Root owns final rendered/installed acceptance and packaging. The tested role pairs do not establish complete accessibility.

## Implemented

- Scope is **All shares / For you / Pinned** on desktop and phone. Content kind is the independent **All types / Text / Files** selector beside Recent shares. Search fills a separate row below heading/filter; phone widths 320/360/412 are measured explicitly. Kind and pin filters intersect over loaded items; search and opaque paging retain existing server semantics, including Load older when no loaded item matches the local filter. Notification opening resets content kind so its addressed item is visible. Filtered empty states explain recovery. No unsupported kinds or API change.
- Text-field focus anywhere in the workspace hides the existing mobile browsing navigation node instead of moving it under the composer. Composer, device search, feed search and inline entry editing are covered. A separate sticky **Done editing** control stays scrollable above a non-resizing keyboard stand-in. Done or handled Escape restores selected-scope focus without losing draft, recipients, kind, search or identity. IME composition Escape is ignored; menu/picker Escape remains local. No viewport-height keyboard detection. Open recipient popovers stack above Done; hidden tabs do not constrain ItemMenu placement.
- Root's **branding/zing-mark.svg** Ribbon Z path and stroke match **web/public/icon.svg** exactly. One **ZingMark** component serves desktop, mobile and connection settings; no web house mark remains. The existing standard-library PNG generator emits matching 192/512 RGBA icons, white on navy with rounded transparent corners. Output paths/semantics remain stable; native owners were given the exact public icon hashes for reuse.
- **Navy / nautical** roles are consistent across canvas/sidebar, content, metadata/placeholders, input boundaries, actions, focus, progress, menus, selections, errors/success and toast. Canvas `#F7F8FA`; ink `#18334A`; metadata/placeholders `#5E6B78`; accent `#244C6A`; hover `#18334A`; soft `#EAF0F5`; decorative line `#DCE3EA`; essential boundary `#788795`. Success is `#23764A` on `#EAF7EE`; errors are `#B42336` on `#FFF0F1`. A small aria-hidden red wordmark line adds the requested brand detail without becoming a status signal. Copy, Download, send and progress share the navy accent; launchers have no red overlay. PWA theme/background and HTML theme-color match canvas. Focus is 3 px with a gap; text input boundaries are strong, while row separators stay quiet. Shell cache is **v13**, still excluding API, text and transfer bytes. IDs, paths, saved state and transport/auth are unchanged.
- The contrast follow-up uses existing roles only: unselected navigation hover now uses soft navy (`--blue-soft`), keeping muted counts readable and the selected white surface distinct. Toast dismiss `:focus-visible` now uses the white surface outline against its dark navy parent, retaining the global 3 px width/offset and 44 px target. No palette, notification or menu behavior changed.
- Configured native clients open the feed directly from native configuration. Offline/401/403 startup and later denial retain explanatory error, Retry and explicit Settings without forced setup. Manual Settings/Advanced token recovery, explicit Disconnect, generic requiresConnection setup, browser token recovery and tokenless protected-fetch startup remain covered. No JS default origin, env/config migration or native bootstrap change: native owners initialize configuration.
- Shared ItemMenu still opens upward near the last item, clamps above fixed tabs/inside the visual viewport and scrolls internally when necessary. Scroll/resize repositioning, outside dismissal, Arrow/Home/End navigation, wraparound, disabled items and Escape focus return remain. Five-action text, file and composer menus retain at least 44 px actions.
- Compact content-first rows, light routine Copy/Download controls, full short notes, wrapping filenames and six-line collapsed long-text previews remain. Expanded DOM stays bounded at 256 KiB; Copy/editor preparation stays at 8 MiB with oversized download recovery. Short note/file fixtures remain 107/85 px and resting composer 100 px at 320/360/390/412. Ready text editing/rename remains explicit versioned Save/Cancel with conflict/draft recovery; no autosave or resend. TXT/MD attachment naming, final-extension/dotfile/255-byte UTF-8 handling and exact BOM/CRLF/Unicode text preserve earlier behavior. Shared text-file fixture/charset/UTF-8 eligibility and validation failures remain recoverable with ordinary file Download.
- Device registration preserves authoritative existing names; recipients are snapshotted for queued sends. For you/ACK history, browser notifier election, native notification ownership/targets and Android reboot/force-stop/delay notices remain. Transfer queues, bounded streaming, recovery and identity are unchanged.

## Exact paths

This contrast follow-up changes only web/src/styles.css, web/e2e/browser.spec.ts and web/FINAL-REVIEW.md, plus generated web/tsconfig.tsbuildinfo, the replacement dist files and five refreshed fixture screenshots named below. All three public launcher assets remain byte-identical to the original navy freeze; no native icon handoff is needed.

The original navy pass updated 11 paths: styles.css; e2e/browser.spec.ts; scripts/generate-icons.py; public/icon.svg, icon-192.png, icon-512.png, sw.js, manifest.webmanifest; index.html; README.md; FINAL-REVIEW.md. Combined feed/brand/palette work changes 14 paths: App.tsx, styles.css, ItemMenu.tsx, ZingMark.tsx under src/; e2e/browser.spec.ts; scripts/generate-icons.py; public/icon.svg, icon-192.png, icon-512.png, sw.js, manifest.webmanifest; index.html; README.md; FINAL-REVIEW.md, all under web/. The cumulative named web source/asset/test/doc paths are:

- web/FINAL-REVIEW.md
- web/README.md
- web/e2e/browser.spec.ts
- web/e2e/download-server.cjs
- web/index.html
- web/public/icon-192.png
- web/public/icon-512.png
- web/public/icon.svg
- web/public/manifest.webmanifest
- web/public/sw.js
- web/scripts/generate-icons.py
- web/src/App.tsx
- web/src/DeviceSettings.tsx
- web/src/FeedCard.test.tsx
- web/src/FeedCard.tsx
- web/src/ItemMenu.tsx
- web/src/ZingMark.tsx
- web/src/api.test.ts
- web/src/api.ts
- web/src/entry-editing.test.tsx
- web/src/native-platform-ui.test.tsx
- web/src/native-platform.test.ts
- web/src/styles.css
- web/src/text-files.test.ts
- web/src/text-files.ts

No native/server/root application source was changed. Existing React, ItemMenu, platform/API adapters, clipboard/text helpers and icon generator were reused. No new dependency, bitmap generation service, Agent, Git, CI, native build/device operation, system installation, persistent service change, host publication or deployment. The existing quality reviewer's bounded read-only follow-up is complete and incorporated below.

## Validation

- **This contrast follow-up:** Chromium 1243 **5/5 passed**, runner summary **11.5 s**, clean exit. The selection was `Navy nautical theme|hides feed tabs while editing|secondary text and sharing actions|phone layout fits and settings`: the extended theme case, browser and Android keyboard stand-ins, secondary-menu keys, and phone dialog focus. Command: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/phoenix/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome pnpm test:browser --grep 'Navy nautical theme|hides feed tabs while editing|secondary text and sharing actions|phone layout fits and settings' --output=test-results/zing-navy-contrast`, run from web/. Metadata: web/test-results/zing-navy-contrast/.last-run.json, passed/no failed tests. No failures or reruns.
- **This contrast follow-up:** `pnpm typecheck` passed. One final `pnpm build` passed (TypeScript and Vite; Vite **1.94 s**). No dependency installation or other build was run.
- The extended rendered-theme case really hovers an unselected Pinned row containing a count, waits for its computed soft surface, checks the muted-count pair >=4.5:1 (**4.748:1**) and preserves the selected white surface. Real Copy produces a toast; Tab from the last feed action reaches its dismiss button with `:focus-visible`. Its computed white outline/dark toast pair is >=3:1 (**13.033:1**), solid and 3 px wide with a 3 px offset; the target remains >=44×44 px, unobscured, and Enter dismisses the real toast. Existing rendered role, search/select/composer focus, branding and metadata assertions also pass. These are tested cases, not a complete accessibility audit or installed-device evidence.
- The existing quality reviewer's separate read-only follow-up confirms both original findings are resolved in source and found no regression within this bounded change. It checked the approved roles, selected/hover rule order, matching App markup, inherited outline/target dimensions and the extended interacted-state regression. It ran no tests or build; the executed checks above remain the interface owner's evidence. The report-only join continuation did not rerun implementation, tests or build.
- **Prior evidence, before these two CSS fixes:** the full unit/component suite passed **94/94 in 11 files**, 5.34 s; the original full navy Chromium suite passed **36/36**, runner summary **1.6 m**, clean exit. Prior metadata: web/test-results/zing-final-navy/.last-run.json, passed/no failed tests. Those suites were not repeated here. Their startup/auth, clipboard/editing, ACK/history/arrival, routing, transfer, menu, layout and filter coverage retains its original scope. The original navy build took 4.94 s and is superseded by the build above.
- Earlier behavior regressions reproduced mixed tabs, missing content selection and picker stacking; prior fixes and tests remain. Existing Chromium **1243** was used explicitly; default 1248 is absent and nothing was installed. API/native/notification/keyboard responses remain isolated fixtures. Prior authenticated HTTP attachment and real 9 MiB tus 8+1 MiB/SHA256 evidence was not repeated here and is not 20 GB acceptance.
- Final filesystem/hash audit passed: all 25 named cumulative source/asset/test/doc paths, generated TypeScript state, both browser-run metadata files, all 40 named navy PNG captures and five retained historical PNGs are present/nonempty; PNG signatures and 192/512 launcher dimensions pass. Exactly nine dist files match the frozen hashes; all five public/dist assets are identical; all index references resolve; all 19 matched web source-map contents equal current source. Canonical SVG geometry/stroke matches. The launcher hashes equal the original navy freeze. No build ran after the audit.

## Screenshots

The following 40 captures exist under web/test-results. This contrast follow-up refreshed only household-mobile.png, zing-editing-browser-keyboard.png, zing-editing-android-keyboard.png, zing-navy-desktop.png and zing-navy-phone.png through the five focused tests. The other 35 retain their pre-fix full navy suite scope:

- web/test-results/household-compact-desktop.png
- web/test-results/household-compact-mobile.png
- web/test-results/household-desktop.png
- web/test-results/household-empty.png
- web/test-results/household-long-file.png
- web/test-results/household-long-text.png
- web/test-results/household-mobile.png
- web/test-results/household-narrow-keyboard-layout.png
- web/test-results/household-pairing.png
- web/test-results/household-row-error.png
- web/test-results/household-transfers.png
- web/test-results/zing-arrival-denied.png
- web/test-results/zing-arrival-settings-desktop.png
- web/test-results/zing-arrival-settings-native.png
- web/test-results/zing-arrival-settings-phone.png
- web/test-results/zing-configured-native-401-phone.png
- web/test-results/zing-configured-native-403-phone.png
- web/test-results/zing-configured-native-offline-phone.png
- web/test-results/zing-device-picker-desktop.png
- web/test-results/zing-device-picker-phone.png
- web/test-results/zing-editing-android-keyboard.png
- web/test-results/zing-editing-browser-keyboard.png
- web/test-results/zing-entry-conflict-desktop.png
- web/test-results/zing-entry-conflict-phone.png
- web/test-results/zing-feed-controls-320.png
- web/test-results/zing-feed-controls-360.png
- web/test-results/zing-feed-controls-412.png
- web/test-results/zing-for-you-desktop.png
- web/test-results/zing-for-you-phone.png
- web/test-results/zing-navy-desktop.png
- web/test-results/zing-navy-phone.png
- web/test-results/zing-kind-scope-desktop.png
- web/test-results/zing-last-text-menu-long-phone.png
- web/test-results/zing-last-text-menu-long-scroll.png
- web/test-results/zing-last-text-menu-short-phone.png
- web/test-results/zing-last-text-menu-short-scroll.png
- web/test-results/zing-preconfigured-native-desktop.png
- web/test-results/zing-tailscale-settings.png
- web/test-results/zing-text-candidate-recovery-phone.png
- web/test-results/zing-text-file-phone.png

Retained historical captures: web/test-results/household-editing-overlay-layout.png, zing-iris-desktop.png, zing-iris-phone.png, zing-sea-glass-desktop.png and zing-sea-glass-phone.png predate this navy revision and are not final-build evidence. The replaced keyboard tests now write zing-editing-browser-keyboard.png and zing-editing-android-keyboard.png.

The navy desktop/phone, 320 px feed controls, Android keyboard stand-in and launcher icon were visually inspected by the interface owner during the original navy pass. The contrast follow-up relies on the new computed-role/focus assertions above. Root retains final rendered and installed acceptance; fixture screenshots do not establish real IME/Back, OS notifications, launcher masks or device behavior.

## Frozen SHA256

| Path | SHA256 |
| --- | --- |
| web/dist/assets/index-BWwY4mOY.js | cf98d95d53db8272feb3de90d7f90149b6743ece1263fccea861f06b34d4e07b |
| web/dist/assets/index-BWwY4mOY.js.map | 7647aa7ddafbdcaf9a5cab4c4afb8e907bc54aca363ff38034bba4aae14fb889 |
| web/dist/assets/index-BP1qYeCi.css | 87f18980ed1f824ee522d81ffdc0bbc7ce7776428a52925615d430c9bb9d9f43 |
| web/dist/icon-192.png | 4c63bac5d98f32f846916ab321a0d23a2b335c43294ec3c7ae279a2af373910e |
| web/dist/icon-512.png | c541ce23a945b12f5b24dcca4b47f1a8289da46e68a5a44aaeb82186b3f55641 |
| web/dist/icon.svg | da5f674585ed312b9c863fb95d62cfd2ba5cf5c712a7ffc6177b9c595709c128 |
| web/dist/index.html | 978e9dfadde6e79458b7f4b9d00f05643a7aa6d3adb6f7f40970ea70003d98d0 |
| web/dist/manifest.webmanifest | 34b61468014280a8ddd2a659fb26f40a67cb1d98c84e46d34a5b17d42820795f |
| web/dist/sw.js | dda23a17f1b9073134a90c90252d094409911d1374bbefa0c38343a751ea0543 |

## Remaining external acceptance

Both reported P2 source findings are resolved in this freeze: toast dismiss focus changed from navy-on-navy (1.438:1) to white-on-navy (13.033:1), and hovered navigation counts changed from muted-on-separator (4.212:1) to muted-on-soft (4.748:1). The focused rendered regression checks the actual interacted states and thresholds. These two findings are no longer open; no clean-complete accessibility claim is made beyond the tested cases.

No real Serve login, installed Mac/Linux/Android behavior, actual OS permission/presentation/background notifications, native IME/Back/safe areas, PWA installation or 20 GB transfer was performed by this web work. Root coordinates those checks and packaging against the final nine assets. No native package, CI, Git, service/publication/deployment action is authorized or claimed here.

Historical housekeeping: root removed the earlier untracked 114-byte empty root pnpm-lock.yaml at 16:52. My mistaken root-directory browser-script lookup at 16:53 recreated that empty file and refreshed ignored pnpm metadata before I corrected the working directory to web/. No dependency was added. That empty lockfile is absent at this contrast follow-up's read-only check; this Run made no root edits. The original mistake left the pre-existing root .vite cache and root application source untouched. This corrects the earlier progress description calling it a pre-existing retained lockfile.

Ponytail applied. Existing README retains LocalSend Apache-2.0 reference provenance; no third-party code or mark was copied. No unrelated feature, API change, Markdown renderer, file-binary editor, edit history, merge feature, dark mode or new runtime dependency was added.
