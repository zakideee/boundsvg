import { readFileSync } from "node:fs";
import { createEngineAsync, type Engine, type LayoutNode, type VNode } from "@boundsvg/core";
import { initNodeWasm } from "@boundsvg/core/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildMeasurementsVNode } from "../../playground-react/src/pages/templates/engine-builders/measurements";
import { FONT_ALIAS } from "../src/config";
import { measurementsPreset } from "../src/presets/measurements";

/** Measured text and its nearest decorated card in the computed layout. */
type MeasuredPreview = { text: LayoutNode; card: LayoutNode };

/** Find measurement previews without depending on generated IDs or wrapper depth. */
function collectMeasuredPreviews(node: LayoutNode, card?: LayoutNode): MeasuredPreview[] {
  const isMeasuredCard =
    (node.vnode.type === "Box" || node.vnode.type === "Flex") &&
    node.vnode.props.background === "#252526";
  const nearestCard = isMeasuredCard ? node : card;
  const previews: MeasuredPreview[] = [];
  if (node.vnode.type === "Text" && node.vnode.props.fontSizePx === 18 && nearestCard) {
    previews.push({ text: node, card: nearestCard });
  }
  for (const child of node.children) {
    previews.push(...collectMeasuredPreviews(child, nearestCard));
  }
  return previews;
}

describe("Measurements preview frames", () => {
  let engine: Engine;

  beforeAll(async () => {
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [
        {
          alias: FONT_ALIAS,
          weight: 400,
          style: "normal",
          data: new Uint8Array(
            readFileSync(
              new URL("../../../fixtures/fonts/NotoSansJP-Regular.subset.woff2", import.meta.url),
            ),
          ),
        },
      ],
    });
  });

  afterAll(() => engine.dispose());

  for (const [name, build] of [
    ["Core", (activeEngine: Engine) => measurementsPreset.build(activeEngine)],
    ["React", buildMeasurementsVNode],
  ] satisfies Array<[string, (activeEngine: Engine) => VNode]>) {
    for (const [previewIndex, previewName] of [
      "horizontal",
      "vertical",
      "rich vertical",
    ].entries()) {
      it(`${name} keeps the measured ${previewName} frame inside its card`, () => {
        const blockMeasurement = vi.spyOn(engine, "measureTextBlock");
        const shrinkwrap = vi.spyOn(engine, "shrinkwrapText");
        try {
          const vnode = build(engine);
          const horizontal = blockMeasurement.mock.results[0];
          const vertical = blockMeasurement.mock.results[1];
          const rich = shrinkwrap.mock.results[0];
          if (
            horizontal?.type !== "return" ||
            vertical?.type !== "return" ||
            rich?.type !== "return" ||
            rich.value.status !== "satisfied"
          ) {
            throw new TypeError("Expected successful preview measurements");
          }
          const expectedFrames = [
            {
              width: horizontal.value.usedWidth,
              height: horizontal.value.usedHeight,
              lines: horizontal.value.lineCount,
            },
            {
              width: vertical.value.usedWidth,
              height: vertical.value.usedHeight,
              lines: vertical.value.lineCount,
            },
            {
              width: rich.value.usedWidth,
              height: rich.value.chosenHeightPx,
              lines: rich.value.lineCount,
            },
          ];
          const previews = collectMeasuredPreviews(engine.renderToLayoutTree(vnode).root);
          expect(previews).toHaveLength(3);
          const preview = previews[previewIndex];
          const expected = expectedFrames[previewIndex];
          if (
            !preview ||
            !expected ||
            expected.width === undefined ||
            expected.height === undefined
          ) {
            throw new TypeError("Missing measured preview frame");
          }
          // Taffy's final boxes use pixel rounding; borders must not consume that frame.
          expect(preview.text.bbox.width).toBe(Math.round(expected.width));
          expect(preview.text.bbox.height).toBe(Math.round(expected.height));
          expect(preview.text.textLayout?.resolvedTextLayout.lines).toHaveLength(expected.lines);
          expect(preview.text.bbox.x).toBeGreaterThan(preview.card.bbox.x);
          expect(preview.text.bbox.y).toBeGreaterThan(preview.card.bbox.y);
          expect(preview.text.bbox.x + preview.text.bbox.width).toBeLessThan(
            preview.card.bbox.x + preview.card.bbox.width,
          );
          expect(preview.text.bbox.y + preview.text.bbox.height).toBeLessThan(
            preview.card.bbox.y + preview.card.bbox.height,
          );
        } finally {
          blockMeasurement.mockRestore();
          shrinkwrap.mockRestore();
        }
      });
    }
  }

  it("keeps Core and React measurement scenes byte-identical", () => {
    expect(engine.renderToSvg(measurementsPreset.build(engine))).toBe(
      engine.renderToSvg(buildMeasurementsVNode(engine)),
    );
  });
});
