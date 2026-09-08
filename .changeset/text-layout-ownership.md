---
"@boundsvg/core": minor
---

**Output-affecting:** Plain-text measurement and shrinkwrap now succeed for
missing emoji and CJK glyphs when the resolved font chain can provide fallback
layout. Pre-wrap layout includes missing-glyph warnings, and rendered warnings
identify characters with Unicode notation such as `U+1F389 (🎉)`. Explicit
Japanese and English language tags reach shaping, which can change advances,
line breaks, and shrinkwrap sizes for language-sensitive fonts. Same-content
sibling text nodes retain their own layout settings regardless of child order;
measurement cache hit counts reflect reuse within each node.

Add Rust-only raw-flow, shrinkwrap request/provider, and unwrapped glyph
projection APIs in boundtext, and route the bundled renderer through its text
layout owner. The renderer also uses the additive, documentation-hidden Rust
`TextLayoutSession` API to retain width-independent prepared text within one
rendering operation. These are additive Rust APIs; existing TypeScript and WASM
signatures and schema remain unchanged.
