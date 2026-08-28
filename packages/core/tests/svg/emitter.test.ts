/**
 * WASM emitter contract: hand-built IRs driven through the `emit_svg_from_ir`
 * export must produce the pinned SVG markup (attributes, escaping, debug
 * overlays, defs, draw order). This suite is the TS-side net for the Rust
 * emitter's IR-consumption behavior; the Rust crate carries its own unit
 * tests for the emission internals.
 *
 * Prerequisite: `pnpm build:wasm`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IR, IRNode } from "../../src/ir/types.js";
import { createResourceIdPrefix } from "../../src/svg/resource-id.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import {
  createFontedWasmHandle,
  emitAnimatedSvgFromIrViaHandle,
  emitSvgFromIrViaHandle,
} from "../helpers/wasm-render-engine.js";

let handle: WasmEngineHandle;

beforeAll(async () => {
  handle = await createFontedWasmHandle();
});

afterAll(() => {
  handle.dispose();
});

function makeIR(children: IRNode[], drawOrder: string[], width = 800, height = 600): IR {
  return {
    root: {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: width, h: height },
      children,
    },
    drawOrder,
    width,
    height,
    warnings: [],
  };
}

function makeIdentifierNamespaceIR(): IR {
  const animation = {
    keyframes: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    durationMs: 400,
    easing: "linear" as const,
  };
  const sharedShapePart = { d: "M150 20H170V40H150Z" };

  return makeIR(
    [
      {
        type: "group",
        nodeId: "panel",
        bbox: { x: 10, y: 10, w: 120, h: 80 },
        clipPath: { x: 10, y: 10, w: 120, h: 80 },
        boxShadow: { dx: 1, dy: 2, blur: 4, spread: 0, color: "#0008" },
        meta: { scope: "raw-resourceIdPrefix-doc-clip-" },
        animation,
        children: [
          {
            type: "rect",
            nodeId: "panel:bg",
            bbox: { x: 10, y: 10, w: 120, h: 80 },
            gradient: {
              type: "linear",
              angle: 90,
              stops: [
                { color: "#000000", offset: 0 },
                { color: "#ffffff", offset: 1 },
              ],
            },
          },
          {
            type: "rect",
            nodeId: "panel:border",
            bbox: { x: 12, y: 12, w: 116, h: 76 },
            fill: "none",
            stroke: "#ffffff",
            strokeWidth: 1,
            strokeScaling: "canvas",
          },
          {
            type: "path",
            nodeId: "hairline-path",
            bbox: { x: 20, y: 20, w: 80, h: 30 },
            pathData: "M20 20H100V50",
            fill: "none",
            stroke: "#ff00ff",
            strokeWidth: 2,
            strokeScaling: "canvas",
          },
        ],
      },
      {
        type: "text",
        nodeId: "unit-text",
        bbox: { x: 20, y: 100, w: 20, h: 20 },
        lines: [{ text: "A", glyphs: [], width: 20, baselineY: 16 }],
        font: "F",
        fontSizePx: 16,
        color: "#111111",
        textAlign: "start",
        layoutBox: { x: 20, y: 100, w: 20, h: 20 },
        lineHeightPx: 20,
        glyphPaths: [
          {
            nodeId: "unit-text",
            d: "M20 100H36V116H20Z",
            fill: "#111111",
            glyphIds: [1],
            text: "A",
            bbox: { x: 20, y: 100, w: 16, h: 16 },
            unitId: "unit-0",
          },
        ],
        unitMap: {
          kind: "cluster",
          ruby: "with-base",
          units: [
            {
              unitId: "unit-0",
              kind: "cluster",
              sourceStart: 0,
              sourceEnd: 1,
              lineId: "line-0",
              logicalOrder: 0,
              visualOrder: 0,
              members: [{ lineIndex: 0, glyphIndex: 0, sourceRole: "content" }],
            },
          ],
        },
        unitAnimation: {
          by: "cluster",
          animation,
          delayStepMs: 25,
        },
        unitAnimationSamples: [
          {
            unitId: "unit-0",
            bbox: { x: 20, y: 100, w: 16, h: 16 },
            opacity: 0.5,
          },
        ],
      },
      {
        type: "shape",
        nodeId: "shape-left",
        bbox: { x: 150, y: 20, w: 20, h: 20 },
        shapeParts: [sharedShapePart],
        fill: "#2563eb",
      },
      {
        type: "shape",
        nodeId: "shape-right",
        bbox: { x: 180, y: 20, w: 20, h: 20 },
        shapeParts: [sharedShapePart],
        fill: "#2563eb",
      },
      {
        type: "svg",
        nodeId: "raw-svg",
        bbox: { x: 150, y: 80, w: 40, h: 40 },
        svgContent: '<path data-token="raw-resourceIdPrefix-doc-clip-" d="M0 0H1"/>',
        svgViewBox: "0 0 1 1",
        preserveAspectRatio: "xMidYMid meet",
      },
    ],
    [
      "panel:bg",
      "panel:border",
      "hairline-path",
      "unit-text",
      "shape-left",
      "shape-right",
      "raw-svg",
    ],
    240,
    160,
  );
}

function makeNodeMetadataIR(): IR {
  return makeIR(
    [
      {
        type: "group",
        nodeId: "group-node",
        bbox: { x: 0, y: 0, w: 40, h: 40 },
        meta: { scope: "kept-meta" },
        children: [
          {
            type: "rect",
            nodeId: "rect-node",
            bbox: { x: 1, y: 1, w: 10, h: 8 },
            fill: "#ef4444",
          },
          {
            type: "rect",
            nodeId: "rounded-rect-node",
            bbox: { x: 14, y: 1, w: 10, h: 8 },
            fill: "#f59e0b",
            borderRadius: 2,
          },
        ],
      },
      {
        type: "text",
        nodeId: "text-node",
        bbox: { x: 0, y: 44, w: 20, h: 12 },
        lines: [{ text: "A", glyphs: [], width: 8, baselineY: 9 }],
        font: "Fixture",
        fontSizePx: 10,
        color: "#111827",
        textAlign: "start",
        layoutBox: { x: 0, y: 44, w: 20, h: 12 },
        lineHeightPx: 12,
        glyphPaths: [
          {
            nodeId: "text-node",
            d: "M0 44H8V52Z",
            fill: "#111827",
            glyphIds: [1],
            text: "A",
            bbox: { x: 0, y: 44, w: 8, h: 8 },
          },
        ],
      },
      {
        type: "image",
        nodeId: "image-node",
        bbox: { x: 24, y: 44, w: 8, h: 8 },
        src: "data:image/png;base64,AA==",
        preserveAspectRatio: "xMidYMid meet",
      },
      {
        type: "path",
        nodeId: "path-node",
        bbox: { x: 36, y: 44, w: 8, h: 8 },
        pathData: "M0 0H8V8Z",
        fill: "#22c55e",
      },
      {
        type: "svg",
        nodeId: "svg-node",
        bbox: { x: 48, y: 44, w: 8, h: 8 },
        svgContent:
          '<path data-boundsvg-node-id="raw-authored" data-boundsvg-part-id="raw-part" d="M0 0H1"/>',
        svgViewBox: "0 0 1 1",
        preserveAspectRatio: "xMidYMid meet",
      },
      {
        type: "shape",
        nodeId: "shape-node",
        bbox: { x: 60, y: 44, w: 8, h: 8 },
        shapeParts: [{ partId: "shape-part", d: "M60 44H68V52Z" }],
        fill: "#3b82f6",
      },
    ],
    [
      "rect-node",
      "rounded-rect-node",
      "text-node",
      "image-node",
      "path-node",
      "svg-node",
      "shape-node",
    ],
    80,
    64,
  );
}

type GeneratedIdentifierInventory = {
  ids: Set<string>;
  classes: Set<string>;
  keyframes: Set<string>;
  references: Set<string>;
  animationNames: Set<string>;
  selectorClasses: Set<string>;
};

function cssUnescapeGeneratedIdentifier(identifier: string): string {
  return identifier.replace(/\\(.)/gu, "$1");
}

function captures(svg: string, pattern: RegExp): string[] {
  return [...svg.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

function generatedIdentifierInventory(svg: string): GeneratedIdentifierInventory {
  const ids = new Set(captures(svg, /(?:^|[<\s])id="([^"]+)"/gu));
  const classes = new Set(
    captures(svg, /\sclass="([^"]+)"/gu).flatMap((classList) => classList.split(/\s+/u)),
  );
  const keyframes = new Set(
    captures(svg, /@keyframes\s+((?:\\.|[^\s{])+)/gu).map(cssUnescapeGeneratedIdentifier),
  );
  const references = new Set([
    ...captures(svg, /url\(#([^)]+)\)/gu),
    ...captures(svg, /\shref="#([^"]+)"/gu),
  ]);
  const animationNames = new Set(
    captures(svg, /animation-name:\s+((?:\\.|[^;\s])+);/gu).map(cssUnescapeGeneratedIdentifier),
  );
  const selectorClasses = new Set(
    captures(svg, /^\s*\.((?:\\.|[^\s,{])+)(?:\s*,|\s*\{)/gmu).map(cssUnescapeGeneratedIdentifier),
  );
  return { ids, classes, keyframes, references, animationNames, selectorClasses };
}

function sortedIntersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => right.has(value)).sort();
}

describe("emit_svg_from_ir", () => {
  it("generates valid SVG with viewBox", () => {
    const ir = makeIR([], []);
    const svg = emitSvgFromIrViaHandle(handle, ir);

    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('data-boundsvg-node-id="root"');
    expect(svg).toContain('viewBox="0 0 800 600"');
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("omits only generated node metadata across every emitter site", () => {
    const ir = makeNodeMetadataIR();
    const irBefore = JSON.stringify(ir);
    const generator = { name: "metadata-test", version: "0.3.0" };
    const defaultSvg = emitSvgFromIrViaHandle(handle, ir, { generator });
    const includedSvg = emitSvgFromIrViaHandle(handle, ir, {
      generator,
      nodeIdMetadata: "include",
    });
    const omittedSvg = emitSvgFromIrViaHandle(handle, ir, {
      generator,
      nodeIdMetadata: "omit",
    });

    expect(includedSvg).toBe(defaultSvg);
    for (const nodeId of [
      "root",
      "group-node",
      "rect-node",
      "rounded-rect-node",
      "text-node",
      "image-node",
      "path-node",
      "svg-node",
      "shape-node",
    ]) {
      expect(defaultSvg).toContain(`data-boundsvg-node-id="${nodeId}"`);
      expect(omittedSvg).not.toContain(`data-boundsvg-node-id="${nodeId}"`);
    }
    expect(omittedSvg).toContain('data-boundsvg-node-id="raw-authored"');
    expect(omittedSvg).toContain('data-boundsvg-part-id="raw-part"');
    expect(omittedSvg).toContain('data-boundsvg-part-id="shape-part"');
    expect(omittedSvg).toContain('data-boundsvg-meta-scope="kept-meta"');
    expect(omittedSvg).toContain('data-boundsvg-generator="metadata-test"');
    expect(omittedSvg).toContain('data-boundsvg-generator-version="0.3.0"');
    expect(JSON.stringify(ir)).toBe(irBefore);
  });

  it("emits rect with fill", () => {
    const ir = makeIR(
      [
        {
          type: "rect",
          nodeId: "bg",
          bbox: { x: 10, y: 20, w: 200, h: 100 },
          fill: "#ff0000",
        },
      ],
      ["bg"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('data-boundsvg-node-id="bg"');
    expect(svg).toContain('<rect x="10" y="20" width="200" height="100"');
    expect(svg).toContain('fill="#ff0000"');
  });

  it("emits rect with stroke and borderRadius", () => {
    const ir = makeIR(
      [
        {
          type: "rect",
          nodeId: "border",
          bbox: { x: 0, y: 0, w: 100, h: 50 },
          stroke: "#000000",
          strokeWidth: 2,
          borderRadius: 8,
        },
      ],
      ["border"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('rx="8"');
    expect(svg).toContain('ry="8"');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('fill="none"');
  });

  it("emits a canvas-stable fallback and browser non-scaling stroke rule", () => {
    const ir = makeIR(
      [
        {
          type: "group",
          nodeId: "camera",
          bbox: { x: 0, y: 0, w: 96, h: 64 },
          transform: { scaleX: 1.6, scaleY: 1.6, originX: 0, originY: 0 },
          children: [
            {
              type: "rect",
              nodeId: "camera:border",
              bbox: { x: 8, y: 8, w: 40, h: 20 },
              stroke: "#fff",
              strokeWidth: 1,
              strokeScaling: "canvas",
            },
          ],
        },
      ],
      ["camera:border"],
      96,
      64,
    );

    const svg = emitSvgFromIrViaHandle(handle, ir, { scale: 2 });
    expect(svg).toContain('class="bsvg-vstroke-camera"');
    expect(svg).toContain('stroke-width="0.625"');
    expect(svg).toContain("@supports (vector-effect: non-scaling-stroke)");
    expect(svg).toContain("stroke-width: 2;");
    expect(svg).toContain("vector-effect: non-scaling-stroke;");
  });

  it("emits canvas-stable rules on the inner Path element", () => {
    const ir = makeIR(
      [
        {
          type: "group",
          nodeId: "camera",
          bbox: { x: 0, y: 0, w: 96, h: 64 },
          transform: { scaleX: 1.6, scaleY: 1.6, originX: 0, originY: 0 },
          children: [
            {
              type: "path",
              nodeId: "hairline-path",
              bbox: { x: 8, y: 8, w: 40, h: 20 },
              pathData: "M0 0H40V20H0Z",
              fill: "none",
              stroke: "#fff",
              strokeWidth: 1,
              strokeScaling: "canvas",
            },
          ],
        },
      ],
      ["hairline-path"],
      96,
      64,
    );

    const svg = emitSvgFromIrViaHandle(handle, ir, { scale: 2 });
    expect(svg).toContain('<path d="M0 0H40V20H0Z" class="bsvg-vstroke-hairline-path"');
    expect(svg).toContain('stroke-width="0.625"');
    expect(svg).toContain("@supports (vector-effect: non-scaling-stroke)");
    expect(svg).toContain("stroke-width: 2;");
    expect(svg).toContain("vector-effect: non-scaling-stroke;");
  });

  it("keeps omitted and explicit transform stroke scaling byte-identical", () => {
    const rect: IRNode = {
      type: "rect",
      nodeId: "border",
      bbox: { x: 0, y: 0, w: 10, h: 10 },
      stroke: "#fff",
      strokeWidth: 1,
    };
    const omitted = emitSvgFromIrViaHandle(handle, makeIR([rect], ["border"], 10, 10));
    const explicit = emitSvgFromIrViaHandle(
      handle,
      makeIR([{ ...rect, strokeScaling: "transform" }], ["border"], 10, 10),
    );
    expect(explicit).toBe(omitted);
  });

  it("uses one style element for animation, reduced motion, and canvas stroke rules", () => {
    const ir = makeIR(
      [
        {
          type: "group",
          nodeId: "camera",
          bbox: { x: 0, y: 0, w: 20, h: 20 },
          animation: {
            keyframes: [
              { at: 0, transform: { scaleX: 1, scaleY: 1 } },
              { at: 1, transform: { scaleX: 2, scaleY: 2 } },
            ],
            durationMs: 100,
            easing: "linear",
          },
          children: [
            {
              type: "rect",
              nodeId: "camera:border",
              bbox: { x: 2, y: 2, w: 10, h: 10 },
              stroke: "#fff",
              strokeWidth: 1,
              strokeScaling: "canvas",
            },
          ],
        },
      ],
      ["camera:border"],
      20,
      20,
    );
    const svg = emitAnimatedSvgFromIrViaHandle(handle, ir, {
      playback: { mode: "independent" },
      reducedMotion: "pause",
      timeMs: 50,
    });
    expect(svg.match(/<style>/g)).toHaveLength(1);
    expect(svg).toContain("@keyframes");
    expect(svg).toContain("prefers-reduced-motion");
    expect(svg).toContain("@supports (vector-effect: non-scaling-stroke)");
    expect(svg).toContain('stroke-width="0.666667"');
  });

  it("escapes prefixed canvas-stroke class selectors deterministically", () => {
    const ir = makeIR(
      [
        {
          type: "group",
          nodeId: "card one",
          bbox: { x: 0, y: 0, w: 10, h: 10 },
          children: [
            {
              type: "rect",
              nodeId: "card one:border",
              bbox: { x: 0, y: 0, w: 10, h: 10 },
              stroke: "#fff",
              strokeWidth: 1,
              strokeScaling: "canvas",
            },
          ],
        },
      ],
      ["card one:border"],
      10,
      10,
    );
    const prefix = createResourceIdPrefix("unsafe prefix");
    const svg = emitSvgFromIrViaHandle(handle, ir, { resourceIdPrefix: prefix });
    const className = svg.match(/class="([^"]*vstroke-[^"]+)"/)?.[1];
    expect(className).toBeDefined();
    expect(className).not.toContain(" ");
    expect(svg).toContain(`.${className?.replaceAll(":", "\\:")}`);
  });

  it("rejects unknown hand-authored strokeScaling values", () => {
    const ir = makeIR(
      [
        {
          type: "rect",
          nodeId: "border",
          bbox: { x: 0, y: 0, w: 10, h: 10 },
          stroke: "#fff",
          strokeWidth: 1,
          strokeScaling: "canvas" as unknown as "transform",
        },
      ],
      ["border"],
      10,
      10,
    );
    Reflect.set(ir.root.children?.[0] ?? {}, "strokeScaling", "viewport");
    expect(() => emitSvgFromIrViaHandle(handle, ir)).toThrow(/unknown variant.*viewport/i);
  });

  it("rejects unknown hand-authored Path strokeScaling values", () => {
    const ir = makeIR(
      [
        {
          type: "path",
          nodeId: "path",
          bbox: { x: 0, y: 0, w: 10, h: 10 },
          pathData: "M0 0L10 10",
          stroke: "#fff",
          strokeWidth: 1,
          strokeScaling: "canvas",
        },
      ],
      ["path"],
      10,
      10,
    );
    Reflect.set(ir.root.children?.[0] ?? {}, "strokeScaling", "viewport");
    expect(() => emitSvgFromIrViaHandle(handle, ir)).toThrow(/unknown variant.*viewport/i);
  });

  it("emits text as glyph path wrapper with metadata", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "txt1",
          bbox: { x: 10, y: 10, w: 200, h: 40 },
          font: "NotoSansJP",
          fontSizePx: 16,
          color: "#333333",
          textAlign: "start",
          layoutBox: { x: 10, y: 10, w: 200, h: 40 },
          lineHeightPx: 19.2,
          lines: [
            { text: "Hello", glyphs: [], width: 48, baselineY: 15.36 },
            { text: "World", glyphs: [], width: 48, baselineY: 34.56 },
          ],
          glyphPaths: [
            {
              nodeId: "txt1",
              d: "M0 0L10 0",
              fill: "#333333",
              glyphIds: [1, 2],
              text: "Hello\nWorld",
              bbox: { x: 0, y: 0, w: 10, h: 10 },
            },
          ],
        },
      ],
      ["txt1"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('data-boundsvg-node-id="txt1"');
    expect(svg).toContain('data-boundsvg-text="Hello');
    expect(svg).toContain('aria-label="Hello');
    expect(svg).toContain('<path d="M0 0L10 0" fill="#333333"/>');
    expect(svg).not.toContain("<tspan");
    expect(svg).not.toContain("<text");
  });

  it("emits multiple path runs when glyph fills differ", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "txt-frag",
          bbox: { x: 10, y: 10, w: 200, h: 20 },
          font: "BaseFont",
          fontSizePx: 16,
          color: "#000000",
          textAlign: "start",
          layoutBox: { x: 10, y: 10, w: 200, h: 20 },
          lineHeightPx: 19.2,
          lines: [
            {
              text: "ABC",
              glyphs: [],
              width: 30,
              baselineY: 14,
              fragments: [
                {
                  text: "A",
                  glyphs: [],
                  width: 10,
                  style: {
                    font: "BaseFont",
                    fontWeight: 400,
                    fontStyle: "normal",
                    color: "#ff0000",
                    fontSizePx: 16,
                    letterSpacingPx: 0,
                  },
                },
                {
                  text: "BC",
                  glyphs: [],
                  width: 20,
                  style: {
                    font: "BaseFont",
                    fontWeight: 400,
                    fontStyle: "normal",
                    color: "#0000ff",
                    fontSizePx: 16,
                    letterSpacingPx: 0,
                  },
                },
              ],
            },
          ],
          glyphPaths: [
            {
              nodeId: "txt-frag",
              d: "M0 0L10 0",
              fill: "#ff0000",
              glyphIds: [1],
              text: "A",
              bbox: { x: 0, y: 0, w: 10, h: 10 },
            },
            {
              nodeId: "txt-frag",
              d: "M10 0L30 0",
              fill: "#0000ff",
              glyphIds: [2, 3],
              text: "BC",
              bbox: { x: 10, y: 0, w: 20, h: 10 },
            },
          ],
        },
      ],
      ["txt-frag"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('fill="#0000ff"');
    expect(svg).not.toContain("<tspan");
  });

  it("emits fill per glyph path when provided", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "txt-path",
          bbox: { x: 0, y: 0, w: 100, h: 20 },
          font: "F",
          fontSizePx: 16,
          color: "#111111",
          textAlign: "start",
          layoutBox: { x: 0, y: 0, w: 100, h: 20 },
          lineHeightPx: 19.2,
          lines: [{ text: "A", glyphs: [], width: 10, baselineY: 14 }],
          glyphPaths: [
            {
              nodeId: "txt-path",
              d: "M0 0L10 0",
              fill: "#ff0000",
              glyphIds: [1],
              text: "A",
              bbox: { x: 0, y: 0, w: 10, h: 1 },
            },
            {
              nodeId: "txt-path",
              d: "M0 1L10 1",
              fill: "#0000ff",
              glyphIds: [2],
              text: "A",
              bbox: { x: 0, y: 1, w: 10, h: 1 },
            },
          ],
        },
      ],
      ["txt-path"],
    );
    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('<path d="M0 0L10 0" fill="#ff0000"/>');
    expect(svg).toContain('<path d="M0 1L10 1" fill="#0000ff"/>');
  });

  it("emits image with data URI", () => {
    const ir = makeIR(
      [
        {
          type: "image",
          nodeId: "img1",
          bbox: { x: 50, y: 50, w: 200, h: 150 },
          src: "data:image/png;base64,AAAA",
          preserveAspectRatio: "xMidYMid meet",
        },
      ],
      ["img1"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain("<image");
    expect(svg).toContain('data-boundsvg-node-id="img1"');
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("emits group wrappers with data-boundsvg-node-id attribute", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            type: "group",
            nodeId: "panel",
            bbox: { x: 10, y: 10, w: 120, h: 80 },
            children: [
              {
                type: "text",
                nodeId: "label",
                bbox: { x: 20, y: 20, w: 40, h: 20 },
                font: "F",
                fontSizePx: 16,
                color: "#000000",
                textAlign: "start",
                layoutBox: { x: 20, y: 20, w: 40, h: 20 },
                lineHeightPx: 19.2,
                lines: [{ text: "A", glyphs: [], width: 12, baselineY: 14 }],
                glyphPaths: [
                  {
                    nodeId: "label",
                    d: "M0 0L10 0",
                    fill: "#000000",
                    glyphIds: [1],
                    text: "A",
                    bbox: { x: 20, y: 20, w: 12, h: 12 },
                  },
                ],
              },
            ],
          },
        ],
      },
      drawOrder: ["label"],
      width: 300,
      height: 200,
      warnings: [],
    };

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('<g data-boundsvg-node-id="panel">');
  });

  it("emits nested svg wrappers with data-boundsvg-node-id attribute", () => {
    const ir = makeIR(
      [
        {
          type: "svg",
          nodeId: "badge",
          bbox: { x: 16, y: 24, w: 48, h: 48 },
          svgContent: '<circle cx="24" cy="24" r="20"/>',
          svgViewBox: "0 0 48 48",
          preserveAspectRatio: "xMidYMid meet",
        },
      ],
      ["badge"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain(
      '<svg data-boundsvg-node-id="badge" x="16" y="24" width="48" height="48"',
    );
  });

  it("does not emit data-boundsvg-node-id for internal background and border rects", () => {
    const ir = makeIR(
      [
        {
          type: "group",
          nodeId: "panel",
          bbox: { x: 0, y: 0, w: 120, h: 80 },
          children: [
            {
              type: "rect",
              nodeId: "panel:bg",
              bbox: { x: 0, y: 0, w: 120, h: 80 },
              fill: "#ffffff",
            },
            {
              type: "rect",
              nodeId: "panel:border",
              bbox: { x: 0, y: 0, w: 120, h: 80 },
              stroke: "#000000",
            },
          ],
        },
      ],
      ["panel:bg", "panel:border"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).not.toContain('data-boundsvg-node-id="panel:bg"');
    expect(svg).not.toContain('data-boundsvg-node-id="panel:border"');
    expect(svg).toContain('data-boundsvg-node-id="panel"');
  });

  it("emits clipPath definitions", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        clipPath: { x: 0, y: 0, w: 800, h: 600 },
        children: [
          {
            type: "rect",
            nodeId: "bg",
            bbox: { x: 0, y: 0, w: 200, h: 100 },
            fill: "#ff0000",
          },
        ],
      },
      drawOrder: ["bg"],
      width: 800,
      height: 600,
      warnings: [],
    };

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain("<defs>");
    expect(svg).toContain("<clipPath");
    expect(svg).toContain("clip-root");
    expect(svg).toContain("</clipPath>");
    expect(svg).toContain("</defs>");
  });

  it("applies resourceIdPrefix to generated defs and references", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 300, h: 200 },
        children: [
          {
            type: "group",
            nodeId: "panel",
            bbox: { x: 10, y: 10, w: 120, h: 80 },
            clipPath: { x: 10, y: 10, w: 120, h: 80 },
            boxShadow: { dx: 1, dy: 2, blur: 4, spread: 0, color: "rgba(0,0,0,0.3)" },
            children: [
              {
                type: "rect",
                nodeId: "bg",
                bbox: { x: 10, y: 10, w: 120, h: 80 },
                gradient: {
                  type: "linear",
                  angle: 90,
                  stops: [
                    { color: "#000000", offset: 0 },
                    { color: "#ffffff", offset: 1 },
                  ],
                },
              },
            ],
          },
        ],
      },
      drawOrder: ["bg"],
      width: 300,
      height: 200,
      warnings: [],
    };

    const svg = emitSvgFromIrViaHandle(handle, ir, { resourceIdPrefix: "doc-a-" });

    expect(svg).toContain('id="doc-a-clip-panel"');
    expect(svg).toContain('clip-path="url(#doc-a-clip-panel)"');
    expect(svg).toContain('id="doc-a-grad-bg"');
    expect(svg).toContain('fill="url(#doc-a-grad-bg)"');
    expect(svg).toContain('id="doc-a-filter-panel"');
    expect(svg).toContain('filter="url(#doc-a-filter-panel)"');
    expect(svg).not.toContain('id="clip-panel"');
    expect(svg).not.toContain("url(#clip-panel)");
  });

  it("namespaces every generated document-global identifier and closes its references", () => {
    const ir = makeIdentifierNamespaceIR();
    const prefixA = createResourceIdPrefix("scope-a-000");
    const prefixB = createResourceIdPrefix("scope-b-000");
    const svgA = emitAnimatedSvgFromIrViaHandle(handle, ir, {
      debug: true,
      playback: { mode: "independent" },
      resourceIdPrefix: prefixA,
    });
    const svgB = emitAnimatedSvgFromIrViaHandle(handle, ir, {
      debug: true,
      playback: { mode: "independent" },
      resourceIdPrefix: prefixB,
    });
    const inventoryA = generatedIdentifierInventory(svgA);
    const inventoryB = generatedIdentifierInventory(svgB);

    expect(sortedIntersection(inventoryA.ids, inventoryB.ids)).toEqual([]);
    expect(sortedIntersection(inventoryA.classes, inventoryB.classes)).toEqual([]);
    expect(sortedIntersection(inventoryA.keyframes, inventoryB.keyframes)).toEqual([]);

    for (const inventory of [inventoryA, inventoryB]) {
      expect(inventory.ids.size).toBeGreaterThanOrEqual(4);
      expect(inventory.classes.size).toBeGreaterThanOrEqual(5);
      expect(inventory.keyframes.size).toBeGreaterThanOrEqual(2);
      for (const reference of inventory.references) {
        expect(inventory.ids.has(reference), `missing local definition for #${reference}`).toBe(
          true,
        );
      }
      for (const animationName of inventory.animationNames) {
        expect(
          inventory.keyframes.has(animationName),
          `missing local @keyframes ${animationName}`,
        ).toBe(true);
      }
      const styleBoundClasses = [...inventory.classes].filter(
        (className) => className.includes("anim-") || className.includes("vstroke-"),
      );
      for (const className of styleBoundClasses) {
        expect(
          inventory.selectorClasses.has(className),
          `missing local selector for .${className}`,
        ).toBe(true);
      }
    }

    expect(inventoryA.classes).toContain(`bsvg-${prefixA}vstroke-panel`);
    expect(inventoryA.classes).toContain(`bsvg-${prefixA}vstroke-hairline-path`);
    expect(inventoryA.classes).toContain(`bsvg-${prefixA}debug-overlay`);
    expect([...inventoryA.ids]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^scope-a-000-sp-/u)]),
    );
    expect([...inventoryA.keyframes]).toEqual(
      expect.arrayContaining([
        `${prefixA}anim-panel-keyframes`,
        `${prefixA}anim-unit-text:unit:0-keyframes`,
      ]),
    );
    for (const svg of [svgA, svgB]) {
      expect(svg).toContain('data-boundsvg-meta-scope="raw-resourceIdPrefix-doc-clip-"');
      expect(svg).toContain('<path data-token="raw-resourceIdPrefix-doc-clip-" d="M0 0H1"/>');
    }
  });

  it("keeps the comprehensive generated-token fixture byte-identical without a prefix", () => {
    const ir = makeIdentifierNamespaceIR();
    const omitted = emitAnimatedSvgFromIrViaHandle(handle, ir, {
      debug: true,
      playback: { mode: "independent" },
    });
    const explicitEmpty = emitAnimatedSvgFromIrViaHandle(handle, ir, {
      debug: true,
      playback: { mode: "independent" },
      resourceIdPrefix: "",
    });

    expect(explicitEmpty).toBe(omitted);
    expect(omitted).toContain('<g class="debug-overlay" opacity="0.4">');
    expect(omitted).toContain('class="bsvg-vstroke-panel"');
    expect(omitted).toContain("@keyframes anim-panel-keyframes");
  });

  it("creates deterministic resource ID prefixes", () => {
    expect(createResourceIdPrefix()).toBe("bsvg-");
    expect(createResourceIdPrefix("doc a")).toBe("doc-a-");
    expect(createResourceIdPrefix("  ")).toBe("bsvg-");
  });

  it("clips debug overlays by ancestor clip paths", () => {
    const ir: IR = {
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 160, h: 160 },
        children: [
          {
            type: "group",
            nodeId: "clipper",
            bbox: { x: 20, y: 20, w: 80, h: 80 },
            clipPath: { x: 20, y: 20, w: 80, h: 80 },
            children: [
              {
                type: "text",
                nodeId: "txt-clipped",
                bbox: { x: 24, y: 24, w: 48, h: 120 },
                font: "F",
                fontSizePx: 16,
                color: "#000000",
                textAlign: "start",
                layoutBox: { x: 24, y: 24, w: 48, h: 120 },
                lineHeightPx: 19.2,
                lines: [{ text: "A", glyphs: [], width: 20, baselineY: 18 }],
                glyphPaths: [
                  {
                    nodeId: "txt-clipped",
                    d: "M50 30L110 30L110 130L50 130Z",
                    fill: "#000000",
                    glyphIds: [1],
                    text: "A",
                    bbox: { x: 50, y: 30, w: 60, h: 100 },
                  },
                ],
              },
            ],
          },
        ],
      },
      drawOrder: ["txt-clipped"],
      width: 160,
      height: 160,
      warnings: [],
    };

    const svg = emitSvgFromIrViaHandle(handle, ir, { debug: true });

    expect(svg).toContain('<g class="debug-overlay" opacity="0.4">');
    expect(svg).toMatch(
      /<g class="debug-overlay" opacity="0\.4">[\s\S]*<g clip-path="url\(#clip-clipper\)">[\s\S]*<rect x="50" y="30" width="60" height="100" fill="none" stroke="#ff0000" stroke-width="1"\/>[\s\S]*<\/g>/,
    );
  });

  it("draws computed line layout boxes in debug overlays", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "txt-lines",
          bbox: { x: 20, y: 10, w: 100, h: 40 },
          font: "F",
          fontSizePx: 16,
          color: "#000000",
          textAlign: "center",
          layoutBox: { x: 20, y: 10, w: 100, h: 40 },
          lineHeightPx: 20,
          lines: [
            { text: "First", glyphs: [], width: 60, baselineY: 14 },
            { text: "Second", glyphs: [], width: 30, baselineY: 34 },
          ],
          glyphPaths: [
            {
              nodeId: "txt-lines",
              d: "M40 12L100 12L100 28L40 28Z",
              fill: "#000000",
              glyphIds: [1],
              text: "First",
              bbox: { x: 40, y: 12, w: 60, h: 16 },
            },
            {
              nodeId: "txt-lines",
              d: "M55 32L85 32L85 44L55 44Z",
              fill: "#000000",
              glyphIds: [2],
              text: "Second",
              bbox: { x: 55, y: 32, w: 30, h: 12 },
            },
          ],
        },
      ],
      ["txt-lines"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir, { debug: true });

    expect(svg).toContain(
      '<rect x="40" y="10" width="60" height="20" fill="none" stroke="#22c55e" stroke-width="1" stroke-dasharray="4,2"/>',
    );
    expect(svg).toContain(
      '<rect x="55" y="30" width="30" height="20" fill="none" stroke="#22c55e" stroke-width="1" stroke-dasharray="4,2"/>',
    );
  });

  it("expands debug measured glyph bounds by text stroke width", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "txt-stroke-debug",
          bbox: { x: 0, y: 0, w: 80, h: 30 },
          font: "F",
          fontSizePx: 16,
          color: "#000000",
          textAlign: "start",
          layoutBox: { x: 0, y: 0, w: 80, h: 30 },
          lineHeightPx: 19.2,
          stroke: "#f59e0b",
          strokeWidth: 4,
          lines: [{ text: "A", glyphs: [], width: 30, baselineY: 20 }],
          glyphPaths: [
            {
              nodeId: "txt-stroke-debug",
              d: "M10 12L40 12L40 24L10 24Z",
              fill: "#000000",
              glyphIds: [1],
              text: "A",
              bbox: { x: 10, y: 12, w: 30, h: 12 },
            },
          ],
        },
      ],
      ["txt-stroke-debug"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir, { debug: true });

    expect(svg).toContain(
      '<rect x="8" y="10" width="34" height="16" fill="none" stroke="#ff0000" stroke-width="1"/>',
    );
  });

  it("can emit only selected debug overlay parts", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "txt-selected-debug",
          bbox: { x: 10, y: 20, w: 80, h: 30 },
          font: "F",
          fontSizePx: 16,
          color: "#000000",
          textAlign: "start",
          layoutBox: { x: 10, y: 20, w: 80, h: 30 },
          lineHeightPx: 19.2,
          lines: [{ text: "A", glyphs: [], width: 30, baselineY: 18 }],
          glyphPaths: [
            {
              nodeId: "txt-selected-debug",
              d: "M12 24L38 24L38 36L12 36Z",
              fill: "#000000",
              glyphIds: [1],
              text: "A",
              bbox: { x: 12, y: 24, w: 26, h: 12 },
            },
          ],
        },
      ],
      ["txt-selected-debug"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir, { debug: { parts: ["baseline"] } });

    expect(svg).toContain('<g class="debug-overlay" opacity="0.4">');
    expect(svg).toContain(
      '<line x1="10" y1="38" x2="40" y2="38" stroke="#fbbf24" stroke-width="0.5"/>',
    );
    expect(svg).not.toContain('stroke="#38bdf8"');
    expect(svg).not.toContain('stroke="#22c55e"');
    expect(svg).not.toContain('stroke="#ff0000"');
  });

  it("emits vertical baselines for vertical-rl text", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "txt-vertical-baseline",
          bbox: { x: 10, y: 20, w: 60, h: 120 },
          font: "F",
          fontSizePx: 16,
          color: "#000000",
          textAlign: "start",
          layoutBox: { x: 8, y: 16, w: 72, h: 140 },
          writingMode: "vertical-rl",
          lineHeightPx: 24,
          lines: [
            { text: "一", glyphs: [], width: 80, baselineY: 14 },
            { text: "二", glyphs: [], width: 80, baselineY: 38 },
          ],
        },
      ],
      ["txt-vertical-baseline"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir, { debug: { parts: ["baseline"] } });

    expect(svg).toContain(
      '<line x1="68" y1="16" x2="68" y2="96" stroke="#fbbf24" stroke-width="0.5"/>',
    );
    expect(svg).toContain(
      '<line x1="44" y1="16" x2="44" y2="96" stroke="#fbbf24" stroke-width="0.5"/>',
    );
  });

  it("uses positioned base glyphs for rich vertical baselines", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "txt-positioned-vertical-baseline",
          bbox: { x: 40, y: 20, w: 40, h: 120 },
          font: "NotoSansJP",
          color: "#000000",
          textAlign: "start",
          layoutBox: { x: 100, y: 16, w: 100, h: 140 },
          writingMode: "vertical-rl",
          fontSizePx: 28,
          lineHeightPx: 33.6,
          lines: [
            {
              text: "古こと",
              glyphs: [],
              width: 80,
              baselineY: 14,
              positionedGlyphs: [
                {
                  glyphId: 1,
                  text: "古",
                  clusterStart: 0,
                  clusterEnd: 3,
                  fontAlias: "NotoSansJP",
                  fontWeight: 400,
                  fontStyle: "normal",
                  fontSizePx: 28,
                  originX: 24,
                  originY: 20,
                  xOffset: 2,
                  yOffset: 0,
                  xAdvance: 0,
                  yAdvance: 28,
                  rotationDeg: 0,
                  absolutePosition: true,
                },
                {
                  glyphId: 2,
                  text: "こ",
                  clusterStart: 3,
                  clusterEnd: 6,
                  fontAlias: "NotoSansJP",
                  fontWeight: 400,
                  fontStyle: "normal",
                  fontSizePx: 11,
                  originX: 38,
                  originY: 20,
                  xOffset: 0,
                  yOffset: 0,
                  xAdvance: 0,
                  yAdvance: 11,
                  rotationDeg: 0,
                  absolutePosition: true,
                },
              ],
            },
          ],
        },
      ],
      ["txt-positioned-vertical-baseline"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir, { debug: { parts: ["baseline"] } });

    expect(svg).toContain(
      '<line x1="122" y1="16" x2="122" y2="96" stroke="#fbbf24" stroke-width="0.5"/>',
    );
  });

  it("omits debug overlays when selected debug parts are empty", () => {
    const ir = makeIR(
      [
        {
          type: "rect",
          nodeId: "rect-empty-debug",
          bbox: { x: 0, y: 0, w: 20, h: 20 },
          fill: "#ffffff",
        },
      ],
      ["rect-empty-debug"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir, { debug: { parts: [] } });

    expect(svg).not.toContain("debug-overlay");
  });

  it("escapes XML characters in text metadata", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "txt1",
          bbox: { x: 0, y: 0, w: 200, h: 20 },
          font: "Arial",
          fontSizePx: 16,
          color: "#000",
          textAlign: "start",
          layoutBox: { x: 0, y: 0, w: 200, h: 20 },
          lineHeightPx: 19.2,
          lines: [{ text: "A < B & C > D", glyphs: [], width: 100, baselineY: 14 }],
          glyphPaths: [
            {
              nodeId: "txt1",
              d: "M0 0L10 0",
              fill: "#000",
              glyphIds: [1],
              text: "A < B & C > D",
              bbox: { x: 0, y: 0, w: 10, h: 10 },
            },
          ],
        },
      ],
      ["txt1"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('data-boundsvg-text="A &lt; B &amp; C &gt; D"');
  });

  it("rounds decimal values to 2 places", () => {
    const ir = makeIR(
      [
        {
          type: "rect",
          nodeId: "r1",
          bbox: { x: 10.123456, y: 20.987654, w: 100.555, h: 50.001 },
          fill: "#000",
        },
      ],
      ["r1"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('x="10.12"');
    expect(svg).toContain('y="20.99"');
    expect(svg).toContain('width="100.56"');
    expect(svg).toContain('height="50"');
  });

  it("emits path wrapper with data-boundsvg-node-id attribute", () => {
    const ir = makeIR(
      [
        {
          type: "path",
          nodeId: "star1",
          bbox: { x: 100, y: 200, w: 120, h: 115 },
          pathData: "M60 10 L73 45 L110 45 L80 68 L90 105 L60 82 L30 105 L40 68 L10 45 L47 45 Z",
          fill: "#fbbf24",
        },
      ],
      ["star1"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('data-boundsvg-node-id="star1"');
    expect(svg).toContain('x="100"');
    expect(svg).toContain('y="200"');
    expect(svg).toContain("<path");
    expect(svg).toContain('fill="#fbbf24"');
  });

  it("escapes special characters in data-boundsvg-node-id", () => {
    const ir = makeIR(
      [
        {
          type: "path",
          nodeId: 'path<>&"test',
          bbox: { x: 0, y: 0, w: 50, h: 50 },
          pathData: "M0 0 L50 50",
          fill: "#000",
        },
      ],
      ['path<>&"test'],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('data-boundsvg-node-id="path&lt;&gt;&amp;&quot;test"');
  });

  it("emits text stroke with round linejoin", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "stroked",
          bbox: { x: 0, y: 0, w: 200, h: 30 },
          font: "Arial",
          fontSizePx: 24,
          color: "#000",
          textAlign: "start",
          layoutBox: { x: 0, y: 0, w: 200, h: 30 },
          lineHeightPx: 28.8,
          stroke: "#ff0000",
          strokeWidth: 3,
          strokeLinejoin: "round",
          lines: [{ text: "Wv", glyphs: [], width: 40, baselineY: 20 }],
          glyphPaths: [
            {
              nodeId: "stroked",
              d: "M0 0L10 10",
              fill: "#000",
              glyphIds: [1],
              text: "Wv",
              bbox: { x: 0, y: 0, w: 10, h: 10 },
            },
          ],
        },
      ],
      ["stroked"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('paint-order="stroke"');
  });

  it("emits all text stroke style attrs", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "styled-stroke",
          bbox: { x: 0, y: 0, w: 200, h: 30 },
          font: "Arial",
          fontSizePx: 24,
          color: "#000",
          textAlign: "start",
          layoutBox: { x: 0, y: 0, w: 200, h: 30 },
          lineHeightPx: 28.8,
          stroke: "#0000ff",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "bevel",
          strokeDasharray: "5,3",
          strokeMiterlimit: 8,
          lines: [{ text: "Test", glyphs: [], width: 60, baselineY: 20 }],
          glyphPaths: [
            {
              nodeId: "styled-stroke",
              d: "M0 0L10 10",
              fill: "#000",
              glyphIds: [1],
              text: "Test",
              bbox: { x: 0, y: 0, w: 10, h: 10 },
            },
          ],
        },
      ],
      ["styled-stroke"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="bevel"');
    expect(svg).toContain('stroke-dasharray="5,3"');
    expect(svg).toContain('stroke-miterlimit="8"');
  });

  it("emits stroke style attrs on glyph paths", () => {
    const ir = makeIR(
      [
        {
          type: "text",
          nodeId: "glyph-stroked",
          bbox: { x: 0, y: 0, w: 100, h: 20 },
          font: "F",
          fontSizePx: 16,
          color: "#000",
          textAlign: "start",
          layoutBox: { x: 0, y: 0, w: 100, h: 20 },
          lineHeightPx: 19.2,
          stroke: "#f00",
          strokeWidth: 2,
          strokeLinejoin: "round",
          lines: [{ text: "A", glyphs: [], width: 10, baselineY: 14 }],
          glyphPaths: [
            {
              nodeId: "glyph-stroked",
              d: "M0 0L10 10",
              fill: "#000",
              glyphIds: [1],
              text: "A",
              bbox: { x: 0, y: 0, w: 10, h: 10 },
            },
          ],
        },
      ],
      ["glyph-stroked"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('stroke="#f00"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('paint-order="stroke"');
    expect(svg).toContain("<path");
  });

  it("emits nodes in drawOrder sequence", () => {
    const ir = makeIR(
      [
        {
          type: "rect",
          nodeId: "first",
          bbox: { x: 0, y: 0, w: 100, h: 100 },
          fill: "#ff0000",
        },
        {
          type: "rect",
          nodeId: "second",
          bbox: { x: 50, y: 50, w: 100, h: 100 },
          fill: "#00ff00",
        },
      ],
      ["first", "second"],
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    const firstIdx = svg.indexOf("#ff0000");
    const secondIdx = svg.indexOf("#00ff00");
    // drawOrder should be preserved (first before second)
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(-1);
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it("preserves SVG's default fill when split stroke geometry has no paint", () => {
    const ir = makeIR(
      [
        {
          type: "shape",
          nodeId: "bowtie",
          bbox: { x: 0, y: 0, w: 100, h: 100 },
          shapeParts: [
            {
              d: "M0,0L50,50L0,100Z M100,0L50,50L100,100Z",
              strokeD: "M0,0L100,100L100,0L0,100Z",
            },
          ],
        },
      ],
      ["bowtie"],
      100,
      100,
    );

    const svg = emitSvgFromIrViaHandle(handle, ir);
    expect(svg).toContain('d="M0,0L50,50L0,100Z M100,0L50,50L100,100Z"');
    expect((svg.match(/<path /g) ?? []).length).toBe(1);
  });

  it("does not create dead shared defs for split stroke geometry", () => {
    const splitShape = (nodeId: string): IRNode => ({
      type: "shape",
      nodeId,
      bbox: { x: 0, y: 0, w: 100, h: 100 },
      stroke: "#f00",
      strokeWidth: 2,
      shapeParts: [{ d: "", strokeD: "M0,50L100,50" }],
    });
    const svg = emitSvgFromIrViaHandle(
      handle,
      makeIR([splitShape("a"), splitShape("b")], ["a", "b"], 100, 100),
    );

    expect(svg).not.toMatch(/<path id="[^"]*sp-/);
    expect(svg).not.toContain("<use ");
    expect((svg.match(/d="M0,50L100,50"/g) ?? []).length).toBe(2);
  });
});
