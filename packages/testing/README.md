# @boundsvg/testing

Testing helpers for boundsvg snapshots and render diagnostics.

## Installation

```bash
npm install @boundsvg/testing
```

## When to use

Use this package in application test suites that render boundsvg scenes and need stable assertions around SVG output, warnings, PNG dimensions, or node IDs.

```ts
import {
  assertNoWarnings,
  assertStableNodeIds,
  renderMatrix,
  renderSvgSnapshot,
} from "@boundsvg/testing";

assertStableNodeIds(vnode);

const svg = renderSvgSnapshot(engine, vnode);
expect(svg).toMatchSnapshot();

const [{ normalizedSvg }] = renderMatrix(engine, [
  { name: "default", input: vnode },
]);

expect(normalizedSvg).toMatchSnapshot();

const ir = engine.renderToIR(vnode);
assertNoWarnings(ir);
```

Vitest matcher helpers are available from `@boundsvg/testing/vitest`:

```ts
import { expect } from "vitest";
import { boundsvgMatchers } from "@boundsvg/testing/vitest";

expect.extend(boundsvgMatchers);
```

## Documentation

Full documentation: <https://github.com/zakideee/boundsvg>

## License

MIT OR Apache-2.0
