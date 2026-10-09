---
"@boundsvg/core": minor
---

**Output-affecting:** Box, Flex, and Grid with `overflow: "clip"` now clip children using the same resolved `borderRadius` as their background. The clipping boundary also cuts the container's own border and shadow at rounded corners, where the previous clip was rectangular. `overflow: "visible"` leaves child paint unclipped.

Path paint, including strokes at layout-box edges, can now extend beyond its `width` and `height`, which continue to control layout. To retain the previous clipping, wrap the Path in a Box of the same size with `overflow: "clip"`. Move positioning, margin, flex/grid item props, `zIndex`, `layer`, `transform`, and `animate` to the wrapper so placement and the clip's coordinate system stay together. The clipped wrapper is atomic in layered output. Add `borderRadius` to that Box for a rounded clip. Layout and inspection bounds retain their placement meaning.
