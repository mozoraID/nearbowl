#!/usr/bin/env bash
# Build the factory and tUSDC contracts for the current NEAR runtime.
# wasm flags live in .cargo/config.toml (`--cfg near`, strip debug info).
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release --target wasm32-unknown-unknown -p nearbowl-factory -p nearbowl-tusdc
echo "factory  target/wasm32-unknown-unknown/release/nearbowl_factory.wasm"
echo "tUSDC    target/wasm32-unknown-unknown/release/nearbowl_tusdc.wasm"
