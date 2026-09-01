# @boundsvg/worker

Web Worker adapter for boundsvg — offloads WASM rendering to a background thread.

## Installation

```bash
npm install @boundsvg/worker
```

## Usage

```ts
import { WorkerEngine } from "@boundsvg/worker";

const engine = await WorkerEngine.create({
  worker: new URL("@boundsvg/worker/worker", import.meta.url),
  fonts: [{ alias: "Inter", weight: 400, style: "normal", data: fontBuffer }],
});

const svg = await engine.renderToSvg(scene);
engine.dispose();
```

The worker entry point is available at `@boundsvg/worker/worker` for bundler configuration.

`WorkerEngine` also exposes async text measurement methods matching the core engine:

Warning-bearing Worker responses use one top-level recoverable diagnostic
list. SVG-plus-IR results retain that list as public `IR.warnings`, while
callback values are detached so callback mutation cannot affect the returned
IR. Malformed correlated responses reject the matching request; malformed
uncorrelatable responses dispose the engine and reject all pending work.
`layoutTextFlow`, `layoutTextFlowWithExclusions`, `measureTextBlock`, `shrinkwrapText`,
`shrinkwrapFlow`, and `measureIntrinsicInlineSize`.

## Documentation

Full documentation: <https://github.com/zakideee/boundsvg>

## License

MIT OR Apache-2.0
