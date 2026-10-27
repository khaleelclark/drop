#!/usr/bin/env bash
# Synthetic GUI regression only; never builds the app or touches household state.
set -euo pipefail
if [[ $# != 1 ]]; then
  echo 'Usage: test-titlebar-webview.sh NEW_OUTPUT_DIR (parent must exist)' >&2
  exit 2
fi
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Requires macOS, an active GUI/capture session and existing Apple SDK/Swift tools. No installation is performed.' >&2
  exit 2
fi
here="$(cd -- "$(dirname -- "$0")" && pwd -P)"
root="$(cd -- "$here/../.." && pwd -P)"
parent="$(cd -- "$(dirname -- "$1")" && pwd -P)"
name="$(basename -- "$1")"
[[ "$name" != . && "$name" != .. ]] || exit 2
out="$parent/$name"
[[ ! -e "$out" && ! -L "$out" ]] || { echo 'Choose a fresh output directory' >&2; exit 2; }
mkdir -- "$out"
work="$(mktemp -d "${TMPDIR:-/tmp}/drop-titlebar-webview.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
{
  sw_vers
  xcrun --show-sdk-path
  xcrun --show-sdk-version
  xcrun swiftc --version
  shasum -a 256 "$root/clients/desktop/notifications/src/macos.m" \
    "$here/test-titlebar-webview.swift" "$here/test-titlebar-webview.sh"
} > "$out/environment.txt"
# Link the production implementation, including its unchanged notification symbols.
xcrun clang -fobjc-arc -fblocks -c "$root/clients/desktop/notifications/src/macos.m" \
  -o "$work/macos.o" > "$out/compile.log" 2>&1
xcrun swiftc -swift-version 5 -framework AppKit -framework WebKit -framework UserNotifications \
  "$here/test-titlebar-webview.swift" "$work/macos.o" -o "$work/test-titlebar" >> "$out/compile.log" 2>&1
"$work/test-titlebar" "$out" > "$out/runner.log" 2>&1
