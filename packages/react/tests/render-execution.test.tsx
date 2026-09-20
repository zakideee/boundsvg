// @vitest-environment happy-dom
/** @jsxImportSource react */

import {
  Engine,
  FatalError,
  fromSceneDocument,
  RecoverableError,
  type RenderSvgOptions,
  type VNode,
} from "@boundsvg/core";
import { WorkerEngine, type WorkerRequest, type WorkerResponse } from "@boundsvg/worker";
import {
  act,
  Component,
  type ReactNode,
  StrictMode,
  Suspense,
  startTransition,
  useLayoutEffect,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRenderToPngAsync, useRenderToSvgAsync } from "../src/async.js";
import { BoundSvg } from "../src/components/boundsvg.js";
import { BoundSvgContext } from "../src/context.js";
import { MainRenderSchedulerContext } from "../src/execution/context.js";
import { MainRenderScheduler } from "../src/execution/main-render-scheduler.js";
import type { RenderExecutionOptions } from "../src/execution/types.js";

class ControlledWorker {
  readonly posts: WorkerRequest[] = [];
  private readonly listeners = new Map<string, Set<(event: MessageEvent | ErrorEvent) => void>>();
  terminate = vi.fn();

  postMessage(message: WorkerRequest): void {
    this.posts.push(structuredClone(message));
    if (message.type === "init") {
      this.respond({ id: message.id, type: "init-ok" });
    }
  }

  addEventListener(type: string, listener: (event: MessageEvent | ErrorEvent) => void): void {
    const callbacks = this.listeners.get(type) ?? new Set();
    callbacks.add(listener);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type: string, listener: (event: MessageEvent | ErrorEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  respond(response: WorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: response } as MessageEvent);
    }
  }

  svg(value: string): void {
    const request = this.posts.at(-1);
    if (!request) {
      throw new Error("Expected a posted request");
    }
    this.respond({ id: request.id, type: "render-svg-ok", svg: value, warnings: [] });
  }
}

const roots: Root[] = [];
const engines: Array<Engine | WorkerEngine> = [];
const schedulers: MainRenderScheduler[] = [];

function scene(width: number): VNode {
  return { type: "Canvas", props: { width, height: 100 }, children: [] };
}

function mount(owner: Engine | WorkerEngine) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const scheduler = owner instanceof Engine ? new MainRenderScheduler() : null;
  if (scheduler) {
    schedulers.push(scheduler);
  }
  return {
    container,
    render(ui: ReactNode, transition = false) {
      const render = () =>
        root.render(
          <BoundSvgContext.Provider
            value={{
              engine: owner instanceof Engine ? owner : null,
              workerEngine: owner instanceof WorkerEngine ? owner : null,
              status: "ready",
              error: null,
            }}
          >
            <MainRenderSchedulerContext.Provider value={scheduler}>
              {ui}
            </MainRenderSchedulerContext.Provider>
          </BoundSvgContext.Provider>,
        );
      act(() => {
        if (transition) {
          startTransition(render);
        } else {
          render();
        }
      });
    },
  };
}

