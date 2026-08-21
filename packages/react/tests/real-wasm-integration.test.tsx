// @vitest-environment happy-dom
/** @jsxImportSource react */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngineAsync, type Engine, type RecoverableError, type VNode } from "@boundsvg/core";
import { initNodeWasm } from "@boundsvg/core/node";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { useCompiledScene, useRenderAsset } from "../src/assets.js";
import { Box, Canvas, Text } from "../src/components/nodes.js";
import { BoundSvgContext } from "../src/context.js";
import { useRenderToPng } from "../src/hooks/use-render-png.js";
import { useRenderToSvg } from "../src/hooks/use-render-svg.js";
import type { BoundSvgContextValue } from "../src/types.js";
import { toVNode } from "../src/utils/to-vnode.js";

/**
 * Test-debt regression: every React test ran against a mock engine, so
 * the JSX -> core -> real WASM path was never exercised end to end. These
 * tests close that gap: the hooks are driven by a REAL engine and their
 * output is compared byte-for-byte with a direct core render.
 */
const fontPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf",
);

let engine: Engine;

function contextValue(overrides: Partial<BoundSvgContextValue> = {}): BoundSvgContextValue {
  return {
    engine,
    workerEngine: null,
    status: "ready",
    error: null,
    ...overrides,
  } as BoundSvgContextValue;
}

function scene(): VNode {
  return toVNode(
    <Canvas width={240} height={80} background="#ffffff">
      <Text font="NotoSansJP" fontSizePx={24} color="#111111">
        リアル WASM
      </Text>
    </Canvas>,
  );
}

function sha(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

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
});

describe("React hooks against a real WASM engine", () => {
  it("useRenderToSvg produces the same bytes as a direct core render", () => {
    const vnode = scene();
    let hookSvg: string | null = null;

    function Probe() {
      const { svg, error, isReady } = useRenderToSvg(vnode);
      expect(error).toBeNull();
      expect(isReady).toBe(true);
      hookSvg = svg;
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={contextValue()}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(hookSvg).not.toBeNull();
    expect(sha(hookSvg as unknown as string)).toBe(sha(engine.renderToSvg(vnode)));
  });

  it("useRenderToPng produces the same bytes as a direct core render", () => {
    const vnode = scene();
    let hookPng: Uint8Array | null = null;

    function Probe() {
      const { png, error } = useRenderToPng(vnode);
      expect(error).toBeNull();
      hookPng = png;
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={contextValue()}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(hookPng).not.toBeNull();
    expect(sha(hookPng as unknown as Uint8Array)).toBe(sha(engine.renderToPng(vnode)));
  });

  it("forwards render options (scale) through the hook to the engine", () => {
    const vnode = scene();
    let hookSvg: string | null = null;
    const options = { scale: 1.5 };

    function Probe() {
      hookSvg = useRenderToSvg(vnode, options).svg;
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={contextValue()}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    // scale multiplies the root size (viewBox unchanged) — a silently
    // dropped option would leave width at 240.
    expect(hookSvg).toContain('width="360"');
    expect(hookSvg).toContain('viewBox="0 0 240 80"');
  });

  it("merges defaultRenderOptions from the provider with per-call options", () => {
    // A clipped box emits clip-path="url(#<prefix>clip-...)", so a dropped
    // prefix is visible in the output.
    const vnode = toVNode(
      <Canvas width={100} height={100}>
        <Box id="clipper" width={50} height={50} overflow="clip">
          <Box width={100} height={100} background="#ff0000" />
        </Box>
      </Canvas>,
    );
    let hookSvg: string | null = null;

    function Probe() {
      hookSvg = useRenderToSvg(vnode).svg;
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider
        value={contextValue({ defaultRenderOptions: { resourceIdPrefix: "pfx-" } })}
      >
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(hookSvg).toContain("url(#pfx-clip-clipper)");
  });

  it("delivers recoverable warnings from the real engine after commit", () => {
    const warnings: RecoverableError[] = [];
    const vnode = toVNode(
      <Canvas width={240} height={80}>
        <Text id="warn" font="NotoSansJP" fontSizePx={24}>
          絵文字🎉
        </Text>
      </Canvas>,
    );
    const options = { onWarning: (warning: RecoverableError) => warnings.push(warning) };

    function Probe() {
      useRenderToSvg(vnode, options);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <BoundSvgContext.Provider value={contextValue()}>
          <Probe />
        </BoundSvgContext.Provider>,
      );
    });

    expect(warnings.map((warning) => warning.code)).toContain("MISSING_GLYPH");
    act(() => root.unmount());
    container.remove();
  });

  it("useCompiledScene returns the same real IR as core compile", () => {
    const vnode = scene();
    let hookCompiled: ReturnType<typeof useCompiledScene>["compiled"] = null;

    function Probe() {
      const result = useCompiledScene(vnode, { textPathMode: "merged" });
      expect(result.error).toBeNull();
      expect(result.isReady).toBe(true);
      hookCompiled = result.compiled;
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={contextValue()}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(hookCompiled).toEqual(engine.compile(vnode, { textPathMode: "merged" }));
  });

  it("useRenderAsset matches real compiled SVG and PNG bytes", () => {
    const vnode = scene();
    let hookResult: ReturnType<typeof useRenderAsset> | null = null;

    function Probe() {
      hookResult = useRenderAsset(vnode, {
        compileOptions: { textPathMode: "merged" },
        svgOptions: { scale: 1.25 },
        pngOptions: { scale: 2 },
      });
      return null;
    }

    renderToString(
      <BoundSvgContext.Provider value={contextValue()}>
        <Probe />
      </BoundSvgContext.Provider>,
    );

    expect(hookResult?.error).toBeNull();
    expect(hookResult?.isReady).toBe(true);
    const compiled = engine.compile(vnode, { textPathMode: "merged" });
    expect(hookResult?.compiled).toEqual(compiled);
    expect(sha(hookResult?.svg as unknown as string)).toBe(
      sha(engine.renderCompiledToSvg(compiled, { scale: 1.25 })),
    );
    expect(sha(hookResult?.png as unknown as Uint8Array)).toBe(
      sha(engine.renderCompiledToPng(compiled, { scale: 2 })),
    );
    expect(hookResult?.dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
