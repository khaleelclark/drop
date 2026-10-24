# Current corrective candidate — last-row delete errors

The current freeze is `web/test-results/ui-refresh/error-visibility-freeze.json`:
`index-Cak_AnQS.js`/map and `index-Dw3Gk6BF.css`. The exact old desktop error
bounds reproduced before correction; five focused Chromium checks, typecheck
and one new production build pass. Root verified 81 hash entries and 20 source
map/source matches. The error shares the confirmation scroll area and triggers
scrolling without refocusing Keep. New-asset Mac WebKit rerun, replacement
packages and installed Mac acceptance remain pending. Existing package and
Android emulator checks below describe the previous candidate only.

---

# Zing UI refresh and Mac Delete correction

24 October 2026. Application source: `efa33faeeebfac1c12866f502793d2ead89ee19e`.
Desktop shell 0.1.5; Android Tauri 0.1.7/code1007. Approved navy/white/red Ribbon Z.

The composer groups files, recipient selection and Send. The history uses a
quieter continuous list, aligned Copy/Download actions, and a full-width phone
search. On the same 390×844 fixture the first share moves from y=436 to y=308,
with four complete shares above the navigation. The desktop and phone renders
are in `web/test-results/ui-refresh/after-desktop.png` and `after-phone.png`.

Mac Delete previously lost its click when WebKit moved focus to the enclosing
feed item and unmounted the menu. Explicit `tabIndex={0}` on the shared trigger
and each menu action retains focus/click. Safe Keep focus and visible inline
confirmation are included. The final macOS WebKit check found the last-row
HTTP 500 error below the viewport; error visibility remains incomplete. No destructive action is performed
until the user presses the final Delete button.

## Evidence

- The web freeze records 9 assets and 20 exact source-map/source matches. Root
  checked all 79 recorded hashes. Retained validation: 36 units and 20 relevant
  browser cases; final focused selection 4/4 plus strengthened phone error case
  1/1; final typecheck and one local production build passed. See
  `web/UI-REFRESH-REVIEW.md` and `web/test-results/ui-refresh/final-freeze.json`.
- The baseline/attribute differential on macOS WebKit reproduced the lost click
  and isolated the focus correction. It did not pass the whole old-baseline
  flow. Final candidate Mac WebKit run: 40054960535; DMG run: 40054961984.
  Final Mac WebKit result: failed, 23/24 recorded checks passed. The last-row
  error appears at y=801.5–821.5 in an 800px viewport. Menu activation, visible
  confirmation and Keep passed in both cases; default-case retry/204/feed
  recovery passed, last-case recovery stopped at the invisible error. See
  `docs/evidence/zing-ui-refresh-macos-webkit.json`. The DMG remained in progress
  at the single root check. Existing packages predate the remaining correction;
  installed Tauri acceptance is still required on the user's Mac.
- Linux 0.1.5 package/helper inspected: architecture, package identity, launcher,
  icon, configured private origin, and all 9 actual embedded assets. No host
  installation or Linux GUI execution. See `docs/evidence/zing-ui-refresh-linux-package.json`.
- Both Android APKs passed signing with the retained certificate, 16 KiB
  ZIP/ELF alignment, manifest/native checks, and all 9 packaged and compiled
  assets. See `docs/evidence/zing-ui-refresh-android-packages.json`.
- Installed Android API36 x86_64 emulator: native text/send, exact clipboard
  paste, actual OS keyboard/Back/Done, safe navigation bounds, draft/filter
  preservation, Home/resume, explicit Settings and saved connection all passed.
  The installed APK hash matches the candidate. Fixture connection restored
  byte for byte, disposable server and ADB forwarding removed. No physical-phone
  or 20 GB acceptance is inferred. See `docs/evidence/zing-ui-refresh-android-installed.json`.

## Installation and acceptance

Quit Zing before replacing the Mac application from its matching DMG. Keep the
existing saved connection and device identity. On the Mac, use a disposable
share to check: More → Delete item opens visible confirmation; Keep retains it;
opening again and confirming Delete removes it. Check the last visible row too.
Rename through Settings should survive relaunch. These user-Mac checks remain
pending even after CI package checks succeed.

Android uses the same application ID and retained signing certificate, so the
0.1.7 APK is an update. Use `adb install -r <downloaded-arm64-apk>` for an ARM64
phone. The x86_64 APK is for the tested emulator. No app-store account is needed.
Linux uses the versioned amd64 `.deb`; its helper is packaged separately too.

No live service or browser deployment was performed. A versioned server bundle
is a deployment handoff, not evidence that the running household was updated.

## Historical evidence and package scope

Twenty-two older required evidence files are unavailable after capture-output
cleanup; the reviewer exhausted the permitted recovery locations. Their exact
inventory is retained in `docs/evidence/historical-evidence-unavailable.json`.
They remain absent and unretired. Fresh screenshots are never presented as the
originals, and whole-project/all-required-files completion is not claimed.

The aggregate `artifacts/package-manifest.json` and `artifacts/SHA256SUMS` are
stale historical receipts. Use the versioned UI-refresh manifest and immutable
Project downloads for this candidate. Source archives intentionally exclude
local state, credentials, build caches and retained runtime evidence; reports
record the evidence paths and actual checks separately.
