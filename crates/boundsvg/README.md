# boundsvg

WASM engine for the boundsvg project — Taffy layout, intermediate representation (IR) build, SVG/PNG/WebP/GIF emit, WOFF2 decode, and rasterization.

## Architecture

```
VNode → Validate → Build Taffy Tree → Compute Layout → Text Resolve → Build IR → Emit (SVG/PNG/WebP/GIF)
```

- **Layout** — Taffy flexbox engine for box model and positioning
- **Text** — Delegates to [boundtext](../boundtext/) for shaping, line breaking, kinsoku, and vertical text
- **IR Build** — Converts the resolved layout tree into a backend-agnostic intermediate representation
- **SVG Emit** — Serializes IR to standalone SVG with text as glyph outlines (no font file or `@font-face` in the output)
- **Raster Emit** — Rasterizes IR via resvg and encodes PNG, WebP, animated WebP and GIF (`resvg-backend` feature, on by default)
- **WOFF2 Decode** — Decompresses WOFF2 fonts to TTF at load time

## WASM Targets

| Target                                      | Output                     | Consumer                      |
| ------------------------------------------- | -------------------------- | ----------------------------- |
| `wasm32-unknown-unknown` (wasm-pack nodejs) | `packages/core/wasm-pkg/`  | `@boundsvg/core` (Node.js)    |
| `wasm32-unknown-unknown` (wasm-pack web)    | `crates/boundsvg/pkg-web/` | `@boundsvg/browser` (browser) |

The primary artifact in each target directory is compiled with WebAssembly
`simd128`. A scalar artifact is built under `scalar/` and selected
automatically by the package loader when SIMD is unavailable.

## Building

```bash
# Node.js target (simd128 primary + scalar fallback)
pnpm build:wasm

# Web target (simd128 primary + scalar fallback)
pnpm build:wasm:web
```

## License

MIT OR Apache-2.0