async function worker() {
  const transport = new ControlledWorker();
  const owner = await WorkerEngine.create({ worker: transport, fonts: [] });
  engines.push(owner);
  return { owner, transport };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function tasks(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
}

function SvgProbe({
  vnode,
  options,
  control,
}: {
  vnode: VNode | null;
  options?: RenderSvgOptions;
  control?: RenderExecutionOptions;
}) {
  const result = useRenderToSvgAsync(vnode, options, control);
  return (
    <output
      data-status={result.status}
      data-execution={result.execution}
      data-ready={String(result.isReady)}
      data-stale={String(result.isStale)}
    >
      {result.svg ?? result.error?.message ?? "empty"}
    </output>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  for (const scheduler of schedulers.splice(0)) {
    scheduler.dispose();
  }
  for (const engine of engines.splice(0)) {
    engine.dispose();
  }
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("committed render execution", () => {
  it("keeps a runtime Worker failure on Worker execution without a main retry", async () => {
    const { owner, transport } = await worker();
    const mainRender = vi.spyOn(Engine.prototype, "renderToSvg");
    try {
      const view = mount(owner);
      view.render(<SvgProbe vnode={scene(1)} />);
      await flush();
      const request = transport.posts.at(-1)!;
      await act(async () =>
        transport.respond({
          id: request.id,
          type: "error",
          error: {
            severity: "fatal",
            code: "WORKER_UNHANDLED_ERROR",
            message: "runtime failure",
            stage: "engine",
          },
        }),
      );
      expect(view.container.querySelector("output")?.dataset).toMatchObject({
        status: "error",
        execution: "worker",
      });
      expect(view.container.textContent).toBe("runtime failure");
      expect(mainRender).not.toHaveBeenCalled();
    } finally {
      mainRender.mockRestore();
    }
  });

  it("drops the previous success when the context changes to a new Worker owner", async () => {
    const first = await worker();
    const second = await worker();
    const view = mount(first.owner);
    const vnode = scene(1);
    const render = (owner: WorkerEngine) =>
      view.render(
        <BoundSvgContext.Provider
          value={{ engine: null, workerEngine: owner, status: "ready", error: null }}
        >
          <SvgProbe vnode={vnode} />
        </BoundSvgContext.Provider>,
      );
    render(first.owner);
    await flush();
    await act(async () => first.transport.svg("first"));
    expect(view.container.textContent).toBe("first");
    render(second.owner);
    expect(view.container.textContent).toBe("empty");
    expect(view.container.querySelector("output")?.dataset.stale).toBe("false");
    await flush();
    await act(async () => second.transport.svg("second"));
    expect(view.container.textContent).toBe("second");
  });

  it("coalesces 100 committed inputs into one post and snapshots the last input", async () => {
    const { owner, transport } = await worker();
    const view = mount(owner);
    let lastScene = scene(1);
    for (let width = 1; width <= 100; width++) {
      lastScene = scene(width);
      view.render(<SvgProbe vnode={lastScene} />);
    }
    expect(transport.posts).toHaveLength(1);
    lastScene.props.width = 999;
    await flush();
    expect(transport.posts).toHaveLength(2);
    expect(transport.posts[1]).toMatchObject({ type: "render-svg", scene: { width: 100 } });
    await act(async () => transport.svg("last"));
    expect(view.container.textContent).toBe("last");
    expect(view.container.querySelector("output")?.dataset.status).toBe("success");
  });

  it("keeps a sent slot until its response and puts the latest self replacement behind another consumer", async () => {
    const { owner, transport } = await worker();
    const view = mount(owner);
    const otherScene = scene(500);
    view.render(
      <>
        <SvgProbe vnode={scene(1)} />
        <SvgProbe vnode={otherScene} />
      </>,
    );
    await flush();
    expect(transport.posts).toHaveLength(2);
    for (let width = 2; width <= 101; width++) {
      view.render(
        <>
          <SvgProbe vnode={scene(width)} />
          <SvgProbe vnode={otherScene} />
        </>,
      );
    }
    await flush();
    expect(transport.posts).toHaveLength(2);
    await act(async () => transport.svg("obsolete"));
    expect(transport.posts).toHaveLength(3);
    expect(transport.posts[2]).toMatchObject({ scene: { width: 500 } });
    expect(view.container.textContent).not.toContain("obsolete");
    await act(async () => transport.svg("other"));
    expect(transport.posts).toHaveLength(4);
    expect(transport.posts[3]).toMatchObject({ scene: { width: 101 } });
    await act(async () => transport.svg("latest"));
    expect(view.container.textContent).toBe("latestother");
  });

  it("retains a complete prior success through rendering and error, and drops it on null", async () => {
    const { owner, transport } = await worker();
    const view = mount(owner);
    view.render(<SvgProbe vnode={scene(1)} />);
    await flush();
    await act(async () => transport.svg("previous"));
    view.render(<SvgProbe vnode={scene(2)} />);
    expect(view.container.textContent).toBe("previous");
    expect(view.container.querySelector("output")?.dataset).toMatchObject({
      status: "rendering",
      ready: "false",
      stale: "true",
    });
    await flush();
    const request = transport.posts.at(-1)!;
    await act(async () =>
      transport.respond({
        id: request.id,
        type: "error",
        error: new FatalError("TEST_FAILURE", "failed", { stage: "emit" }).toJSON(),
      }),
    );
    expect(view.container.textContent).toBe("previous");
    expect(view.container.querySelector("output")?.dataset).toMatchObject({
      status: "error",
      ready: "false",
      stale: "true",
    });
    view.render(<SvgProbe vnode={null} />);
    expect(view.container.textContent).toBe("empty");
    expect(view.container.querySelector("output")?.dataset.status).toBe("idle");
  });

  it("drops retained results when explicitly disabled", async () => {
    const { owner, transport } = await worker();
    const view = mount(owner);
    view.render(<SvgProbe vnode={scene(1)} />);
    await flush();
    await act(async () => transport.svg("previous"));
    view.render(<SvgProbe vnode={scene(2)} control={{ retainPreviousResult: false }} />);
    expect(view.container.textContent).toBe("empty");
    expect(view.container.querySelector("output")?.dataset.stale).toBe("false");
  });

  it("delivers warnings to the latest committed callback once after result commit under StrictMode", async () => {
    const { owner, transport } = await worker();
    const view = mount(owner);
    const vnode = scene(10);
    const trace: string[] = [];
    view.render(
      <StrictMode>
        <SvgProbe vnode={vnode} options={{ onWarning: () => trace.push("old") }} />
      </StrictMode>,
    );
    await flush();
    view.render(
      <StrictMode>
        <SvgProbe
          vnode={vnode}
          options={{ onWarning: () => trace.push(`latest:${view.container.textContent}`) }}
        />
      </StrictMode>,
    );
    await flush();
    expect(transport.posts).toHaveLength(2);
    const request = transport.posts.at(-1)!;
    await act(async () =>
      transport.respond({
        id: request.id,
        type: "render-svg-ok",
        svg: "committed",
        warnings: [
          new RecoverableError("TEST_WARNING", "warning", {
            stage: "emit",
            fallback: "continue",
          }).toJSON(),
        ],
      }),
    );
    expect(trace).toEqual(["latest:committed"]);
  });

  it("ignores abandoned input and callbacks without cancelling the committed request", async () => {
    const { owner, transport } = await worker();
    const view = mount(owner);
    const committed = scene(1);
    const trace: string[] = [];
    const never = new Promise<void>(() => {});
    function MaybeSuspend({ suspend }: { suspend: boolean }) {
      useRenderToSvgAsync(suspend ? scene(2) : committed, {
        onWarning: () => trace.push(suspend ? "abandoned" : "committed"),
      });
      if (suspend) {
        throw never;
      }
      return <span>visible</span>;
    }
    view.render(
      <Suspense fallback="waiting">
        <MaybeSuspend suspend={false} />
      </Suspense>,
    );
    await flush();
    view.render(
      <Suspense fallback="waiting">
        <MaybeSuspend suspend />
      </Suspense>,
      true,
    );
    await flush();
    expect(transport.posts).toHaveLength(2);
    expect(view.container.textContent).toBe("visible");
    view.render(
      <Suspense fallback="waiting">
        <MaybeSuspend suspend={false} />
      </Suspense>,
    );
    await flush();
    const request = transport.posts.at(-1)!;
    await act(async () =>
      transport.respond({
        id: request.id,
        type: "render-svg-ok",
        svg: "finished",
        warnings: [
          new RecoverableError("TEST_WARNING", "warning", {
            stage: "emit",
            fallback: "continue",
          }).toJSON(),
        ],
      }),
    );
    expect(trace).toEqual(["committed"]);
  });

  it("makes no post for unmount before dispatch and ignores a response after sent unmount", async () => {
    const { owner, transport } = await worker();
    const view = mount(owner);
    const onWarning = vi.fn();
    view.render(<SvgProbe vnode={scene(1)} options={{ onWarning }} />);
    view.render(null);
    await flush();
    expect(transport.posts).toHaveLength(1);
    view.render(<SvgProbe vnode={scene(2)} options={{ onWarning }} />);
    await flush();
    view.render(null);
    await act(async () => transport.svg("late"));
    expect(view.container.textContent).toBe("");
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("requires revision for a mutation in place and observes Core resource changes", async () => {
    const owner = new Engine({ computeLayoutFn: () => "" });
    engines.push(owner);
    const render = vi
      .spyOn(owner, "renderToSvg")
      .mockImplementation((input) =>
        String("props" in input ? input.props.width : fromSceneDocument(input).props.width),
      );
    const view = mount(owner);
    const vnode = scene(10);
    view.render(<SvgProbe vnode={vnode} />);
    await tasks();
    expect(view.container.textContent).toBe("10");
    vnode.props.width = 20;
    view.render(<SvgProbe vnode={vnode} />);
    await tasks();
    expect(render).toHaveBeenCalledTimes(1);
    view.render(<SvgProbe vnode={vnode} control={{ revision: 1 }} />);
    await tasks();
    expect(view.container.textContent).toBe("20");
    act(() =>
      owner.registerGeometry("sample", {
        viewBox: { width: 10, height: 10 },
        root: { kind: "path", nodeId: "sample", d: "M0 0H10V10Z" },
      }),
    );
    await tasks();
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("isolates public PNG buffers from retained data and another consumer", async () => {
    const owner = new Engine({ computeLayoutFn: () => "" });
    engines.push(owner);
    vi.spyOn(owner, "renderToPng").mockImplementation(() => new Uint8Array([137, 80, 78, 71]));
    const view = mount(owner);
    const vnode = scene(1);
    const outputs: Array<ReturnType<typeof useRenderToPngAsync>> = [];
    function PngProbe({ index }: { index: number }) {
      const result = useRenderToPngAsync(vnode);
      useLayoutEffect(() => {
        outputs[index] = result;
      });
      return <img alt={String(index)} src={result.dataUrl ?? undefined} />;
    }
    view.render(
      <>
        <PngProbe index={0} />
        <PngProbe index={1} />
      </>,
    );
    await tasks();
    const first = outputs[0]!;
    const originalUrl = first.dataUrl;
    first.png![0] = 0;
    expect(outputs[1]!.png![0]).toBe(137);
    view.render(
      <>
        <PngProbe index={0} />
        <PngProbe index={1} />
      </>,
    );
    expect(outputs[0]!.png![0]).toBe(137);
    expect(outputs[0]!.dataUrl).toBe(originalUrl);
  });

  it("prioritizes BoundSvg errorFallback over its retained successful SVG", async () => {
    const owner = new Engine({ computeLayoutFn: () => "" });
    engines.push(owner);
    const render = vi.spyOn(owner, "renderToSvg").mockReturnValueOnce("<svg>previous</svg>");
    const view = mount(owner);
    view.render(<BoundSvg vnode={scene(1)} errorFallback="failed" />);
    await tasks();
    expect(view.container.textContent).toBe("previous");
    render.mockImplementation(() => {
      throw new Error("render failed");
    });
    view.render(<BoundSvg vnode={scene(2)} errorFallback="failed" />);
    expect(view.container.textContent).toBe("previous");
    await tasks();
    expect(view.container.textContent).toBe("failed");
  });

  it("does not commit a duplicate retained SVG while scheduling the next input", async () => {
    const owner = new Engine({ computeLayoutFn: () => "" });
    engines.push(owner);
    vi.spyOn(owner, "renderToSvg")
      .mockReturnValueOnce("<svg><text>first</text></svg>")
      .mockReturnValueOnce("<svg><text>second</text></svg>");
    const view = mount(owner);
    function MarkupProbe({ vnode }: { vnode: VNode }) {
      const result = useRenderToSvgAsync(vnode);
      return <div dangerouslySetInnerHTML={{ __html: result.svg ?? "" }} />;
    }
    view.render(<MarkupProbe vnode={scene(10)} />);
    await tasks();
    const replacements: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (added.nodeName.toLowerCase() === "svg") {
            replacements.push(added.textContent ?? "");
          }
        }
      }
    });
    observer.observe(view.container, { childList: true, subtree: true });
    try {
      view.render(<MarkupProbe vnode={scene(20)} />);
      await tasks();
      expect(view.container.querySelector("svg")?.textContent).toBe("second");
      expect(replacements).toEqual(["first", "second"]);
    } finally {
      observer.disconnect();
    }
  });

  it("keeps SSR idle and defers BoundSvg main rendering to a task", async () => {
    const owner = new Engine({ computeLayoutFn: () => "" });
    engines.push(owner);
    const render = vi.spyOn(owner, "renderToSvg").mockReturnValue("<svg><text>main</text></svg>");
    const vnode = scene(1);
    const context = { engine: owner, workerEngine: null, status: "ready" as const, error: null };
    expect(
      renderToString(
        <BoundSvgContext.Provider value={context}>
          <BoundSvg vnode={vnode} fallback="loading" />
        </BoundSvgContext.Provider>,
      ),
    ).toBe("loading");
    expect(render).not.toHaveBeenCalled();
    const view = mount(owner);
    view.render(<BoundSvg vnode={vnode} fallback="loading" />);
    expect(view.container.textContent).toBe("loading");
    expect(render).not.toHaveBeenCalled();
    await tasks();
    expect(view.container.querySelector("svg")?.textContent).toBe("main");
    expect(render).toHaveBeenCalledTimes(1);
  });
});

class NotificationBoundary extends Component<
  { children: ReactNode; onCatch: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onCatch(error);
  }
  render() {
    return this.state.failed ? <span>caught</span> : this.props.children;
  }
}

describe("render execution notifications and invalidation", () => {
  it("delivers ordered warnings then onError once and reports callback failure through React", async () => {
    const owner = new Engine({ computeLayoutFn: () => "" });
    engines.push(owner);
    const failure = new FatalError("TEST_RENDER_FAILURE", "producer failed", { stage: "emit" });
    const callbackFailure = new Error("callback failed");
    const render = vi.spyOn(owner, "renderToSvg").mockImplementation((_input, options) => {
      options?.onWarning?.(
        new RecoverableError("FIRST_WARNING", "first", { stage: "emit", fallback: "continue" }),
      );
      options?.onWarning?.(
        new RecoverableError("SECOND_WARNING", "second", { stage: "emit", fallback: "continue" }),
      );
      throw failure;
    });
    const trace: string[] = [];
    const caught = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = mount(owner);
    const vnode = scene(1);
    view.render(
      <StrictMode>
        <NotificationBoundary onCatch={caught}>
          <SvgProbe
            vnode={vnode}
            options={{
              onWarning: (warning) => {
                trace.push(warning.code);
                if (warning.code === "FIRST_WARNING") {
                  throw callbackFailure;
                }
              },
            }}
            control={{
              onError: (error) => {
                expect(error).toBe(failure);
                trace.push("onError");
              },
            }}
          />
        </NotificationBoundary>
      </StrictMode>,
    );
    await tasks();
    expect(trace).toEqual(["FIRST_WARNING", "SECOND_WARNING", "onError"]);
    expect(caught).toHaveBeenCalledExactlyOnceWith(callbackFailure);
    expect(render).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe("caught");
    consoleError.mockRestore();
  });

  it("invalidates a partial font-registration failure and reports disposal instead of reusing a success", async () => {
    const owner = new Engine({
      computeLayoutFn: () => "",
      registerFontFn: (font) => {
        if (font.alias === "bad") {
          throw new Error("font failed");
        }
      },
    });
    engines.push(owner);
    const render = vi
      .spyOn(owner, "renderToSvg")
      .mockImplementation(() => String(owner.resourceVersion));
    const view = mount(owner);
    const vnode = scene(1);
    const failures: string[] = [];
    const onError = (error: Error) => failures.push((error as FatalError).code);
    view.render(<SvgProbe vnode={vnode} control={{ onError }} />);
    await tasks();
    expect(view.container.textContent).toBe("0");
    act(() =>
      expect(() =>
        owner.registerFonts([
          { alias: "good", data: new Uint8Array() },
          { alias: "bad", data: new Uint8Array() },
        ]),
      ).toThrow("font failed"),
    );
    await tasks();
    expect(view.container.textContent).toBe("1");
    expect(render).toHaveBeenCalledTimes(2);
    act(() => owner.dispose());
    await tasks();
    expect(view.container.querySelector("output")?.dataset.status).toBe("error");
    expect(failures).toEqual(["ENGINE_DISPOSED"]);
  });

  it("coalesces 100 main updates before computation and retains no work after unmount", async () => {
    const owner = new Engine({ computeLayoutFn: () => "" });
    engines.push(owner);
    const render = vi.spyOn(owner, "renderToSvg").mockReturnValue("final");
    const view = mount(owner);
    for (let width = 0; width < 100; width++) {
      view.render(<SvgProbe vnode={scene(width)} />);
    }
    expect(render).not.toHaveBeenCalled();
    await tasks();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[0]).toMatchObject({ props: { width: 99 } });
    view.render(<SvgProbe vnode={scene(200)} />);
    view.render(null);
    await tasks();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["revision", null],
    ["revision", -1],
    ["revision", 0.5],
    ["revision", Infinity],
    ["revision", NaN],
    ["revision", Number.MAX_SAFE_INTEGER + 1],
    ["retainPreviousResult", null],
    ["retainPreviousResult", "true"],
    ["onError", null],
    ["onError", false],
  ])("rejects invalid %s controls before creating work", (field, value) => {
    const owner = new Engine({ computeLayoutFn: () => "" });
    engines.push(owner);
    const context = { engine: owner, workerEngine: null, status: "ready" as const, error: null };
    expect(() =>
      renderToString(
        <BoundSvgContext.Provider value={context}>
          <SvgProbe
            vnode={scene(1)}
            control={{ [field as string]: value } as RenderExecutionOptions}
          />
        </BoundSvgContext.Provider>,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_RENDER_EXECUTION_OPTION",
        stage: "validate",
        context: { field },
      }),
    );
  });
});
