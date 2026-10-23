# Final web review — connection settings and phone navigation

The replacement web source and nine production files are frozen for root’s packaging and independent acceptance. The new JavaScript is `index-D_HQx3BY.js`; this freeze supersedes the contrast freeze `index-BWwY4mOY.js` and all earlier web freezes. The reported editing-state latch is reproduced and corrected in web source/fixtures. Actual recovery on the affected phone is not established by these checks; installed Android Back recovery also requires the coordinated native event described below.

## Implemented

- Generic installed clients open the inbox shell even with no saved server or an explicit disconnected state. A nonblocking message exposes **Configure connection**, while connection settings remain available in the header/sidebar. No initial connection modal or fake connected status appears. Missing server settings start blank; disconnected saved addresses remain available. The existing native configuration store remembers explicitly saved settings. Household-default and already configured builds still open the feed directly.
- Native startup feed requests are deferred until configuration exists. The adapter independently rejects native API requests when configuration is absent/disconnected, including after explicit Disconnect. It exposes no baseURL for an absent address. Reading the durable native transfer queue remains available. Browser same-origin authentication, token recovery, and configured native offline/401/403 Retry/Settings behavior are preserved. Optional app tokens stay behind Advanced and are not persisted by web code.
- Explicit Disconnect returns an installed client to the inbox shell without automatically reopening Settings. Explicit Settings opens an accessible dialog; its opener is captured before autofocus so Escape/close can return focus. The connection form still performs an authenticated protected fetch before declaring success. Identity, recipients, queue state and the existing native configuration format are unchanged.
- Phone tabs still hide during text editing. Blur outside text fields/composer/picker/edit toolbar, window blur, or document background clears the editing mode. Focus can move through composer actions to **Done editing** without prematurely removing that keyboard target. Done/handled Escape restores selected-scope focus; IME-composition Escape and local menu/picker Escape remain local.
- A validated boolean native Android IME-hidden event clears editing even when Back retains DOM field focus and neither viewport resizes. IME-visible events can hide tabs again while a workspace text field remains focused. These event/lifecycle handlers do not move focus, clear drafts, change recipients, scope, content kind, search or identity. Malformed payloads and events in browser mode are ignored. There is no keyboard-height/viewport heuristic.
- **All shares / For you / Pinned** and the independent **All types / Text / Files** dropdown remain. The approved navy palette, shared Ribbon Z, 44 px targets, safe-area policy, menu behavior, notifications, bounded text/copy/editing, uploads/downloads and server API are unchanged. All three launcher assets remain byte-identical; no icon regeneration/native icon copy is required. Shell-only cache remains v13.

## Android contract and requirements

The shared event is a `window` CustomEvent named `household-keyboard-visibility` with exactly `detail: {visible: boolean}`. Web consumes it only when the runtime is native and bootstrap has marked `data-native-android`. Native source samples actual `rootWindowInsets.isVisible(WindowInsets.Type.ime())` on API30+, emitting the first known state, transitions, and current state after attachment, Activity resume or window-focus gain. Unknown/unavailable visibility emits nothing. The event contains no content, field, token or dimensions and is not persisted/replayed across WebView reload or late listener registration.

Minimum Android app support remains **API26**; genuine typed IME visibility requires **API30 / Android 11**. **API26–29 emits no guessed IME state:** web blur, Done and background recovery remain available, but Back with retained focus and a non-resizing overlay keyboard is not guaranteed. Older installed APKs without the new event likewise have only those web recovery paths. New web assets and the coordinated native source must be packaged together for API30+ Back recovery. No new web dependency/toolchain is required; existing project Node/pnpm dependencies, React19, TypeScript5.7 and Vite are used. Native source requirements recorded by its owner are JDK17, compile/target SDK36; those native checks were not executed by the interface owner.

Root authorized Tauri Android source **0.1.6/code1006**; standalone remains **0.1.5/code6**. App IDs, signing paths and data remain native-owned. Native source report: `clients/android/validation/keyboard-visibility-0.1.6-source.json`. The interface owner inspected the report’s contract/requirements and matching shared policy, and directly verified the following interoperability source/test hashes; this is not a native build/device audit:

