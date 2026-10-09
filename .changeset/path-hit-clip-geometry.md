---
"@boundsvg/core": minor
"@boundsvg/browser": minor
"@boundsvg/react": minor
---

Hit-test candidates include Path geometry and stroke outside its layout box. Explicit rectangular and rounded clips exclude invisible portions of their owner and descendants, including transformed and nested clips. Browser and React interaction verify painted Path fill/stroke, so empty space inside conservative bounds falls through to nodes underneath. React also uses the current native pointer hit stack for canvas-stable strokes under SVG viewport scaling.

Path IR now includes required Rust-derived `pathGeometry`, and the WASM schema is 34. Regenerate saved or hand-built older IR with the matching engine's `renderToIR(scene)` before hit testing; missing geometry raises `VALIDATION` rather than using layout bounds. Path `width`/`height`, layout `bbox`, and inspection bounds keep their placement meaning. Static and explicit `timeMs` samples are covered; live SVG playback does not synchronize the hit index at every instant.
