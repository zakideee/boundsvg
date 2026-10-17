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

`FontBackend::create_face_with_admission` can reuse proof for an exact immutable
allocation; custom implementations keep their shared-face factory by default.
Missing or mismatched proof still requires admission. Native
`outline::extract_glyph_paths` now accepts a `&dyn FontFace` at the desired
variation location. Construct or obtain that face first, then reuse it for the
whole extraction instead of passing raw font bytes to the outline operation.

`FontRegistry::rasterize_font_data` now returns `Result<RasterizeFontData, BoundtextError>`.
The snapshot has `aliases`, `fonts` and aligned optional `admissions` fields.
Snapshot allocation failures propagate before rasterization. The built-in renderer
checks each proof against the exact immutable font allocation; missing or mismatched
proofs take full admission. Animation sessions retain proofs only with their font
snapshot and release them on finish, abort or failure. Standalone native raster
functions still admit raw bytes. Custom `Renderer` implementations retain their
existing methods through the provided proof-aware defaults.

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
| `FONT_DUPLICATE`              | Native font registration reported an existing entry.                                                     |

### Fixed messages and typed context

The WASM/TypeScript transport preserves these exact message, stage and reason
combinations. Different messages under the same code describe different failures;
callers must not replace one with another.

| Diagnostic                    | Fixed message                                   | Stage  | `context.reason`                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FONT_PARSE_FAILED`           | Font parsing or admission failed.               | `font` | `invalidData`, `missingTable`, `invalidTable`, `noOutlines`, `invalidUnitsPerEm`, `invalidGlyphCount`, `nonFiniteMetric`, `invalidVariationAxis`, `allocationFailed`       |
| `FONT_OUTLINE_FAILED`         | Font outline extraction failed.                 | `font` | `invalidGlyphId`, `nonFiniteMetric`, `allocationFailed`, `drawingFailed`                                                                                                   |
| `FONT_OUTLINE_FAILED`         | Baseline glyph rotation must be finite.         | `font` | `invalidBaselineRotation`                                                                                                                                                  |
| `FONT_OUTLINE_FAILED`         | Glyph inline scale must be positive and finite. | `font` | `invalidInlineScale`                                                                                                                                                       |
| `TEXT_SHAPING_FAILED`         | Text shaping failed.                            | `text` | `nonFiniteVariation`, `nonFiniteMetric`, `allocationFailed`, `bufferPreparationFailed`, `inputTooLong`, `alreadyShaped`, `directionUnset`, `planMismatch`, `shapingFailed` |
| `TEXT_SHAPING_LIMIT_EXCEEDED` | The shaping buffer failed during processing.    | `text` | `bufferFailedDuringShaping`                                                                                                                                                |
| `TEXT_SHAPING_INVALID_OUTPUT` | The shaper returned invalid glyph data.         | `text` | `invalidGlyphId`, `invalidCluster`, `parallelArrayLengthMismatch`                                                                                                          |
| `TEXT_FONT_UNAVAILABLE`       | No requested font is available.                 | `font` | `unregisteredFont`                                                                                                                                                         |
| `TEXT_FONT_UNAVAILABLE`       | No requested font is available for text layout. | `text` | Layout preparation uses run/alias context without a `reason` field.                                                                                                        |
| `FONT_DUPLICATE`              | The font is already registered.                 | `font` | `duplicateRegistration`                                                                                                                                                    |

The native font-classification forms include `context.operation` and the typed
`context.reason`. Parse errors also include the zero-based `faceIndex` and, when
applicable, a four-character OpenType `table` tag; an absent tag is omitted rather
than `null`. Ordinary outline failures include the requested `glyphId`; the two
positioned-glyph argument failures do not. Invalid shaped output includes
`glyphIndex`, the zero-based output-record index rather than a glyph ID or UTF-8
cluster. The font-stage unavailable form includes the requested `weight`.
The text-stage layout-preparation form instead carries the bounded effective-run
and requested-alias context documented in the
[text layout diagnostic guide](../guides/debugging-diagnostics.md).

Rendering preserves node identity when available. Dependency-internal
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

## Raster backend feature

The `resvg-backend` Cargo feature is removed in 0.9.0. The `boundsvg` crate always
includes its rasterization dependencies. Remove explicit `resvg-backend` feature
selectors from Cargo manifests. `default-features = false` remains valid and does
not disable rasterization. The `Renderer` injection API remains available; custom
renderers do not exclude the standard raster dependencies from the build.
