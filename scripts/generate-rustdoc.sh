#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$REPO_ROOT/apps/docs/public/rustdoc"

# Strip machine-local absolute paths from generated pages so the same source
# produces location-independent output.
RUSTDOCFLAGS="--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo \
--remap-path-prefix=${RUSTUP_HOME:-$HOME/.rustup}=/rustup \
--remap-path-prefix=${REPO_ROOT}=/build" \
  cargo doc --no-deps -p boundsvg -p boundtext -p boundshape \
    --manifest-path "$REPO_ROOT/Cargo.toml"

rm -rf "$OUT_DIR"
cp -r "$REPO_ROOT/target/doc" "$OUT_DIR"
rm -f "$OUT_DIR/.lock"

# Publish source pages only for the workspace's own crates; dependency crate
# sources are not redistributed through the docs site.
if [ -d "$OUT_DIR/src" ]; then
  find "$OUT_DIR/src" -mindepth 1 -maxdepth 1 -type d \
    ! -name 'boundsvg' ! -name 'boundtext' ! -name 'boundshape' \
    -exec rm -rf {} +
fi

# rustdoc pages load a per-trait implementors script that is emitted only
# when implementors exist; stub the missing ones so the published site
# serves no 404s for implementor-less traits.
while IFS= read -r page; do
  rel="${page#"$OUT_DIR/"}"
  js="$OUT_DIR/trait.impl/${rel%.html}.js"
  if [ ! -f "$js" ]; then
    mkdir -p "$(dirname "$js")"
    printf '(function() {})()\n' > "$js"
  fi
done < <(find "$OUT_DIR" -path "$OUT_DIR/trait.impl" -prune -o -name 'trait.*.html' -print)

# Root redirect → /rustdoc/boundsvg/
cat > "$OUT_DIR/index.html" << 'HTML'
<!DOCTYPE html>
<html>
<head><meta http-equiv="refresh" content="0; url=boundsvg/"></head>
<body><a href="boundsvg/">boundsvg</a></body>
</html>
HTML

echo "Rustdoc generated → $OUT_DIR ($(du -sh "$OUT_DIR" | cut -f1))"
