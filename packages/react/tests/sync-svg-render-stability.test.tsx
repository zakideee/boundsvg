// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { Engine, RenderOptions, VNode } from "@boundsvg/core";
import { act, StrictMode, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BoundSvg } from "../src/components/boundsvg.js";
import { Text } from "../src/components/nodes.js";
import { BoundSvgContext } from "../src/context.js";
import { useRenderToSvg } from "../src/hooks/use-render-svg.js";
import type { BoundSvgContextValue } from "../src/types.js";

function makeVNode(width = 100, text = "hello"): VNode {
  return {
    type: "Canvas",
    props: { width, height: 100 },
    children: [
      {
        type: "Text",
        props: { font: "f", fontSizePx: 16 },
        children: [text],
      },
    ],
  };
}

const STABLE_VNODE = makeVNode();

function makeEngine() {
  const renderToSvg = vi.fn((vnode: VNode, options: RenderOptions) => {
    options.onWarning?.(
      new Error("test warning") as Parameters<NonNullable<RenderOptions["onWarning"]>>[0],
    );
    return `<svg data-width="${Reflect.get(vnode.props, "width")}" data-scale="${options.scale ?? 1}"></svg>`;
  });
  return {
    engine: { renderToSvg } as unknown as Engine,
    renderToSvg,
  };
}

function context(engine: Engine): BoundSvgContextValue {
  return {
    engine,
    workerEngine: null,
    status: "ready",
    error: null,
    defaultRenderOptions: { textPathMode: "merged" },
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

describe("synchronous SVG render-input stability", () => {
  it("delivers render warnings once after a StrictMode generation commits", () => {
    const onWarning = vi.fn();
    const renderToSvg = vi.fn((_vnode: VNode, options: RenderOptions) => {
      options.onWarning?.(
        new Error("commit warning") as Parameters<NonNullable<RenderOptions["onWarning"]>>[0],
      );
      expect(onWarning).not.toHaveBeenCalled();
      return "<svg></svg>";
    });
    const engine = { renderToSvg } as unknown as Engine;

    function Probe() {
      useRenderToSvg(STABLE_VNODE, { onWarning });
      return <div data-committed="true" />;
    }

    const mounted = mount(
      <StrictMode>
        <Probe />
      </StrictMode>,
      engine,
    );

    expect(renderToSvg).toHaveBeenCalled();
    expect(document.querySelector('[data-committed="true"]')).not.toBeNull();
    expect(onWarning).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("does not deliver warnings from a render that starts but never commits", () => {
    const onWarning = vi.fn();
    const never = new Promise<never>(() => {});
    const renderToSvg = vi.fn((_vnode: VNode, options: RenderOptions) => {
      options.onWarning?.(
        new Error("render warning") as Parameters<NonNullable<RenderOptions["onWarning"]>>[0],
      );
      return "<svg></svg>";
    });
    const engine = { renderToSvg } as unknown as Engine;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Probe({ suspend, width }: { suspend: boolean; width: number }) {
      useRenderToSvg(makeVNode(width), { onWarning });
      if (suspend) {
        throw never;
      }
      return <div data-width={width} />;
    }

    act(() => {
      root.render(
        <BoundSvgContext.Provider value={context(engine)}>
          <Suspense fallback={<div data-fallback="true" />}>
            <Probe suspend={false} width={100} />
          </Suspense>
        </BoundSvgContext.Provider>,
      );
    });
    expect(onWarning).toHaveBeenCalledTimes(1);
    onWarning.mockClear();

    act(() => {
      root.render(
        <BoundSvgContext.Provider value={context(engine)}>
          <Suspense fallback={<div data-fallback="true" />}>
            <Probe suspend width={120} />
          </Suspense>
        </BoundSvgContext.Provider>,
      );
    });

    expect(
      renderToSvg.mock.calls.some(([vnode]) => Reflect.get(vnode.props, "width") === 120),
    ).toBe(true);
    expect(document.querySelector('[data-fallback="true"]')).not.toBeNull();
    expect(onWarning).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });

  it("does not rerender a direct hook for unrelated parent state", async () => {
    const { engine, renderToSvg } = makeEngine();
    let setLabel!: (label: string) => void;
    function Probe() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      const result = useRenderToSvg(makeVNode(), {
        debug: { parts: ["layout"] },
        onWarning: () => {},
      });
      return <div data-label={label} dangerouslySetInnerHTML={{ __html: result.svg ?? "" }} />;
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setLabel("latest"));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("does not rerender explicit BoundSvg for unrelated parent state", async () => {
    const { engine, renderToSvg } = makeEngine();
    let setLabel!: (label: string) => void;
    function Probe() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      return (
        <div data-label={label}>
          <BoundSvg
            vnode={makeVNode()}
            renderOptions={{ debug: { parts: ["layout"] }, onWarning: () => {} }}
          />
        </div>
      );
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setLabel("latest"));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("does not rerender declarative BoundSvg for unrelated parent state", async () => {
    const { engine, renderToSvg } = makeEngine();
    let setLabel!: (label: string) => void;
    function Probe() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      return (
        <div data-label={label}>
          <BoundSvg
            width={100}
            height={100}
            renderOptions={{ debug: { parts: ["layout"] }, onWarning: () => {} }}
          >
            <Text font="f" fontSizePx={16}>
              hello
            </Text>
          </BoundSvg>
        </div>
      );
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setLabel("latest"));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("renders exactly once more for a direct VNode value change", async () => {
    const { engine, renderToSvg } = makeEngine();
    let setWidth!: (width: number) => void;
    function Probe() {
      const [width, setValue] = useState(100);
      setWidth = setValue;
      useRenderToSvg(makeVNode(width), { scale: 1 });
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setWidth(120));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(2);
    expect(renderToSvg.mock.calls[1]?.[0]).toMatchObject({ props: { width: 120 } });
    mounted.unmount();
  });

  it("renders exactly once more for declarative text content change", async () => {
    const { engine, renderToSvg } = makeEngine();
    let setText!: (text: string) => void;
    function Probe() {
      const [text, setValue] = useState("first");
      setText = setValue;
      return (
        <BoundSvg width={100} height={100}>
          <Text font="f" fontSizePx={16}>
            {text}
          </Text>
        </BoundSvg>
      );
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setText("second"));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(2);
    const secondVNode = renderToSvg.mock.calls[1]?.[0];
    expect(secondVNode?.children[0]).toMatchObject({ children: ["second"] });
    mounted.unmount();
  });

  it("renders once per option value and calls the latest warning closure", async () => {
    const { engine, renderToSvg } = makeEngine();
    const observedLabels: string[] = [];
    let setState!: (state: { label: string; scale: number }) => void;
    function Probe() {
      const [state, setValue] = useState({ label: "first", scale: 1 });
      setState = setValue;
      useRenderToSvg(STABLE_VNODE, {
        scale: state.scale,
        onWarning: () => observedLabels.push(state.label),
      });
      return null;
    }
    const mounted = mount(<Probe />, engine);
    await flush();
    act(() => setState({ label: "latest", scale: 2 }));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(2);
    expect(renderToSvg.mock.calls[1]?.[1]).toMatchObject({ scale: 2 });
    expect(observedLabels).toEqual(["first", "latest"]);
    mounted.unmount();
  });
});
