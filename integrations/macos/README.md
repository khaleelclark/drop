# macOS capture

These scripts make durable **local queue** captures. They never make a whole-file HTTP request or block for upload completion. Text streams into one owned staging file; file sends preserve the original path and identity rather than duplicating a large file. Keep original files in place until their transfer completes.

Install **Household Share.app** and configure the server/token once in the app before capturing. The DMG build bundles its signed capture helper at `Household Share.app/Contents/Helpers/household-share-cli`; a plain Tauri source build still needs the separately built helper from `clients/desktop/native`. The CLI writes to the same per-user data directory, then asks Launch Services to open the installed app in background. A running app consumes the spool without opening a window. If app launch fails, the capture remains queued until the app is opened. Closing its window leaves it running; explicit Quit pauses transfers.

The scripts use `~/.local/bin/household-share-cli` by default. After dragging the DMG app to `/Applications`, create a user-owned link without replacing any existing helper:

```sh
mkdir -p "$HOME/.local/bin"
ln -s "/Applications/Household Share.app/Contents/Helpers/household-share-cli" \
  "$HOME/.local/bin/household-share-cli"
```

If that destination already exists, inspect it and explicitly choose whether to keep or replace it. Alternatively, replace the `cli=...` line in each pasted script with `cli="/Applications/Household Share.app/Contents/Helpers/household-share-cli"`. For a per-user installation use `$HOME/Applications/Household Share.app/...` instead. Copying the scripts from `Contents/Resources/capture` does not install a Quick Action automatically. The bundle helper is already ad-hoc signed; a symlink does not modify its signature.

## Finder Quick Action

1. In Automator, make a Quick Action receiving **files or folders** in **Finder**.
2. Add **Run Shell Script**, shell `/bin/bash`, input **as arguments**.
3. Paste the contents of `send-files.sh`. Save as **Send to household**.
4. Right-click files → Quick Actions → Send to household. Folders are deliberately rejected; archive them first.

`"$@"` preserves spaces, newlines, Unicode and shell metacharacters. Do not replace it with a command string, `eval`, unquoted expansions, or an HTTP upload. File size, modification time, file identity and sampled contents are captured. Missing/changed originals produce a visible transfer error.

## Text and Shortcuts

Create a Shortcut accepting text and expose it in the share sheet where desired. Use **Run Shell Script** with input **to stdin**, and paste `send-text.sh`. Do not place the Shortcut input in an interpolated shell command. For a keyboard shortcut sending the clipboard, run `send-clipboard.sh`. Text is captured as UTF-8 from stdin and uploaded through the resumable text-file route; invalid UTF-8 is rejected by the server.

For file inputs to a Shortcut, pass real persistent paths as separate arguments to `send-files.sh`. Temporary export files from other apps may disappear after the Shortcut returns: first save them to a durable user-owned location, then enqueue that saved file. This version does not pretend temporary export paths become durable automatically.

The app global shortcut `Command+Shift+H` opens its composer; the explicit clipboard script sends the clipboard. Shortcut permission prompts and exact share-sheet input types must be checked in the actual apps.

## Local installation

The `.github/workflows/macos-dmg.yml` workflow builds separate Apple Silicon/Intel installers using the existing app. A push affecting Mac/desktop/web build inputs on `main`, or **Actions → macOS DMG → Run workflow**, starts the native Mac jobs. Each build records the source commit and generated frontend hashes. Download the matching `household-share-macos-arm64` or `household-share-macos-x86_64` artifact for the accepted source, verify `SHA256SUMS`, open its DMG, drag the app to Applications and eject the image before launching it. Read `INSTALL.txt` inside the image.

The current **0.1.1 Apple Silicon and Intel packages** were accepted against clean source `57e26b4e8707eff13dabb5725d15b1ec7c67c6e4`, successful run `39878431406` / jobs `120169690452` (ARM64) and `120169690572` (Intel). The retained installers are:

| Installer | Bytes | SHA-256 |
| --- | ---: | --- |
| `artifacts/macos/0.1.1/aarch64-apple-darwin/Household-Share_0.1.1_arm64.dmg` | 9,064,284 | `8d86401ff54f6c98ef82f80eff73031c3867466be9e4a4156279848bf4203c6c` |
| `artifacts/macos/0.1.1/x86_64-apple-darwin/Household-Share_0.1.1_x86_64.dmg` | 9,532,266 | `07d430cdcd9c43920bba1860c460fe2c64ab06ea5103b3d30d3246fe0c52ea60` |

Both packages use the approved CS6EIQOV/DVPjc1UT frontend freeze, including the mobile bottom tabs. At acceptance, each complete 9-file manifest matched the actual frozen `web/dist`. Actual Mac logs for **each architecture** record **17 native tests passing** (4 core + 13 protocol), ad-hoc app/helper/image signature checks, read-only DMG mount/layout verification, and native helper usage execution. The native lead's bounded independent Linux review streamed both DMG digests, compared both complete manifests and read the retained native evidence without finding a concrete package/evidence blocker. Mac execution conclusions rely on those logs and audited packaging scripts; root verified CI job/ZIP provenance. See [desktop validation](../../clients/desktop/VALIDATION.md#accepted-current-mac-packages) for exact asset hashes and evidence boundaries. The earlier accepted 0.1.0 BRmFLqLf/BJCLriK5 ARM64 package remains documented as history there. Package acceptance is tied to this exact source/freeze, not future changes to `web/dist`.

No Apple developer account is required. The Tauri configuration and packaging script use local ad-hoc signing (`signingIdentity: "-"`), without notarization. A browser-downloaded app may require a per-app approval in **System Settings → Privacy & Security → Open Anyway** after an initial launch attempt; follow [Apple's current instructions](https://support.apple.com/en-us/102445). Do not disable Gatekeeper globally. For a separate source-built CLI only, sign locally as needed using `codesign --force --sign - ~/.local/bin/household-share-cli` after building it on that Mac.

To build the DMG locally, use `bash integrations/macos/build-dmg.sh aarch64-apple-darwin` on Apple Silicon or `x86_64-apple-darwin` on Intel from the repository root. Prerequisites must already be installed: Xcode command-line tools/SDK, Node 24.16.0, pnpm 11.10.0 and Rust 1.99.1 (exact pins in `versions.env`). The script installs only locked project dependencies. Hosted CI provisions pinned project tools in the disposable runner and reuses its Apple SDK; no system package/SDK install is performed on the Linux workspace. See `clients/desktop/README.md` for artifact paths, verification commands and the native build/test/signing details.

The earlier Linux shell/YAML/source checks remain historical in `clients/desktop/VALIDATION.md`; current native package evidence exists separately for both architectures. Installed GUI launch/lifecycle, quarantined-download Gatekeeper approval, Finder/Shortcuts, native clipboard/dialogs, physical household Macs/Tailscale, close/sleep/background behavior, macOS 11 runtime compatibility and Mac 20 GB transfers remain untested. The packaging script does not launch the GUI. No Share extension, launchd user agent, sleep transfer guarantee, or notarization is claimed.
