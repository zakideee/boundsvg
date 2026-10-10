---
"@boundsvg/react": patch
---

Preserve unchanged SVG DOM and animation clocks in `InteractiveBoundSvg`, `BoundSvg`, and `AnimatedBoundSvg` during hover and unrelated parent updates. Callback updates continue to use the latest handlers, and changed SVG content replaces the displayed document as usual.
