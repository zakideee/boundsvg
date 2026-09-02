# @boundsvg/browser

Browser WASM loader, SVG DOM utilities, and runtime adapter for boundsvg.

This package provides the browser-targeted WASM bindings and SVG DOM interaction utilities used internally by `@boundsvg/react` and `@boundsvg/worker`. Most users should use those packages directly rather than importing `@boundsvg/browser`.

The `@boundsvg/browser/wasm` loader requires the complete nine-operation shape
WASM family and returns an adapter for `initWasm()` from
`@boundsvg/core/wasm`. Keep Browser, Core, and the embedded WASM files on the
same release; a missing operation or schema mismatch fails during
initialization instead of falling back to a partial adapter.

## Installation

```bash
npm install @boundsvg/browser
```

## When to use the asset utilities

```ts
import { downloadPng, readPngDimensions } from "@boundsvg/browser/assets";

const dimensions = readPngDimensions(png);
downloadPng(png, "preview.png");
```

- `readPngDimensions` reads width and height from PNG bytes without decoding pixels.
- `downloadPng` triggers a browser download for a generated PNG. It uses DOM APIs, so call it from browser event handlers, not from render functions or Node.js scripts.

## Documentation

Full documentation: <https://github.com/zakideee/boundsvg>

## License

MIT OR Apache-2.0
