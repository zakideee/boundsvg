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
`layoutTextFlow`, `layoutTextFlowWithExclusions`, `measureTextBlock`, `shrinkwrapText`,
`shrinkwrapFlow`, and `measureIntrinsicInlineSize`.

## Documentation

Full documentation: <https://github.com/zakideee/boundsvg>

## License

MIT OR Apache-2.0
