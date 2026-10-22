#!/usr/bin/env bash
set -euo pipefail
android_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$android_dir/../.." && pwd)"
source "$project_dir/scripts/env.sh"
: "${ANDROID_HOME:?Set ANDROID_HOME to the installed Android SDK}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/27.1.12297006}"
test -d "$NDK_HOME" || { echo 'Configured Android NDK is not installed.' >&2; exit 1; }
test -f "$project_dir/web/dist/index.html" || { echo 'Build the shared web frontend first.' >&2; exit 1; }
# Tauri supplies target flags; explicit RUSTFLAGS keeps NDK27 binaries compatible with 16 KiB pages.
export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=-Wl,-z,max-page-size=16384"
target="${HOUSEHOLD_ANDROID_TARGET:-aarch64}"
case "$target" in aarch64|x86_64) ;; *) echo 'Use HOUSEHOLD_ANDROID_TARGET=aarch64 or x86_64.' >&2; exit 1 ;; esac
cd "$android_dir"
# AGP's incremental ZIP writer can retain large holes after replacing an unstripped native library.
# Recreate only this generated package, leaving Cargo/Gradle dependency caches intact.
rm -f src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
../desktop/node_modules/.bin/tauri android build --target "$target" --debug --apk --ci "$@"
# Preserve each ABI build before the generated universal output is reused by another build.
mkdir -p build/outputs
cp src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk "build/outputs/household-share-tauri-$target-debug.apk"
echo "APK: $android_dir/build/outputs/household-share-tauri-$target-debug.apk"
