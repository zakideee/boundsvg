import { createElement, type VNode } from "@boundsvg/core";
import { FONT_ALIAS } from "./config";
import type { PresetDefinition } from "./types";

function createPreviewChip(text: string, accent = false): VNode {
  return createElement(
    "Box",
    {
      padding: [4, 8, 4, 8],
      background: accent ? "rgba(34, 211, 238, 0.16)" : "rgba(148, 163, 184, 0.16)",
      borderWidth: 1,
      borderColor: accent ? "rgba(34, 211, 238, 0.3)" : "rgba(148, 163, 184, 0.24)",
      borderRadius: 999,
    },
    createElement(
      "Text",
      {
        font: FONT_ALIAS,
        fontSizePx: 10,
        color: accent ? "#a5f3fc" : "#e2e8f0",
        wrap: "none",
      },
      text,
    ),
  );
}

export function buildThirdPartyDemoVNode(
  renderedSvg: string,
  preset: PresetDefinition,
  rawSvg: string,
): VNode {
  const sourceLabel = preset.sourceLabel ?? "Third-party SVG";
  const license = preset.license ?? "Unknown";
  const fileName = preset.sourcePath?.split("/").at(-1) ?? preset.title;
  const includesImage = /<image\b/i.test(rawSvg);
  const outerWidth = 960;
  const outerHeight = 710;
  const panelWidth = outerWidth - 48;
  const titleFrameWidth = panelWidth - 28;
  const contentWidth = panelWidth - 12;
  const contentHeight = 508;
  const sampleNote = includesImage
    ? "Sample: imported SVG and embedded PNG stay visible through the same SVG -> PNG rasterization flow."
    : "Sample: imported complex SVG stays visible through the same SVG -> PNG rasterization flow.";

  const sampleChips: VNode[] = [
    createPreviewChip("Imported SVG", true),
    createPreviewChip("Rasterize PNG", true),
  ];
  if (includesImage) {
    sampleChips.splice(1, 0, createPreviewChip("Embedded PNG", true));
  }

  return createElement(
    "Canvas",
    { width: outerWidth, height: outerHeight, background: "#161616" },
    createElement(
      "Box",
      { position: "relative", width: outerWidth, height: outerHeight },
      createElement(
        "Flex",
        {
          position: "absolute",
          top: 24,
          left: 24,
          width: panelWidth,
          height: 132,
          direction: "column",
          gap: 8,
          padding: [12, 14, 12, 14],
          background: "#1e1e1e",
          borderWidth: 1,
          borderColor: "#474747",
          borderRadius: 12,
        },
        createElement(
          "Text",
          {
            font: FONT_ALIAS,
            fontSizePx: 10,
            color: "#67e8f9",
            wrap: "none",
          },
          "COMPLEX SVG -> PNG SAMPLE",
        ),
        createElement(
          "Text",
          {
            font: FONT_ALIAS,
            fontSizePx: 22,
            color: "#f8fafc",
            wrap: "word",
            preferredFrame: { w: titleFrameWidth },
          },
          "Core: Flex/Grid layout + BBOX text. This sample adds imported SVG/PNG rasterization.",
        ),
        createElement(
          "Flex",
          {
            direction: "row",
            wrap: "wrap",
            gap: 6,
          },
          createPreviewChip("Flexbox / Grid"),
          createPreviewChip("Text in BBOX"),
          ...sampleChips,
        ),
        createElement(
          "Text",
          {
            font: FONT_ALIAS,
            fontSizePx: 12,
            color: "#93c5fd",
            wrap: "word",
            preferredFrame: { w: titleFrameWidth },
          },
          `${preset.title} / ${sourceLabel} / ${fileName} / ${license}`,
        ),
      ),
      createElement(
        "Flex",
        {
          position: "absolute",
          top: 166,
          left: 24,
          width: panelWidth,
          height: 520,
          direction: "column",
          gap: 8,
          padding: 6,
          background: "#2d2d2d",
          borderWidth: 1,
          borderColor: "#474747",
          borderRadius: 12,
          overflow: "clip",
        },
        createElement("Svg", {
          width: contentWidth,
          height: contentHeight,
          content: renderedSvg,
          preserveAspectRatio: "meet",
          contentIdPrefix: `preview-${preset.key}-`,
        }),
        createElement(
          "Text",
          {
            font: FONT_ALIAS,
            fontSizePx: 12,
            color: "#cbd5e1",
            wrap: "word",
            preferredFrame: { w: contentWidth },
          },
          sampleNote,
        ),
      ),
    ),
  );
}
