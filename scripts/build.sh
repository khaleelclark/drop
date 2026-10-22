#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "$0")/env.sh"
cd "$HOUSEHOLD_ROOT"
command -v go >/dev/null || { echo "Go is required. See README.md for build tools." >&2; exit 1; }
pnpm --dir web build
mkdir -p bin
cd server
CGO_ENABLED=0 go build -trimpath -o "$HOUSEHOLD_ROOT/bin/household-server" ./cmd/household
