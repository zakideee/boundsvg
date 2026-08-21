#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TARGET="${1:-nodejs}"

# Strip machine-local absolute paths from the compiled binaries so the same
# source produces location-independent output.
REMAP_FLAGS="--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=${RUSTUP_HOME:-$HOME/.rustup}=/rustup --remap-path-prefix=${REPO_ROOT}=/build"

build_variant() {
  local target="$1"
  local output_dir="$2"
  local target_features="$3"

  (
    cd "$SCRIPT_DIR"
    RUSTFLAGS="-C target-feature=${target_features} ${REMAP_FLAGS}" \
      wasm-pack build . \
        --release \
        --target "$target" \
        --out-dir "$output_dir" \
        -- --features unicode-full
  )
  if [[ "$target" == "nodejs" ]]; then
    # npm-packlist honors wasm-pack's generated ignore file, so the Node.js
    # artifacts must remove it before @boundsvg/core is packed. The web
    # artifacts stay ignored because they are source-side build inputs.
    rm -f "$SCRIPT_DIR/$output_dir/.gitignore"
  fi
}

build_target() {
  local target="$1"
  local primary_output_dir="$2"
  local scalar_output_dir="$3"

  echo "Building WASM package (target: $target, variant: simd128)..."
  build_variant "$target" "$primary_output_dir" "+simd128"

  echo "Building WASM package (target: $target, variant: scalar)..."
  build_variant "$target" "$scalar_output_dir" "-simd128"
}

case "$TARGET" in
  nodejs)
    build_target nodejs ../../packages/core/wasm-pkg ../../packages/core/wasm-pkg/scalar
    echo "WASM Node.js builds complete: packages/core/wasm-pkg/"
    ;;
  web)
    build_target web pkg-web pkg-web/scalar
    echo "WASM web builds complete: crates/boundsvg/pkg-web/"
    ;;
  all)
    build_target nodejs ../../packages/core/wasm-pkg ../../packages/core/wasm-pkg/scalar
    build_target web pkg-web pkg-web/scalar
    echo "All WASM builds complete."
    ;;
  *)
    echo "Usage: $0 [nodejs|web|all]"
    exit 1
    ;;
esac
