---
"@boundsvg/core": minor
---

**Output-affecting:** SVG text paths now use shorter numeric path syntax, including the intermediate SVG used for PNG, WebP, GIF, frames, and layered raster output. Rounded decimal outline geometry and returned IR paths are unchanged. Raster bytes and a small number of edge pixels can change because renderers evaluate relative coordinates with floating-point arithmetic.
