/** @jsxImportSource react */

import {
  type Engine,
  FatalError,
  type RenderAnimatedSvgOptions,
  type RenderSvgOptions,
  type VNode,
} from "@boundsvg/core";
import type { WorkerEngine } from "@boundsvg/worker";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AnimatedBoundSvg, BoundSvg } from "../src/components/boundsvg.js";
import { Flex, Text } from "../src/components/nodes.js";
import { BoundSvgContext } from "../src/context.js";
import { useBoundSvg } from "../src/hooks/use-boundsvg.js";
import type { BoundSvgContextValue } from "../src/types.js";
import { makeEngineMock, makeWorkerEngineMock } from "./test-doubles.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function createMainThreadContext(engine: Engine | null): BoundSvgContextValue {
  return {
    engine,
    workerEngine: null,
    status: engine ? "ready" : "loading",
    error: null,
    defaultCommonOptions: { textPathMode: "merged" },
  };
}

function createWorkerContext(workerEngine: WorkerEngine | null): BoundSvgContextValue {
  return {
    engine: null,
    workerEngine,
    status: workerEngine ? "ready" : "loading",
    error: null,
    defaultCommonOptions: { textPathMode: "merged" },
  };
}

// ---------------------------------------------------------------------------
// BoundSvgContextValue shape
// ---------------------------------------------------------------------------

