# @boundsvg/browser

Browser WASM loader, SVG DOM utilities, and runtime adapter for boundsvg.

This package provides the browser-targeted WASM bindings and SVG DOM interaction utilities used internally by `@boundsvg/react` and `@boundsvg/worker`. Most users should use those packages directly rather than importing `@boundsvg/browser`.

## Installation

> Not yet published to npm — build from source. See the [monorepo README](https://github.com/zakideee/boundsvg) for setup instructions.

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
