---
"@boundsvg/react": patch
---

Preserve displayed SVG DOM across unrelated parent updates in `BoundSvg`, `AnimatedBoundSvg`, and `InteractiveBoundSvg`. `InteractiveBoundSvg` also preserves the DOM through hover while using current event handlers. In animated displays, these updates preserve animation clocks. Changed SVG content still replaces the display.
