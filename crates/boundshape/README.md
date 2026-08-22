# boundshape

Low-level geometry and symbol kernel for [boundsvg](https://github.com/zakideee/boundsvg):
path parsing and normalization, fill-topology regions, boolean operations
(union / subtract / intersect / xor), stroke geometry, part attribution, and
symbol definitions with elastic segments.

This crate is an internal layer of the boundsvg engine, published so the
`boundsvg` and `boundtext` crates can build from crates.io. Its API follows
the needs of the engine and may change between minor versions.

## Known limitations

Boolean operations over cubic (curved) boundaries can intermittently return
wrong regions, and the xor area identity can fail for rare polygon inputs.
These are documented, with pinned reproductions, in
[`tests/boolean_properties.rs`](https://github.com/zakideee/boundsvg/blob/main/crates/boundshape/tests/boolean_properties.rs);
the boundsvg pipeline manages them as known constraints.

## License

MIT OR Apache-2.0
