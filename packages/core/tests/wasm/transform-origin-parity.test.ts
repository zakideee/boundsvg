import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import initWeb, {
  BoundSvgEngine as WebEngine,
  wasm_schema_version as webVersion,
} from "../../../../crates/boundsvg/pkg-web/boundsvg.js";
import type { WasmEngineInstance } from "../../src/wasm/types.js";

/** Load the generated CommonJS binding alongside the independent Web binding. */
const require = createRequire(import.meta.url);
/** Node-side WASM exports checked against the Web engine in the same cases. */
const nodeModule = require("../../wasm-pkg/boundsvg.js") as {
  BoundSvgEngine: new () => WasmEngineInstance;
  wasm_schema_version: () => number;
};

function input(origin: unknown, transform: Record<string, number> = { rotateDeg: 90 }) {
  return JSON.stringify({
    root: {
      nodeId: "root",
      nodeType: "canvas",
      authoredId: true,
      style: { width: 200, height: 200 },
      children: [
        {
          nodeId: "box",
          nodeType: "box",
          authoredId: true,
          style: { width: 80, height: 40 },
          children: [],
          visual: { transformOrigin: origin, transform },
        },
      ],
    },
    fonts: [],
  });
}

function captureFailure(
  engine: WasmEngineInstance,
  transport: string,
): Record<string, unknown> | string {
  try {
    engine.render_to_ir?.(transport, "{}");
  } catch (error) {
    const diagnostic = String(error);
    return diagnostic.startsWith("{")
      ? (JSON.parse(diagnostic) as Record<string, unknown>)
      : diagnostic;
  }
  throw new Error("Expected a structured origin failure");
}

describe("relative origin node/web transport parity", () => {
  let nodeEngine: WasmEngineInstance;
  let webEngine: WasmEngineInstance;
  beforeAll(async () => {
    await initWeb({
      module_or_path: readFileSync(
        new URL("../../../../crates/boundsvg/pkg-web/boundsvg_bg.wasm", import.meta.url),
      ),
    });
    nodeEngine = new nodeModule.BoundSvgEngine();
    webEngine = new WebEngine() as unknown as WasmEngineInstance;
  });
  afterAll(() => {
    nodeEngine?.free();
    webEngine?.free();
  });

  it("uses schema 39 and resolves both axes with the same output", () => {
    expect(nodeModule.wasm_schema_version()).toBe(39);
    expect(webVersion()).toBe(39);
    for (const origin of [
      undefined,
      { x: 0.5, y: 0.5 },
      { x: 0, y: 2 ** -1022 },
      { x: 1, y: 1 },
      { x: -0, y: 0 },
    ]) {
      expect(webEngine.render_to_ir?.(input(origin), "{}")).toBe(
        nodeEngine.render_to_ir?.(input(origin), "{}"),
      );
    }
    expect(nodeEngine.render_to_ir?.(input({ x: 0.5, y: 0.5 }), "{}")).toContain('"originX":40.0');
  });

  it.each([
    null,
    [],
    [0, 0],
    {},
    { x: 0 },
    { x: 0, y: 0, extra: 1 },
    { x: null, y: 0 },
  ])("rejects invalid wire shape %j on both targets", (origin) => {
    const error = captureFailure(nodeEngine, input(origin));
    expect(error).toMatch(/^Invalid input JSON:/);
    expect(captureFailure(webEngine, input(origin))).toEqual(error);
  });

  it.each([
    { x: -1, y: 0 },
    { x: Number.MIN_VALUE, y: 0 },
    { x: 1 + Number.EPSILON, y: 0 },
  ])("keeps domain failures structured for %j", (origin) => {
    const error = captureFailure(nodeEngine, input(origin));
    expect(error).toMatchObject({ code: "VALIDATION", stage: "ir", nodeId: "box" });
    expect(captureFailure(webEngine, input(origin))).toEqual(error);
  });

  it("rejects explicit zero pixel origins", () => {
    for (const transform of [{ originX: 0 }, { originY: 0 }]) {
      expect(captureFailure(nodeEngine, input({ x: 0.5, y: 0.5 }, transform))).toMatchObject({
        code: "VALIDATION",
        stage: "ir",
        nodeId: "box",
      });
    }
  });
});
