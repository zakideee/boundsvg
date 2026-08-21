/**
 * Conformance SVG snapshots rendered through the real WASM engine (not the mock
 * backend used by tests/snapshot). Prerequisite: `pnpm build:wasm`.
 *
 * Snapshot updates require visual review — never bulk-update; see the PR
 * checklist in CONTRIBUTING conventions.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { normalizeSvg } from "../snapshot/normalize-svg.js";
import { createConformanceEngine } from "./conformance-engine.js";
import { CONFORMANCE_SCENES } from "./scenes/index.js";

describe("conformance SVG snapshots", () => {
  let engine: Engine;

  beforeAll(async () => {
    engine = await createConformanceEngine();
  });

  it.each(
    CONFORMANCE_SCENES.map((scene) => [scene.id, scene] as const),
  )("%s renders a stable normalized SVG", (_id, scene) => {
    const svg = engine.renderToSvg(scene.build(), scene.renderOptions);
    expect(svg).toContain(`viewBox="0 0 ${scene.width} ${scene.height}"`);
    expect(normalizeSvg(svg)).toMatchSnapshot();
  });
});
