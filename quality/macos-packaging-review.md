# macOS packaging source review

Reviewed 2026-10-22 on Linux using the repository-local Ponytail skill. **No remaining concrete blocker found in this bounded source review.** This is a source-ready checkpoint for the packaging automation, not a successful Mac build or release acceptance.

## Scope and findings

Read `AGENTS.md`, `docs/api-contract.md`, `.github/workflows/macos-dmg.yml`, and `integrations/macos/{versions.env,build-dmg.sh,verify-dmg.sh,INSTALL.txt,README.md}`. Followed the existing desktop package/lockfiles, Tauri configuration and capabilities, app startup, native CLI entry point/data-directory selection, capture scripts, and desktop build/validation documentation.

- The earlier Command Line Tools blocker is closed: `build-dmg.sh:50–56` runs optional Xcode/CLT metadata commands in conditional branches. Full Xcode is not a prerequisite, while both mandatory `xcrun` SDK checks remain.
- The workflow maps ARM64 and Intel targets to native runner labels, pins tools/actions, grants read-only repository permission, and disables persisted checkout credentials. No workflow secret reference was found. Both pnpm trees use frozen locks; helper tests/build and the Tauri Cargo invocation use locked resolutions. The installed Tauri CLI 2.12.4 help confirms arguments following `--` go to the build runner, whose default is Cargo.
- Build/output paths match the existing app name, executable, identifier, frontend build command and target layout. The helper is signed before the modified app is re-sealed. Verification covers architecture, expected metadata, system-library linkage, strict executable/deep app signatures, signed image integrity, and the app payload read from the finished DMG mounted read-only. Cleanup preserves a failed detach as a failure.
- Packaging selects the built app/helper, capture scripts, instructions and Applications link. No per-user queue/config copy or concrete credential exposure was found in this path. The no-argument helper probe returns its usage error before `data_dir()` and does not open user state. Installed-helper paths and the optional user-owned symlink match the capture scripts and CLI launch behavior.
- `beforeBuildCommand` rebuilds `web/dist`; the build records generated asset hashes and source provenance. Final delivery still requires a package built from the integration owner's selected, reviewed redesign source. An earlier CI candidate does not establish that result.

The Bash constructs used are compatible with Bash 3.2 by source inspection. That conclusion is separate from execution with Apple's Bash. No writer-source changes were needed.

## Checks actually run

- Individual `bash -n` checks for `build-dmg.sh`, `verify-dmg.sh`, `versions.env`, `send-files.sh`, `send-text.sh`, and `send-clipboard.sh`: passed on the Linux host's Bash.
- Parsed workflow YAML with PyYAML and asserted manual/main-push triggers, both native runner/target/architecture mappings, read-only permissions, full action commit pins, disabled checkout credential persistence, and absence of workflow secret references: passed.
- Parsed app JSON and desktop pnpm lock; checked ad-hoc signing/minimum-version settings, frontend path/build command, and locked CLI version: passed.
- Ran the already installed desktop Tauri CLI's `build --help` only; confirmed Cargo argument forwarding. No build was invoked.
- `git diff --check`: passed before adding this report; report verification is recorded in the canonical handoff.

Cross-checked [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Apple's nested-code locations/signing guidance](https://developer.apple.com/library/archive/technotes/tn2206/_index.html), and [Tauri's ad-hoc signing documentation](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing). These support the source assessment; they provide no execution evidence for this app.

## Limits and remaining evidence

Only this report was written. No builds, test suites, dependency/tool installation, Git staging, service/Serve changes, emulator/device actions, or Apple commands were performed. There is no new DMG, signature, image-mount, native Mac helper-load or GUI result from this review. Actual Apple Bash/runtime behavior, both native Mac CI builds, installation/Gatekeeper approval, Finder/Shortcuts and installed lifecycle checks remain unperformed here. The macOS 11 deployment target does not prove acceptance on that OS. Transfer behavior was outside scope.
