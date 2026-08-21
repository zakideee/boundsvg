---
title: WASM Engine (Rust)
---

# WASM Engine (Rust)

The `boundsvg` Rust crate provides the WASM core for layout, rasterization, and SVG emission; text shaping lives in the `boundtext` crate it embeds.

::: tip
Full API documentation is available in the [Rustdoc](/rustdoc/boundsvg/).
:::

## Overview

The WASM module exposes two categories of APIs:

### Stateless Functions

Top-level functions that operate on inline data (no font registry required):

- `get_font_metrics(font_data)` — Get font metrics (unitsPerEm, ascender, descender)
- `shape_text(font_data, text, font_size_px, letter_spacing_px)` — Shape text with inline font binary
- `grapheme_split(text)` — Split text into grapheme clusters
- `uax14_line_breaks(text)` — Get UAX#14 line break opportunities
- `extract_image_hrefs(svg_string)` — Extract external image hrefs from SVG

### Instance-based API (`BoundSvgEngine`)

Each `BoundSvgEngine` instance owns an isolated font registry. Create via `new wasm.BoundSvgEngine()`.

- `register_font(data, alias, weight, style)` — Register a font into this instance's registry
- `compute_layout(input_json)` — Compute Flexbox/Grid layout using Taffy
- `shape_text_registered(alias, weight, style, ...)` — Shape text with a registered font
- `shape_text_registered_with_options(alias, weight, style, ..., options_json)` — Shape with shaping options
- `shape_text_registered_with_fallback(aliases_json, ...)` — Shape with fallback chain
- `shape_text_registered_with_fallback_with_options(aliases_json, ..., options_json)` — Fallback + shaping options
- `shape_text_with_variations(alias, weight, style, ..., variations_json)` — Shape with variable font variations
- `shape_text_with_variations_with_options(alias, ..., variations_json, options_json)` — Variations + shaping options
- `svg_to_png(svg_string)` — Convert SVG to PNG
- `svg_to_png_with_options(svg_string, options_json)` — Convert with options (scale, background)
- `svg_to_webp_with_options(svg_string, options_json)` — Convert SVG to lossless WebP
- `svgs_to_animated_webp(input_json)` — Mux pre-sampled SVG frames into an animated WebP
- `svgs_to_animated_gif(input_json)` — Encode pre-sampled SVG frames as an animated GIF
- `extract_glyph_paths(alias, weight, style, text, ...)` — Extract SVG path data for glyphs
- `extract_glyph_paths_with_options(alias, weight, style, text, ..., options_json)` — Extract paths with shaping options
- `extract_glyph_paths_with_fallback(aliases_json, ...)` — Extract paths with fallback chain
- `extract_glyph_paths_with_fallback_with_options(aliases_json, ..., options_json)` — Fallback + shaping options
- `free()` — Release Rust-side memory (required to prevent WASM heap leaks)

## Dependencies

| Crate             | Version | Purpose                      |
| ----------------- | ------- | ---------------------------- |
| taffy             | 0.9     | Flexbox / Grid layout        |
| rustybuzz         | 0.20    | Text shaping (HarfBuzz port) |
| resvg             | 0.45    | SVG rasterization            |
| image-webp        | 0.2     | Lossless WebP encoding       |
| gif               | 0.13    | Animated GIF encoding        |
| ttf-parser        | 0.25    | Font parsing                 |
| unicode-linebreak | 0.1     | UAX#14 line breaking         |
