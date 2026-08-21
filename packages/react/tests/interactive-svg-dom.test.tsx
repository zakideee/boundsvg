// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { Engine, IR, VNode } from "@boundsvg/core";
import { act, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BoundSvgContext } from "../src/context.js";
import { useInteractiveSvg } from "../src/hooks/use-interactive-svg.js";
import { InteractiveBoundSvg } from "../src/interactive.js";
import type { BoundSvgContextValue, EventCallback } from "../src/types.js";
import { makeEngineMock } from "./test-doubles.js";

vi.mock("@boundsvg/browser/events", () => ({
  resolveHitTarget: (_container: Element, candidates: string[]) => candidates[0] ?? null,
  translateSvgCoords: (_svg: Element, clientX: number, clientY: number) => ({
    x: clientX,
    y: clientY,
  }),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function sampleVNode(width = 100): VNode {
  return {
    type: "Canvas",
    props: { width, height: 100 },
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
          bbox: { x: 0, y: 0, w: 100, h: 100 },
          lines: [{ text: "hello", glyphs: [], width: 40, baselineY: 20 }],
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

function createContextValue(engine: Engine): BoundSvgContextValue {
  return {
    engine,
    workerEngine: null,
    status: "ready",
    error: null,
    defaultRenderOptions: { textPathMode: "merged" },
  };
}

describe("useInteractiveSvg DOM lifecycle", () => {
  it("delivers InteractiveBoundSvg render, hover, and text-copy callbacks", async () => {
    let scheduledFrame: FrameRequestCallback | null = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        scheduledFrame = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const ir = sampleIr();
    const engine = makeEngineMock({
      renderToSvgAndIR: vi.fn(() => ({
        svg: '<svg viewBox="0 0 100 100"></svg>',
        ir,
      })),
    });
    const onHoverChange = vi.fn();
    const onRender = vi.fn();
    const onTextCopyMenu = vi.fn();
    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);
    const root = createRoot(rootEl);

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <InteractiveBoundSvg
            vnode={sampleVNode()}
            className="interactive-surface"
            onHoverChange={onHoverChange}
            onRender={onRender}
            enableTextCopy
            onTextCopyMenu={onTextCopyMenu}
          />
        </BoundSvgContext.Provider>,
      );
    });

    const surface = document.querySelector(".interactive-surface");
    expect(surface).toBeInstanceOf(HTMLDivElement);
    expect(onRender).toHaveBeenCalledWith(ir);

    await act(async () => {
      surface?.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 20 }));
    });
    const frame = scheduledFrame;
    scheduledFrame = null;
    await act(async () => {
      frame?.(0);
    });
    expect(onHoverChange).toHaveBeenLastCalledWith("txt");

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 20,
    });
    await act(async () => {
      surface?.dispatchEvent(contextMenuEvent);
    });
    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(onTextCopyMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "txt",
        svgX: 10,
        svgY: 20,
        clientX: 10,
        clientY: 20,
        nodeText: "hello",
        allText: "hello",
        copyToClipboard: expect.any(Function),
      }),
    );

    onTextCopyMenu.mockClear();
    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <InteractiveBoundSvg
            vnode={sampleVNode()}
            className="interactive-surface"
            enableTextCopy={false}
            onTextCopyMenu={onTextCopyMenu}
          />
        </BoundSvgContext.Provider>,
      );
    });
    const disabledContextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 20,
    });
    await act(async () => {
      document.querySelector(".interactive-surface")?.dispatchEvent(disabledContextMenuEvent);
    });
    expect(disabledContextMenuEvent.defaultPrevented).toBe(false);
    expect(onTextCopyMenu).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("routes InteractiveBoundSvg declarative conversion errors to errorFallback", () => {
    const renderToSvgAndIR = vi.fn(() => ({
      svg: '<svg viewBox="0 0 100 100"></svg>',
      ir: sampleIr(),
    }));
    const engine = makeEngineMock({ renderToSvgAndIR });

    const html = renderToString(
      <BoundSvgContext.Provider value={createContextValue(engine)}>
        <InteractiveBoundSvg
          width={100}
          height={100}
          errorFallback={(error) => <span>Interactive error: {error.message}</span>}
        >
          <div>unsupported</div>
        </InteractiveBoundSvg>
      </BoundSvgContext.Provider>,
    );

    expect(renderToSvgAndIR).not.toHaveBeenCalled();
    expect(html).toContain("<span>Interactive error:");
    expect(html).toContain("[boundsvg] Unsupported React element &lt;div&gt;");
    expect(html).not.toContain('role="alert"');
  });

  it("keeps SVG+IR stable across internal state with fresh equal render inputs", async () => {
    let scheduledFrame: FrameRequestCallback | null = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        scheduledFrame = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const renderToSvgAndIR = vi.fn(() => ({
      svg: '<svg viewBox="0 0 100 100"></svg>',
      ir: sampleIr(),
    }));
    const engine = makeEngineMock({ renderToSvgAndIR });
    const observedLabels: string[] = [];
    let setLabel!: (label: string) => void;
    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);
    const root = createRoot(rootEl);

    function Probe() {
      const [label, setValue] = useState("first");
      setLabel = setValue;
      const handlers = new Map<string, EventCallback>([
        ["click:txt", () => observedLabels.push(label)],
      ]);
      const result = useInteractiveSvg(sampleVNode(), handlers, {
        renderOptions: { debug: { parts: ["layout"] }, onWarning: () => {} },
        showPointerCursor: false,
      });
      return (
        <div
          data-surface="stateful"
          data-hover={result.hoverNodeId ?? "none"}
          ref={result.containerRef}
          dangerouslySetInnerHTML={result.svg ? { __html: result.svg } : undefined}
        />
      );
    }

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Probe />
        </BoundSvgContext.Provider>,
      );
    });
    act(() => setLabel("latest"));

    const surface = document.querySelector('[data-surface="stateful"]');
    expect(surface).not.toBeNull();
    await act(async () => {
      surface?.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10 }));
      surface?.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 10 }));
    });
    const frame = scheduledFrame;
    scheduledFrame = null;
    await act(async () => {
      frame?.(0);
    });
    expect(document.querySelector('[data-surface="stateful"]')?.getAttribute("data-hover")).toBe(
      "txt",
    );
    await act(async () => {
      document
        .querySelector('[data-surface="stateful"]')
        ?.dispatchEvent(new PointerEvent("pointerleave"));
    });

    expect(renderToSvgAndIR).toHaveBeenCalledTimes(1);
    expect(observedLabels).toEqual(["latest"]);
    expect(document.querySelector('[data-surface="stateful"]')?.getAttribute("data-hover")).toBe(
      "none",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps committed handlers when a newer render suspends before commit", async () => {
    const renderToSvgAndIR = vi.fn(() => ({
      svg: '<svg viewBox="0 0 100 100"></svg>',
      ir: sampleIr(),
    }));
    const engine = makeEngineMock({ renderToSvgAndIR });
    const observedHandlers: string[] = [];
    const never = new Promise<never>(() => {});
    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);
    const root = createRoot(rootEl);

    function Probe({ label, suspend }: { label: string; suspend: boolean }) {
      const handlers = new Map<string, EventCallback>([
        ["click:txt", () => observedHandlers.push(label)],
      ]);
      const result = useInteractiveSvg(sampleVNode(), handlers, { showPointerCursor: false });
      if (suspend) {
        throw never;
      }
      return (
        <div
          data-surface="commit-boundary"
          ref={result.containerRef}
          dangerouslySetInnerHTML={result.svg ? { __html: result.svg } : undefined}
        />
      );
    }

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Suspense fallback={<div data-fallback="true" />}>
            <Probe label="committed" suspend={false} />
          </Suspense>
        </BoundSvgContext.Provider>,
      );
    });
    const committedSurface = document.querySelector('[data-surface="commit-boundary"]');
    expect(committedSurface).not.toBeNull();

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Suspense fallback={<div data-fallback="true" />}>
            <Probe label="abandoned" suspend />
          </Suspense>
        </BoundSvgContext.Provider>,
      );
    });
    expect(document.querySelector('[data-fallback="true"]')).not.toBeNull();

    await act(async () => {
      committedSurface?.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10 }));
    });
    expect(observedHandlers).toEqual(["committed"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("renders exactly once more when a fresh VNode value changes", async () => {
    const renderToSvgAndIR = vi.fn(() => ({
      svg: '<svg viewBox="0 0 100 100"></svg>',
      ir: sampleIr(),
    }));
    const engine = makeEngineMock({ renderToSvgAndIR });
    let setWidth!: (width: number) => void;
    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);
    const root = createRoot(rootEl);

    function Probe() {
      const [width, setValue] = useState(100);
      setWidth = setValue;
      const result = useInteractiveSvg(sampleVNode(width), new Map(), {
        showPointerCursor: false,
      });
      return (
        <div
          ref={result.containerRef}
          dangerouslySetInnerHTML={result.svg ? { __html: result.svg } : undefined}
        />
      );
    }

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Probe />
        </BoundSvgContext.Provider>,
      );
    });
    act(() => setWidth(120));

    expect(renderToSvgAndIR).toHaveBeenCalledTimes(2);
    expect(renderToSvgAndIR.mock.calls[1]?.[0]).toMatchObject({ props: { width: 120 } });

    await act(async () => {
      root.unmount();
    });
  });

  it("renders exactly once more when a nested render option changes", async () => {
    const renderToSvgAndIR = vi.fn(() => ({
      svg: '<svg viewBox="0 0 100 100"></svg>',
      ir: sampleIr(),
    }));
    const engine = makeEngineMock({ renderToSvgAndIR });
    const vnode = sampleVNode();
    let setPart!: (part: "layout" | "actual") => void;
    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);
    const root = createRoot(rootEl);

    function Probe() {
      const [part, setValue] = useState<"layout" | "actual">("layout");
      setPart = setValue;
      const result = useInteractiveSvg(vnode, new Map(), {
        renderOptions: { debug: { parts: [part] }, onWarning: () => {} },
        showPointerCursor: false,
      });
      return (
        <div
          ref={result.containerRef}
          dangerouslySetInnerHTML={result.svg ? { __html: result.svg } : undefined}
        />
      );
    }

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Probe />
        </BoundSvgContext.Provider>,
      );
    });
    act(() => setPart("actual"));

    expect(renderToSvgAndIR).toHaveBeenCalledTimes(2);
    expect(renderToSvgAndIR.mock.calls[1]?.[1]).toMatchObject({
      debug: { parts: ["actual"] },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("moves DOM listeners when the public containerRef is rebound to another node", async () => {
    const renderToSvgAndIR = vi.fn(() => ({
      svg: '<svg viewBox="0 0 100 100"></svg>',
      ir: sampleIr(),
    }));
    const engine = makeEngineMock({ renderToSvgAndIR });
    const onClick = vi.fn();
    const handlers = new Map<string, EventCallback>([["click:txt", onClick]]);
    const vnode = sampleVNode();
    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);
    const root = createRoot(rootEl);

    function Probe({ version }: { version: number }) {
      const { svg, containerRef } = useInteractiveSvg(vnode, handlers, {
        showPointerCursor: false,
      });
      return (
        <div
          key={version}
          data-surface={String(version)}
          ref={containerRef}
          dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
        />
      );
    }

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Probe version={1} />
        </BoundSvgContext.Provider>,
      );
    });

    const firstSurface = document.querySelector('[data-surface="1"]');
    expect(firstSurface).toBeInstanceOf(HTMLDivElement);

    await act(async () => {
      firstSurface?.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10 }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Probe version={2} />
        </BoundSvgContext.Provider>,
      );
    });

    const secondSurface = document.querySelector('[data-surface="2"]');
    expect(secondSurface).toBeInstanceOf(HTMLDivElement);
    onClick.mockClear();

    await act(async () => {
      firstSurface?.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10 }));
      secondSurface?.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10 }));
    });

    expect(onClick).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("reapplies touchAction to the generated inner SVG when SVG markup changes", async () => {
    let svg = '<svg data-render="one" viewBox="0 0 100 100"></svg>';
    const renderToSvgAndIR = vi.fn(() => ({
      svg,
      ir: sampleIr(),
    }));
    const engine = makeEngineMock({ renderToSvgAndIR });
    const handlers = new Map<string, EventCallback>();
    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);
    const root = createRoot(rootEl);

    function Probe({ vnode }: { vnode: VNode }) {
      const result = useInteractiveSvg(vnode, handlers, { showPointerCursor: false });
      return (
        <div
          data-surface="stable"
          ref={result.containerRef}
          dangerouslySetInnerHTML={result.svg ? { __html: result.svg } : undefined}
        />
      );
    }

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Probe vnode={sampleVNode()} />
        </BoundSvgContext.Provider>,
      );
    });

    const firstSvg = document.querySelector('[data-render="one"]');
    expect(firstSvg).toBeInstanceOf(SVGElement);
    expect((firstSvg as SVGElement).style.touchAction).toBe("none");

    svg = '<svg data-render="two" viewBox="0 0 100 100"></svg>';
    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Probe vnode={sampleVNode(120)} />
        </BoundSvgContext.Provider>,
      );
    });

    const secondSvg = document.querySelector('[data-render="two"]');
    expect(secondSvg).toBeInstanceOf(SVGElement);
    expect((secondSvg as SVGElement).style.touchAction).toBe("none");

    await act(async () => {
      root.unmount();
    });
  });

  it("cancels each pointer-down target once across cancel, lost capture, and pointerup", async () => {
    const ir = sampleIr();
    const textNode = ir.root.type === "group" ? ir.root.children?.[0] : undefined;
    if (!textNode || textNode.type !== "text") {
      throw new TypeError("test IR text node is missing");
    }
    textNode.on = {
      onPointerDown: "pointer-down:txt",
      onPointerCancel: "pointer-cancel:txt",
    };
    const renderToSvgAndIR = vi.fn(() => ({
      svg: '<svg viewBox="0 0 100 100"></svg>',
      ir,
    }));
    const engine = makeEngineMock({ renderToSvgAndIR });
    const onPointerDown = vi.fn();
    const onPointerCancel = vi.fn();
    const handlers = new Map<string, EventCallback>([
      ["pointer-down:txt", onPointerDown],
      ["pointer-cancel:txt", onPointerCancel],
    ]);
    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);
    const root = createRoot(rootEl);

    function Probe() {
      const result = useInteractiveSvg(sampleVNode(), handlers, { showPointerCursor: false });
      return (
        <div
          data-surface="cancel"
          ref={result.containerRef}
          dangerouslySetInnerHTML={result.svg ? { __html: result.svg } : undefined}
        />
      );
    }

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Probe />
        </BoundSvgContext.Provider>,
      );
    });
    const surface = document.querySelector('[data-surface="cancel"]');
    const pointerEvent = (type: string, pointerId: number) =>
      new PointerEvent(type, { pointerId, pointerType: "touch", clientX: 10, clientY: 10 });

    await act(async () => {
      surface?.dispatchEvent(pointerEvent("pointerdown", 1));
      surface?.dispatchEvent(pointerEvent("pointerdown", 2));
      surface?.dispatchEvent(pointerEvent("pointercancel", 1));
      surface?.dispatchEvent(pointerEvent("lostpointercapture", 1));
      surface?.dispatchEvent(pointerEvent("pointerup", 2));
      surface?.dispatchEvent(pointerEvent("pointercancel", 2));
    });

    expect(onPointerDown).toHaveBeenCalledTimes(2);
    expect(onPointerCancel).toHaveBeenCalledTimes(1);
    expect(onPointerCancel).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "txt", nativeEvent: expect.any(PointerEvent) }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it.each([
    "pointercancel",
    "lostpointercapture",
  ] as const)("preserves the pointer-down target across option changes before %s", async (terminalEventType) => {
    const ir = sampleIr();
    const textNode = ir.root.type === "group" ? ir.root.children?.[0] : undefined;
    if (!textNode || textNode.type !== "text") {
      throw new TypeError("test IR text node is missing");
    }
    textNode.on = {
      onPointerDown: "pointer-down:txt",
      onPointerCancel: "pointer-cancel:txt",
    };
    const engine = makeEngineMock({
      renderToSvgAndIR: vi.fn(() => ({
        svg: '<svg viewBox="0 0 100 100"></svg>',
        ir,
      })),
    });
    const onPointerDown = vi.fn();
    const onPointerCancel = vi.fn();
    const handlers = new Map<string, EventCallback>([
      ["pointer-down:txt", onPointerDown],
      ["pointer-cancel:txt", onPointerCancel],
    ]);
    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);
    const root = createRoot(rootEl);

    function Probe({ optionsEnabled }: { optionsEnabled: boolean }) {
      const result = useInteractiveSvg(sampleVNode(), handlers, {
        showPointerCursor: optionsEnabled,
        enableTextCopy: optionsEnabled,
      });
      return (
        <div
          data-surface="rerender-cancel"
          ref={result.containerRef}
          dangerouslySetInnerHTML={result.svg ? { __html: result.svg } : undefined}
        />
      );
    }

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Probe optionsEnabled={false} />
        </BoundSvgContext.Provider>,
      );
    });
    const surface = document.querySelector('[data-surface="rerender-cancel"]');
    expect(surface).toBeInstanceOf(HTMLDivElement);

    await act(async () => {
      surface?.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "touch",
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    expect(onPointerDown).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={createContextValue(engine)}>
          <Probe optionsEnabled />
        </BoundSvgContext.Provider>,
      );
    });
    await act(async () => {
      surface?.dispatchEvent(
        new PointerEvent(terminalEventType, {
          pointerId: 1,
          pointerType: "touch",
          clientX: 10,
          clientY: 10,
        }),
      );
    });

    expect(onPointerCancel).toHaveBeenCalledTimes(1);
    expect(onPointerCancel).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "txt", nativeEvent: expect.any(PointerEvent) }),
    );

    await act(async () => {
      root.unmount();
    });
  });
});
