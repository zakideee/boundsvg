// @vitest-environment happy-dom
/** @jsxImportSource react */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngineAsync, type Engine } from "@boundsvg/core";
import { initNodeWasm } from "@boundsvg/core/node";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Box, Canvas } from "../src/components/nodes.js";
import { BoundSvgContext } from "../src/context.js";
import { useInteractiveSvg } from "../src/hooks/use-interactive-svg.js";
import type { BoundSvgContextValue, PointerEventInfo } from "../src/types.js";
import { toInteractiveVNode } from "../src/utils/to-interactive-vnode.js";
import { installSvgDomPrimitives } from "./svg-dom-primitives.js";

const fontPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf",
);

let engine: Engine;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await initNodeWasm();
  engine = await createEngineAsync({
    fonts: [
      {
        alias: "NotoSansJP",
        weight: 400,
        style: "normal",
        data: new Uint8Array(readFileSync(fontPath)),
      },
    ],
  });

  installSvgDomPrimitives((x, y) => {
    const svg = document.querySelector("svg");
    return x >= 100 && x < 150 && y >= 0 && y < 40
      ? (svg?.querySelector("rect,path") ?? null)
      : svg;
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

function contextValue(): BoundSvgContextValue {
  return {
    engine,
    workerEngine: null,
    status: "ready",
    error: null,
  } as BoundSvgContextValue;
}

describe("interactive React boundary against real WASM and browser helpers", () => {
  it("dispatches only at the transformed real-IR hit position", async () => {
    const onClick = vi.fn((_info: PointerEventInfo) => {});
    const { vnode, handlers } = toInteractiveVNode(
      <Canvas width={200} height={100}>
        <Box
          id="target"
          width={50}
          height={40}
          background="#ef4444"
          transform={{ translateX: 100 }}
          onClick={onClick}
        />
      </Canvas>,
    );
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const root = createRoot(mount);

    function Probe() {
      const result = useInteractiveSvg(vnode, handlers, { showPointerCursor: false });
      return (
        <div
          data-surface="real"
          ref={result.containerRef}
          dangerouslySetInnerHTML={result.svg ? { __html: result.svg } : undefined}
        />
      );
    }

    await act(async () => {
      root.render(
        <BoundSvgContext.Provider value={contextValue()}>
          <Probe />
        </BoundSvgContext.Provider>,
      );
    });

    const surface = document.querySelector('[data-surface="real"]');
    expect(surface).toBeInstanceOf(HTMLDivElement);
    expect(surface?.querySelector("svg")).toBeInstanceOf(SVGSVGElement);
    const frame = surface?.querySelector(
      '[data-boundsvg-node-id="target"][data-boundsvg-role="source"]',
    );
    if (!frame) {
      throw new TypeError("Missing actual emitted Frame");
    }
    // happy-dom does not apply the authored transform; supply that one declared pose.
    Object.defineProperty(frame, "getScreenCTM", {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 100, f: 0 }),
    });

    await act(async () => {
      surface?.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10 }));
      surface?.dispatchEvent(new MouseEvent("click", { clientX: 110, clientY: 10 }));
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]?.[0]).toMatchObject({
      nodeId: "target",
      point: { svgX: 110, svgY: 10 },
      cause: "input",
    });

    await act(async () => {
      root.unmount();
    });
  });
});
