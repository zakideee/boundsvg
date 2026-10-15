---
"@boundsvg/core": minor
"@boundsvg/browser": minor
"@boundsvg/worker": minor
---

Replace the font parser and shaper with released Fontations and HarfRust dependencies, and update raw SVG rasterization. Support maximum-count fonts without vendored source. Preserve fractional outline/variation metrics and unsigned Win metrics, propagate structured font/shaping failures, and require matching WASM schema 35. Native backend traits use Result and finite f64 metrics; the workspace MSRV is Rust 1.88.0. Font and raster output may change across versions.
