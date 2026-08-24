import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import type { LayoutNode } from "../../src/layout/types.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

function findTextLayout(node: LayoutNode): LayoutNode | undefined {
  if (node.textLayout) {
    return node;
  }
  for (const child of node.children) {
    const found = findTextLayout(child);
    if (found) {
      return found;
    }
  }
  return undefined;
}

describe("vertical rich-text ellipsis", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [
        {
          alias: "NotoSansJP",
          weight: 400,
          style: "normal",
          data: loadSubsetFont(),
        },
      ],
    });
  });

  it("ends the last allowed column with U+2026", () => {
    const scene = createElement(
      "Canvas",
      { width: 180, height: 160 },
      createElement(
        "Text",
        {
          font: "NotoSansJP",
          fontSizePx: 22,
          language: "ja",
          writingMode: "vertical-rl",
          width: 120,
          height: 112,
          maxLines: 2,
          ellipsis: true,
        },
        "縦書き",
        createElement("Ruby", {}, "東京", createElement("Rt", {}, "とうきょう")),
        createElement("Inline", { color: "#b91c1c" }, "の省略表示"),
        "を検証する長い文章です。",
      ),
    );

    const textLayout = findTextLayout(engine.renderToLayoutTree(scene).root)?.textLayout
      ?.resolvedTextLayout;

    expect(textLayout).toBeDefined();
    expect(textLayout?.lines.length).toBeLessThanOrEqual(2);
    expect(textLayout?.lines.at(-1)?.text).toMatch(/…$/u);
    expect(textLayout?.overflow.type).toBe("overflow");
    expect(textLayout?.bbox.w).toBeLessThanOrEqual(120.01);
    expect(textLayout?.bbox.h).toBeLessThanOrEqual(112.01);
  });
});
