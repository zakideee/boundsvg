// @vitest-environment happy-dom
/** @jsxImportSource react */

import type {
  CompiledScene,
  CompileOptions,
  Engine,
  IR,
  LayoutResult,
  RenderIrOptions,
  VNode,
} from "@boundsvg/core";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useCompiledScene } from "../src/assets.js";
import { BoundSvgContext } from "../src/context.js";
import { useBoundSvgInspection } from "../src/inspect.js";
import type { BoundSvgContextValue } from "../src/types.js";

function makeVNode(width = 100, text = "hello"): VNode {
  return {
    type: "Canvas",
    props: { width, height: 80 },
    children: [
      {
        type: "Text",
        props: { id: "txt", font: "f", fontSizePx: 16 },
        children: [text],
      },
    ],
  };
}

const STABLE_VNODE = makeVNode();
const STABLE_COMPILE_OPTIONS: CompileOptions = { textPathMode: "merged" };
const STABLE_RENDER_OPTIONS: RenderIrOptions = { textPathMode: "merged" };

function vnodeWidth(vnode: VNode): number {
  return Reflect.get(vnode.props, "width") as number;
}

function makeIr(vnode: VNode): IR {
  const width = vnodeWidth(vnode);
  return {
    root: {
      type: "group",
      nodeId: "auto:0",
      bbox: { x: 0, y: 0, w: width, h: 80 },
      children: [],
    },
    drawOrder: [],
    width,
    height: 80,
    warnings: [],
  };
}

function makeLayout(vnode: VNode): LayoutResult {
  return {
    root: {
      nodeId: "auto:0",
      vnode,
      bbox: { x: 0, y: 0, width: vnodeWidth(vnode), height: 80 },
      children: [],
    },
    measureCallCount: 1,
  };
}

function makeEngine() {
  const compile = vi.fn((vnode: VNode, options?: CompileOptions) => {
    const compiled: CompiledScene = {
      ir: makeIr(vnode),
      width: vnodeWidth(vnode),
      height: 80,
      textPathMode: options?.textPathMode ?? "merged",
    };
    return compiled;
  });
  const renderToLayoutTree = vi.fn((vnode: VNode) => makeLayout(vnode));
  const renderToIR = vi.fn((vnode: VNode, options?: RenderIrOptions) => {
    options?.onWarning?.(
      new Error("test warning") as Parameters<NonNullable<RenderIrOptions["onWarning"]>>[0],
    );
    return makeIr(vnode);
  });
  const engine = {
    compile,
    renderToLayoutTree,
    renderToIR,
  } as unknown as Engine;
  return { engine, compile, renderToLayoutTree, renderToIR };
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

describe("compiled-scene and inspection render-input stability", () => {
  it("does not recompile a fresh equal VNode for unrelated parent state", async () => {
    const { engine, compile } = makeEngine();
    let setLabel!: (label: string) => void;
    function Probe() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      useCompiledScene(makeVNode(), STABLE_COMPILE_OPTIONS);
      return <div data-label={label} />;
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setLabel("latest"));
    await flush();

    expect(compile).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("does not recompile fresh equal options for unrelated parent state", async () => {
    const { engine, compile } = makeEngine();
    let setLabel!: (label: string) => void;
    function Probe() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      useCompiledScene(STABLE_VNODE, { textPathMode: "merged" });
      return <div data-label={label} />;
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setLabel("latest"));
    await flush();

    expect(compile).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("recompiles exactly once for a VNode value change", async () => {
    const { engine, compile } = makeEngine();
    let setWidth!: (width: number) => void;
    function Probe() {
      const [width, setValue] = useState(100);
      setWidth = setValue;
      useCompiledScene(makeVNode(width), STABLE_COMPILE_OPTIONS);
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setWidth(120));
    await flush();

    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile.mock.calls[1]?.[0]).toMatchObject({ props: { width: 120 } });
    mounted.unmount();
  });

  it("recompiles exactly once for a compile-option value change", async () => {
    const { engine, compile } = makeEngine();
    let setTextPathMode!: (mode: "merged" | "perGlyph") => void;
    function Probe() {
      const [textPathMode, setValue] = useState<"merged" | "perGlyph">("merged");
      setTextPathMode = setValue;
      useCompiledScene(STABLE_VNODE, { textPathMode });
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setTextPathMode("perGlyph"));
    await flush();

    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile.mock.calls[1]?.[1]).toMatchObject({ textPathMode: "perGlyph" });
    mounted.unmount();
  });

  it("does not reinspect a fresh equal VNode for unrelated parent state", async () => {
    const { engine, renderToLayoutTree, renderToIR } = makeEngine();
    let setLabel!: (label: string) => void;
    function Probe() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      useBoundSvgInspection(makeVNode(), STABLE_RENDER_OPTIONS);
      return <div data-label={label} />;
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setLabel("latest"));
    await flush();

    expect(renderToLayoutTree).toHaveBeenCalledTimes(1);
    expect(renderToIR).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("does not reinspect fresh equal options and callbacks for unrelated state", async () => {
    const { engine, renderToLayoutTree, renderToIR } = makeEngine();
    let setLabel!: (label: string) => void;
    function Probe() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      useBoundSvgInspection(STABLE_VNODE, {
        debug: { parts: ["layout"] },
        onWarning: () => {},
      });
      return <div data-label={label} />;
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setLabel("latest"));
    await flush();

    expect(renderToLayoutTree).toHaveBeenCalledTimes(1);
    expect(renderToIR).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("reinspects exactly once for a VNode value change", async () => {
    const { engine, renderToLayoutTree, renderToIR } = makeEngine();
    let setWidth!: (width: number) => void;
    function Probe() {
      const [width, setValue] = useState(100);
      setWidth = setValue;
      useBoundSvgInspection(makeVNode(width), STABLE_RENDER_OPTIONS);
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setWidth(120));
    await flush();

    expect(renderToLayoutTree).toHaveBeenCalledTimes(2);
    expect(renderToIR).toHaveBeenCalledTimes(2);
    expect(renderToIR.mock.calls[1]?.[0]).toMatchObject({ props: { width: 120 } });
    mounted.unmount();
  });

  it("reinspects once per option value and calls the latest warning closure", async () => {
    const { engine, renderToLayoutTree, renderToIR } = makeEngine();
    const observedLabels: string[] = [];
    let setState!: (state: { label: string; scale: number }) => void;
    function Probe() {
      const [state, setValue] = useState({ label: "first", scale: 1 });
      setState = setValue;
      useBoundSvgInspection(STABLE_VNODE, {
        scale: state.scale,
        onWarning: () => observedLabels.push(state.label),
      });
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setState({ label: "latest", scale: 2 }));
    await flush();

    expect(renderToLayoutTree).toHaveBeenCalledTimes(2);
    expect(renderToIR).toHaveBeenCalledTimes(2);
    expect(renderToIR.mock.calls[1]?.[1]).toMatchObject({ scale: 2 });
    expect(observedLabels).toEqual(["first", "latest"]);
    mounted.unmount();
  });
});
