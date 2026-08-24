import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import type { IRNode } from "../../src/ir/types.js";
import { initNodeWasm } from "../../src/node.js";
import { createElement } from "../../src/vnode/create-element.js";
import { assertWasmPkgAvailable, loadSubsetFont } from "./test-prerequisites.js";

function findTextNodeById(node: IRNode, nodeId: string): IRNode | undefined {
  if (node.nodeId === nodeId && node.type === "text") {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findTextNodeById(child, nodeId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

type SingleTextSceneOptions = {
  alignItems?: "start" | "center" | "end" | "stretch";
  content?: string;
  direction?: "row" | "column";
  explicitWidth?: number;
  preferredWidth?: number;
  rich?: boolean;
};

function renderSingleText(engine: Engine, options: SingleTextSceneOptions = {}): IRNode {
  const content = options.content ?? "Same transform,";
  const textChild = options.rich ? createElement("Inline", {}, content) : content;
  const scene = createElement(
    "Canvas",
    { width: 160, height: 120 },
    createElement(
      "Flex",
      {
        direction: options.direction ?? "column",
        justifyContent: "center",
        alignItems: options.alignItems ?? "center",
        width: 160,
        height: 120,
        padding: 12,
      },
      createElement(
        "Text",
        {
          id: "subject",
          font: "NotoSansJP",
          fontSizePx: 13,
          width: options.explicitWidth,
          preferredFrame:
            options.preferredWidth === undefined ? undefined : { w: options.preferredWidth },
        },
        textChild,
      ),
    ),
  );
  const textNode = findTextNodeById(engine.renderToIR(scene).root, "subject");
  expect(textNode).toBeDefined();
  return textNode!;
}

function expectResolvedHeightMatchesLayout(textNode: IRNode): void {
  expect(Math.abs((textNode.layoutBox?.h ?? 0) - textNode.bbox.h)).toBeLessThan(1);
}

describe("Text intrinsic sizing in Flex", () => {
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

  it("uses max-content width for centered Text children in a column", () => {
    const scene = createElement(
      "Canvas",
      { width: 160, height: 120 },
      createElement(
        "Flex",
        {
          direction: "column",
          justifyContent: "center",
          alignItems: "center",
          width: 160,
          height: 120,
          padding: 12,
          gap: 4,
        },
        createElement("Text", { id: "t1", font: "NotoSansJP", fontSizePx: 13 }, "Same transform,"),
        createElement("Text", { id: "t2", font: "NotoSansJP", fontSizePx: 13 }, "every node type."),
      ),
    );

    const ir = engine.renderToIR(scene);
    const first = findTextNodeById(ir.root, "t1");
    const second = findTextNodeById(ir.root, "t2");

    expect(first?.lines).toHaveLength(1);
    expect(second?.lines).toHaveLength(1);
    expect(first?.bbox.w).toBeCloseTo(100.7, 0);
    expect(Math.abs((first?.layoutBox?.w ?? 0) - (first?.bbox.w ?? 0))).toBeLessThan(1);
    expect(Math.abs((second?.layoutBox?.w ?? 0) - (second?.bbox.w ?? 0))).toBeLessThan(1);
    expect(Math.abs((first?.layoutBox?.h ?? 0) - (first?.bbox.h ?? 0))).toBeLessThan(1);
    expect(Math.abs((second?.layoutBox?.h ?? 0) - (second?.bbox.h ?? 0))).toBeLessThan(1);
    expect((first?.bbox.y ?? 0) + (first?.bbox.h ?? 0)).toBeLessThanOrEqual(second?.bbox.y ?? 0);
  });

  it.each([
    "start",
    "center",
    "end",
    "stretch",
  ] as const)("keeps one-line intrinsic sizing with alignItems=%s", (alignItems) => {
    const textNode = renderSingleText(engine, { alignItems });

    expect(textNode.lines).toHaveLength(1);
    expect(textNode.bbox.w).toBeCloseTo(100.7, 0);
    expectResolvedHeightMatchesLayout(textNode);
    if (alignItems === "stretch") {
      expect(textNode.layoutBox?.w).toBe(136);
    } else {
      expect(Math.abs((textNode.layoutBox?.w ?? 0) - textNode.bbox.w)).toBeLessThan(1);
    }
  });

  it.each([
    "row",
    "column",
  ] as const)("keeps the short Text measurement stable in a %s flex container", (direction) => {
    const textNode = renderSingleText(engine, { direction });

    expect(textNode.lines).toHaveLength(1);
    expectResolvedHeightMatchesLayout(textNode);
  });

  it.each([
    { label: "plain", rich: false },
    { label: "rich", rich: true },
  ])("keeps $label Text intrinsic sizing stable", ({ rich }) => {
    const textNode = renderSingleText(engine, { rich });

    expect(textNode.lines).toHaveLength(1);
    expectResolvedHeightMatchesLayout(textNode);
  });

  it.each([
    { label: "explicit width", options: { explicitWidth: 60 } },
    {
      label: "available width",
      options: { content: "This intentionally long text must wrap inside the available width." },
    },
    { label: "preferredFrame", options: { preferredWidth: 60 } },
  ])("propagates wrapped height for $label constraints", ({ options }) => {
    const textNode = renderSingleText(engine, options);

    expect((textNode.lines?.length ?? 0) > 1).toBe(true);
    expectResolvedHeightMatchesLayout(textNode);
  });
});
