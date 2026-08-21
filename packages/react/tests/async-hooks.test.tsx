// @vitest-environment happy-dom
/** @jsxImportSource react */

/**
 * Tests for useRenderToSvgAsync / useRenderToPngAsync.
 *
 * Uses happy-dom env so useEffect fires. Fully mocks @boundsvg/core to avoid
 * loading the WASM module (which causes OOM in forked vitest workers).
 *
 * Most VNodes are shared constants so each test controls only the dependency
 * whose lifecycle it intends to exercise. A focused regression below covers
 * freshly allocated, structurally equal VNodes.
 */

import type { LayeredPngResult, LayeredSvgResult, RenderOptions, VNode } from "@boundsvg/core";
import type { WorkerEngine } from "@boundsvg/worker";
import { act, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BoundSvgContext } from "../src/context.js";
import type { BoundSvgContextValue } from "../src/types.js";
import { makeInvalidVNode, makeWorkerEngineMock } from "./test-doubles.js";

// Fully mock @boundsvg/core — no actual module loading (avoids WASM OOM)
const mockToSceneDocument = vi.fn((vnode: VNode) => {
  if ((vnode.type as string) === "UnknownWidget") {
    throw new Error(`Cannot convert VNode of unknown type "UnknownWidget" to SceneNode`);
  }
  return { type: "canvas", width: 100, height: 100, children: [] };
});

vi.mock("@boundsvg/core", () => ({
  toSceneDocument: (vnode: VNode) => mockToSceneDocument(vnode),
}));

// Import after mock is set up
const { useRenderToSvgAsync } = await import("../src/hooks/use-render-svg-async.js");
const { useRenderToPngAsync } = await import("../src/hooks/use-render-png-async.js");
const { useRenderToLayeredSvgAsync } = await import("../src/hooks/use-render-layered-svg-async.js");
const { useRenderToLayeredPngAsync } = await import("../src/hooks/use-render-layered-png-async.js");

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable VNode reference — create ONCE, reuse across renders */
const VALID_VNODE: VNode = {
  type: "Canvas",
  props: { width: 100, height: 100 },
  children: [
    { type: "Text", props: { font: "f", fontSizePx: 16, color: "#000" }, children: ["hi"] },
  ],
};

/** Stable invalid VNode reference */
const INVALID_VNODE = makeInvalidVNode({ type: "UnknownWidget", props: {}, children: [] });

/** Stable render options */
const SCALE_OPTIONS: RenderOptions = { scale: 2 };

function workerCtx(workerEngine: WorkerEngine): BoundSvgContextValue {
  return {
    engine: null,
    workerEngine,
    status: "ready",
    error: null,
    defaultRenderOptions: { textPathMode: "merged" },
  };
}

function mount(ui: React.ReactNode, ctx: BoundSvgContextValue) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<BoundSvgContext.Provider value={ctx}>{ui}</BoundSvgContext.Provider>);
  });
  return {
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  mockToSceneDocument.mockClear();
});

// ---------------------------------------------------------------------------
// useRenderToSvgAsync
// ---------------------------------------------------------------------------

