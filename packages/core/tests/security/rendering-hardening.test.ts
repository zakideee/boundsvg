/**
 * Rendering-hardening regression tests:
 * markup-injection escaping, the emit_svg_from_ir SVG trust boundary,
 * non-finite visual-number rejection, and the box-shadow filter-region
 * finiteness guard.
 *
 * Prerequisite: `pnpm build:wasm`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import type { IR } from "../../src/ir/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import {
  createEngineFromHandle,
  createFontedWasmHandle,
  emitAnimatedSvgFromIrViaHandle,
  emitSvgFromIrViaHandle,
} from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;
let engine: Engine;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
  engine = createEngineFromHandle(handle);
});

afterAll(() => {
  handle.dispose();
});

describe("attribute escaping (markup injection)", () => {
  it("rejects an out-of-enum stroke-linejoin returned in a text stroke layer", () => {
    const scene = createElement(
      "Canvas",
      { width: 200, height: 80 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 24,
          // A JS/untyped caller can supply an out-of-enum value. Even if the
          // Rust input path accepts it, the decoded public IR must not claim
          // that the value satisfies TextStrokeLayer's closed union.
          textStrokes: [
            { color: "#f00", widthPx: 2, linejoin: 'x"><script>bad</script>' as never },
          ],
        },
        "A",
      ),
    );
    expect(() => engine.renderToSvgAndIR(scene)).toThrowError(
      expect.objectContaining({
        name: "FatalError",
        code: "WASM_INVALID_SVG_OUTPUT",
        stage: "wasm",
        context: expect.objectContaining({
          protocolPath: expect.stringContaining(".strokes[0].linejoin"),
        }),
      }),
    );
  });

  it("escapes a raw image preserveAspectRatio in a hand-built IR", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 100, h: 100 },
        children: [
          {
            type: "image",
            nodeId: "img",
            bbox: { x: 0, y: 0, w: 50, h: 50 },
            src: "data:image/png;base64,AA==",
            preserveAspectRatio: 'none"><script>x</script>',
          },
        ],
      },
      drawOrder: ["img"],
      width: 100,
      height: 100,
      warnings: [],
    };
    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).not.toContain("<script>x</script>");
  });
});

describe("emit_svg_from_ir SVG trust boundary", () => {
  it("rejects unsafe nested-svg content in a hand-built IR", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 100, h: 100 },
        children: [
          {
            type: "svg",
            nodeId: "nested",
            bbox: { x: 0, y: 0, w: 50, h: 50 },
            svgContent: '<script id="pwn">alert(1)</script>',
            preserveAspectRatio: "none",
          },
        ],
      },
      drawOrder: ["nested"],
      width: 100,
      height: 100,
      warnings: [],
    };
    let caught: unknown;
    try {
      emitSvgFromIrViaHandle(handle, ir);
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toContain("disallowed markup");
  });

  it("rejects a character-reference-obfuscated javascript: URI", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 100, h: 100 },
        children: [
          {
            type: "svg",
            nodeId: "nested",
            bbox: { x: 0, y: 0, w: 50, h: 50 },
            // `java&#x73;cript:` decodes to `javascript:` — the scheme check
            // must decode before matching.
            svgContent: '<a href="java&#x73;cript:alert(1)"><rect width="10" height="10"/></a>',
            preserveAspectRatio: "none",
          },
        ],
      },
      drawOrder: ["nested"],
      width: 100,
      height: 100,
      warnings: [],
    };
    let caught: unknown;
    try {
      emitSvgFromIrViaHandle(handle, ir);
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toContain("disallowed markup");
  });
});

describe("part paint attribute escaping", () => {
  it("escapes a partPaint stroke-linejoin from the public API", () => {
    const geometry = {
      viewBox: { width: 10, height: 10 },
      root: { kind: "path" as const, nodeId: "only", d: "M0 0 H10 V10 H0 Z" },
    };
    const scene = createElement(
      "Canvas",
      { width: 60, height: 60 },
      createElement("Shape", {
        geometry,
        width: 40,
        height: 40,
        fill: "#0f0",
        emitPartIds: true,
        // validate does not constrain partPaint enum strings at runtime.
        partPaint: {
          only: {
            stroke: "#000",
            strokeWidth: 2,
            strokeLinejoin: 'x"><script>y</script>' as never,
          },
        },
      }),
    );
    const svg = engine.renderToSvg(scene);
    expect(svg).not.toContain("<script>y</script>");
  });
});

describe("non-finite visual numbers", () => {
  const captureFatal = (run: () => unknown): FatalError => {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(FatalError);
      return error as FatalError;
    }
    throw new Error("expected validation to throw");
  };

  it("rejects NaN opacity instead of silently rendering fully opaque", () => {
    const error = captureFatal(() =>
      engine.renderToSvg(
        createElement(
          "Canvas",
          { width: 50, height: 50 },
          createElement("Box", { width: 20, height: 20, background: "#f00", opacity: Number.NaN }),
        ),
      ),
    );
    expect(error.code).toBe("VALIDATION");
    expect(error.message).toContain("opacity");
  });

  it("rejects Infinity borderWidth and malformed borderRadius", () => {
    expect(
      captureFatal(() =>
        engine.renderToSvg(
          createElement(
            "Canvas",
            { width: 50, height: 50 },
            createElement("Box", {
              width: 20,
              height: 20,
              borderWidth: Number.POSITIVE_INFINITY,
              borderColor: "#000",
            }),
          ),
        ),
      ).message,
    ).toContain("borderWidth");

    expect(
      captureFatal(() =>
        engine.renderToSvg(
          createElement(
            "Canvas",
            { width: 50, height: 50 },
            createElement("Box", {
              width: 20,
              height: 20,
              background: "#f00",
              borderRadius: [1, 2, 3] as never,
            }),
          ),
        ),
      ).message,
    ).toContain("borderRadius");
  });
});

describe("box-shadow filter region", () => {
  it("fails on a finite-but-overflowing filter region instead of emitting Infinity%", () => {
    let caught: unknown;
    try {
      engine.renderToSvg(
        createElement(
          "Canvas",
          { width: 50, height: 50 },
          createElement("Box", {
            width: 20,
            height: 20,
            background: "#eee",
            boxShadow: `${Number.MAX_VALUE} ${Number.MAX_VALUE} 0 0 #000`,
          }),
        ),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FatalError);
    expect((caught as FatalError).code).toBe("INVALID_NUMBER");
  });
});

describe("hand-built IR spring easing", () => {
  function springIr(stiffness: number): IR {
    return {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 100, h: 100 },
        children: [
          {
            type: "group",
            nodeId: "animated",
            bbox: { x: 0, y: 0, w: 50, h: 50 },
            children: [
              {
                type: "rect",
                nodeId: "painted",
                bbox: { x: 0, y: 0, w: 50, h: 50 },
                background: "#2563eb",
              },
            ],
            animation: {
              keyframes: [
                { at: 0, opacity: 0 },
                { at: 1, opacity: 1 },
              ],
              durationMs: 400,
              easing: { type: "spring", stiffness },
            },
          },
        ],
      },
      drawOrder: [],
      width: 100,
      height: 100,
      warnings: [],
    } as unknown as IR;
  }

  // The CSS linear() expansion resolves defaults without re-validating, so the
  // emit entry itself must reject an out-of-range spring rather than formatting
  // a garbage curve into the stylesheet.
  it.each([0.5, 5000])("rejects a spring stiffness of %p at the emit boundary", (stiffness) => {
    let caught: unknown;
    try {
      emitAnimatedSvgFromIrViaHandle(handle, springIr(stiffness), {
        playback: { mode: "independent" },
      });
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toContain("ANIMATION_INVALID_SPEC");
  });

  it("emits a finite linear() curve for an in-range hand-built spring", () => {
    const svg = emitAnimatedSvgFromIrViaHandle(handle, springIr(170), {
      playback: { mode: "independent" },
    });
    const timingFunction = /animation-timing-function: (linear\([^)]*\));/.exec(svg)?.[1];

    expect(timingFunction, svg).toBeDefined();
    expect(timingFunction).not.toMatch(/NaN|inf|e[+-]/i);
  });
});
