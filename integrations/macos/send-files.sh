#!/bin/bash
# Finder Quick Action: input as arguments. Never evaluate, join or interpolate paths.
set -euo pipefail
cli="${HOUSEHOLD_CLI:-$HOME/.local/bin/household-share-cli}"
if [[ ! -x "$cli" ]]; then
  printf '%s\n' "Install household-share-cli in ~/.local/bin or set HOUSEHOLD_CLI." >&2
  exit 1
fi
if (( $# == 0 )); then
  printf '%s\n' 'No files were supplied.' >&2
  exit 1
fi
exec "$cli" enqueue "$@"