| Path | SHA256 |
| --- | --- |
| clients/android/app/src/main/java/household/share/android/AppWebViewPolicy.kt | 327d5ef756504370187bbdbeefd00d87786c28ed403ff112401ce3b7edcef116 |
| clients/android/app/src/test/java/household/share/android/AppWebViewPolicyTest.kt | 0fd09cb2d239059065007491d2f0c7a5a86f5db23757070db72e280ffeb63076 |

## Exact paths and source/test hashes

This follow-up edits the seven source/test/doc files in the next table plus this report. Generated outputs are `web/tsconfig.tsbuildinfo`, nine dist files, focused browser metadata/traces and the screenshots/evidence named below. `web/src/styles.css` remains `4faf9bb07ab8e67003cf0d1b5ae5d80afbe7093ca678feae6f2bfbcf63b82c62`. No root/server/native source was edited by the interface owner.

| Path | SHA256 |
| --- | --- |
| web/src/App.tsx | 5e1c271446c77a8279ba1b51e1e3d6995a0949256fd6e71535abc4c6428d63a0 |
| web/src/native-platform.ts | 467fd5c3e3d53021173e9a1ec0c95d6f4e09f47a6414916f59a6c60aaf93fdde |
| web/src/native-platform.test.ts | 8b01549cab82f12c1bd3286a57ec43768b3cf830b4537af918bbfb944ccca00c |
| web/src/native-platform-ui.test.tsx | 2a3a9abb210f5a9b7008495feac0f622112ebd96423a060ab7a7379d45bed86a |
| web/src/bootstrap.test.tsx | c59ace0deeb5edf12cbdd9da6e198f842908fec195331da088a770e28eb09d1d |
| web/e2e/browser.spec.ts | 07c1e83560fa41a268e034f6514596d7d18fcce6e5ed7027dad7087df1749ff7 |
| web/README.md | 95ae7b407ff34adbd6f1e4348b7b8ab59bcecee7cc050265700e20be458e9b8d |

The cumulative explicitly named web source/asset/test/doc deliverables are:

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
- web/src/native-platform.ts
- web/src/bootstrap.test.tsx

## Validation actually run