describe("useRenderToSvgAsync", () => {
  it("renders SVG via WorkerEngine after effect fires", async () => {
    const svgString = '<svg viewBox="0 0 100 100"><text>hi</text></svg>';
    const wEng = makeWorkerEngineMock({ renderToSvg: vi.fn(async () => svgString) });

    let snap: ReturnType<typeof useRenderToSvgAsync> | null = null;
    function Probe() {
      snap = useRenderToSvgAsync(VALID_VNODE);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(snap!.isReady).toBe(true);
    expect(snap!.svg).toBe(svgString);
    expect(snap!.error).toBeNull();
    expect(wEng.renderToSvg).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("captures toSceneDocument() sync error in error state", async () => {
    const wEng = makeWorkerEngineMock({ renderToSvg: vi.fn(async () => "<svg></svg>") });

    let snap: ReturnType<typeof useRenderToSvgAsync> | null = null;
    function Probe() {
      snap = useRenderToSvgAsync(INVALID_VNODE);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(snap!.error).not.toBeNull();
    expect(snap!.error!.message).toContain("UnknownWidget");
    expect(snap!.svg).toBeNull();
    expect(snap!.isReady).toBe(false);
    expect(wEng.renderToSvg).not.toHaveBeenCalled();
    unmount();
  });

  it("captures WorkerEngine.renderToSvg() rejection in error state", async () => {
    const wEng = makeWorkerEngineMock({
      renderToSvg: vi.fn(async () => {
        throw new Error("worker render failed");
      }),
    });

    let snap: ReturnType<typeof useRenderToSvgAsync> | null = null;
    function Probe() {
      snap = useRenderToSvgAsync(VALID_VNODE);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(snap!.error!.message).toBe("worker render failed");
    expect(snap!.svg).toBeNull();
    expect(snap!.isReady).toBe(false);
    unmount();
  });

  it("merges defaultRenderOptions with per-call options", async () => {
    const wEng = makeWorkerEngineMock({ renderToSvg: vi.fn(async () => "<svg></svg>") });

    function Probe() {
      useRenderToSvgAsync(VALID_VNODE, SCALE_OPTIONS);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    const renderToSvgMock = wEng.renderToSvg as ReturnType<typeof vi.fn>;
    const callArgs = renderToSvgMock.mock.calls[0] as unknown[];
    const options = callArgs[1] as RenderOptions;
    expect(options.textPathMode).toBe("merged");
    expect(options.scale).toBe(2);
    unmount();
  });

  it("re-renders when renderOptions change with the same vnode", async () => {
    const wEng = makeWorkerEngineMock({ renderToSvg: vi.fn(async () => "<svg></svg>") });

    let setDebug: ((debug: boolean) => void) | null = null;
    function Probe() {
      const [debug, setter] = useState(false);
      setDebug = setter;
      const renderOptions = useMemo(() => ({ debug }), [debug]);
      useRenderToSvgAsync(VALID_VNODE, renderOptions);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    const renderToSvgMock = wEng.renderToSvg as ReturnType<typeof vi.fn>;
    expect(renderToSvgMock).toHaveBeenCalledTimes(1);
    const firstCallOptions = (renderToSvgMock.mock.calls[0] as unknown[])[1] as RenderOptions;
    expect(firstCallOptions.debug).toBe(false);

    act(() => setDebug!(true));
    await flush();

    expect(renderToSvgMock).toHaveBeenCalledTimes(2);
    const secondCallOptions = (renderToSvgMock.mock.calls[1] as unknown[])[1] as RenderOptions;
    expect(secondCallOptions.debug).toBe(true);
    unmount();
  });

  it("does not restart for equal inline nested options and detects a nested value change", async () => {
    const pendingSecondRender = new Promise<string>(() => {});
    const renderToSvg = vi
      .fn()
      .mockResolvedValueOnce("<svg>first</svg>")
      .mockReturnValue(pendingSecondRender);
    const wEng = makeWorkerEngineMock({ renderToSvg });

    let setDebugPart: ((part: "layout" | "baseline") => void) | null = null;
    function Probe() {
      const [debugPart, setter] = useState<"layout" | "baseline">("layout");
      setDebugPart = setter;
      useRenderToSvgAsync(VALID_VNODE, { debug: { parts: [debugPart] } });
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(1);

    act(() => setDebugPart!("baseline"));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(2);
    const secondCallOptions = (renderToSvg.mock.calls[1] as unknown[])[1] as RenderOptions;
    expect(secondCallOptions.debug).toEqual({ parts: ["baseline"] });
    unmount();
  });

  it("does not restart for an inline callback and forwards to its latest closure", async () => {
    const pendingSecondRender = new Promise<string>(() => {});
    const renderToSvg = vi
      .fn()
      .mockResolvedValueOnce("<svg>first</svg>")
      .mockReturnValue(pendingSecondRender);
    const wEng = makeWorkerEngineMock({ renderToSvg });
    const observedLabels: string[] = [];

    let setLabel: ((label: string) => void) | null = null;
    function Probe() {
      const [label, setter] = useState("first");
      setLabel = setter;
      useRenderToSvgAsync(VALID_VNODE, {
        onWarning: () => observedLabels.push(label),
      });
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(1);

    act(() => setLabel!("latest"));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(1);
    const firstCallOptions = (renderToSvg.mock.calls[0] as unknown[])[1] as RenderOptions;
    const warning = { code: "TEST_WARNING" } as unknown as Parameters<
      NonNullable<RenderOptions["onWarning"]>
    >[0];
    firstCallOptions.onWarning?.(warning);
    expect(observedLabels).toEqual(["latest"]);
    unmount();
  });

  it("suppresses a delayed warning after the hook consumer unmounts", async () => {
    let resolveRender: ((svg: string) => void) | null = null;
    const renderToSvg = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRender = resolve;
        }),
    );
    const wEng = makeWorkerEngineMock({ renderToSvg });
    const observedWarnings: string[] = [];

    let setVisible: ((visible: boolean) => void) | null = null;
    function Probe() {
      useRenderToSvgAsync(VALID_VNODE, {
        onWarning: () => observedWarnings.push("warning"),
      });
      return null;
    }
    function ConsumerHarness() {
      const [visible, setter] = useState(true);
      setVisible = setter;
      return visible ? <Probe /> : null;
    }

    const { unmount } = mount(<ConsumerHarness />, workerCtx(wEng));
    await flush();
    const firstCallOptions = (renderToSvg.mock.calls[0] as unknown[])[1] as RenderOptions;

    act(() => setVisible!(false));
    act(() => {
      const warning = { code: "TEST_WARNING" } as unknown as Parameters<
        NonNullable<RenderOptions["onWarning"]>
      >[0];
      firstCallOptions.onWarning?.(warning);
      resolveRender!("<svg>stale</svg>");
    });
    await flush();

    expect(observedWarnings).toEqual([]);
    unmount();
  });

  it("suppresses a superseded request warning and delivers the current request warning", async () => {
    const secondVNode: VNode = {
      type: "Canvas",
      props: { width: 120, height: 80 },
      children: [],
    };
    let resolveFirst: ((svg: string) => void) | null = null;
    let resolveSecond: ((svg: string) => void) | null = null;
    const renderToSvg = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const wEng = makeWorkerEngineMock({ renderToSvg });
    const observedLabels: string[] = [];

    let setVNode: ((vnode: VNode) => void) | null = null;
    function Probe() {
      const [vnode, setter] = useState(VALID_VNODE);
      setVNode = setter;
      useRenderToSvgAsync(vnode, {
        onWarning: () => observedLabels.push(vnode === VALID_VNODE ? "first" : "second"),
      });
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();
    const firstCallOptions = (renderToSvg.mock.calls[0] as unknown[])[1] as RenderOptions;

    act(() => setVNode!(secondVNode));
    await flush();
    const secondCallOptions = (renderToSvg.mock.calls[1] as unknown[])[1] as RenderOptions;
    const warning = { code: "TEST_WARNING" } as unknown as Parameters<
      NonNullable<RenderOptions["onWarning"]>
    >[0];

    act(() => {
      firstCallOptions.onWarning?.(warning);
      resolveFirst!("<svg>stale</svg>");
    });
    await flush();
    expect(observedLabels).toEqual([]);

    act(() => {
      secondCallOptions.onWarning?.(warning);
      resolveSecond!("<svg>current</svg>");
    });
    await flush();
    expect(observedLabels).toEqual(["second"]);
    unmount();
  });

  it("forwards PNG resolution warnings to the latest inline callback", async () => {
    const pendingSecondRender = new Promise<Uint8Array>(() => {});
    const renderToPng = vi
      .fn()
      .mockResolvedValueOnce(new Uint8Array([137, 80, 78, 71]))
      .mockReturnValue(pendingSecondRender);
    const wEng = makeWorkerEngineMock({ renderToPng });
    const observedLabels: string[] = [];

    let setLabel: ((label: string) => void) | null = null;
    function Probe() {
      const [label, setter] = useState("first");
      setLabel = setter;
      useRenderToPngAsync(VALID_VNODE, {
        onPngResolutionAdjusted: () => observedLabels.push(label),
      });
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();
    act(() => setLabel!("latest"));
    await flush();

    expect(renderToPng).toHaveBeenCalledTimes(1);
    const firstCallOptions = (renderToPng.mock.calls[0] as unknown[])[1] as RenderOptions;
    const warning = { code: "PNG_RESOLUTION_ADJUSTED" } as unknown as Parameters<
      NonNullable<RenderOptions["onPngResolutionAdjusted"]>
    >[0];
    firstCallOptions.onPngResolutionAdjusted?.(warning);
    expect(observedLabels).toEqual(["latest"]);
    unmount();
  });

  it("suppresses a delayed PNG resolution callback after the hook consumer unmounts", async () => {
    let resolveRender: ((png: Uint8Array) => void) | null = null;
    const renderToPng = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveRender = resolve;
        }),
    );
    const wEng = makeWorkerEngineMock({ renderToPng });
    const observedWarnings: string[] = [];

    let setVisible: ((visible: boolean) => void) | null = null;
    function Probe() {
      useRenderToPngAsync(VALID_VNODE, {
        onPngResolutionAdjusted: () => observedWarnings.push("adjusted"),
      });
      return null;
    }
    function ConsumerHarness() {
      const [visible, setter] = useState(true);
      setVisible = setter;
      return visible ? <Probe /> : null;
    }

    const { unmount } = mount(<ConsumerHarness />, workerCtx(wEng));
    await flush();
    const firstCallOptions = (renderToPng.mock.calls[0] as unknown[])[1] as RenderOptions;

    act(() => setVisible!(false));
    act(() => {
      const warning = { code: "PNG_RESOLUTION_ADJUSTED" } as unknown as Parameters<
        NonNullable<RenderOptions["onPngResolutionAdjusted"]>
      >[0];
      firstCallOptions.onPngResolutionAdjusted?.(warning);
      resolveRender!(new Uint8Array([137, 80, 78, 71]));
    });
    await flush();

    expect(observedWarnings).toEqual([]);
    unmount();
  });

  it("forwards through the latest Provider default callback without restarting", async () => {
    const pendingSecondRender = new Promise<string>(() => {});
    const renderToSvg = vi
      .fn()
      .mockResolvedValueOnce("<svg>first</svg>")
      .mockReturnValue(pendingSecondRender);
    const wEng = makeWorkerEngineMock({ renderToSvg });
    const observedLabels: string[] = [];

    let setLabel: ((label: string) => void) | null = null;
    function Probe() {
      useRenderToSvgAsync(VALID_VNODE);
      return null;
    }
    function DefaultOptionsHarness() {
      const [label, setter] = useState("first");
      setLabel = setter;
      const context = workerCtx(wEng);
      context.defaultRenderOptions = {
        onWarning: () => observedLabels.push(label),
      };
      return (
        <BoundSvgContext.Provider value={context}>
          <Probe />
        </BoundSvgContext.Provider>
      );
    }

    const { unmount } = mount(<DefaultOptionsHarness />, workerCtx(wEng));
    await flush();
    act(() => setLabel!("latest"));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(1);
    const firstCallOptions = (renderToSvg.mock.calls[0] as unknown[])[1] as RenderOptions;
    const warning = { code: "TEST_WARNING" } as unknown as Parameters<
      NonNullable<RenderOptions["onWarning"]>
    >[0];
    firstCallOptions.onWarning?.(warning);
    expect(observedLabels).toEqual(["latest"]);
    unmount();
  });

  it("does not restart for an equal fresh VNode and detects a nested text change", async () => {
    const pendingSecondRender = new Promise<string>(() => {});
    const renderToSvg = vi
      .fn()
      .mockResolvedValueOnce("<svg>first</svg>")
      .mockReturnValue(pendingSecondRender);
    const wEng = makeWorkerEngineMock({ renderToSvg });

    let setText: ((text: string) => void) | null = null;
    function Probe() {
      const [text, setter] = useState("first");
      setText = setter;
      const vnode: VNode = {
        type: "Canvas",
        props: { width: 100, height: 100 },
        children: [
          {
            type: "Text",
            props: { font: "f", fontSizePx: 16, color: "#000" },
            children: [text],
          },
        ],
      };
      useRenderToSvgAsync(vnode);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(1);

    act(() => setText!("second"));
    await flush();

    expect(renderToSvg).toHaveBeenCalledTimes(2);
    const convertedVNode = mockToSceneDocument.mock.calls.at(-1)?.[0] as VNode;
    expect(convertedVNode).toMatchObject({ children: [{ children: ["second"] }] });
    unmount();
  });

  it("stabilizes a fresh VNode for PNG and detects a scalar prop change", async () => {
    const pendingSecondRender = new Promise<Uint8Array>(() => {});
    const renderToPng = vi
      .fn()
      .mockResolvedValueOnce(new Uint8Array([137, 80, 78, 71]))
      .mockReturnValue(pendingSecondRender);
    const wEng = makeWorkerEngineMock({ renderToPng });

    let setWidth: ((width: number) => void) | null = null;
    function Probe() {
      const [width, setter] = useState(100);
      setWidth = setter;
      const vnode: VNode = {
        type: "Canvas",
        props: { width, height: 100 },
        children: [],
      };
      useRenderToPngAsync(vnode);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(renderToPng).toHaveBeenCalledTimes(1);

    act(() => setWidth!(120));
    await flush();

    expect(renderToPng).toHaveBeenCalledTimes(2);
    const convertedVNode = mockToSceneDocument.mock.calls.at(-1)?.[0] as VNode;
    expect(convertedVNode.props.width).toBe(120);
    unmount();
  });

  it("returns null state when vnode is null", async () => {
    const wEng = makeWorkerEngineMock({ renderToSvg: vi.fn(async () => "<svg></svg>") });

    let snap: ReturnType<typeof useRenderToSvgAsync> | null = null;
    function Probe() {
      snap = useRenderToSvgAsync(null);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(snap!.svg).toBeNull();
    expect(snap!.isReady).toBe(false);
    expect(wEng.renderToSvg).not.toHaveBeenCalled();
    unmount();
  });

  it("cancels in-flight render when vnode changes to null", async () => {
    const stableVNode = VALID_VNODE;
    let resolveRender: ((svg: string) => void) | null = null;
    const wEng = makeWorkerEngineMock({
      renderToSvg: vi.fn(
        () =>
          new Promise<string>((r) => {
            resolveRender = r;
          }),
      ),
    });

    let snap: ReturnType<typeof useRenderToSvgAsync> | null = null;
    let setVNode: ((v: VNode | null) => void) | null = null;
    function Probe() {
      const [vnode, setter] = useState<VNode | null>(stableVNode);
      setVNode = setter;
      snap = useRenderToSvgAsync(vnode);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    act(() => setVNode!(null));
    await flush();

    // Resolve the stale promise — should be ignored
    resolveRender!("<svg>stale</svg>");
    await flush();

    expect(snap!.svg).toBeNull();
    expect(snap!.isReady).toBe(false);
    unmount();
  });

  it("keeps only the latest async render result by default", async () => {
    const firstVNode = VALID_VNODE;
    const secondVNode: VNode = {
      type: "Canvas",
      props: { width: 120, height: 80 },
      children: [],
    };
    let resolveFirst: ((svg: string) => void) | null = null;
    let resolveSecond: ((svg: string) => void) | null = null;
    const wEng = makeWorkerEngineMock({
      renderToSvg: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveSecond = resolve;
            }),
        ),
    });

    let snap: ReturnType<typeof useRenderToSvgAsync> | null = null;
    let setVNode: ((v: VNode) => void) | null = null;
    function Probe() {
      const [vnode, setter] = useState<VNode>(firstVNode);
      setVNode = setter;
      snap = useRenderToSvgAsync(vnode);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    act(() => setVNode!(secondVNode));
    await flush();

    resolveSecond!("<svg>latest</svg>");
    await flush();
    expect(snap!.svg).toBe("<svg>latest</svg>");

    resolveFirst!("<svg>stale</svg>");
    await flush();
    expect(snap!.svg).toBe("<svg>latest</svg>");
    unmount();
  });

  it("does not expose a settled SVG for a new VNode while its render is pending", async () => {
    const secondVNode: VNode = {
      type: "Canvas",
      props: { width: 120, height: 80 },
      children: [],
    };
    let resolveSecond: ((svg: string) => void) | null = null;
    const wEng = makeWorkerEngineMock({
      renderToSvg: vi
        .fn()
        .mockResolvedValueOnce("<svg>first</svg>")
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveSecond = resolve;
            }),
        ),
    });
    const snapshots: Array<{
      vnode: VNode;
      result: ReturnType<typeof useRenderToSvgAsync>;
    }> = [];
    let setVNode: ((vnode: VNode) => void) | null = null;
    function Probe() {
      const [vnode, setter] = useState<VNode>(VALID_VNODE);
      setVNode = setter;
      snapshots.push({ vnode, result: useRenderToSvgAsync(vnode) });
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();
    snapshots.length = 0;
    act(() => setVNode!(secondVNode));

    expect(
      snapshots.some(
        (snapshot) => snapshot.vnode === secondVNode && snapshot.result.svg === "<svg>first</svg>",
      ),
    ).toBe(false);
    expect(snapshots.at(-1)?.result.svg).toBeNull();
    expect(snapshots.at(-1)?.result.isReady).toBe(false);
    expect(snapshots.at(-1)?.result.isRendering).toBe(true);

    resolveSecond!("<svg>second</svg>");
    await flush();
    expect(snapshots.at(-1)?.result.svg).toBe("<svg>second</svg>");
    unmount();
  });
});

// ---------------------------------------------------------------------------
// useRenderToPngAsync
// ---------------------------------------------------------------------------

describe("useRenderToPngAsync", () => {
  it("renders PNG via WorkerEngine after effect fires", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const wEng = makeWorkerEngineMock({ renderToPng: vi.fn(async () => pngBytes) });

    let snap: ReturnType<typeof useRenderToPngAsync> | null = null;
    function Probe() {
      snap = useRenderToPngAsync(VALID_VNODE);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(snap!.isReady).toBe(true);
    expect(snap!.png).toBe(pngBytes);
    expect(snap!.dataUrl).toContain("data:image/png;base64,");
    expect(snap!.error).toBeNull();
    unmount();
  });

  it("does not expose settled PNG data for a new VNode while its render is pending", async () => {
    const firstPng = new Uint8Array([137, 80, 78, 71, 1]);
    const secondPng = new Uint8Array([137, 80, 78, 71, 2]);
    const secondVNode: VNode = {
      type: "Canvas",
      props: { width: 120, height: 80 },
      children: [],
    };
    let resolveSecond: ((png: Uint8Array) => void) | null = null;
    const wEng = makeWorkerEngineMock({
      renderToPng: vi
        .fn()
        .mockResolvedValueOnce(firstPng)
        .mockImplementationOnce(
          () =>
            new Promise<Uint8Array>((resolve) => {
              resolveSecond = resolve;
            }),
        ),
    });
    const snapshots: Array<{
      vnode: VNode;
      result: ReturnType<typeof useRenderToPngAsync>;
    }> = [];
    let setVNode: ((vnode: VNode) => void) | null = null;
    function Probe() {
      const [vnode, setter] = useState<VNode>(VALID_VNODE);
      setVNode = setter;
      snapshots.push({ vnode, result: useRenderToPngAsync(vnode) });
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();
    snapshots.length = 0;
    act(() => setVNode!(secondVNode));

    expect(
      snapshots.some(
        (snapshot) => snapshot.vnode === secondVNode && snapshot.result.png === firstPng,
      ),
    ).toBe(false);
    expect(snapshots.at(-1)?.result.png).toBeNull();
    expect(snapshots.at(-1)?.result.dataUrl).toBeNull();
    expect(snapshots.at(-1)?.result.isReady).toBe(false);

    resolveSecond!(secondPng);
    await flush();
    expect(snapshots.at(-1)?.result.png).toBe(secondPng);
    unmount();
  });

  it("captures toSceneDocument() sync error in error state", async () => {
    const wEng = makeWorkerEngineMock({ renderToPng: vi.fn(async () => new Uint8Array()) });

    let snap: ReturnType<typeof useRenderToPngAsync> | null = null;
    function Probe() {
      snap = useRenderToPngAsync(INVALID_VNODE);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(snap!.error).not.toBeNull();
    expect(snap!.error!.message).toContain("UnknownWidget");
    expect(snap!.png).toBeNull();
    expect(snap!.dataUrl).toBeNull();
    expect(wEng.renderToPng).not.toHaveBeenCalled();
    unmount();
  });

  it("captures WorkerEngine.renderToPng() rejection in error state", async () => {
    const wEng = makeWorkerEngineMock({
      renderToPng: vi.fn(async () => {
        throw new Error("png render failed");
      }),
    });

    let snap: ReturnType<typeof useRenderToPngAsync> | null = null;
    function Probe() {
      snap = useRenderToPngAsync(VALID_VNODE);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(snap!.error!.message).toBe("png render failed");
    expect(snap!.png).toBeNull();
    expect(snap!.dataUrl).toBeNull();
    unmount();
  });
});

// ---------------------------------------------------------------------------
// useRenderToLayeredSvgAsync
// ---------------------------------------------------------------------------

const SAMPLE_LAYERED_SVG_RESULT: LayeredSvgResult = {
  width: 100,
  height: 100,
  layers: [
    {
      id: "background",
      bbox: { x: 0, y: 0, width: 100, height: 100 },
      nodeIds: ["bg"],
      mode: "independent",
      paintOrder: 0,
      warnings: [],
      svg: "<svg><!-- bg --></svg>",
    },
  ],
  manifest: {
    width: 100,
    height: 100,
    layers: [
      {
        id: "background",
        bbox: { x: 0, y: 0, width: 100, height: 100 },
        nodeIds: ["bg"],
        mode: "independent",
        paintOrder: 0,
        warnings: [],
      },
    ],
  },
};

describe("useRenderToLayeredSvgAsync", () => {
  it("renders layered SVG via WorkerEngine after effect fires", async () => {
    const wEng = makeWorkerEngineMock({
      renderToLayeredSvg: vi.fn(async () => SAMPLE_LAYERED_SVG_RESULT),
    });

    let snap: ReturnType<typeof useRenderToLayeredSvgAsync> | null = null;
    function Probe() {
      snap = useRenderToLayeredSvgAsync(VALID_VNODE);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(snap!.isReady).toBe(true);
    expect(snap!.result).toBe(SAMPLE_LAYERED_SVG_RESULT);
    expect(snap!.error).toBeNull();
    expect(wEng.renderToLayeredSvg).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("captures WorkerEngine.renderToLayeredSvg() rejection in error state", async () => {
    const wEng = makeWorkerEngineMock({
      renderToLayeredSvg: vi.fn(async () => {
        throw new Error("layered svg render failed");
      }),
    });

    let snap: ReturnType<typeof useRenderToLayeredSvgAsync> | null = null;
    function Probe() {
      snap = useRenderToLayeredSvgAsync(VALID_VNODE);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(snap!.error!.message).toBe("layered svg render failed");
    expect(snap!.result).toBeNull();
    expect(snap!.isReady).toBe(false);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// useRenderToLayeredPngAsync
// ---------------------------------------------------------------------------

const SAMPLE_LAYERED_PNG_RESULT: LayeredPngResult = {
  width: 100,
  height: 100,
  pixelWidth: 200,
  pixelHeight: 200,
  layers: [
    {
      id: "background",
      bbox: { x: 0, y: 0, width: 100, height: 100 },
      nodeIds: ["bg"],
      mode: "independent",
      paintOrder: 0,
      warnings: [],
      png: new Uint8Array([137, 80, 78, 71]),
    },
    {
      id: "text",
      bbox: { x: 0, y: 0, width: 100, height: 100 },
      nodeIds: ["title"],
      mode: "independent",
      paintOrder: 1,
      warnings: [],
      png: new Uint8Array([137, 80, 78, 71, 1, 2]),
    },
  ],
  manifest: {
    width: 100,
    height: 100,
    pixelWidth: 200,
    pixelHeight: 200,
    layers: [
      {
        id: "background",
        bbox: { x: 0, y: 0, width: 100, height: 100 },
        nodeIds: ["bg"],
        mode: "independent",
        paintOrder: 0,
        warnings: [],
      },
      {
        id: "text",
        bbox: { x: 0, y: 0, width: 100, height: 100 },
        nodeIds: ["title"],
        mode: "independent",
        paintOrder: 1,
        warnings: [],
      },
    ],
  },
};

describe("useRenderToLayeredPngAsync", () => {
  it("renders layered PNG and exposes per-layer data URLs", async () => {
    const wEng = makeWorkerEngineMock({
      renderToLayeredPng: vi.fn(async () => SAMPLE_LAYERED_PNG_RESULT),
    });

    let snap: ReturnType<typeof useRenderToLayeredPngAsync> | null = null;
    function Probe() {
      snap = useRenderToLayeredPngAsync(VALID_VNODE);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(snap!.isReady).toBe(true);
    expect(snap!.result).toBe(SAMPLE_LAYERED_PNG_RESULT);
    expect(snap!.layerDataUrls).not.toBeNull();
    expect(snap!.layerDataUrls).toHaveLength(2);
    expect(snap!.layerDataUrls![0]).toContain("data:image/png;base64,");
    expect(snap!.layerDataUrls![1]).toContain("data:image/png;base64,");
    expect(snap!.error).toBeNull();
    expect(wEng.renderToLayeredPng).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("captures WorkerEngine.renderToLayeredPng() rejection in error state", async () => {
    const wEng = makeWorkerEngineMock({
      renderToLayeredPng: vi.fn(async () => {
        throw new Error("layered png render failed");
      }),
    });

    let snap: ReturnType<typeof useRenderToLayeredPngAsync> | null = null;
    function Probe() {
      snap = useRenderToLayeredPngAsync(VALID_VNODE);
      return null;
    }

    const { unmount } = mount(<Probe />, workerCtx(wEng));
    await flush();

    expect(snap!.error!.message).toBe("layered png render failed");
    expect(snap!.result).toBeNull();
    expect(snap!.layerDataUrls).toBeNull();
    expect(snap!.isReady).toBe(false);
    unmount();
  });
});
