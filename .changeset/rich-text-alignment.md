---
"@boundsvg/core": patch
---

**Output-affecting:** Rich Text with shrink, grow, Inline, Ruby, spans, or ellipsis now aligns each horizontal line and vertical column with its final layout box. Vertical rich Text columns also start at the box's right edge. InlineBox, InlineRect, and text decoration geometry follows the same line placement as glyphs. Finite flow keeps glyph placement and now places InlineRect and the text node box at the flow frame origin. SVG, PNG, WebP, GIF, frames, layered output, outlines, and animation may change for those scenes. The public layout tree JSON remains text-local.
