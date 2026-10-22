#!/usr/bin/env bash
# Source this file to use optional project-local toolchains.
HOUSEHOLD_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOUSEHOLD_ROOT/.tools/go/bin:$HOUSEHOLD_ROOT/.tools/cargo/bin:$PATH"
export CARGO_HOME="$HOUSEHOLD_ROOT/.tools/cargo"
export RUSTUP_HOME="$HOUSEHOLD_ROOT/.tools/rustup"
