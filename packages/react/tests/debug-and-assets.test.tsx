/** @jsxImportSource react */

import type { CompiledScene, Engine, IR, LayoutResult, RenderOptions, VNode } from "@boundsvg/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useRenderAsset } from "../src/assets.js";
import { BoundSvgContext } from "../src/context.js";
import { BoundSvgDebugOverlay, NodeInspectorPanel } from "../src/debug.js";
import { type UseBoundSvgInspectionResult, useBoundSvgInspection } from "../src/inspect.js";
import type { BoundSvgContextValue } from "../src/types.js";
import { makeEngineMock } from "./test-doubles.js";

function sampleVNode(): VNode {
  return {
    type: "Canvas",
    props: { width: 100, height: 80 },
    children: [
      {
        type: "Text",
        props: { id: "txt", font: "TestFont", fontSizePx: 16, onClick: "click:txt" },
        children: ["hello"],
      },
    ],
  };
}

function sampleIr(): IR {
  return {
    root: {
      type: "group",
      nodeId: "auto:0",
      bbox: { x: 0, y: 0, w: 100, h: 80 },
      children: [
        {
          type: "text",
          nodeId: "txt",
          bbox: { x: 10, y: 12, w: 40, h: 18 },
          lines: [{ text: "hello", glyphs: [], width: 40, baselineY: 14 }],
          on: { onClick: "click:txt" },
        },
      ],
    },
    drawOrder: ["txt"],
    width: 100,
    height: 80,
    warnings: [],
  };
}

function sampleLayout(): LayoutResult {
  return {
    root: {
      nodeId: "auto:0",
      vnode: sampleVNode(),
      bbox: { x: 0, y: 0, width: 100, height: 80 },
      children: [],
    },
    measureCallCount: 1,
  };
}

function createContextValue(engine: Engine): BoundSvgContextValue {
  return {
    engine,
    workerEngine: null,
    status: "ready",
    error: null,
    defaultRenderOptions: { textPathMode: "merged" },
  };
}

describe("react debug/assets", () => {
  it("inspects a VNode from context", () => {
    const engine = makeEngineMock({
      renderToLayoutTree: vi.fn(() => sampleLayout()),
      renderToIR: vi.fn(() => sampleIr()),
    });
    let snapshot: UseBoundSvgInspectionResult | null = null;

    function Probe() {
      snapshot = useBoundSvgInspection(sampleVNode(), { textPathMode: "merged" });
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={createContextValue(engine)}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(snapshot?.isReady).toBe(true);
    expect(snapshot?.inspection?.stats.nodeCount).toBe(2);
    expect(snapshot?.inspection?.handlerMap.get("txt")?.onClick).toBe("click:txt");
  });

  it("renders overlay and inspector markup", () => {
    const engine = makeEngineMock({
      renderToLayoutTree: vi.fn(() => sampleLayout()),
      renderToIR: vi.fn(() => sampleIr()),
    });
    const inspection = useInspectionSnapshot(engine);

    const html = renderToString(
      <>
        <BoundSvgDebugOverlay inspection={inspection} />
        <NodeInspectorPanel
          inspection={inspection}
          selectedNodeId="txt"
          className="node-inspector"
        />
      </>,
    );

    expect(html).toContain('class="node-inspector"');
    expect(html).toContain("txt");
    expect(html).toContain("text 40x18 @ 10,12 d1 #0");
    expect(html).toContain("drawIndex");
    expect(html).toContain("click:txt");
  });

  it("renders rich debug overlay labels and highlights", () => {
    const engine = makeEngineMock({
      renderToLayoutTree: vi.fn(() => sampleLayout()),
      renderToIR: vi.fn(() => sampleIr()),
    });
    const inspection = useInspectionSnapshot(engine);

    const html = renderToString(
      <BoundSvgDebugOverlay
        inspection={inspection}
        className="debug-overlay"
        labelMode="metrics"
        selectedNodeId="txt"
        highlightedNodeIds={["auto:0"]}
        highlightedBBoxes={[{ id: "manual", label: "manual bbox", x: 2, y: 3, w: 4, h: 5 }]}
        highlightColor="#123456"
      />,
    );

    expect(html).toContain('class="debug-overlay"');
    expect(html).toContain("text 40x18 @ 10,12 d1 #0");
    expect(html).toContain("handlers yes");
    expect(html).toContain("draw order 0");
    expect(html).toContain("manual bbox");
    expect(html).toContain('data-layer="highlight-bboxes"');
    expect(html).toContain('x="10" y="12" width="40" height="18" fill="#123456"');
    expect(html).toContain('x="0" y="0" width="100" height="80" fill="#123456"');
    expect(html).toContain('x="2" y="3" width="4" height="5" fill="#123456"');
  });

  it("keeps showLabels=false as a labelMode compatibility path", () => {
    const engine = makeEngineMock({
      renderToLayoutTree: vi.fn(() => sampleLayout()),
      renderToIR: vi.fn(() => sampleIr()),
    });
    const inspection = useInspectionSnapshot(engine);

    const html = renderToString(
      <BoundSvgDebugOverlay inspection={inspection} showLabels={false} />,
    );

    expect(html).toContain('data-layer="base-bboxes"');
    expect(html).not.toContain("text 40x18 @ 10,12 d1 #0");
  });

  it("renders asset outputs from a compiled scene", () => {
    const compiled: CompiledScene = {
      ir: sampleIr(),
      width: 100,
      height: 80,
      textPathMode: "merged",
    };
    const renderCompiledToSvg = vi.fn(() => "<svg></svg>");
    const renderCompiledToPng = vi.fn(() => new Uint8Array([137, 80, 78, 71]));
    const engine = makeEngineMock({
      compile: vi.fn(() => compiled),
      renderCompiledToSvg,
      renderCompiledToPng,
    });
    let result: ReturnType<typeof useRenderAsset> | null = null;

    function Probe() {
      result = useRenderAsset(sampleVNode(), { pngOptions: { scale: 2 } });
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={createContextValue(engine)}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(result?.isReady).toBe(true);
    expect(result?.svg).toBe("<svg></svg>");
    expect(result?.dataUrl).toContain("data:image/png;base64");
    expect(renderCompiledToPng).toHaveBeenCalledWith(compiled, {
      textPathMode: "merged",
      scale: 2,
    } satisfies RenderOptions);
  });
});

function useInspectionSnapshot(engine: Engine) {
  let snapshot: UseBoundSvgInspectionResult | null = null;
  function Probe() {
    snapshot = useBoundSvgInspection(sampleVNode());
    return null;
  }
  renderToString(
    <BoundSvgContext.Provider value={createContextValue(engine)}>
      <Probe />
    </BoundSvgContext.Provider>,
  );
  return snapshot?.inspection ?? null;
}
