/** @jsxImportSource react */

import type { Engine, IR, RenderOptions, VNode } from "@boundsvg/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BoundSvgContext } from "../src/context.js";
import { useBoundSvg } from "../src/hooks/use-boundsvg.js";
import {
  type UseInteractiveSvgResult,
  useInteractiveSvg,
} from "../src/hooks/use-interactive-svg.js";
import { type UseRenderToPngResult, useRenderToPng } from "../src/hooks/use-render-png.js";
import { BoundSvgProvider } from "../src/provider.js";
import type { BoundSvgContextValue } from "../src/types.js";
import { makeEngineMock } from "./test-doubles.js";

function sampleVNode(): VNode {
  return {
    type: "Canvas",
    props: { width: 100, height: 100 },
    children: [
      {
        type: "Text",
        props: { id: "txt", font: "NotoSansJP", fontSizePx: 16, color: "#111111" },
        children: ["hello"],
      },
    ],
  };
}

function sampleIr(): IR {
  return {
    root: {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 100, h: 100 },
      children: [
        {
          type: "text",
          nodeId: "txt",
          bbox: { x: 0, y: 0, w: 40, h: 20 },
          lines: [],
          on: { onClick: "click:txt" },
        },
      ],
    },
    drawOrder: ["txt"],
    width: 100,
    height: 100,
    warnings: [],
  };
}

function sampleSvgIr(): IR {
  return {
    root: {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 200, h: 120 },
      children: [
        {
          type: "svg",
          nodeId: "embedded",
          bbox: { x: 24, y: 18, w: 120, h: 72 },
          svgContent: '<rect width="40" height="20" fill="#22d3ee"/>',
          svgViewBox: "0 0 40 20",
          preserveAspectRatio: "xMidYMid meet",
          on: { onClick: "click:embedded" },
        },
      ],
    },
    drawOrder: ["embedded"],
    width: 200,
    height: 120,
    warnings: [],
  };
}

function createMockEngineSuccess(ir: IR = sampleIr()) {
  const renderToSvgAndIR = vi.fn(() => ({
    svg: '<svg viewBox="0 0 100 100"></svg>',
    ir,
  }));
  return {
    engine: makeEngineMock({ renderToSvgAndIR }),
    renderToSvgAndIR,
  };
}

function createContextValue(
  engine: Engine | null,
  status: BoundSvgContextValue["status"],
): BoundSvgContextValue {
  return {
    engine,
    workerEngine: null,
    status,
    error: null,
    defaultRenderOptions: { textPathMode: "merged" },
  };
}

describe("useBoundSvg", () => {
  it("throws when used outside BoundSvgProvider", () => {
    function Probe() {
      useBoundSvg();
      return null;
    }

    expect(() => renderToString(<Probe />)).toThrow(
      "useBoundSvg must be used within a <BoundSvgProvider>",
    );
  });
});

describe("BoundSvgProvider", () => {
  it("renders fallback during initial idle state", () => {
    const html = renderToString(
      <BoundSvgProvider config={{ fonts: [] }} fallback={<span>loading-ui</span>}>
        <span>ready-ui</span>
      </BoundSvgProvider>,
    );

    expect(html).toContain("loading-ui");
    expect(html).not.toContain("ready-ui");
  });
});

