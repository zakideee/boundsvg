---
title: "@boundsvg/testing"
---

# @boundsvg/testing

Testing helpers for snapshot stability and render diagnostics. Use this package in application test suites so tests can assert the output you care about without depending on internal engine details.

## Snapshot Helpers

```ts
import {
  assertNoWarnings,
  assertStableNodeIds,
  normalizeSvg,
  renderMatrix,
  renderSvgSnapshot,
} from "@boundsvg/testing";

assertStableNodeIds(vnode);

const svg = renderSvgSnapshot(engine, vnode);
expect(svg).toMatchSnapshot();

const cases = renderMatrix(engine, [
  { name: "default", input: vnode },
  { name: "glyph paths", input: vnode, options: { textPathMode: "glyphs" } },
]);

expect(cases.map((entry) => entry.normalizedSvg)).toMatchSnapshot();
```

| API                   | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| `normalizeSvg`        | Sorts tag attributes and rounds long decimal values for stable snapshots   |
| `createTestEngine`    | Thin wrapper around `createEngine` for tests that inject mock engines      |
| `renderSvgSnapshot`   | Renders SVG and normalizes it                                              |
| `renderPngSnapshot`   | Renders PNG and returns bytes plus header dimensions                       |
| `assertNoWarnings`    | Throws when an IR contains recoverable render warnings                     |
| `assertStableNodeIds` | Throws when a VNode tree contains duplicate explicit node IDs              |
| `renderMatrix`        | Renders named cases and returns normalized SVG strings with warning counts |

## Vitest Matchers

Vitest integration lives in a separate subpath so the root testing helpers do not require a test runner at runtime.

```ts
import { expect } from "vitest";
import { boundsvgMatchers } from "@boundsvg/testing/vitest";

expect.extend(boundsvgMatchers);
```
