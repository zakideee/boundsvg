import { createElement, type InlineVNode, type VNode } from "@boundsvg/core";
import { resolveTerminalPaneLayout } from "./pane-layout";
import {
  createTerminalTokenColorMap,
  DEFAULT_TERMINAL_TEXT_COLOR,
  resolveTerminalTokenColor,
} from "./prism-theme";
import { tokenizeTerminalCode } from "./prism-tokenizer";
import type {
  TerminalBoundsvgInput,
  TerminalDesignInput,
  TerminalFontInput,
  TerminalOutputLineInput,
  TerminalSourceLine,
  TerminalTokenColorMap,
  TerminalWrapMode,
} from "./types";

const DEFAULT_LICENSE_NOTICE = "Fonts: JetBrains Mono / Monaspace Neon (SIL OFL 1.1).";

const DEFAULT_CANVAS_WIDTH = 980;
const DEFAULT_CANVAS_HEIGHT = 560;
const DEFAULT_FRAME_WIDTH = 920;
const DEFAULT_FRAME_HEIGHT = 500;
const DEFAULT_CANVAS_BACKGROUND = "#161616";

const WINDOW_HEADER_HEIGHT = 48;
const WINDOW_CONTENT_PADDING: [number, number, number, number] = [14, 16, 14, 16];
const WINDOW_FOOTER_HEIGHT = 56;

const SOURCE_PANE_HEADER_HEIGHT = 36;
const SOURCE_PANE_BODY_PADDING: [number, number, number, number] = [10, 10, 10, 10];
const SOURCE_LINE_NUMBER_WIDTH = 24;
const SOURCE_LINE_GAP = 10;
const SOURCE_FONT_SIZE_PX = 12;

const OUTPUT_PANE_HEADER_HEIGHT = 36;
const OUTPUT_PANE_BODY_PADDING: [number, number, number, number] = [10, 12, 10, 12];
const OUTPUT_PROMPT_WIDTH = 12;
const OUTPUT_ROW_GAP = 10;

type ResolvedSurface = {
  canvasWidth: number;
  canvasHeight: number;
  frameWidth: number;
  frameHeight: number;
  canvasBackground: string;
};

type ResolvedOutputLine = {
  prompt: string;
  text: string;
  color: string;
  wrap: TerminalWrapMode;
};

function resolveSurface(input: TerminalDesignInput): ResolvedSurface {
  return {
    canvasWidth: input.surface?.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
    canvasHeight: input.surface?.canvasHeight ?? DEFAULT_CANVAS_HEIGHT,
    frameWidth: input.surface?.frameWidth ?? DEFAULT_FRAME_WIDTH,
    frameHeight: input.surface?.frameHeight ?? DEFAULT_FRAME_HEIGHT,
    canvasBackground: input.surface?.canvasBackground ?? DEFAULT_CANVAS_BACKGROUND,
  };
}

function toLineLabel(index: number, start: number): string {
  return String(start + index).padStart(2, "0");
}

function toSourceLines(
  code: string,
  language: TerminalDesignInput["language"],
  lineNumberStart: number,
  tokenColors: TerminalTokenColorMap,
  defaultTextColor: string,
  tagPunctuationColor: string | undefined,
): TerminalSourceLine[] {
  const tokenLines = tokenizeTerminalCode(code, language ?? "tsx");
  return tokenLines.map((line, index) => ({
    lineLabel: toLineLabel(index, lineNumberStart),
    segments: line.map((segment) => ({
      text: segment.text,
      tokenTypes: segment.tokenTypes,
      color: resolveTerminalTokenColor(
        segment.tokenTypes,
        tokenColors,
        defaultTextColor,
        tagPunctuationColor,
      ),
    })),
  }));
}