describe("useInteractiveSvg", () => {
  it("returns empty artifacts when vnode is null", () => {
    const { engine, renderToSvgAndIR } = createMockEngineSuccess();
    let snapshot: UseInteractiveSvgResult | null = null;

    function Probe() {
      snapshot = useInteractiveSvg(null, new Map());
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={createContextValue(engine, "ready")}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.isReady).toBe(false);
    expect(snapshot!.svg).toBeNull();
    expect(snapshot!.ir).toBeNull();
    expect(snapshot!.error).toBeNull();
    expect(snapshot!.hoverNodeId).toBeNull();
    expect(typeof snapshot!.containerRef).toBe("function");
    expect(renderToSvgAndIR).not.toHaveBeenCalled();
  });

  it("returns rendered artifacts when context is ready", () => {
    const { engine, renderToSvgAndIR } = createMockEngineSuccess();
    let snapshot: UseInteractiveSvgResult | null = null;
    const vnode = sampleVNode();
    const handlers = new Map([["click:txt", vi.fn()]]);

    function Probe() {
      snapshot = useInteractiveSvg(vnode, handlers, {
        renderOptions: { textPathMode: "merged" },
        showPointerCursor: false,
      });
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={createContextValue(engine, "ready")}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.isReady).toBe(true);
    expect(snapshot!.svg).toContain("<svg");
    expect(snapshot!.ir).not.toBeNull();
    expect(snapshot!.error).toBeNull();
    expect(snapshot!.hoverNodeId).toBeNull();
    expect(renderToSvgAndIR).toHaveBeenCalledTimes(1);
    expect(renderToSvgAndIR).toHaveBeenCalledWith(vnode, { textPathMode: "merged" });
  });

  it("surfaces render errors when engine throws", () => {
    const engine = makeEngineMock({
      renderToSvgAndIR: vi.fn(() => {
        throw new Error("render failed");
      }),
    });
    let snapshot: UseInteractiveSvgResult | null = null;

    function Probe() {
      snapshot = useInteractiveSvg(sampleVNode(), new Map());
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={createContextValue(engine, "ready")}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.isReady).toBe(false);
    expect(snapshot!.svg).toBeNull();
    expect(snapshot!.ir).toBeNull();
    expect(snapshot!.error?.message).toBe("render failed");
  });

  it("accepts IRs with Svg leaf nodes without treating them as errors", () => {
    const { engine, renderToSvgAndIR } = createMockEngineSuccess(sampleSvgIr());
    let snapshot: UseInteractiveSvgResult | null = null;

    function Probe() {
      snapshot = useInteractiveSvg(sampleVNode(), new Map([["click:embedded", vi.fn()]]));
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={createContextValue(engine, "ready")}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.isReady).toBe(true);
    expect(snapshot!.error).toBeNull();
    expect(snapshot!.ir).toEqual(sampleSvgIr());
    expect(renderToSvgAndIR).toHaveBeenCalledTimes(1);
  });
});

describe("useRenderToPng cache", () => {
  it("reuses PNG render results for the same vnode and options references", () => {
    const vnode = sampleVNode();
    const options: RenderOptions = { scale: 2, textPathMode: "merged" };
    const png = new Uint8Array([137, 80, 78, 71]);
    const renderToPng = vi.fn(() => png);
    const engine = makeEngineMock({ renderToPng });
    let firstResult: UseRenderToPngResult | null = null;
    let secondResult: UseRenderToPngResult | null = null;

    function ProbeA() {
      firstResult = useRenderToPng(vnode, options);
      return null;
    }

    function ProbeB() {
      secondResult = useRenderToPng(vnode, options);
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={createContextValue(engine, "ready")}>
        <ProbeA />
        <ProbeB />
      </BoundSvgContext.Provider>,
    );

    expect(renderToPng).toHaveBeenCalledTimes(1);
    expect(firstResult!.isReady).toBe(true);
    expect(secondResult!.isReady).toBe(true);
    expect(firstResult!.png).toBe(png);
    expect(secondResult!.png).toBe(png);
    expect(firstResult!.dataUrl).toBe(secondResult!.dataUrl);
  });

  it("renders again when options reference changes", () => {
    const vnode = sampleVNode();
    const firstOptions: RenderOptions = { scale: 1, textPathMode: "merged" };
    const secondOptions: RenderOptions = { scale: 2, textPathMode: "merged" };
    const renderToPng = vi.fn(() => new Uint8Array([137, 80, 78, 71]));
    const engine = makeEngineMock({ renderToPng });

    function ProbeA() {
      useRenderToPng(vnode, firstOptions);
      return null;
    }

    function ProbeB() {
      useRenderToPng(vnode, secondOptions);
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={createContextValue(engine, "ready")}>
        <ProbeA />
        <ProbeB />
      </BoundSvgContext.Provider>,
    );

    expect(renderToPng).toHaveBeenCalledTimes(2);
  });
});