- Final current-source Chromium1243 selection: **15/15 passed, 30.1 s**, clean exit. From web/: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/phoenix/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome pnpm test:browser --grep 'native (missing|disconnected) connection|configured native startup|phone layout fits|applies safe areas once|hides feed tabs while editing|narrow layouts|content kind sits|Tailscale browser|Navy nautical theme|secondary text and sharing actions' --output=test-results/zing-connection-navigation-final`. Metadata: `web/test-results/zing-connection-navigation-final/.last-run.json`, passed/no failed tests.
- The two new missing/disconnected startup cases verify shell/no auto modal, no native API calls while unconfigured, explicit Settings/Advanced, Escape focus return, saving one address, reload without reconfiguration, scope/kind preservation and explicit Disconnect/reload without reconnection. Browser API requests remain absent in native fixtures.
- Browser/native keyboard cases verify non-resizing overlay constraints, ordinary blur versus real-IME event stand-ins, retained input focus on Android hide, unchanged viewport dimensions, all three restored targets hit-tested, malformed/non-native events ignored, visible events rehide, Done/Escape/menu keys and same DOM/draft/recipient/scope/kind preservation through a background/resume stand-in. These use mocked keyboard/native/lifecycle signals, not real IME/Back/Home execution.
- Relevant final adapter/UI/bootstrap unit/component selection: **24/24 passed across 3 files, 2.74 s**. Exact command: `NODE_ENV=test pnpm exec vitest run src/native-platform.test.ts src/native-platform-ui.test.tsx src/bootstrap.test.tsx`. It includes the new independent no-config/after-disconnect transport guard and installed-shell startup assertions without browser fallback.
- `pnpm typecheck` passed after the final source correction. One final `pnpm build` passed (TypeScript and Vite6.4.5; Vite **2.20s**, 1619 modules). No production build was repeated after the final audit.
- Initial focused browser attempt: **12/15 passed**. Two new Settings cases exposed lost opener focus, fixed by capturing the opener before autofocus. The narrow test expected the old Done latch after disabled-field blur; it now starts a fresh editing cycle for its Done check. Recovery selection **5/5 passed, 15.3 s**, followed by the final 15-case pass above. Initial failure metadata/traces remain in `web/test-results/zing-connection-navigation/`; recovery metadata is `web/test-results/zing-connection-navigation-recovery/.last-run.json`.
- Unit command corrections are recorded honestly: `pnpm test -- <three paths>` ignored its filter and ran an intermediate-source full **95/95 in 11 files, 3.42 s**. A subsequent raw targeted command omitted required `NODE_ENV=test`, causing production-React/Node-fixture setup failures. The exact targeted command above then passed without dependency or test-environment source changes. No further full unit suite was repeated.
- The existing quality reviewer inspected the bounded current source/tests and found no new material blocker. It confirmed editing/lifecycle/event recovery, generic native shell/deferred transport, opener focus return and the relevant regression assertions. Read-only source inspection only; no tests/build, production-byte, native-delivery or phone validation by that reviewer.
- Prior source evidence remains scoped: original full navy browser **36/36 (1.6 m)** and units **94/94 (11 files, 5.34 s)** predate these fixes. The contrast pass **5/5 (11.5 s)** and 1.94 s Vite build also predate this freeze. Full browser 36 was not repeated. Prior authenticated HTTP attachment and real 9 MiB tus 8+1 MiB/SHA256 evidence were not repeated and do not establish 20 GB acceptance.
- Current focused theme assertions still pass the two resolved contrast pairs: hovered nav-count muted-on-soft **4.748:1 >=4.5** and keyboard-focused real toast dismiss white-on-navy **13.033:1 >=3**, preserving solid 3 px outline/3 px offset, 44 px target, hit testing and Enter dismissal. No complete accessibility claim is made.

## Baseline investigation and evidence scope

The exact imported ARM64 0.1.5 APK was 29,690,485 bytes, SHA256 `fb91e5795f61b1d0d2fb6cb4e498f649d14d7d3f49f0dae33548d28893ea9bc1`. Before source changes, its nine assets/web files and 19 source-map contents matched the then-current contrast freeze, including device-width/initial-scale1/viewport-fit metadata and expected tab CSS/markup. The new JS/map/index below supersede those bytes; the old APK does not contain this fix. Android’s separate read-only DEX/ELF investigation reported matching embedded frontend and policy with no established native viewport defect; those native checks were not repeated by the interface owner.

A routed production-bundle diagnostic reused nativeFixture in a Chromium mobile/touch Android-user-agent context, DPR 3, 806 px height. Baseline tabs were 72 px high at y=734 with three visible >=44px hit-tested targets at widths 320/360/412/600/800; widths 801/980 deliberately chose the sidebar. CSS layout zoom 150/200% kept all three targets visible. Forced pageScale 2 reduced the visual viewport to 206×403 while the bar remained at layout y=734; native disables zoom, so this forced condition is not the user’s confirmed cause. Focus then BODY blur reproduced the old editing latch; Done restored it. The source fix addresses that supported latch without asserting every cause of missing phone navigation is resolved.

Synthetic 24 px/36 px tab-label text at 320 px kept every button present, but two-line All shares reached y=818, 12 px below the 806 px viewport. This secondary label clipping remains open. It neither reproduces loss of all buttons nor establishes actual Android textZoom behavior.

Baseline records (before this fix):

- web/test-results/zing-navigation-diagnostic.json
- web/test-results/zing-navigation-diagnostic/.last-run.json
- web/test-results/zing-navigation-resting-native-standin.png
- web/test-results/zing-navigation-after-blur-native-standin.png
- web/test-results/zing-navigation-after-done-native-standin.png

The pre-fix diagnostic existing-browser selection passed **7/7, 19.3 s**. Baseline screenshots were visually inspected; they are historical production-bundle stand-ins, not new-source or device evidence.

## Screenshots

The final 15-case source-fixture run refreshed 14 retained screenshots: household-mobile.png; household-long-file.png; household-narrow-keyboard-layout.png; zing-configured-native-offline-phone.png; zing-configured-native-401-phone.png; zing-configured-native-403-phone.png; zing-editing-browser-keyboard.png; zing-editing-android-keyboard.png; zing-feed-controls-320/360/412.png; zing-tailscale-settings.png; zing-navy-desktop.png; zing-navy-phone.png. Two new captures are `web/test-results/zing-native-missing-inbox.png` and `web/test-results/zing-native-disconnected-inbox.png`; they show the unconfigured shell after selecting Pinned, including still-visible phone tabs, and were visually inspected. The three baseline diagnostic captures above retain their pre-fix scope. Other retained screenshots below remain prior evidence; none is a new APK capture.

The original 40 retained named captures are:

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

Five historical captures also remain: `web/test-results/household-editing-overlay-layout.png`, `web/test-results/zing-iris-desktop.png`, `web/test-results/zing-iris-phone.png`, `web/test-results/zing-sea-glass-desktop.png`, `web/test-results/zing-sea-glass-phone.png`. Iris/SeaGlass remain historical. Root owns final rendered and installed acceptance; web fixture screenshots do not establish actual IME/Back, OS notifications, launcher masks or household-device behavior.

## Frozen SHA256

| Path | SHA256 |
| --- | --- |
| web/dist/assets/index-BP1qYeCi.css | 87f18980ed1f824ee522d81ffdc0bbc7ce7776428a52925615d430c9bb9d9f43 |
| web/dist/assets/index-D_HQx3BY.js | da441faccc97752466c33c108cc620ee4d990a68eb12cfbf1a595b8d3af64a20 |
| web/dist/assets/index-D_HQx3BY.js.map | 5f3db9b5519ac71c844b98347cf195eab4ea6c4aae40dee4c989ce9007e864ad |
| web/dist/icon-192.png | 4c63bac5d98f32f846916ab321a0d23a2b335c43294ec3c7ae279a2af373910e |
| web/dist/icon-512.png | c541ce23a945b12f5b24dcca4b47f1a8289da46e68a5a44aaeb82186b3f55641 |
| web/dist/icon.svg | da5f674585ed312b9c863fb95d62cfd2ba5cf5c712a7ffc6177b9c595709c128 |
| web/dist/index.html | e6b1fc4ace241f4a1e4b2ecc0395fb441d2531939e582a12fd090e625b45d332 |
| web/dist/manifest.webmanifest | 34b61468014280a8ddd2a659fb26f40a67cb1d98c84e46d34a5b17d42820795f |
| web/dist/sw.js | dda23a17f1b9073134a90c90252d094409911d1374bbefa0c38343a751ea0543 |

All named deliverables and evidence are directly checked as present/nonempty at final handoff. The audit checks PNG signatures/launcher 192×192 and 512×512 dimensions, exactly nine dist files, all table hashes, public/dist equality for all five public assets, index-reference resolution and all 19 compiled web source-map contents against current source. The CSS and three launcher hashes match the prior contrast freeze. No further source edits/build are planned after this freeze.

## Remaining work and limitations

Root owns the versioned replacement APK/package, actual API30+ IME Back with retained DOM focus/unchanged viewports, draft/scope/kind preservation, Home/resume, and the affected household phone. This web freeze alone does not prove the user’s APK/device defect resolved. API26–29 and older native shells lack the new reliable IME signal and retain the partial fallback described above. Synthetic 320 px doubled-label clipping remains open. No clean-complete accessibility/mobile claim is made beyond tested cases.

No real Serve login, installed Mac/Linux/Android, native package, actual OS permission/presentation/background notification, real IME/Back/safe-area behavior, PWA installation or 20 GB transfer was executed by this web work. The exact 0.1.5 APK read was an archive/source-map comparison. Native owner checks are separately attributed in its source record; the interface owner did not run native/JVM suites, package builds, ADB/device operations or installation.

Ponytail applied. No new dependencies, Agents, toolchains/OS packages, Git/CI, persistent services, deployment, publication, server/root/native edits by this owner. Existing test runners used their temporary loopback fixtures; the baseline routed diagnostic needed no server. README retains LocalSend Apache-2.0 reference provenance; no third-party code/mark was copied. No unrelated feature, API mutation, Markdown renderer, binary editor, edit history or dark mode was added.
