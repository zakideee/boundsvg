import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

/**
 * Regression: unspecified inset sides were defaulted to 0 instead of auto,
 * so a lone `right` / `bottom` was inert — the implicit 0 on the opposite
 * side won the constraint and pinned the node to the left / top edge.
 */
describe("absolute positioning insets", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [{ alias: "NotoSansJP", weight: 400, style: "normal", data: loadSubsetFont() }],
    });
  });

  function boxAt(props: Record<string, unknown>): { x: number; y: number; w: number; h: number } {
    const { ir } = engine.renderToSvgAndIR(
      createElement(
        "Canvas",
        { width: 300, height: 200 },
        createElement(
          "Box",
          { id: "outer", position: "relative", width: 300, height: 200 },
          createElement("Box", {
            id: "probe",
            position: "absolute",
            background: "#ff0000",
            ...props,
          }),
        ),
      ),
    );
    const find = (node: (typeof ir)["root"]): (typeof ir)["root"] | undefined => {
      if (node.nodeId === "probe") {
        return node;
      }
      for (const child of node.children ?? []) {
        const found = find(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    };
    const probe = find(ir.root);
    expect(probe, "probe node must exist in IR").toBeDefined();
    return probe!.bbox;
  }

  it("right alone anchors to the right edge", () => {
    const bbox = boxAt({ right: 20, width: 50, height: 30 });
    expect(bbox.x).toBeCloseTo(230, 1); // 300 - 20 - 50
  });

  it("bottom alone anchors to the bottom edge", () => {
    const bbox = boxAt({ bottom: 20, width: 50, height: 30 });
    expect(bbox.y).toBeCloseTo(150, 1); // 200 - 20 - 30
  });

  it("left/top still anchor as before", () => {
    const bbox = boxAt({ left: 20, top: 10, width: 50, height: 30 });
    expect(bbox.x).toBeCloseTo(20, 1);
    expect(bbox.y).toBeCloseTo(10, 1);
  });

  it("left + right together stretch the box when width is auto", () => {
    const bbox = boxAt({ left: 30, right: 30, height: 30 });
    expect(bbox.x).toBeCloseTo(30, 1);
    expect(bbox.w).toBeCloseTo(240, 1); // 300 - 30 - 30
  });
});
