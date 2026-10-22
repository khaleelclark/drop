#!/bin/bash
set -euo pipefail
cli="${HOUSEHOLD_CLI:-$HOME/.local/bin/household-share-cli}"
/usr/bin/pbpaste | "$cli" text
