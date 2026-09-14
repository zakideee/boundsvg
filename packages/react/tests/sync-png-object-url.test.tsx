// @vitest-environment happy-dom
/** @jsxImportSource react */

import {
  type CompiledScene,
  type EmitPngOptions,
  Engine,
  type IR,
  type RenderPngOptions,
  type VNode,
} from "@boundsvg/core";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BoundSvgContext } from "../src/context.js";
import type { BoundSvgContextValue } from "../src/types.js";

const pngMocks = vi.hoisted(() => ({
  createPngObjectUrl: vi.fn(() => "blob:stable"),
  pngToDataUrl: vi.fn(() => "data:image/png;base64,c3RhYmxl"),
  revokePngObjectUrl: vi.fn(),
}));

vi.mock("@boundsvg/browser/png", () => pngMocks);

const { usePngObjectUrl, useRenderAsset } = await import("../src/assets.js");
const { useRenderToPng } = await import("../src/hooks/use-render-png.js");

function makeVNode(width = 10): VNode {
  return {
    type: "Canvas",
    props: { width, height: 10 },
    children: [{ type: "Text", props: { font: "f", fontSizePx: 10 }, children: ["x"] }],
  };
}

const STABLE_VNODE = makeVNode();
const STABLE_OPTIONS: RenderPngOptions = { scale: 2 };

function vnodeWidth(vnode: VNode): number {
  return Number(Reflect.get(vnode.props, "width"));
}

function makeStructuralIr(width: number): Omit<IR, "warnings"> {
  return {
    root: {
      type: "group",
      nodeId: "auto:0",
      bbox: { x: 0, y: 0, w: width, h: 10 },
      children: [],
    },
    drawOrder: [],
    width,
    height: 10,
  };
}

function makeEngine() {
  let compileWidth = vnodeWidth(STABLE_VNODE);
  const engine = new Engine({
    computeLayoutFn: () => "{}",
    renderToIrFn: () => JSON.stringify({ ir: makeStructuralIr(compileWidth), warnings: [] }),
  });
  const originalCompile = engine.compile.bind(engine);
  const compile = vi.spyOn(engine, "compile").mockImplementation((input, options) => {
    compileWidth = vnodeWidth(input as VNode);
    const artifactInput: VNode = {
      type: "Canvas",
      props: { width: compileWidth, height: 10 },
      children: [],
    };
    return originalCompile(artifactInput, options);
  });
  const renderToPng = vi
    .spyOn(engine, "renderToPng")
    .mockImplementation(
      (vnode: VNode, options: RenderPngOptions) =>
        new Uint8Array([vnodeWidth(vnode), options.scale ?? 1]),
    );
  vi.spyOn(engine, "renderCompiledToSvg").mockReturnValue("<svg></svg>");
  const renderCompiledToPng = vi
    .spyOn(engine, "renderCompiledToPng")
    .mockImplementation(
      (compiled: CompiledScene, options: EmitPngOptions) =>
        new Uint8Array([compiled.width, options.scale ?? 1]),
    );
  return { engine, compile, renderToPng, renderCompiledToPng };
}

function context(engine: Engine): BoundSvgContextValue {
  return {
    engine,
    workerEngine: null,
    status: "ready",
    error: null,
    defaultCommonOptions: { textPathMode: "merged" },
  };
}

