import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLayoutTransportJson } from "../../src/layout/taffy-layout-adapter.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationSpec } from "../../src/vnode/types.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

type MutableTransportNode = {
  nodeId: string;
  style: Record<string, unknown>;
  children: MutableTransportNode[];
};

type LayoutTransport = {
  root: MutableTransportNode;
};

type WireIrNode = {
  nodeId: string;
  type: string;
  bbox: { x: number; y: number; w: number; h: number };
  children?: WireIrNode[];
};

const INLINE_FADE: AnimationSpec = {
  keyframes: [
    { at: 0, opacity: 0 },
    { at: 1, opacity: 1 },
  ],
  durationMs: 100,
};

const TRANSITION_PLAN_JSON = JSON.stringify({
  checkpoints: [
    { timeMs: 0, stateIndex: 0 },
    { timeMs: 300, stateIndex: 1 },
    { timeMs: 700, stateIndex: 1 },
    { timeMs: 1_000, stateIndex: 0 },
  ],
  easing: "ease-in-out",
});

function createRealCompileTransport(panelHeight: 120 | 132): string {
  const scene = createElement(
    "Canvas",
    { id: "scene", width: 240, height: 160, background: "#ffffff" },
    createElement(
      "Box",
      {
        id: "panel",
        width: 200,
        height: panelHeight,
        background: "#112233",
        borderWidth: 2,
        borderColor: "#445566",
      },
      createElement(
        "Text",
        {
          id: "copy",
          width: 180,
          font: "NotoSansJP",
          fontSizePx: 16,
          lineHeightPx: 24,
          color: "#000000",
        },
        "A ",
        createElement(
          "Inline",
          { background: "#ffeeaa", paddingInline: [2, 2], animate: INLINE_FADE },
          "chip",
        ),
        " Z",
      ),
      createElement("Box", {
        id: "hidden",
        width: 20,
        height: 20,
        background: "#ff0000",
      }),
    ),
  );
  const transport = JSON.parse(buildLayoutTransportJson(scene, {})) as LayoutTransport;
  const hiddenNode = transport.root.children[0]?.children[1];
  if (!hiddenNode || hiddenNode.nodeId !== "hidden") {
    throw new Error("layout transition integration fixture lost its hidden node");
  }
  // display:none is a supported low-level layout transport value but is not
  // currently authored by the public VNode props.
  hiddenNode.style.display = "none";
  return JSON.stringify(transport);
}

function findIrNode(node: WireIrNode, nodeId: string): WireIrNode | undefined {
  if (node.nodeId === nodeId) {
    return node;
  }
  for (const child of node.children ?? []) {
    const match = findIrNode(child, nodeId);
    if (match) {
      return match;
    }
  }
  return undefined;
}

describe("layout transition real compile seam", () => {
  let handle: WasmEngineHandle | undefined;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
  });

  afterAll(() => {
    handle?.dispose();
  });

  it("joins the TS transport to real Rust IR provenance without exposing the manifest", () => {
    if (!handle) {
      throw new Error("WASM handle was not initialized");
    }
    const referenceTransport = createRealCompileTransport(120);
    const targetTransport = createRealCompileTransport(132);
    const optionsJson = "{}";

    const referenceEnvelope = JSON.parse(handle.renderToIr(referenceTransport, optionsJson)) as {
      ir: { root: WireIrNode };
    };
    const hiddenGroup = findIrNode(referenceEnvelope.ir.root, "hidden");
    const inlinePaintGroup = findIrNode(referenceEnvelope.ir.root, "copy:ibox0");
    expect(hiddenGroup).toMatchObject({ type: "group", bbox: { w: 0, h: 0 } });
    expect(inlinePaintGroup).toMatchObject({ type: "group" });

    const resultJson = handle.compileLayoutTransition(
      referenceTransport,
      targetTransport,
      TRANSITION_PLAN_JSON,
      optionsJson,
    );
    const result = JSON.parse(resultJson) as { ir: { root: WireIrNode }; warnings: unknown[] };
    expect(result.ir.root.nodeId).toBe("scene");
    expect(result.warnings).toEqual([]);
    expect(resultJson).not.toContain("semanticManifest");
    expect(resultJson).not.toContain("authoredId");
  });

  it("returns effective-canvas incompatibility with stable structured context", () => {
    if (!handle) {
      throw new Error("WASM handle was not initialized");
    }
    const reference = buildLayoutTransportJson(
      createElement(
        "Canvas",
        { id: "scene", width: 100, height: 100 },
        createElement("Box", { id: "box", width: 10, height: 10 }),
      ),
      {},
    );
    const target = buildLayoutTransportJson(
      createElement(
        "Canvas",
        { id: "scene", width: 100, height: 120 },
        createElement("Box", { id: "box", width: 10, height: 10 }),
      ),
      {},
    );
    let thrown: unknown;
    try {
      handle.compileLayoutTransition(reference, target, TRANSITION_PLAN_JSON, "{}");
    } catch (error) {
      thrown = error;
    }

    expect(typeof thrown).toBe("string");
    expect(JSON.parse(String(thrown))).toMatchObject({
      code: "LAYOUT_TRANSITION_INCOMPATIBLE",
      stage: "layout",
      nodeId: "scene",
      context: {
        category: "canvas",
        expected: "100x100",
        observed: "100x120",
      },
    });
  });

  it("rejects sampleAnimation instead of silently overriding the caller", () => {
    if (!handle) {
      throw new Error("WASM handle was not initialized");
    }
    const transport = createRealCompileTransport(120);
    let thrown: unknown;
    try {
      handle.compileLayoutTransition(
        transport,
        transport,
        TRANSITION_PLAN_JSON,
        JSON.stringify({ sampleAnimation: true }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(String(thrown)).toContain("unknown field `sampleAnimation`");
  });
});
