#!/bin/bash
# Run on a Mac with Xcode command-line tools and the pinned project tools present.
# This script does not install OS packages, sign with an account, or publish releases.
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd -- "$here/../.." && pwd)"
source "$here/versions.env"

die() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || die 'DMG packaging requires macOS and an Apple SDK. No installer was built.'
case "${1:-}" in
  aarch64-apple-darwin) target=$1; arch=arm64 ;;
  x86_64-apple-darwin) target=$1; arch=x86_64 ;;
  *) die "Usage: $0 aarch64-apple-darwin|x86_64-apple-darwin" ;;
esac
[[ "$(uname -m)" == "$arch" ]] || die 'Use a native runner for this target; cross-built binaries cannot satisfy the helper execution check.'
for tool in node pnpm rustup rustc cargo xcrun codesign hdiutil ditto lipo otool plutil git shasum; do
  command -v "$tool" >/dev/null || die "Missing prerequisite: $tool (nothing installed automatically)."
done
[[ "$(node --version)" == "v$HOUSEHOLD_NODE_VERSION" ]] || die "Use Node $HOUSEHOLD_NODE_VERSION."
[[ "$(pnpm --version)" == "$HOUSEHOLD_PNPM_VERSION" ]] || die "Use pnpm $HOUSEHOLD_PNPM_VERSION."
export RUSTUP_TOOLCHAIN="$HOUSEHOLD_RUST_VERSION"
[[ "$(rustc --version)" == "rustc $HOUSEHOLD_RUST_VERSION "* ]] || die "Use Rust $HOUSEHOLD_RUST_VERSION."
xcrun --sdk macosx --show-sdk-path >/dev/null
export MACOSX_DEPLOYMENT_TARGET=11.0
export APPLE_SIGNING_IDENTITY=-
# Refuse credentials rather than accidentally notarizing with a developer's shell environment.
for credential in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH; do
  [[ -z "${!credential:-}" ]] || die "Unset $credential: this installer uses only ad-hoc signing."
done

cd "$root"
out="$root/artifacts/macos/$target"
mkdir -p "$out"
work="$(mktemp -d "${TMPDIR:-/tmp}/household-dmg.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
version="$(node -p "require('./clients/desktop/src-tauri/tauri.conf.json').version")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'Expected a numeric app version.'
name="Household-Share_${version}_${arch}"
[[ ! -e "$out/$name.dmg" ]] || die "Output already exists: $out/$name.dmg; choose a clean output directory before rebuilding."

{
  printf 'Source commit: '; git rev-parse HEAD
  printf 'Tracked working-tree changes (empty in a clean CI checkout):\n'
  git status --porcelain --untracked-files=no
  printf 'Target: %s\n' "$target"
  sw_vers
  # xcodebuild requires full Xcode; standalone Command Line Tools are sufficient.
  # Keep optional provenance reporting from blocking an otherwise usable SDK.
  if command -v xcodebuild >/dev/null && xcodebuild -version 2>/dev/null; then
    :
  elif command -v pkgutil >/dev/null && pkgutil --pkg-info=com.apple.pkg.CLTools_Executables 2>/dev/null; then
    printf 'Standalone Command Line Tools; full Xcode is not required.\n'
  else
    printf 'Xcode/CLT package metadata unavailable; macOS SDK is checked with xcrun.\n'
  fi
  xcrun --sdk macosx --show-sdk-version
  node --version
  pnpm --version
  rustc --version
  cargo --version
  printf 'Signing: ad-hoc; notarization: none; GUI/device checks: not run\n'
} > "$out/build-environment.log"

# Each dependency tree has its own checked-in lockfile. Never update them in CI.
pnpm --dir web install --frozen-lockfile 2>&1 | tee "$out/dependencies.log"
pnpm --dir clients/desktop install --frozen-lockfile 2>&1 | tee -a "$out/dependencies.log"
cargo test --locked --manifest-path clients/desktop/native/Cargo.toml --target "$target" 2>&1 | tee "$out/native-tests.log"
cargo build --locked --release --manifest-path clients/desktop/native/Cargo.toml --target "$target" --bin household-share-cli 2>&1 | tee "$out/helper-build.log"
# Build only the .app with the existing CSP/native bridge; hdiutil creates the DMG below.
# The arguments after -- are passed through to cargo by the pinned Tauri CLI.
pnpm --dir clients/desktop exec tauri build --ci --target "$target" --bundles app -- --locked 2>&1 | tee "$out/app-build.log"

# Record the exact source UI built by Tauri. CI outputs are packaging candidates;
# the integration owner selects the final redesign/source commit before shipping.
node > "$out/web-assets-sha256.txt" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
async function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) {
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      console.log(`${hash.digest('hex')}  ${file}`);
    } else throw new Error(`Unexpected non-regular web asset: ${file}`);
  }
}
walk('web/dist').catch(error => { console.error(error); process.exitCode = 1; });
NODE

stage="$work/volume"
mkdir -p "$stage"
chmod 755 "$stage"
app="$stage/Household Share.app"
ditto "$root/clients/desktop/src-tauri/target/$target/release/bundle/macos/Household Share.app" "$app"
mkdir -p "$app/Contents/Helpers" "$app/Contents/Resources/capture"
cp "$root/clients/desktop/native/target/$target/release/household-share-cli" "$app/Contents/Helpers/household-share-cli"
chmod 755 "$app/Contents/Helpers/household-share-cli"
cp "$here"/send-*.sh "$app/Contents/Resources/capture/"
cp "$here/INSTALL.txt" "$stage/INSTALL.txt"
ln -s /Applications "$stage/Applications"

# Sign nested code first, then replace the app resource seal after adding the helper.
# Preserve Tauri's entitlements and flags (including hardened runtime).
codesign --force --sign - --timestamp=none "$app/Contents/Helpers/household-share-cli"
codesign --force --sign - --timestamp=none --preserve-metadata=identifier,entitlements,flags "$app"
bash "$here/verify-dmg.sh" --app "$app" "$arch" 2>&1 | tee "$out/app-verification.log"

# Execute only the helper's no-argument usage path: it exits before opening user state.
# This checks native Mach-O loading without pretending the GUI was exercised.
set +e
"$app/Contents/Helpers/household-share-cli" > "$out/helper-execution.log" 2>&1
helper_status=$?
set -e
[[ "$helper_status" == 1 ]] || die "Helper usage returned unexpected status $helper_status."
[[ "$(cat "$out/helper-execution.log")" == Usage:\ household-share-cli* ]] || die 'Helper failed before showing its usage.'

hdiutil create -volname 'Household Share' -srcfolder "$stage" -fs HFS+ -format UDZO "$out/$name.dmg" 2>&1 | tee "$out/dmg-create.log"
codesign --force --sign - --timestamp=none "$out/$name.dmg"
bash "$here/verify-dmg.sh" "$out/$name.dmg" "$arch" 2>&1 | tee "$out/dmg-verification.log"
cp "$here/INSTALL.txt" "$out/INSTALL.txt"
(
  cd "$out"
  shasum -a 256 "$name.dmg" > SHA256SUMS
  shasum -a 256 -c SHA256SUMS
)
printf 'Verified installer: %s\n' "$out/$name.dmg"
