#!/bin/bash
# Shortcut/Quick Action: text as stdin. Keep large text out of argument lists.
set -euo pipefail
cli="${HOUSEHOLD_CLI:-$HOME/.local/bin/household-share-cli}"
exec "$cli" text
