// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { IR, VNode } from "@boundsvg/core";
import { act, type ReactNode, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedBoundSvg, BoundSvg } from "../src/components/boundsvg.js";
import { InteractiveBoundSvg } from "../src/components/interactive-boundsvg.js";
import { Path } from "../src/components/nodes.js";
import { BoundSvgContext } from "../src/context.js";
import { MainRenderSchedulerContext } from "../src/execution/context.js";
import { MainRenderScheduler } from "../src/execution/main-render-scheduler.js";
import type { BoundSvgContextValue, EventCallback } from "../src/types.js";
import { makeEngineMock } from "./test-doubles.js";

// Geometry and browser clocks are exercised separately in real browser tests.
vi.mock("@boundsvg/browser/events", () => ({
  resolveHitTarget: (_container: Element, candidates: string[]) => candidates[0] ?? null,
  translateSvgCoords: (_svg: Element, clientX: number, clientY: number) => ({
    x: clientX,
    y: clientY,
  }),
}));

/** Mounted roots and schedulers owned by the current test. */
const mountedFixtures: Array<{ root: Root; scheduler: MainRenderScheduler }> = [];

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  for (const { root, scheduler } of mountedFixtures.splice(0)) {
    act(() => root.unmount());
    scheduler.dispose();
  }
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Distinct scene references request a new engine result without changing the component type. */
function scene(width = 100): VNode {
  return { type: "Canvas", props: { width, height: 100 }, children: [] };
}

/** A semantic node and callback name supplied by the render engine. */
function renderIr(nodeId = "path", handlerName = "path-click"): IR {
  return {
    width: 100,
    height: 100,
    warnings: [],
    drawOrder: [nodeId],
    root: {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 100, h: 100 },
      children: [
        {
          type: "text",
          nodeId,
          bbox: { x: 0, y: 0, w: 100, h: 100 },
          lines: [],
          on: { onClick: handlerName },
        },
      ],
    },
  };
}

/** Render output with a visible path whose identity can be observed independently of engine calls. */
function createSvgDocument(color = "red"): string {
  return `<svg viewBox="0 0 100 100"><path d="M0 0H100V100H0Z" fill="${color}"/></svg>`;
}

