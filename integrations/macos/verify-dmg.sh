#!/bin/bash
# Strict native architecture, ad-hoc signature, resource seal and DMG verification.
# Does not launch the GUI or modify system trust/quarantine settings.
set -euo pipefail
die() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || die 'DMG verification requires macOS. No native verification was performed.'

verify_app() {
  local app=$1 arch=$2 binary signature dependencies line dependency
  [[ -d "$app" ]] || die "Missing app bundle: $app"
  plutil -lint "$app/Contents/Info.plist"
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" == net.household.share ]] || die 'Unexpected app identifier.'
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")" == household-share ]] || die 'Unexpected main executable.'
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app/Contents/Info.plist")" == 11.0 ]] || die 'Unexpected deployment target.'
  for binary in "$app/Contents/MacOS/household-share" "$app/Contents/Helpers/household-share-cli"; do
    [[ -x "$binary" ]] || die "Missing executable: $binary"
    [[ "$(lipo -archs "$binary")" == "$arch" ]] || die "Unexpected architecture in $binary"
    codesign --verify --strict --verbose=2 "$binary"
    signature="$(codesign --display --verbose=4 "$binary" 2>&1)"
    printf '%s\n' "$signature"
    [[ "$signature" == *Signature=adhoc* ]] || die "Expected ad-hoc signature: $binary"
    dependencies="$(otool -L "$binary")"
    printf '%s\n' "$dependencies"
    # The current app/helper use Apple system libraries only. Fail rather than ship a
    # Homebrew/local dylib dependency that happens to exist on the build machine.
    while IFS= read -r line; do
      case "$line" in
        *' (compatibility version '*)
          dependency="${line%% (compatibility version *}"
          dependency="${dependency#"${dependency%%[![:space:]]*}"}"
          case "$dependency" in
            /usr/lib/*|/System/Library/*) ;;
            *) die "Unbundled non-system dependency: $dependency" ;;
          esac
          ;;
      esac
    done <<< "$dependencies"
  done
  codesign --verify --deep --strict --verbose=2 "$app"
  signature="$(codesign --display --verbose=4 "$app" 2>&1)"
  [[ "$signature" == *Signature=adhoc* ]] || die 'App signature is not ad-hoc.'
  for binary in send-files.sh send-text.sh send-clipboard.sh; do
    [[ -f "$app/Contents/Resources/capture/$binary" ]] || die "Missing capture script: $binary"
  done
  printf 'App architecture, system-library linkage and ad-hoc signatures verified.\n'
}

if [[ "${1:-}" == --app ]]; then
  [[ $# == 3 ]] || die "Usage: $0 --app bundle.app arm64|x86_64"
  app=$2; arch=$3
else
  [[ $# == 2 ]] || die "Usage: $0 installer.dmg arm64|x86_64"
  dmg=$1; arch=$2
fi
case "$arch" in arm64|x86_64) ;; *) die 'Expected arm64 or x86_64.' ;; esac
if [[ "${1:-}" == --app ]]; then
  verify_app "$app" "$arch"
  exit
fi

[[ -f "$dmg" ]] || die "Missing DMG: $dmg"
codesign --verify --strict --verbose=2 "$dmg"
signature="$(codesign --display --verbose=4 "$dmg" 2>&1)"
[[ "$signature" == *Signature=adhoc* ]] || die 'DMG signature is not ad-hoc.'
hdiutil verify "$dmg"
work="$(mktemp -d "${TMPDIR:-/tmp}/household-dmg-check.XXXXXX")"
mountpoint="$work/mounted"
mkdir "$mountpoint"
mounted=0
cleanup() {
  if [[ "$mounted" == 1 ]]; then
    if ! hdiutil detach "$mountpoint"; then
      printf 'Could not detach %s; leaving temporary directory in place.\n' "$mountpoint" >&2
      return
    fi
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT
hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$mountpoint" "$dmg"
mounted=1
[[ -L "$mountpoint/Applications" && "$(readlink "$mountpoint/Applications")" == /Applications ]] || die 'Missing Applications drag-install link.'
[[ -s "$mountpoint/INSTALL.txt" ]] || die 'Missing installation instructions.'
verify_app "$mountpoint/Household Share.app" "$arch"
hdiutil detach "$mountpoint"
mounted=0
printf 'Read-only DMG mount, app signatures and drag-install layout verified. GUI launch and household-device checks were not run.\n'