function resolveOutputLines(
  outputLines: readonly TerminalOutputLineInput[],
  defaultTextColor: string,
): ResolvedOutputLine[] {
  if (outputLines.length === 0) {
    return [{ prompt: ">", text: "", color: defaultTextColor, wrap: "none" }];
  }
  return outputLines.map((line, index) => ({
    prompt: line.prompt ?? (index === 0 ? "$" : ">"),
    text: line.text,
    color: line.color ?? defaultTextColor,
    wrap: line.wrap ?? "char",
  }));
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function collectRequiredFontAliases(fonts: TerminalFontInput): string[] {
  return uniqueStrings([
    fonts.source.alias,
    ...fonts.source.fallback,
    fonts.output.alias,
    ...fonts.output.fallback,
  ]);
}

function getInnerSize(size: number, paddingStart: number, paddingEnd: number): number {
  return Math.max(1, size - paddingStart - paddingEnd);
}

function buildSourcePane({
  paneWidth,
  paneHeight,
  title,
  fontLabel,
  fontAlias,
  fallback,
  lines,
  defaultTextColor,
}: {
  paneWidth: number;
  paneHeight: number;
  title: string;
  fontLabel: string;
  fontAlias: string;
  fallback: string[];
  lines: readonly TerminalSourceLine[];
  defaultTextColor: string;
}): VNode {
  const bodyHeight = Math.max(1, paneHeight - SOURCE_PANE_HEADER_HEIGHT);
  const bodyInnerWidth = getInnerSize(
    paneWidth,
    SOURCE_PANE_BODY_PADDING[1],
    SOURCE_PANE_BODY_PADDING[3],
  );
  const sourceTextWidth = Math.max(1, bodyInnerWidth - SOURCE_LINE_NUMBER_WIDTH - SOURCE_LINE_GAP);

  const toSourceTextChildren = (line: TerminalSourceLine): Array<InlineVNode | string> => {
    if (line.segments.length === 0) {
      return ["\u00a0"];
    }

    return line.segments.map((segment) =>
      createElement("Inline", { color: segment.color }, segment.text.replaceAll("\t", "  ")),
    );
  };

  const lineNodes = lines.map((line) =>
    createElement(
      "Flex",
      { direction: "row", alignItems: "start", gap: SOURCE_LINE_GAP, width: bodyInnerWidth },
      createElement(
        "Box",
        {
          width: SOURCE_LINE_NUMBER_WIDTH,
          minWidth: SOURCE_LINE_NUMBER_WIDTH,
          maxWidth: SOURCE_LINE_NUMBER_WIDTH,
          overflow: "clip",
        },
        createElement(
          "Text",
          { font: fontAlias, fallback, fontSizePx: 12, color: "#475569", wrap: "none" },
          line.lineLabel || "\u00a0",
        ),
      ),
      createElement(
        "Box",
        {
          width: sourceTextWidth,
          minWidth: sourceTextWidth,
          maxWidth: sourceTextWidth,
          overflow: "clip",
        },
        createElement(
          "Text",
          {
            font: fontAlias,
            fallback,
            fontSizePx: SOURCE_FONT_SIZE_PX,
            color: defaultTextColor,
            wrap: "none",
            whiteSpace: "pre-wrap",
            alignSelf: "stretch",
          },
          ...toSourceTextChildren(line),
        ),
      ),
    ),
  );

  return createElement(
    "Flex",
    {
      direction: "column",
      width: paneWidth,
      height: paneHeight,
      background: "#1e1e1e",
      borderWidth: 1,
      borderColor: "#3c3c3c",
      borderRadius: 10,
      overflow: "clip",
    },
    createElement(
      "Flex",
      {
        direction: "row",
        justifyContent: "space-between",
        alignItems: "center",
        width: paneWidth,
        height: SOURCE_PANE_HEADER_HEIGHT,
        padding: [0, 12, 0, 12],
        background: "#2d2d2d",
      },
      createElement(
        "Text",
        { font: fontAlias, fallback, fontSizePx: 12, color: "#93c5fd", wrap: "none" },
        title,
      ),
      createElement(
        "Text",
        { font: fontAlias, fallback, fontSizePx: 12, color: "#64748b", wrap: "none" },
        fontLabel,
      ),
    ),
    createElement(
      "Flex",
      {
        direction: "column",
        width: paneWidth,
        height: bodyHeight,
        padding: SOURCE_PANE_BODY_PADDING,
        background: "#1a1a1a",
        gap: 4,
        overflow: "clip",
      },
      ...lineNodes,
    ),
    createElement("Box", {
      position: "absolute",
      left: SOURCE_PANE_BODY_PADDING[3] + SOURCE_LINE_NUMBER_WIDTH + SOURCE_LINE_GAP,
      top: paneHeight - SOURCE_PANE_BODY_PADDING[2] - 8,
      width: sourceTextWidth,
      height: 4,
      background: "#333333",
      borderRadius: 2,
    }),
    createElement("Box", {
      position: "absolute",
      left: SOURCE_PANE_BODY_PADDING[3] + SOURCE_LINE_NUMBER_WIDTH + SOURCE_LINE_GAP,
      top: paneHeight - SOURCE_PANE_BODY_PADDING[2] - 8,
      width: Math.round(sourceTextWidth * 0.35),
      height: 4,
      background: "#555555",
      borderRadius: 2,
    }),
  );
}

function buildOutputPane({
  paneWidth,
  paneHeight,
  title,
  fontLabel,
  fontAlias,
  fallback,
  outputLines,
}: {
  paneWidth: number;
  paneHeight: number;
  title: string;
  fontLabel: string;
  fontAlias: string;
  fallback: string[];
  outputLines: readonly ResolvedOutputLine[];
}): VNode {
  const bodyHeight = Math.max(1, paneHeight - OUTPUT_PANE_HEADER_HEIGHT);
  const bodyInnerWidth = getInnerSize(
    paneWidth,
    OUTPUT_PANE_BODY_PADDING[1],
    OUTPUT_PANE_BODY_PADDING[3],
  );
  const outputTextWidth = Math.max(1, bodyInnerWidth - OUTPUT_PROMPT_WIDTH - OUTPUT_ROW_GAP);

  const outputNodes = outputLines.map((line) =>
    createElement(
      "Flex",
      { direction: "row", alignItems: "start", gap: OUTPUT_ROW_GAP, width: bodyInnerWidth },
      createElement(
        "Box",
        {
          width: OUTPUT_PROMPT_WIDTH,
          minWidth: OUTPUT_PROMPT_WIDTH,
          maxWidth: OUTPUT_PROMPT_WIDTH,
        },
        createElement(
          "Text",
          {
            font: fontAlias,
            fallback,
            fontSizePx: 13,
            lineHeight: 1.4,
            color: "#64748b",
            wrap: "none",
          },
          line.prompt,
        ),
      ),
      createElement(
        "Flex",
        { direction: "column", width: outputTextWidth },
        createElement(
          "Text",
          {
            font: fontAlias,
            fallback,
            fontSizePx: 13,
            lineHeight: 1.4,
            color: line.color,
            wrap: line.wrap,
          },
          line.text,
        ),
      ),
    ),
  );

  return createElement(
    "Flex",
    {
      direction: "column",
      width: paneWidth,
      height: paneHeight,
      background: "#1e1e1e",
      borderWidth: 1,
      borderColor: "#3c3c3c",
      borderRadius: 10,
      overflow: "clip",
    },
    createElement(
      "Flex",
      {
        direction: "row",
        justifyContent: "space-between",
        alignItems: "center",
        width: paneWidth,
        height: OUTPUT_PANE_HEADER_HEIGHT,
        padding: [0, 12, 0, 12],
        background: "#2d2d2d",
      },
      createElement(
        "Text",
        { font: fontAlias, fallback, fontSizePx: 12, color: "#93c5fd", wrap: "none" },
        title,
      ),
      createElement(
        "Text",
        { font: fontAlias, fallback, fontSizePx: 12, color: "#64748b", wrap: "none" },
        fontLabel,
      ),
    ),
    createElement(
      "Flex",
      {
        direction: "column",
        width: paneWidth,
        height: bodyHeight,
        padding: OUTPUT_PANE_BODY_PADDING,
        background: "#1a1a1a",
        gap: 8,
        overflow: "clip",
      },
      ...outputNodes,
    ),
  );
}

export function buildTerminalBoundsvgInput(input: TerminalDesignInput): TerminalBoundsvgInput {
  const surface = resolveSurface(input);
  const defaultTextColor = input.theme?.defaultTextColor ?? DEFAULT_TERMINAL_TEXT_COLOR;
  const tagPunctuationColor = input.theme?.tagPunctuationColor;
  const tokenColors = createTerminalTokenColorMap(input.theme?.tokenColors);
  const lineNumberStart = input.lineNumberStart ?? 1;

  const sourceLines = toSourceLines(
    input.code,
    input.language,
    lineNumberStart,
    tokenColors,
    defaultTextColor,
    tagPunctuationColor,
  );
  const outputLines = resolveOutputLines(input.outputLines, defaultTextColor);

  const contentHeight = Math.max(
    1,
    surface.frameHeight - WINDOW_HEADER_HEIGHT - WINDOW_FOOTER_HEIGHT,
  );
  const contentInnerWidth = getInnerSize(
    surface.frameWidth,
    WINDOW_CONTENT_PADDING[1],
    WINDOW_CONTENT_PADDING[3],
  );
  const contentInnerHeight = getInnerSize(
    contentHeight,
    WINDOW_CONTENT_PADDING[0],
    WINDOW_CONTENT_PADDING[2],
  );
  const paneLayout = resolveTerminalPaneLayout(contentInnerWidth, contentInnerHeight, input.layout);

  const sourcePaneTitle = input.layout?.sourceTitle ?? "source.tsx";
  const outputPaneTitle = input.layout?.outputTitle ?? "runtime.log";
  const routeLabel = input.chrome?.routeLabel ?? "template://terminal-prism-split";
  const footerLeft =
    input.chrome?.footerLeft ??
    'left: Prism token color reproduction | right: wrap="char" terminal output';
  const footerRight =
    input.chrome?.footerRight ?? `${input.fonts.source.label} | ${input.fonts.output.label}`;

  const requiredFontAliases = collectRequiredFontAliases(input.fonts);
  const licenseNotice = input.licenseNotice ?? DEFAULT_LICENSE_NOTICE;

  const sourcePane = buildSourcePane({
    paneWidth: paneLayout.source.width,
    paneHeight: paneLayout.source.height,
    title: sourcePaneTitle,
    fontLabel: input.fonts.source.label,
    fontAlias: input.fonts.source.alias,
    fallback: input.fonts.source.fallback,
    lines: sourceLines,
    defaultTextColor,
  });
  const outputPane = buildOutputPane({
    paneWidth: paneLayout.output.width,
    paneHeight: paneLayout.output.height,
    title: outputPaneTitle,
    fontLabel: input.fonts.output.label,
    fontAlias: input.fonts.output.alias,
    fallback: input.fonts.output.fallback,
    outputLines,
  });

  const vnode = createElement(
    "Canvas",
    {
      width: surface.canvasWidth,
      height: surface.canvasHeight,
      background: surface.canvasBackground,
    },
    createElement(
      "Flex",
      {
        direction: "column",
        justifyContent: "center",
        alignItems: "center",
        width: surface.canvasWidth,
        height: surface.canvasHeight,
        padding: 20,
      },
      createElement(
        "Box",
        {
          width: surface.frameWidth,
          height: surface.frameHeight,
          background: "#252526",
          borderWidth: 1,
          borderColor: "#3c3c3c",
          borderRadius: 14,
          overflow: "clip",
        },
        createElement(
          "Flex",
          { direction: "column", width: surface.frameWidth, height: surface.frameHeight },
          createElement(
            "Flex",
            {
              direction: "row",
              justifyContent: "space-between",
              alignItems: "center",
              width: surface.frameWidth,
              height: WINDOW_HEADER_HEIGHT,
              padding: [0, 14, 0, 14],
              background: "#2d2d2d",
            },
            createElement(
              "Flex",
              { direction: "row", alignItems: "center", gap: 8 },
              createElement("Box", {
                width: 10,
                height: 10,
                background: "#f87171",
                borderRadius: 10,
              }),
              createElement("Box", {
                width: 10,
                height: 10,
                background: "#fbbf24",
                borderRadius: 10,
              }),
              createElement("Box", {
                width: 10,
                height: 10,
                background: "#34d399",
                borderRadius: 10,
              }),
            ),
            createElement(
              "Text",
              {
                font: input.fonts.source.alias,
                fallback: input.fonts.source.fallback,
                fontSizePx: 13,
                color: "#858585",
                wrap: "none",
              },
              routeLabel,
            ),
          ),
          createElement(
            "Flex",
            {
              direction: paneLayout.splitDirection,
              width: surface.frameWidth,
              height: contentHeight,
              padding: WINDOW_CONTENT_PADDING,
              background: "#1e1e1e",
              gap: paneLayout.gapPx,
              overflow: "clip",
            },
            sourcePane,
            outputPane,
          ),
          createElement(
            "Flex",
            {
              direction: "row",
              justifyContent: "space-between",
              alignItems: "center",
              width: surface.frameWidth,
              height: WINDOW_FOOTER_HEIGHT,
              padding: [0, 14, 0, 14],
              background: "#252526",
            },
            createElement(
              "Text",
              {
                font: input.fonts.source.alias,
                fallback: input.fonts.source.fallback,
                fontSizePx: 12,
                color: "#86efac",
                wrap: "none",
              },
              footerLeft,
            ),
            createElement(
              "Text",
              {
                font: input.fonts.output.alias,
                fallback: input.fonts.output.fallback,
                fontSizePx: 12,
                color: "#858585",
                wrap: "none",
              },
              footerRight,
            ),
          ),
        ),
      ),
    ),
  );

  return {
    vnode,
    licenseNotice,
    requiredFontAliases,
  };
}
