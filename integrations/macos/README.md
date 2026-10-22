# macOS capture

These scripts make durable **local queue** captures. They never make a whole-file HTTP request or block for upload completion. Text streams into one owned staging file; file sends preserve the original path and identity rather than duplicating a large file. Keep original files in place until their transfer completes.

Build/install `household-share-cli` from `clients/desktop/native` into `~/.local/bin/household-share-cli` and install the locally built **Household Share.app**. Configure the server/token once in the app before capturing. The CLI writes to the same per-user data directory, then asks Launch Services to open the installed app in background. A running app consumes the spool without opening a window. If app launch fails, the capture remains queued until the app is opened. Closing its window leaves it running; explicit Quit pauses transfers.

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

No Apple developer account is required. The Tauri configuration requests local ad-hoc signing (`signingIdentity: "-"`). Follow the normal macOS local security approval if prompted. Do not disable Gatekeeper globally. Sign the CLI locally as needed using `codesign --force --sign - ~/.local/bin/household-share-cli` after building it on that Mac.

These workflows and ad-hoc packaging have **not** been run on macOS in this Linux workspace. No Share extension, launchd user agent, sleep transfer guarantee, or notarization is claimed. See `clients/desktop/README.md` for build instructions and the validation matrix.
