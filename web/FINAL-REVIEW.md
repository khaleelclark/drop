# Final web review — shared Zing board

This replacement build fixes the last text entry’s five-action menu clipping below the bottom tabs. It supersedes the index-DByv_fP3.js / 16bb81fa… text-file/filename/reboot freeze and all earlier freezes. All prior shared-text fixture, UTF-8, suffix/dotfile/255-byte filename and Android reboot notices remain included. Product sources and the nine dist files are frozen; root owns installed acceptance, live integration and packaging.

## Implemented

- Shared ItemMenu measures the visual viewport and fixed bottom-tab boundary before focusing. It opens upward when downward space is insufficient, clamps within the available vertical space and scrolls internally on very short viewports. Scroll/resize and visual-viewport changes reposition the open menu. Existing outside dismissal, Escape focus return, Arrow/Home/End navigation, disabled-item handling, file/sharing menus and 44 px targets are retained. Shell cache is v9.
- Routine Copy/Download/composer controls use subtle icons or icon/label actions with 44 px hit areas. Ordinary notes use the available full width; long code is collapsed to at most six visual lines with obvious inline Expand/Collapse, no default internal scroll, and a separate 256 KiB expanded DOM cap. Filenames wrap; text entry names appear in metadata. Short two-line note/file fixtures measure 107/85 CSS px at 320/360/390/412; resting composer remains 100 px.
- Ready text entries support explicit inline Save/Cancel, and all ready entries support rename. The opening updatedAt is captured before full-body fetch and retained through refresh, conflict and failure. Versioned PATCH is never autosaved/retried or resent as a new entry. Conflicts preserve the draft and provide an explicit reload/replacement action. File bodies and text above 8 MiB use rename/download rather than a whole-body editor. Edits check 8 MiB decoded and 40 MiB encoded budgets. Existing textarea helpers preserve BOM, Unicode, CRLF, tabs and whitespace. Empty replacement text is allowed.
- Text/Markdown/code keeps visible Copy (disabled with clear download recovery above the preparation budget). File metadata candidates exactly match the root-owned shared allowlists/10 cases, including explicit non-UTF-8 charset rejection. Eligible files up to 8 MiB visibly say Prepare copy until full validated preparation succeeds; then they expose Copy and retain ordinary Download. Larger/unsupported files keep Download. Server validation failure and fatal UTF-8 errors keep preparation recoverable without announcing Copy; they support rename only. Text TXT/MD exports preserve original bytes, use browser /download?format=txt|md navigation, or native itemId downloads with the matching suggested extension. Suggested filenames replace the final non-leading extension, preserve dotfiles and truncate only the UTF-8 stem within 255 bytes; file entries never offer a TXT/MD selector. No huge Blob or new native command.
- Browser protected-fetch startup opens directly through authenticated Serve with no session/form/token requirement. Installed setup accepts an origin/name and empty token via the existing native command, then verifies the protected feed. Optional token entry is behind Advanced; 401 and network failures retain recovery. No browser token persistence, secret URL, auth-mode invention, CORS relaxation or browser fallback from native. Disconnect explains local state versus Tailscale revocation.
- Startup/reconnect registration now passes preserveExisting=true and uses returned authoritative labels. Explicit name saves alone use normal upsert. Native persisted notification targets also have a bounded single-flight five-second check for already-focused clicks. Existing recipient snapshots, For you, elected browser notifier, cursor-before-ACK, native ownership, safe-area/keyboard/navigation/transfer behavior remain covered. Android scheduled settings/help explicitly require reopening after reboot as well as force-stop, with periodic delays and no 15-minute delivery promise. Shell cache is v9; API/text/transfer bytes remain excluded.

## Exact changed paths

- web/src/App.tsx
- web/src/DeviceSettings.tsx
- web/src/text-files.ts
- web/src/text-files.test.ts
- web/src/FeedCard.tsx
- web/src/api.ts
- web/src/styles.css
- web/src/ItemMenu.tsx
- web/src/FeedCard.test.tsx
- web/src/api.test.ts
- web/src/native-platform.test.ts
- web/src/native-platform-ui.test.tsx
- web/src/entry-editing.test.tsx
- web/e2e/browser.spec.ts
- web/e2e/download-server.cjs
- web/public/sw.js
- web/README.md
- web/FINAL-REVIEW.md (this handoff)

Generated: web/tsconfig.tsbuildinfo and the nine files below. No other owner source was edited. No dependencies, browsers, SDKs or toolchains installed; no new Agent, Git, native build, CI, device/emulator, host publication or deployment operation.

## Validation