/** Mount real display components while controlling only their engine output and readiness. */
function createFixture() {
  let svg = createSvgDocument();
  let ir = renderIr();
  let failure: Error | null = null;
  const renderSvg = () => {
    if (failure) {
      throw failure;
    }
    return svg;
  };
  const renderSvgAndIr = () => ({ svg: renderSvg(), ir });
  const engine = makeEngineMock({
    renderToSvg: vi.fn(renderSvg),
    renderToAnimatedSvg: vi.fn(renderSvg),
    renderToSvgAndIR: vi.fn(renderSvgAndIr),
    renderToAnimatedSvgAndIR: vi.fn(renderSvgAndIr),
  });
  const scheduler = new MainRenderScheduler();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedFixtures.push({ root, scheduler });
  return {
    container,
    setOutput(nextSvg: string, nextIr = renderIr()) {
      svg = nextSvg;
      ir = nextIr;
      failure = null;
    },
    fail(error: Error) {
      failure = error;
    },
    async render(children: ReactNode, status: BoundSvgContextValue["status"] = "ready") {
      await act(async () => {
        root.render(
          <StrictMode>
            <BoundSvgContext.Provider value={{ engine, workerEngine: null, status, error: null }}>
              <MainRenderSchedulerContext.Provider value={scheduler}>
                {children}
              </MainRenderSchedulerContext.Provider>
            </BoundSvgContext.Provider>
          </StrictMode>,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    },
  };
}

describe("displayed SVG DOM stability", () => {
  it.each([
    "static",
    "animated",
  ] as const)("preserves %s SVG and Path identity on an unrelated parent update", async (mode) => {
    const fixture = createFixture();
    const vnode = scene();
    const display = (className: string) =>
      mode === "static" ? (
        <BoundSvg vnode={vnode} className={className} />
      ) : (
        <AnimatedBoundSvg
          vnode={vnode}
          className={className}
          renderOptions={{ playback: { mode: "independent" } }}
        />
      );
    await fixture.render(display("before"));
    const svg = fixture.container.querySelector("svg");
    const path = fixture.container.querySelector("path");
    expect(svg).not.toBeNull();
    await fixture.render(display("after"));
    expect(fixture.container.querySelector("svg")).toBe(svg);
    expect(fixture.container.querySelector("path")).toBe(path);
    expect(svg?.parentElement?.className).toBe("after");
  });

  it("preserves hover DOM and dispatches an updated handler without reinserting the SVG", async () => {
    let pendingFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const fixture = createFixture();
    const vnode = scene();
    const originalCallback = vi.fn<EventCallback>();
    const latestCallback = vi.fn<EventCallback>();
    const onHoverChange = vi.fn();
    const display = (callback: EventCallback) => (
      <InteractiveBoundSvg
        vnode={vnode}
        handlers={new Map([["path-click", callback]])}
        onHoverChange={onHoverChange}
      />
    );
    await fixture.render(display(originalCallback));
    const svg = fixture.container.querySelector("svg");
    const path = fixture.container.querySelector("path");
    const surface = svg?.parentElement;
    expect(surface).not.toBeNull();
    await act(async () => {
      surface?.dispatchEvent(new PointerEvent("pointermove", { clientX: 20, clientY: 20 }));
      pendingFrame?.(0);
    });
    expect(onHoverChange).toHaveBeenLastCalledWith("path");
    expect(
      (fixture.container.querySelector("svg") as SVGSVGElement | null)?.style.touchAction,
    ).toBe("none");
    expect(fixture.container.querySelector("svg")).toBe(svg);
    expect(fixture.container.querySelector("path")).toBe(path);
    await fixture.render(display(latestCallback));
    expect(fixture.container.querySelector("svg")).toBe(svg);
    act(() => {
      surface?.dispatchEvent(new MouseEvent("click", { clientX: 20, clientY: 20 }));
    });
    expect(originalCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledOnce();
  });

  it("retains declarative interactive DOM with fresh children and inline callbacks", async () => {
    const fixture = createFixture();
    const display = (label: string) => (
      <InteractiveBoundSvg width={100} height={100} className={label}>
        <Path
          id="path"
          width={100}
          height={100}
          d="M0 0H100V100H0Z"
          fill="red"
          onClick={() => {}}
        />
      </InteractiveBoundSvg>
    );
    await fixture.render(display("before"));
    const svg = fixture.container.querySelector("svg");
    const path = fixture.container.querySelector("path");
    expect(svg).not.toBeNull();
    await fixture.render(display("after"));
    expect(fixture.container.querySelector("svg")).toBe(svg);
    expect(fixture.container.querySelector("path")).toBe(path);
    expect(svg?.parentElement?.className).toBe("after");
  });

  it.each([
    "static",
    "animated",
    "interactive",
  ] as const)("recovers %s loading and error states and replaces genuinely changed SVG", async (mode) => {
    const fixture = createFixture();
    const display = (vnode: VNode) => {
      const shared = { vnode, fallback: <output>loading</output> };
      if (mode === "static") {
        return <BoundSvg {...shared} />;
      }
      if (mode === "animated") {
        return (
          <AnimatedBoundSvg {...shared} renderOptions={{ playback: { mode: "independent" } }} />
        );
      }
      return <InteractiveBoundSvg {...shared} />;
    };
    await fixture.render(display(scene()), "loading");
    expect(fixture.container.textContent).toBe("loading");
    await fixture.render(display(scene()));
    const originalSvg = fixture.container.querySelector("svg");
    expect(originalSvg).not.toBeNull();
    fixture.setOutput(createSvgDocument("green"));
    await fixture.render(display(scene(101)));
    const changedSvg = fixture.container.querySelector("svg");
    expect(changedSvg).not.toBe(originalSvg);
    expect(fixture.container.querySelector("path")?.getAttribute("fill")).toBe("green");
    fixture.fail(new Error("render rejected"));
    await fixture.render(display(scene(102)));
    expect(fixture.container.querySelector('[role="alert"]')?.textContent).toContain(
      "render rejected",
    );
    fixture.setOutput(createSvgDocument("blue"));
    const recoveredScene = scene(103);
    await fixture.render(display(recoveredScene));
    const recoveredSvg = fixture.container.querySelector("svg");
    expect(recoveredSvg).not.toBe(originalSvg);
    expect(fixture.container.querySelector("path")?.getAttribute("fill")).toBe("blue");
    await fixture.render(display(recoveredScene));
    expect(fixture.container.querySelector("svg")).toBe(recoveredSvg);
  });
});
