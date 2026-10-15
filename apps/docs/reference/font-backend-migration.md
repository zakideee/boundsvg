# Font backend migration

The font stack uses released Skrifa 0.48.0, read-fonts 0.45.0 and HarfRust
0.14.0. Raw SVG text and rasterization use usvg/resvg 0.48.1. Font parsing,
shaping and rendering remain in WASM with caller-injected fonts.

## API and failure changes

The TypeScript render, registry and shaping signatures are unchanged. WASM
schema 35 must be paired with the matching JavaScript package; older schema 34
artifacts are rejected. Native `boundtext` callers must replace the old backend
modules/types/features with `backend_skrifa::SkrifaBackend` / `skrifa-backend`
and `backend_harfrust::HarfRustShaper` / `harfrust-backend`. The custom backend
traits remain available. The workspace requires Rust 1.88.0 or later.

Native metrics and control bounds now use finite `f64` values in font units.
Shape and outline operations return `Result`; legitimate absent metrics and
empty glyphs use `Option` inside the result. Drawing and shaping failures do not
produce successful partial output. A present but malformed table used for
metrics or shaping now fails registration or the operation; optional table
absence remains valid. Unknown unused tables are ignored.

| Diagnostic                    | Meaning                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `FONT_PARSE_FAILED`           | Font container, metric table or shaping admission failed.                                                |
| `FONT_OUTLINE_FAILED`         | Glyph ID, positioned-glyph input or outline drawing failed.                                              |
| `TEXT_SHAPING_FAILED`         | Input, buffer preparation or the shaping operation failed.                                               |
| `TEXT_SHAPING_LIMIT_EXCEEDED` | The shaper reported buffer failure during processing, including possible allocation or operation limits. |
| `TEXT_SHAPING_INVALID_OUTPUT` | Returned glyph arrays, glyph IDs or UTF-8 clusters violate the font contract.                            |
| `TEXT_FONT_UNAVAILABLE`       | No requested alias resolves to a registered font, including an empty fallback chain.                     |

Errors carry a typed reason and operation, plus table/face/glyph context where
applicable. Rendering preserves node identity when available. Dependency-internal
infallible allocations and process-wide memory exhaustion are not guaranteed to
be recoverable. Raw SVG text uses usvg’s own shaping path and error visibility.

## Geometry and reproducibility

Horizontal line metrics retain explicit OS/2/hhea/typographic/Win selection;
they do not switch to the new libraries’ default line-height policy. Normal line
height keeps its 1.2em floor and explicit line height keeps half-leading and
baseline placement. Registration metrics remain at the default variation
location; per-call variation settings cannot change shared registration state.
Vertical VORG/vmtx origins, typographic fallback and rotated glyph placement
remain the responsibility of the text engine’s final positioning.

Unsigned Win metrics no longer wrap through `i16`. Outlines use official,
unhinted floating point drawing, and control bounds include emitted endpoints
and curve control points. They are not tight curve bounds. Fractional variation
metrics are retained, and normalized axis-coordinate quantization can differ
from previous versions. Fonts with 65,535 glyphs, including a nonempty last
glyph, no longer require a vendored parser.

Raw SVG text follows usvg's optical sizing behavior: when a variable font has
an `opsz` axis, `font-optical-sizing: auto` selects an optical size from the
font size. This can change outlines from older versions. Use
`font-optical-sizing: none` or an explicit `font-variation-settings: "opsz" 14`
when the SVG needs a fixed optical size. This does not implicitly add an `opsz`
setting to the declarative `Text` API.

SVG text, geometry, decoded RGBA pixels and encoded PNG/WebP/GIF bytes are
separate comparison surfaces. Font and raster library upgrades can change them
across versions. The byte reproducibility guarantee applies to repeated runs
within one matched version and the documented input domain; compare outputs
before upgrading pinned versions.

PNG encoding explicitly selects fast compression and the Sub filter to retain
the established encoding-speed policy across dependency upgrades. This remains
a lossless RGBA path; no new PNG quality option is required.
