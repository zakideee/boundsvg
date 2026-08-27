---
"@boundsvg/core": minor
---

Preserve same-document raw SVG ID references when `contentIdPrefix` is set, including ARIA IDREF(S), SMIL timing references, supported `url()` values, and flat CSS ID selectors. Rewriting is now structural and byte-preserving, and unsafe known-local syntax fails with a structured error instead of emitting dangling references.

`analyzeEmbeddedSvgIds()` now reports `aria`, `smil`, and `css-selector` reference kinds plus `attribute` and `syntax` metadata. Update exhaustive `EmbeddedSvgReferenceKind` switches for the new variants.
