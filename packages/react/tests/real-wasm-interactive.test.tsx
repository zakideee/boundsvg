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

  // happy-dom does not implement SVG CTM methods. Keep the real browser
  // coordinate helper in the test and provide only an identity CTM primitive.
  Object.defineProperty(SVGSVGElement.prototype, "createSVGPoint", {
    configurable: true,
    value() {
      return {
        x: 0,
        y: 0,
        matrixTransform() {
          return { x: this.x, y: this.y };
        },
      };
    },
  });
  Object.defineProperty(SVGSVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value() {
      return { inverse: () => ({}) };
    },
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

    await act(async () => {
      surface?.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10 }));
      surface?.dispatchEvent(new MouseEvent("click", { clientX: 110, clientY: 10 }));
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]?.[0]).toMatchObject({
      nodeId: "target",
      svgX: 110,
      svgY: 10,
    });

    await act(async () => {
      root.unmount();
    });
  });
});
