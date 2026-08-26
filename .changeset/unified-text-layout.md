---
"@boundsvg/core": minor
"@boundsvg/react": minor
---

**Output-affecting:** Use one authoritative text-layout contract for horizontal and vertical
plain/rich text, exclusion flow, shrink/grow fit, and `maxLines` ellipsis. Ellipsis now selects the
longest exact legal prefix without splitting grapheme clusters or atomic rich items, re-shapes
contextual text at the retained end, preserves source/style/decoration identity, and excludes output
and warnings owned only by the omitted suffix.

Ordinary spans now use the canonical rich planner. Paint-only boundaries keep
one shaping run (an indivisible cross-boundary cluster uses its source-start
paint), and nested decorated spans remain fragmentable with all owner keys in
normal and exclusion-flow output. Fit scales font size and letter spacing
together; explicit pixel line height remains absolute. Positioned glyph
`clusterStart` / `clusterEnd` values for ordinary spans are now document-global
UTF-8 byte offsets instead of run-local offsets. Ruby annotations continue to
use annotation-level local offsets because they are shaped from a separate
source string; use `sourceRole` or UnitMap identity across source namespaces.
Nested atomic children and multiple styled ruby segments now keep continuous
source/cluster coordinates, while equal annotation text on different ruby
levels remains distinct UnitMap identity.
Unregistered aliases are now rejected before authoritative WASM text layout
on every render and layout-transition route, preserving
`FONT_ALIAS_NOT_REGISTERED`; when an input has multiple fatal defects, this
structured font diagnosis may now precede a shaping failure.

Add the positive-integer `fitMaxProbes` Text prop for deterministic exact-grid
fit when content (including negative tracking) or flow geometry is not
monotone-certified. Exact ellipsis, fit, and geometry work now fail with
structured resource-limit errors instead of returning approximate or partial
output. The bundled WASM DTO schema advances to 26 and must be rebuilt with the
matching `@boundsvg/core` package.

**Breaking (Rust):** `boundtext::layout_text` and `layout_text_with_unit_metadata` now return
`Result<_, TextLayoutError>`, and the physical `FlowRegionSource` trait is replaced by the fallible
logical-axis `RegionProvider` contract. Rust callers must migrate `Option` handling and provider
implementations as documented in `crates/boundtext/README.md`.
`FlowLayoutResult` also adds `inline_box_decorations`; direct struct constructors must initialize
or forward that field. Flow shrinkwrap geometry/resource failures now keep their structured text
error codes through the WASM bridge; the older direct Rust preformatted-text shrinkwrap helpers
continue to return `Option` pending a separate SemVer decision.
The `boundtext` default feature set now includes `unicode-full`, changing direct
default-feature Rust builds from per-code-point fallback boundaries to UAX #29
extended grapheme clusters. Custom no-default builds must enable
`unicode-full` explicitly to receive the same boundary guarantee.
