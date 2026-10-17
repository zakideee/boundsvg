---
"@boundsvg/core": minor
"@boundsvg/browser": minor
"@boundsvg/worker": minor
---

Replace the font parser and shaper with released Fontations and HarfRust dependencies, and update raw SVG rasterization. Support maximum-count fonts without vendored source. Preserve fractional outline/variation metrics and unsigned Win metrics, propagate structured font/shaping failures, and require matching WASM schema 35. Native backend traits use Result and finite f64 metrics, and native outline extraction takes a parsed face; the workspace MSRV is Rust 1.88.0.

**Output-affecting:** Fractional outlines and variation metrics can change text path coordinates and edge antialiasing. Raw SVG variable fonts now apply optical sizing by default; set `font-optical-sizing: none` or an explicit optical-size axis to retain the previous sizing. SVG and raster bytes can change across versions.

Native `FontRegistry::rasterize_font_data` now returns a fallible `RasterizeFontData` snapshot with aligned optional immutable-allocation admission proofs.

Native Rust: the `resvg-backend` Cargo feature is removed. `boundsvg` always includes its rasterization dependencies; remove explicit `resvg-backend` feature selectors. `default-features = false` remains valid and does not disable rasterization. The `Renderer` injection API remains available and does not exclude the standard raster dependencies.