describe("BoundSvgContextValue with workerEngine", () => {
  it("provides workerEngine in context", () => {
    const mockWorkerEngine = makeWorkerEngineMock({});
    let snapshot: BoundSvgContextValue | null = null;

    function Probe() {
      snapshot = useBoundSvg();
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={createWorkerContext(mockWorkerEngine)}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.workerEngine).toBe(mockWorkerEngine);
    expect(snapshot!.engine).toBeNull();
    expect(snapshot!.status).toBe("ready");
  });

  it("provides engine=null and workerEngine=null while loading", () => {
    const ctx: BoundSvgContextValue = {
      engine: null,
      workerEngine: null,
      status: "loading",
      error: null,
    };
    let snapshot: BoundSvgContextValue | null = null;

    function Probe() {
      snapshot = useBoundSvg();
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={ctx}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(snapshot!.engine).toBeNull();
    expect(snapshot!.workerEngine).toBeNull();
    expect(snapshot!.status).toBe("loading");
  });
});

// ---------------------------------------------------------------------------
// BoundSvg component branching
// ---------------------------------------------------------------------------

describe("BoundSvg Worker/non-Worker branching", () => {
  it("uses sync rendering when engine is available (no workerEngine)", () => {
    const renderToSvg = vi.fn(() => '<svg viewBox="0 0 100 100"><text>hello</text></svg>');
    const engine = makeEngineMock({ renderToSvg });

    const html = renderToString(
      <BoundSvgContext.Provider value={createMainThreadContext(engine)}>
        <BoundSvg vnode={sampleVNode()} className="rendered-boundsvg" />
      </BoundSvgContext.Provider>,
    );

    expect(renderToSvg).toHaveBeenCalledTimes(1);
    expect(html).toContain('class="rendered-boundsvg"');
    expect(html).toContain("<svg");
    expect(html).toContain("hello");
  });

  it("renders fallback when workerEngine is set (async path, SSR returns initial state)", () => {
    // In SSR (renderToString), useEffect doesn't run, so async hook
    // returns the initial state (svg=null, isReady=false).
    const mockWorkerEngine = {
      renderToSvg: vi.fn(async () => '<svg viewBox="0 0 100 100"></svg>'),
    };

    const html = renderToString(
      <BoundSvgContext.Provider value={createWorkerContext(makeWorkerEngineMock(mockWorkerEngine))}>
        <BoundSvg vnode={sampleVNode()} fallback={<span>loading</span>} />
      </BoundSvgContext.Provider>,
    );

    // During SSR, useEffect doesn't run, so async render hasn't happened
    // The component should show fallback
    expect(html).toContain("loading");
  });

  it("renders fallback when engine is loading (no engine, no workerEngine)", () => {
    const ctx: BoundSvgContextValue = {
      engine: null,
      workerEngine: null,
      status: "loading",
      error: null,
    };

    const html = renderToString(
      <BoundSvgContext.Provider value={ctx}>
        <BoundSvg vnode={sampleVNode()} fallback={<span>loading</span>} />
      </BoundSvgContext.Provider>,
    );

    expect(html).toContain("loading");
  });

  it("renders error fallback when sync render throws", () => {
    const engine = makeEngineMock({
      renderToSvg: vi.fn(() => {
        throw new Error("render boom");
      }),
    });

    const html = renderToString(
      <BoundSvgContext.Provider value={createMainThreadContext(engine)}>
        <BoundSvg
          vnode={sampleVNode()}
          errorFallback={(err: Error) => <span>Error: {err.message}</span>}
        />
      </BoundSvgContext.Provider>,
    );

    expect(html).toContain("<span>Error:");
    expect(html).toContain("render boom");
    expect(html).not.toContain('role="alert"');
  });

  it("passes a text-layout FatalError to the sync error fallback unchanged", () => {
    const fatalError = new FatalError(
      "TEXT_FONT_UNAVAILABLE",
      "No requested font is available for text layout.",
      {
        stage: "text",
        nodeId: "txt",
        context: {
          operation: "renderTextLayout",
          runIndex: 0,
          requestedAliases: ["Missing"],
          omittedAliasCount: 0,
          fontWeight: 400,
          fontStyle: "normal",
        },
      },
    );
    const engine = makeEngineMock({
      renderToSvg: vi.fn(() => {
        throw fatalError;
      }),
    });
    let observedError: Error | undefined;

    renderToString(
      <BoundSvgContext.Provider value={createMainThreadContext(engine)}>
        <BoundSvg
          vnode={sampleVNode()}
          errorFallback={(error: Error) => {
            observedError = error;
            return <span>{error.message}</span>;
          }}
        />
      </BoundSvgContext.Provider>,
    );

    expect(observedError).toBe(fatalError);
    expect(observedError).toMatchObject({
      code: "TEXT_FONT_UNAVAILABLE",
      stage: "text",
      nodeId: "txt",
      context: expect.objectContaining({ operation: "renderTextLayout", runIndex: 0 }),
    });
  });

  it("renders error fallback when declarative children include unsupported React elements", () => {
    const renderToSvg = vi.fn(() => '<svg viewBox="0 0 100 100"></svg>');
    const engine = makeEngineMock({ renderToSvg });

    const html = renderToString(
      <BoundSvgContext.Provider value={createMainThreadContext(engine)}>
        <BoundSvg
          width={200}
          height={100}
          errorFallback={(error: Error) => <span>Error: {error.message}</span>}
        >
          <Flex direction="column">
            <div>unsupported</div>
            <Text font="F" fontSizePx={12}>
              ok
            </Text>
          </Flex>
        </BoundSvg>
      </BoundSvgContext.Provider>,
    );

    expect(renderToSvg).not.toHaveBeenCalled();
    expect(html).toContain("Unsupported React element &lt;div&gt;");
  });

  it("passes renderOptions to sync engine", () => {
    const renderToSvg = vi.fn(() => '<svg viewBox="0 0 100 100"></svg>');
    const engine = makeEngineMock({ renderToSvg });
    const options: RenderSvgOptions = { scale: 2 };

    renderToString(
      <BoundSvgContext.Provider value={createMainThreadContext(engine)}>
        <BoundSvg vnode={sampleVNode()} renderOptions={options} />
      </BoundSvgContext.Provider>,
    );

    expect(renderToSvg).toHaveBeenCalledTimes(1);
    const callArgs = renderToSvg.mock.calls[0] as unknown[];
    const calledOptions = callArgs[1] as RenderSvgOptions;
    expect(calledOptions.scale).toBe(2);
    // defaultCommonOptions merged
    expect(calledOptions.textPathMode).toBe("merged");
  });

  it("routes AnimatedBoundSvg through the dedicated animated SVG method", () => {
    const renderToAnimatedSvg = vi.fn(() => '<svg data-mode="animated"></svg>');
    const engine = makeEngineMock({ renderToAnimatedSvg });
    const renderOptions: RenderAnimatedSvgOptions = {
      playback: { mode: "independent" },
      resourceIdPrefix: "react-animated-",
      nodeIdMetadata: "omit",
    };

    const html = renderToString(
      <BoundSvgContext.Provider value={createMainThreadContext(engine)}>
        <AnimatedBoundSvg vnode={sampleVNode()} renderOptions={renderOptions} />
      </BoundSvgContext.Provider>,
    );

    expect(html).toContain("data-mode");
    expect(renderToAnimatedSvg).toHaveBeenCalledWith(sampleVNode(), {
      textPathMode: "merged",
      ...renderOptions,
    });
  });
});
