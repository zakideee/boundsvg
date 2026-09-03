# boundshape

Low-level geometry and symbol kernel for [boundsvg](https://github.com/zakideee/boundsvg):
path parsing and normalization, fill-topology regions, boolean operations
(union / subtract / intersect / xor), stroke geometry, part attribution, and
symbol definitions with elastic segments.

This crate is an internal layer of the boundsvg engine, published so the
`boundsvg` and `boundtext` crates can build from crates.io. Its API follows
the needs of the engine and may change between minor versions.

## Fallible output APIs

`ShapeError` is a closed 15-variant enum. Geometry depth errors report both
`actual` and `limit`; `NonFiniteOutput` reports that generated numeric output
could not be materialized safely. The public `region_to_path`,
`region_to_svg`, and `transform_to_svg` helpers return
`Result<String, ShapeError>`. Callers should propagate or handle the result;
there is no unchecked string-producing counterpart.

Compiled shape parts resolve path data, stroke path data, and finite bounds
before they are returned. Finite inputs are not clamped, and generated output
never substitutes `NaN` or infinity for an error.

## Known limitations

Boolean operations over cubic (curved) boundaries can intermittently return
wrong regions, and the xor area identity can fail for rare polygon inputs.
These are documented, with pinned reproductions, in
[`tests/boolean_properties.rs`](https://github.com/zakideee/boundsvg/blob/main/crates/boundshape/tests/boolean_properties.rs);
the boundsvg pipeline manages them as known constraints.

## License

MIT OR Apache-2.0
