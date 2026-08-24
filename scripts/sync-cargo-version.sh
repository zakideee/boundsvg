#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./packages/core/package.json').version")

for cargo_manifest in \
  crates/boundshape/Cargo.toml \
  crates/boundtext/Cargo.toml \
  crates/boundsvg/Cargo.toml \
  crates/boundmp4/Cargo.toml
do
  sed -i '0,/^version = ".*"/{s/^version = ".*"/version = "'"${VERSION}"'"/}' "$cargo_manifest"
done

sed -i '/^boundshape = { path = "..\/boundshape", version = "/s/version = "[^"]*"/version = "'"${VERSION}"'"/' crates/boundtext/Cargo.toml
sed -i '/^boundshape = { path = "..\/boundshape", version = "/s/version = "[^"]*"/version = "'"${VERSION}"'"/' crates/boundsvg/Cargo.toml
sed -i '/^boundtext = { path = "..\/boundtext", version = "/s/version = "[^"]*"/version = "'"${VERSION}"'"/' crates/boundsvg/Cargo.toml

cargo metadata --format-version 1 >/dev/null

echo "Synced Rust manifests and Cargo.lock to ${VERSION}"