- Final unit/component suite: 90 tests / 11 files passed (2.24 s). Includes exact shared application/extension allowlists and all 10 fixture cases, malformed/non-UTF-8 charset rejection, fixed suffix/dotfile/Unicode 255-byte filename rules, unchanged kind=text semantics, opening-version/body-fetch races, remote refresh/conflict/reload, exact draft Save/Cancel, rename-only large/file cases, native PATCH/conflict/download commands, decoded/encoded overflow, invalid UTF-8/lengthless response overflow, URL-only native connection and protected-fetch rejection with zero browser transport.
- Chromium 1243: all 29 tests passed (runner summary 1.1 m), clean exit. Final metadata: web/test-results/zing-final-menu-placement/.last-run.json, status passed/no failed tests. The two new cases cover last five-action text menus on short (three entries) and long (nine entries) feeds at 412×839, 320×420 and 320×240. Every menu stays above the fixed tabs and inside the viewport; all five actions are uncovered, at least 44 px tall and reachable with Arrow/Home/End, with wraparound and Escape focus return. At 240 px height the bounded menu scrolls internally. Before the fix the new 412×839 regression failed with menu bottom 910 > tab top 767, reproducing root’s installed finding. Both targeted cases then passed (5.8 s) before the full suite. New browser evidence covers visible Prepare copy until validated success, recoverable 415/not_text and invalid UTF-8 responses, exact BOM/CRLF/Unicode clipboard, charset/large-file Download-only recovery, no file-format menu and Android reboot settings/help. All earlier editing/auth/device/arrival/density/keyboard/streaming fixtures pass.
- TypeScript plus Vite production build passed; Vite 1.75 s. Existing Chromium executable was used; no install.
- Filesystem audit: 18 changed source/test/doc files (including this report) above verified nonempty; exactly nine nonempty dist files, every public asset equals its dist copy, and all index references resolve. All 29 root review PNGs exist, are nonempty and have valid PNG signatures.
- Browser fixtures exercise actual DOM, clipboard, authenticated HTTP attachment bytes, and a real 9 MiB tus client upload in 8 MiB + 1 MiB chunks with matching SHA256. They include 320/360/390/412 layouts, long names, all primary hit areas, menus/dialogs, retained composer/search drafts and focus, safe-area aliases and non-resizing keyboard occlusion stand-ins. Device/arrival/auth/edit APIs are isolated contract fixtures. OS notifications/native commands are doubles.

## Review screenshots

- web/test-results/household-compact-desktop.png
- web/test-results/household-compact-mobile.png
- web/test-results/household-desktop.png
- web/test-results/household-editing-overlay-layout.png
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
- web/test-results/zing-device-picker-desktop.png
- web/test-results/zing-device-picker-phone.png
- web/test-results/zing-entry-conflict-desktop.png
- web/test-results/zing-entry-conflict-phone.png
- web/test-results/zing-for-you-desktop.png
- web/test-results/zing-for-you-phone.png
- web/test-results/zing-tailscale-settings.png
- web/test-results/zing-text-file-phone.png
- web/test-results/zing-text-candidate-recovery-phone.png
- web/test-results/zing-last-text-menu-short-phone.png
- web/test-results/zing-last-text-menu-long-phone.png
- web/test-results/zing-last-text-menu-short-scroll.png
- web/test-results/zing-last-text-menu-long-scroll.png

Selected desktop/phone compact, picker, For you, arrival settings, Tailscale settings, conflict editor, long-file and candidate-recovery screenshots were visually reviewed by the interface owner. The new short-feed phone menu and long-feed 240 px scrolling menu screenshots were also visually inspected. Root performs final rendered and installed acceptance. Desktop conflict screenshot is refreshed full-page so its recovery message is visible.

## Frozen SHA256

| Path | SHA256 |
| --- | --- |
| web/dist/assets/index-Bn7PZLMa.js | 4b4c5a4b1f78ce5f887cce213fc10f40121f7dad403cedb69901cd247732895d |
| web/dist/assets/index-Bn7PZLMa.js.map | bcec0b53aa4730f022fb702f220ccd63347461905bac48f6815643917507d0f8 |
| web/dist/assets/index-CeynTtsM.css | 866083b32f69558eb09ce93f3f4ae31217b0ccb85a98f10a2e8ba556510b01cc |
| web/dist/icon-192.png | 26418045ba5cc927416d455f6e1f56fc7ea0f9d6f6ce2b8a843a943b3bead594 |
| web/dist/icon-512.png | 504726f443008617b8e9aa5bdbf4b8f671de095695df5327f653e7f7252df128 |
| web/dist/icon.svg | 8f90ee82fcc9b982325a501f44a0e339dbfc581073130780ee24bc61c95bb546 |
| web/dist/index.html | f220506595fc3b3eb1fb209e4f0121505856c90b2c735cf2e7ce7ff34aa31e4c |
| web/dist/manifest.webmanifest | acd23a7869d887a9f2a249af9a1ca1215137d50452e2f870a3fdebd0c3661095 |
| web/dist/sw.js | 20ba0fdc9d7ff2f3f7152aae2d58af629edf8a6c596b184155a8a7267bad2f73 |

## Remaining external acceptance

No real Serve login, installed Mac/Linux/Android, actual OS permission/presentation/background notifications, native IME/Back/safe areas, PWA installation or 20 GB transfer was performed by this web work. Native bridge fixtures and browser occlusion/insets are not device validation. Root coordinates live server/native integration, visual approval and final packages against this exact freeze.

This narrow menu fix changes exactly six paths: src/ItemMenu.tsx, src/styles.css, e2e/browser.spec.ts, public/sw.js, README.md and this report, all under web/. Generated tsconfig.tsbuildinfo and the nine dist files are also replaced. No native/server/root source was changed. No new feature, API, dependency, Agent, installation, Git, CI, native build, device operation, host publication or deployment was performed. Root’s reported pre-fix installed API36 keyboard/Back/menu measurements are separate evidence; this fix has browser evidence and requires root’s installed recheck.

Existing LocalSend reference provenance remains in README: pinned Apache-2.0 reference; no code/assets copied or adapted. Existing React, ItemMenu, API/platform adapters, clipboard helpers and textarea helpers were reused. No Markdown rendering, conversion, edit history, merge feature, file-binary editor or extra runtime dependency was added.
