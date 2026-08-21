#!/usr/bin/env bash
set -euo pipefail

CARGO_TOML="crates/boundsvg/Cargo.toml"
VERSION=$(node -p "require('./packages/core/package.json').version")

# Replace only the version under [package] (line 3), not dependency versions
sed -i '0,/^version = ".*"/{s/^version = ".*"/version = "'"${VERSION}"'"/}' "$CARGO_TOML"
echo "Synced ${CARGO_TOML} version to ${VERSION}"