function mount(ui: React.ReactNode, engine: Engine) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<BoundSvgContext.Provider value={context(engine)}>{ui}</BoundSvgContext.Provider>);
  });
  return {
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("synchronous PNG object URL stability", () => {
  it("delivers PNG warnings and resolution adjustments after commit", () => {
    const callbackOrder: string[] = [];
    const onWarning = vi.fn(() => callbackOrder.push("warning"));
    const onPngResolutionAdjusted = vi.fn(() => callbackOrder.push("adjusted"));
    const renderToPng = vi.fn((_vnode: VNode, options: RenderPngOptions) => {
      options.onPngResolutionAdjusted?.({
        requestedScale: 2,
        appliedScale: 1,
        baseWidth: 10,
        baseHeight: 10,
        requestedWidth: 20,
        requestedHeight: 20,
        outputWidth: 10,
        outputHeight: 10,
        maxLongEdge: 10,
        maxPixels: 100,
      });
      options.onWarning?.(
        new Error("png warning") as Parameters<NonNullable<RenderPngOptions["onWarning"]>>[0],
      );
      expect(onWarning).not.toHaveBeenCalled();
      expect(onPngResolutionAdjusted).not.toHaveBeenCalled();
      return new Uint8Array([1]);
    });
    const engine = new Engine({ computeLayoutFn: () => "" });
    vi.spyOn(engine, "renderToPng").mockImplementation(renderToPng);

    function Probe() {
      useRenderToPng(STABLE_VNODE, { onWarning, onPngResolutionAdjusted });
      return <div data-png-committed="true" />;
    }

    const mounted = mount(<Probe />, engine);

    expect(document.querySelector('[data-png-committed="true"]')).not.toBeNull();
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onPngResolutionAdjusted).toHaveBeenCalledTimes(1);
    expect(callbackOrder).toEqual(["adjusted", "warning"]);
    mounted.unmount();
  });

  it("renders once for stable VNode with equal inline PNG options and callback", async () => {
    const { engine, renderToPng } = makeEngine();
    function Probe() {
      const { png } = useRenderToPng(STABLE_VNODE, { scale: 2, onWarning: () => {} });
      usePngObjectUrl(png);
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();

    expect(renderToPng).toHaveBeenCalledTimes(1);
    expect(pngMocks.createPngObjectUrl).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("renders once for a freshly allocated equal VNode", async () => {
    const { engine, renderToPng } = makeEngine();
    function Probe() {
      const { png } = useRenderToPng(makeVNode(), STABLE_OPTIONS);
      usePngObjectUrl(png);
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();

    expect(renderToPng).toHaveBeenCalledTimes(1);
    expect(pngMocks.createPngObjectUrl).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("renders exactly once more when a PNG option value changes", async () => {
    const { engine, renderToPng } = makeEngine();
    let setScale!: (scale: number) => void;
    function Probe() {
      const [scale, setValue] = useState(1);
      setScale = setValue;
      const { png } = useRenderToPng(STABLE_VNODE, { scale, onWarning: () => {} });
      usePngObjectUrl(png);
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();

    expect(renderToPng).toHaveBeenCalledTimes(1);
    act(() => setScale(2));
    await flush();

    expect(renderToPng).toHaveBeenCalledTimes(2);
    expect(pngMocks.createPngObjectUrl).toHaveBeenCalledTimes(2);
    mounted.unmount();
  });

  it("renders exactly once more when the VNode value changes", async () => {
    const { engine, renderToPng } = makeEngine();
    let setWidth!: (width: number) => void;
    function Probe() {
      const [width, setValue] = useState(10);
      setWidth = setValue;
      const { png } = useRenderToPng(makeVNode(width), STABLE_OPTIONS);
      usePngObjectUrl(png);
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();

    expect(renderToPng).toHaveBeenCalledTimes(1);
    act(() => setWidth(11));
    await flush();

    expect(renderToPng).toHaveBeenCalledTimes(2);
    expect(pngMocks.createPngObjectUrl).toHaveBeenCalledTimes(2);
    mounted.unmount();
  });

  it("renders one asset when options are omitted", async () => {
    const { engine, compile, renderCompiledToPng } = makeEngine();
    function Probe() {
      const { png } = useRenderAsset(STABLE_VNODE);
      usePngObjectUrl(png);
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();

    expect(compile).toHaveBeenCalledTimes(1);
    expect(renderCompiledToPng).toHaveBeenCalledTimes(1);
    expect(pngMocks.createPngObjectUrl).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("renders one asset for equal inline nested options", async () => {
    const { engine, compile, renderCompiledToPng } = makeEngine();
    function Probe() {
      const { png } = useRenderAsset(STABLE_VNODE, {
        pngOptions: { scale: 2, onWarning: () => {} },
      });
      usePngObjectUrl(png);
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();

    expect(compile).toHaveBeenCalledTimes(1);
    expect(renderCompiledToPng).toHaveBeenCalledTimes(1);
    expect(pngMocks.createPngObjectUrl).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("renders one asset for fresh equal VNode and options", async () => {
    const { engine, compile, renderCompiledToPng } = makeEngine();
    function Probe() {
      const { png } = useRenderAsset(makeVNode(), {
        pngOptions: { scale: 2, onWarning: () => {} },
      });
      usePngObjectUrl(png);
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();

    expect(compile).toHaveBeenCalledTimes(1);
    expect(renderCompiledToPng).toHaveBeenCalledTimes(1);
    expect(pngMocks.createPngObjectUrl).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("renders exactly one new asset for a nested PNG option change", async () => {
    const { engine, compile, renderCompiledToPng } = makeEngine();
    let setScale!: (scale: number) => void;
    function Probe() {
      const [scale, setValue] = useState(1);
      setScale = setValue;
      const { png } = useRenderAsset(STABLE_VNODE, {
        pngOptions: { scale, onWarning: () => {} },
      });
      usePngObjectUrl(png);
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();

    expect(compile).toHaveBeenCalledTimes(1);
    act(() => setScale(2));
    await flush();

    expect(compile).toHaveBeenCalledTimes(2);
    expect(renderCompiledToPng).toHaveBeenCalledTimes(2);
    expect(pngMocks.createPngObjectUrl).toHaveBeenCalledTimes(2);
    mounted.unmount();
  });

  it("creates one URL for freshly allocated equal PNG bytes", async () => {
    const { engine } = makeEngine();
    function Probe() {
      usePngObjectUrl(new Uint8Array([1, 2, 3]));
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();

    expect(pngMocks.createPngObjectUrl).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("invalidates a stable scene after resource registration", () => {
    const { engine, renderToPng } = makeEngine();
    function Probe() {
      const { png } = useRenderToPng(STABLE_VNODE);
      return <output>{png?.[0]}</output>;
    }
    const mounted = mount(<Probe />, engine);
    const geometry = {
      viewBox: { width: 10, height: 10 },
      root: { kind: "path" as const, d: "M0 0H10V10Z" },
    };
    act(() => engine.registerGeometry("shape", geometry));
    expect(renderToPng).toHaveBeenCalledTimes(2);
    act(() => engine.unregisterGeometry("absent"));
    expect(renderToPng).toHaveBeenCalledTimes(2);
    act(() => engine.unregisterGeometry("shape"));
    expect(renderToPng).toHaveBeenCalledTimes(3);
    mounted.unmount();
  });

  it("observes in-place VNode and option changes through revision", () => {
    const { engine, renderToPng } = makeEngine();
    const vnode = makeVNode();
    const options: RenderPngOptions = { scale: 1 };
    let updateRevision!: (revision: number) => void;
    function Probe() {
      const [revision, setRevision] = useState(0);
      updateRevision = setRevision;
      const { png } = useRenderToPng(vnode, options, { revision });
      return <output>{png?.join(",")}</output>;
    }
    const mounted = mount(<Probe />, engine);
    Reflect.set(vnode.props, "width", 12);
    options.scale = 3;
    act(() => updateRevision(1));
    expect(renderToPng).toHaveBeenCalledTimes(2);
    expect(document.querySelector("output")?.textContent).toBe("12,3");
    mounted.unmount();
  });

  it("isolates public PNG bytes across consumers and subsequent projections", () => {
    const { engine, renderToPng } = makeEngine();
    let firstPng: Uint8Array | null = null;
    let secondPng: Uint8Array | null = null;
    let refresh!: (revision: number) => void;
    function First() {
      const [, setRevision] = useState(0);
      refresh = setRevision;
      firstPng = useRenderToPng(STABLE_VNODE).png;
      return null;
    }
    function Second() {
      secondPng = useRenderToPng(STABLE_VNODE).png;
      return null;
    }
    const mounted = mount(
      <>
        <First />
        <Second />
      </>,
      engine,
    );
    expect(renderToPng).toHaveBeenCalledTimes(2);
    expect(firstPng).not.toBe(secondPng);
    const exposed = firstPng as Uint8Array | null;
    exposed?.fill(99);
    expect(secondPng).toEqual(new Uint8Array([10, 1]));
    act(() => refresh(1));
    expect(firstPng).toEqual(new Uint8Array([10, 1]));
    expect(renderToPng).toHaveBeenCalledTimes(2);
    mounted.unmount();
  });

  it("replaces and revokes an object URL when mutable bytes receive a new revision", () => {
    const { engine } = makeEngine();
    const png = new Uint8Array([1]);
    let updateRevision!: (revision: number) => void;
    function Probe() {
      const [revision, setRevision] = useState(0);
      updateRevision = setRevision;
      usePngObjectUrl(png, { revision });
      return null;
    }
    const mounted = mount(<Probe />, engine);
    png[0] = 2;
    act(() => updateRevision(1));
    expect(pngMocks.createPngObjectUrl).toHaveBeenCalledTimes(2);
    expect(pngMocks.revokePngObjectUrl).toHaveBeenCalledTimes(1);
    mounted.unmount();
    expect(pngMocks.revokePngObjectUrl).toHaveBeenCalledTimes(2);
  });
});
