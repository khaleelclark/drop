#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "$0")/env.sh"
cd "$HOUSEHOLD_ROOT"
pnpm --dir web test
command -v go >/dev/null || { echo "Go is required to run server checks." >&2; exit 1; }
cd server
go test ./...
