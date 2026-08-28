import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import type { IRNode } from "../../src/ir/types.js";
import { validate } from "../../src/validate/index.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;
let engine: Engine;

type EmbeddedIdFixtureCase =
  | { name: string; input: string; status: "ok"; output: string }
  | { name: string; input: string; status: "error"; error: string };

type EmbeddedIdFixture = {
  prefix: string;
  cases: EmbeddedIdFixtureCase[];
};

const embeddedIdFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../../fixtures/conformance/embedded-svg-id-reference-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as EmbeddedIdFixture;

function findSvgContent(node: IRNode): string | undefined {
  if (node.type === "svg") {
    return node.svgContent;
  }
  for (const child of node.children ?? []) {
    const content = findSvgContent(child);
    if (content !== undefined) {
      return content;
    }
  }
  return undefined;
}

function embeddedSvgScene(
  content: string,
  contentIdPrefix?: string,
): ReturnType<typeof createElement> {
  return createElement(
    "Canvas",
    { width: 100, height: 100 },
    createElement("Svg", {
      id: "svg1",
      content: `<svg viewBox="0 0 100 100">${content}</svg>`,
      ...(contentIdPrefix !== undefined && { contentIdPrefix }),
      width: 100,
      height: 100,
    }),
  );
}

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
    const content = findSvgContent(ir.root) ?? "";

    // Element ids and url() references were already prefixed; the selector
    // rewrite is what used to be missing, detaching every style rule.
    expect(content).toContain(`id="p-target"`);
    expect(content).toContain("url(#p-grad)");
    expect(content).toContain("#p-target {");
    expect(content).toContain("#p-target:hover");
    expect(content).not.toMatch(/#target[\s{:]/);
  });

  it("matches the shared reference rewrite fixture through real WASM", () => {
    for (const fixtureCase of embeddedIdFixture.cases) {
      if (fixtureCase.status === "error") {
        continue;
      }
      const ir = engine.renderToIR(embeddedSvgScene(fixtureCase.input, embeddedIdFixture.prefix));

      expect(findSvgContent(ir.root), fixtureCase.name).toBe(fixtureCase.output);
    }
  });

  it("fails atomically with structured IR errors for unsupported local references", () => {
    for (const fixtureCase of embeddedIdFixture.cases) {
      if (fixtureCase.status === "ok") {
        continue;
      }
      try {
        engine.renderToIR(embeddedSvgScene(fixtureCase.input, embeddedIdFixture.prefix));
        expect.unreachable(`${fixtureCase.name} should fail`);
      } catch (error) {
        expect(error, fixtureCase.name).toBeInstanceOf(FatalError);
        expect(error, fixtureCase.name).toMatchObject({
          code: fixtureCase.error,
          stage: "ir",
          nodeId: "svg1",
        });
      }
    }
  });

  it("preserves bytes and bypasses structural scanning without a non-empty prefix", () => {
    for (const fixtureCase of embeddedIdFixture.cases) {
      const absent = engine.renderToIR(embeddedSvgScene(fixtureCase.input));
      const empty = engine.renderToIR(embeddedSvgScene(fixtureCase.input, ""));

      expect(findSvgContent(absent.root), `${fixtureCase.name}: absent prefix`).toBe(
        fixtureCase.input,
      );
      expect(findSvgContent(empty.root), `${fixtureCase.name}: empty prefix`).toBe(
        fixtureCase.input,
      );
    }
  });
});
