# @boundsvg/video

## 0.3.0

## 0.2.0

### Patch Changes

- [#18](https://github.com/zakideee/boundsvg/pull/18) [`27659af`](https://github.com/zakideee/boundsvg/commit/27659af778e8d9644eab42cb5800a2aeadd19d0b) Thanks [@zakideee](https://github.com/zakideee)! - **Breaking (Rust):** Prevent unbounded recursive Shape processing by rejecting authored and resolved geometry trees deeper than 48 levels with a stable validation error before recursion or WASM serialization. `boundshape::resolve_symbol_geometry` now returns `Result<GeometryDoc, ShapeError>`, and `ShapeError` is non-exhaustive. Rust callers must handle the resolution result and include a wildcard arm when matching shape errors. Programmatically generated trees at depth 49 or greater must be flattened; associative boolean chains can use one n-ary boolean node instead. The synchronized 0.2 video package requires the 0.2 core line.

## 0.1.0

Initial public release.
