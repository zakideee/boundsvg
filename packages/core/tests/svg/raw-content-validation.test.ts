import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { validate } from "../../src/validate/index.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;
let engine: Engine;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
  engine = createEngineFromHandle(handle);
});

afterAll(() => {
  handle.dispose();
});

/**
 * Regressions: raw content that silently broke rendering.
 */
describe("Path d grammar validation", () => {
  function pathCanvas(d: string): ReturnType<typeof createElement> {
    return createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Path", { d, width: 100, height: 100, fill: "#000000" }),
    );
  }

  it.each([
    ["M0 0 X10 10", /invalid character/],
    ["not-a-path", /invalid character|moveto/],
    ["M0 0 L", /incomplete argument group/],
    ["   ", /blank/],
    ["L10 10", /moveto/],
    ["M0 0 C1 2 3 4 5", /incomplete argument group/],
  ] as const)("rejects %j", (d, message) => {
    // These all used to render successfully as a fully transparent PNG.
    expect(() => validate(pathCanvas(d))).toThrow(message);
  });

  it.each([
    "M0 0H100V100H0Z",
    "m 10,10 l 20,0 20,10 z",
    "M0.5.5L1-1",
    "M0 0 C 10 10 20 20 30 30 40 40 50 50 60 60",
    "M0 0 A 30 50 0 0 1 60 60",
    "M0 0 L10 10 M20 20 L30 30",
  ])("accepts valid path %j", (d) => {
    expect(() => validate(pathCanvas(d))).not.toThrow();
  });
});

describe("contentIdPrefix rewrites <style> id selectors", () => {
  it("keeps style rules attached to prefixed elements", () => {
    const svgContent = `<svg viewBox="0 0 100 100"><defs><linearGradient id="grad"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient><style>#target { fill: url(#grad); } #target:hover { opacity: 0.5; }</style></defs><rect id="target" width="100" height="100"/></svg>`;
    const vnode = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Svg", {
        id: "svg1",
        content: svgContent,
        contentIdPrefix: "p-",
        width: 100,
        height: 100,
      }),
    );
    const ir = engine.renderToIR(vnode);
    const findSvg = (node: (typeof ir)["root"]): string | undefined => {
      if (node.type === "svg") {
        return node.svgContent;
      }
      for (const child of node.children ?? []) {
        const found = findSvg(child);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    };
    const content = findSvg(ir.root) ?? "";

    // Element ids and url() references were already prefixed; the selector
    // rewrite is what used to be missing, detaching every style rule.
    expect(content).toContain(`id="p-target"`);
    expect(content).toContain("url(#p-grad)");
    expect(content).toContain("#p-target {");
    expect(content).toContain("#p-target:hover");
    expect(content).not.toMatch(/#target[\s{:]/);
  });
});
