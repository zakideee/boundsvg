---
"@boundsvg/core": minor
"@boundsvg/video": patch
---

**Breaking (Rust):** Prevent unbounded recursive Shape processing by rejecting authored and resolved geometry trees deeper than 48 levels with a stable validation error before recursion or WASM serialization. `boundshape::resolve_symbol_geometry` now returns `Result<GeometryDoc, ShapeError>`, and `ShapeError` is non-exhaustive. Rust callers must handle the resolution result and include a wildcard arm when matching shape errors. Programmatically generated trees at depth 49 or greater must be flattened; associative boolean chains can use one n-ary boolean node instead. The synchronized video package declares peer compatibility with both the 0.1 and 0.2 core lines.
