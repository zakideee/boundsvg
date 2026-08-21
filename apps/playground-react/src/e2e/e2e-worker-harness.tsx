/**
 * E2E Worker Test Harness
 *
 * Minimal React app that initializes BoundSvgProvider with Worker mode
 * and renders a simple VNode via the Worker pipeline.
 *
 * All state is exposed via `data-testid` attributes for Playwright assertions.
 *
 * Query parameters:
 * - `?workerUrl=<url>` — Override the Worker script URL (e.g. `/missing-worker.js` to test fallback)
 */

import { loadWasmModule } from "@boundsvg/browser/wasm";
import {
  createEngineAsync,
  type Engine,
  type Frame,
  type IRNode,
  type IRTextNode,
  type SceneNode,
  toSceneDocument,
} from "@boundsvg/core";
import { initWasm } from "@boundsvg/core/wasm";
import {
  Box,
  Canvas,
  Flex,
  Grid,
  Inline,
  InlineRect,
  Rt,
  Ruby,
  Text,
  TextOnPath,
  toVNode,
  type VNode,
} from "@boundsvg/react";
import { type BoundSvgConfig, BoundSvgProvider, useBoundSvg } from "@boundsvg/react/provider";
import { useRenderToPngAsync, useRenderToSvgAsync } from "@boundsvg/react/worker";
import { type MaterializedFrameInput, WorkerPool } from "@boundsvg/worker";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { getElement } from "../../../playground-shared/dom.js";

// ---------------------------------------------------------------------------
// Config — reads ?workerUrl= from query string
// ---------------------------------------------------------------------------

function resolveWorkerOption(): BoundSvgConfig["worker"] {
  const params = new URLSearchParams(window.location.search);
  const workerUrl = params.get("workerUrl");
  if (workerUrl) {
    return { mode: "prefer", url: new URL(workerUrl, window.location.origin) };
  }
  return { mode: "prefer" };
}

const config: BoundSvgConfig = {
  fonts: [
    {
      alias: "JetBrainsMono",
      weight: 400,
      style: "normal",
      source: "/fonts/JetBrainsMono-Regular.woff2",
    },
    {
      alias: "NotoSansJP-woff2",
      weight: 400,
      style: "normal",
      source: "/fonts/NotoSansJP-Regular.subset.woff2",
    },
  ],
  worker: resolveWorkerOption(),
};

// ---------------------------------------------------------------------------
// Test VNode
// ---------------------------------------------------------------------------

const TEXT_UNIT_ANIMATION = {
  by: "cluster",
  animation: {
    keyframes: [
      { at: 0, opacity: 0.3, transform: { translateY: 8, scaleX: 0.9, scaleY: 0.9 } },
      { at: 1, opacity: 1, transform: { translateY: 0, scaleX: 1, scaleY: 1 } },
    ],
    durationMs: 600,
    easing: "ease-out",
    fill: "both",
  },
  delayStepMs: 12,
  order: "visual",
  ruby: "with-base",
} as const;

function buildTestVNode(): VNode {
  return toVNode(
    <Canvas width={400} height={200} background="#2d2d2d">
      <Text
        font="NotoSansJP-woff2"
        fontSizePx={24}
        color="#f8fafc"
        animate={{
          keyframes: [
            { at: 0, opacity: 0.25, transform: { translateX: -12 } },
            { at: 1, opacity: 1, transform: { translateX: 18 } },
          ],
          durationMs: 1_200,
          easing: "ease-in-out",
          fill: "both",
        }}
        animateUnits={TEXT_UNIT_ANIMATION}
      >
        Worker E2E Test
      </Text>
      <TextOnPath
        id="worker-path-units"
        d="M20 170C100 80 300 80 380 170L380 190L20 190Z"
        width={400}
        height={200}
        font="NotoSansJP-woff2"
        fontSizePx={22}
        color="#67e8f9"
        startOffsetPx={200}
        textAnchor="middle"
        pathDirection="reverse"
        pathNormal="right"
        pathOffsetPx={4}
        pathFit="spacing"
        pathOverflow="error"
        textStroke="#164e63"
        textStrokeWidth={2}
        textShadows={[{ dx: 1, dy: 1, color: "#0f172a80" }]}
        animateUnits={TEXT_UNIT_ANIMATION}
      >
        Worker{" "}
        <Inline
          fontSizePx={26}
          fontWeight={700}
          color="#f472b6"
          textStrokes={[]}
          textShadows={[{ dx: 2, dy: 1, color: "#83184380" }]}
        >
          曲線
        </Inline>
      </TextOnPath>
      <TextOnPath
        id="worker-path-ellipsis"
        d="M20 45L140 45"
        width={400}
        height={200}
        font="NotoSansJP-woff2"
        fallback={["JetBrainsMono"]}
        fontSizePx={22}
        color="#fbbf24"
        startOffsetPx={60}
        textAnchor="middle"
        pathOverflow="ellipsis"
        textStrokes={[{ color: "#78350f", widthPx: 2 }]}
        animateUnits={TEXT_UNIT_ANIMATION}
      >
        Worker{" "}
        <Inline font="JetBrainsMono" fontSizePx={18}>
          ellipsis
        </Inline>{" "}
        fitting route
      </TextOnPath>
    </Canvas>,
  );
}

function buildGrowingBoxScene(width: number, height: number): SceneNode {
  return toSceneDocument(
    toVNode(
      <Canvas width={640} height={360} background="#111827">
        <Flex
          id="reactive-root"
          width={600}
          height={320}
          margin={20}
          padding={16}
          gap={16}
          alignItems="stretch"
          background="#1f2937"
        >
          <Box
            id="growing-box"
            width={width}
            height={height}
            background="#0ea5e9"
            borderRadius={12}
            animate={{
              keyframes: [
                { at: 0, opacity: 0.5, transform: { translateY: -4 } },
                { at: 1, opacity: 1, transform: { translateY: 8 } },
              ],
              durationMs: 1_600,
              fill: "both",
            }}
          >
            <Text font="NotoSansJP-woff2" fontSizePx={18} color="#082f49">
              Growing
            </Text>
          </Box>
          <Flex id="reactive-sibling" direction="column" flexGrow={1} gap={10} minWidth={160}>
            <Text
              id="reactive-copy"
              font="NotoSansJP-woff2"
              fontSizePx={22}
              lineHeight={1.35}
              wrap="char"
              fit="shrink"
              minFontSizePx={14}
              maxLines={3}
              ellipsis
              color="#f8fafc"
              animateUnits={TEXT_UNIT_ANIMATION}
            >
              幅と高さの変更が兄弟、折返し、省略、祖先レイアウトへ伝播します。
            </Text>
            <Grid
              id="reactive-grid"
              templateColumns="1fr 1fr"
              gap={8}
              height={120}
              alignItems="stretch"
            >
              <Box background="#334155" borderRadius={6} />
              <Text
                id="reactive-vertical-ruby"
                font="NotoSansJP-woff2"
                fontSizePx={18}
                writingMode="vertical-rl"
                wrap="char"
                color="#e2e8f0"
                animateUnits={{ ...TEXT_UNIT_ANIMATION, ruby: "separate" }}
              >
                <Ruby rubyPosition="over" rubyAlign="center">
                  東京<Rt>とうきょう</Rt>
                </Ruby>
                縦組
              </Text>
            </Grid>
          </Flex>
        </Flex>
      </Canvas>,
    ),
  );
}

function buildJustificationScene(justifyContent: "start" | "space-between"): SceneNode {
  return toSceneDocument(
    toVNode(
      <Canvas width={360} height={120} background="#111827">
        <Flex
          id="materialized-justify"
          width={320}
          height={80}
          margin={20}
          direction="row"
          justifyContent={justifyContent}
        >
          <Box width={40} height={40} background="#0ea5e9" />
          <Box width={40} height={40} background="#f97316" />
        </Flex>
      </Canvas>,
    ),
  );
}

function buildMaterializedTextUnitScene(width: number): SceneNode {
  return toSceneDocument(
    toVNode(
      <Canvas width={320} height={180} background="#111827">
        <Text
          id="materialized-text-units"
          font="NotoSansJP-woff2"
          fontSizePx={28}
          width={width}
          wrap="char"
          color="#f8fafc"
          animateUnits={{ ...TEXT_UNIT_ANIMATION, ruby: "separate" }}
        >
          <Ruby rubyPosition="over" rubyAlign="center">
            東京<Rt fontSizePx={12}>とうきょう</Rt>
          </Ruby>
          から字幕アニメーション
        </Text>
      </Canvas>,
    ),
  );
}

type MaterializedTextPathOptions = {
  d: string;
  startOffsetPx: number;
  textAnchor?: "start" | "middle" | "end";
  pathDirection?: "forward" | "reverse";
  pathNormal?: "left" | "right";
  pathFit: "spacing" | "scale" | "shrink";
  pathOverflow?: "hidden" | "error" | "ellipsis";
  decorationStyle: "dotted" | "dashed" | "wavy";
  pathPaintVariant: "cool" | "warm";
  pathSuffix?: string;
};

function buildMaterializedTextPathScene(options: MaterializedTextPathOptions): SceneNode {
  const pathAccent = options.pathPaintVariant === "cool" ? "#67e8f9" : "#fb7185";
  const pathStroke = options.pathPaintVariant === "cool" ? "#0e7490" : "#9f1239";
  const pathShadow = options.pathPaintVariant === "cool" ? "#08334480" : "#4c051980";
  return toSceneDocument(
    toVNode(
      <Canvas width={460} height={220} background="#071827">
        <Text
          id="materialized-decoration"
          position="absolute"
          left={20}
          top={10}
          font="NotoSansJP-woff2"
          fallback={["JetBrainsMono"]}
          fontSizePx={20}
          color="#f8fafc"
          textDecoration={{
            line: "underline",
            style: options.decorationStyle,
            color: "#f97316",
            thicknessPx: 2,
            offsetPx: -7,
            skipInk: "all",
          }}
        >
          装飾と path の交差
        </Text>
        <TextOnPath
          id="materialized-text-path-units"
          d={options.d}
          width={460}
          height={220}
          font="NotoSansJP-woff2"
          fontSizePx={28}
          color="#f8fafc"
          startOffsetPx={options.startOffsetPx}
          textAnchor={options.textAnchor ?? "middle"}
          pathDirection={options.pathDirection ?? "forward"}
          pathNormal={options.pathNormal ?? "left"}
          pathOffsetPx={4}
          pathFit={options.pathFit}
          pathOverflow={options.pathOverflow ?? "error"}
          animateUnits={TEXT_UNIT_ANIMATION}
        >
          MATERIALIZED{" "}
          <Inline
            fontWeight={700}
            color={pathAccent}
            textStrokes={[{ color: pathStroke, widthPx: 2 }]}
            textShadows={[{ dx: 2, dy: 1, color: pathShadow }]}
          >
            fitted path
          </Inline>{" "}
          identity route 日本語{options.pathSuffix ?? ""}
        </TextOnPath>
        <TextOnPath
          id="materialized-rich-decoration"
          d={options.d}
          width={460}
          height={220}
          font="NotoSansJP-woff2"
          fallback={["JetBrainsMono"]}
          fontSizePx={18}
          color="#e0f2fe"
          startOffsetPx={options.startOffsetPx}
          textAnchor={options.textAnchor ?? "middle"}
          pathDirection={options.pathDirection ?? "forward"}
          pathNormal={options.pathNormal ?? "left"}
          pathOffsetPx={16}
          pathFit={options.pathFit}
          pathOverflow={options.pathOverflow ?? "error"}
          textStrokes={[{ color: "#164e63", widthPx: 2 }]}
          textShadows={[{ dx: 2, dy: 2, color: "#02061780" }]}
          textDecoration={{
            line: "underline",
            style: options.decorationStyle,
            color: "#f97316",
            thicknessPx: 2,
            offsetPx: -7,
            skipInk: "all",
          }}
        >
          RICH{" "}
          <Inline
            font="JetBrainsMono"
            fallback={["NotoSansJP-woff2"]}
            color={pathAccent}
            textStrokes={[{ color: pathStroke, widthPx: 2 }]}
            textShadows={[{ dx: 1, dy: 2, color: pathShadow }]}
          >
            rich decoration
          </Inline>{" "}
          path 日本語{options.pathSuffix ?? ""}
        </TextOnPath>
      </Canvas>,
    ),
  );
}

const CARET_BLINK = {
  keyframes: [
    { at: 0, opacity: 1 },
    { at: 1, opacity: 0 },
  ],
  durationMs: 500,
  easing: { type: "steps", count: 2, position: "jump-none" },
  iterations: "infinite",
  fill: "both",
} as const;

function buildTerminalTypingScene(id: string, content: string): SceneNode {
  return toSceneDocument(
    toVNode(
      <Canvas width={280} height={180} background="#020617">
        <Text
          id={`typing-terminal-${id}`}
          font="JetBrainsMono"
          fallback={["NotoSansJP-woff2"]}
          fontSizePx={20}
          lineHeightPx={28}
          width={160}
          height={150}
          wrap="char"
          whiteSpace="pre-wrap"
          color="#e2e8f0"
        >
          {"$ "}
          {content}
          <InlineRect inlineSizePx={2} color="#22c55e" animate={CARET_BLINK} />
        </Text>
      </Canvas>,
    ),
  );
}

function buildImeTypingScene(
  id: string,
  committed: string,
  active: string,
  converted = false,
): SceneNode {
  return toSceneDocument(
    toVNode(
      <Canvas width={400} height={120} background="#f8fafc">
        <Text
          id={`typing-ime-${id}`}
          font="NotoSansJP-woff2"
          fontSizePx={32}
          lineHeightPx={44}
          width={360}
          color="#111827"
        >
          {committed}
          {active ? (
            <Inline
              textDecoration={{
                line: "underline",
                style: converted ? "double" : "solid",
                color: converted ? "#a855f7" : "#2563eb",
                thicknessPx: 2,
              }}
            >
              {active}
            </Inline>
          ) : null}
          <InlineRect inlineSizePx={2} color="#111827" animate={CARET_BLINK} />
        </Text>
      </Canvas>,
    ),
  );
}

function buildVerticalTypingScene(): SceneNode {
  return toSceneDocument(
    toVNode(
      <Canvas width={180} height={280} background="#f8fafc">
        <Text
          id="typing-ime-vertical"
          font="NotoSansJP-woff2"
          fontSizePx={28}
          lineHeightPx={40}
          width={120}
          height={240}
          writingMode="vertical-rl"
          textOrientation="upright"
          wrap="char"
          color="#111827"
        >
          確定
          <Inline
            textDecoration={{
              line: "underline",
              style: "dotted",
              color: "#2563eb",
              thicknessPx: 2,
            }}
          >
            へんかん
          </Inline>
          <InlineRect
            inlineSizePx={18}
            blockSizePx={3}
            blockAlign="end"
            color="#2563eb"
            animate={CARET_BLINK}
          />
        </Text>
      </Canvas>,
    ),
  );
}

function buildClusterBoundaryScene(decorated: boolean): SceneNode {
  const decoration = decorated
    ? {
        line: "underline" as const,
        style: "dashed" as const,
        color: "#ef4444",
        thicknessPx: 2,
      }
    : undefined;
  return toSceneDocument(
    toVNode(
      <Canvas width={300} height={100} background="#ffffff">
        <Text
          id={`typing-clusters-${decorated ? "decorated" : "plain"}`}
          font="JetBrainsMono"
          fallback={["NotoSansJP-woff2"]}
          fontSizePx={36}
          fontFeatureSettings={'"liga" 1'}
          language="en"
          color="#111827"
        >
          {decorated ? (
            <>
              {"f"}
              <Inline textDecoration={decoration}>i</Inline>
              {" e"}
              <Inline textDecoration={decoration}>{"\u0301"}</Inline>
            </>
          ) : (
            "fi e\u0301"
          )}
        </Text>
      </Canvas>,
    ),
  );
}

function buildWavyTypingScene(): SceneNode {
  return toSceneDocument(
    toVNode(
      <Canvas width={360} height={100} background="#ffffff">
        <Text font="NotoSansJP-woff2" fontSizePx={30} color="#111827">
          確定
          <Inline
            textDecoration={{
              line: "underline",
              style: "wavy",
              color: "#f97316",
              thicknessPx: 2,
              offsetPx: -10,
              skipInk: "all",
            }}
          >
            入力中
          </Inline>
        </Text>
      </Canvas>,
    ),
  );
}

function buildTypingCompositionInputs(): MaterializedFrameInput[] {
  return [
    { timeMs: 0, scene: buildTerminalTypingScene("empty", "") },
    { timeMs: 250, scene: buildTerminalTypingScene("command", "pnpm") },
    { timeMs: 500, scene: buildTerminalTypingScene("wrap", "pnpm test --filter boundsvg") },
    {
      timeMs: 750,
      scene: buildTerminalTypingScene("newline", "pnpm test\nPASS typing composition parity"),
    },
    { timeMs: 0, scene: buildImeTypingScene("committed", "入力: ", "") },
    { timeMs: 250, scene: buildImeTypingScene("hiragana", "入力: ", "きょう") },
    { timeMs: 500, scene: buildImeTypingScene("converted", "入力: ", "今日", true) },
    { timeMs: 750, scene: buildImeTypingScene("commit", "入力: 今日", "") },
    { timeMs: 250, scene: buildVerticalTypingScene() },
    { timeMs: 0, scene: buildClusterBoundaryScene(false) },
    { timeMs: 0, scene: buildClusterBoundaryScene(true) },
    { timeMs: 250, scene: buildWavyTypingScene() },
  ];
}

function findTextIrNode(root: IRNode, nodeId: string): IRTextNode {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node?.type === "text" && node.nodeId === nodeId) {
      return node;
    }
    if (node?.type === "group") {
      pending.push(...(node.children ?? []));
    }
  }
  throw new TypeError(`Missing Text IR node ${nodeId}`);
}

function buildMovingExclusionScene(
  exclusionLeft: number,
  obstacleTranslateX = 0,
  marginPx = 8,
  writingMode: "horizontal-tb" | "vertical-rl" = "horizontal-tb",
): SceneNode {
  return toSceneDocument(
    toVNode(
      <Canvas width={640} height={360} background="#111827">
        <Text
          id="materialized-flowed-text-units"
          position="absolute"
          left={24}
          top={24}
          width={592}
          height={312}
          font="NotoSansJP-woff2"
          fontSizePx={20}
          lineHeight={1.4}
          language="ja"
          wrap="char"
          writingMode={writingMode}
          textOrientation={writingMode === "vertical-rl" ? "upright" : "mixed"}
          color="#f8fafc"
          flowExclusions={[
            {
              kind: "rect",
              x: exclusionLeft - 24,
              y: 28,
              width: 112,
              height: 104,
              marginPx,
            },
          ]}
          animateUnits={{ ...TEXT_UNIT_ANIMATION, ruby: "separate" }}
        >
          <Ruby rubyPosition="over" rubyAlign="center">
            東京<Rt fontSizePx={11}>とうきょう</Rt>
          </Ruby>
          から移動する障害物の形状を各時刻で焼き込み、文章の断片と改行を再計算します。
        </Text>
        <Box
          id="materialized-exclusion"
          position="absolute"
          left={exclusionLeft}
          top={52}
          width={112}
          height={104}
          borderRadius={16}
          background="#f97316"
          {...(obstacleTranslateX !== 0 ? { transform: { translateX: obstacleTranslateX } } : {})}
        />
      </Canvas>,
    ),
  );
}

function flowedTextSignature(textNode: IRTextNode): string {
  return JSON.stringify(
    textNode.lines.map((line) => ({
      text: line.text,
      width: line.width,
      baselineY: line.baselineY,
      glyphs: line.positionedGlyphs?.map((glyph) => ({
        glyphId: glyph.glyphId,
        originX: glyph.originX,
        originY: glyph.originY,
        sourceStart: glyph.sourceStart,
        sourceEnd: glyph.sourceEnd,
        sourceRole: glyph.sourceRole,
      })),
    })),
  );
}

function textPathSignature(textNode: IRTextNode): string {
  return JSON.stringify({
    path: textNode.textPath,
    positionedGlyphs: textNode.lines[0]?.positionedGlyphs?.map((glyph) => ({
      glyphId: glyph.glyphId,
      originX: glyph.originX,
      originY: glyph.originY,
      baselineRotationDeg: glyph.baselineRotationDeg,
      sourceStart: glyph.sourceStart,
      sourceEnd: glyph.sourceEnd,
      inlineScale: glyph.inlineScale,
      syntheticKind: glyph.syntheticKind,
    })),
    unitBboxes: textNode.unitAnimationSamples?.map((sample) => sample.bbox),
  });
}

function hasOneShotTextPathParity(
  directPathText: IRTextNode,
  workerPathText: IRTextNode,
  directEllipsisText: IRTextNode,
  workerEllipsisText: IRTextNode,
): boolean {
  const paintedGlyph = directPathText.lines[0]?.positionedGlyphs?.find(
    (glyph) => glyph.text === "曲",
  );
  return (
    directPathText.textLayoutKind === "path" &&
    directPathText.textPath?.pathFit === "spacing" &&
    paintedGlyph?.fill === "#f472b6" &&
    paintedGlyph.textStrokes?.length === 0 &&
    paintedGlyph.textShadows?.map((layer) => layer.color).join(",") === "#83184380" &&
    JSON.stringify(directPathText) === JSON.stringify(workerPathText) &&
    directEllipsisText.sourceText === "Worker ellipsis fitting route" &&
    directEllipsisText.displayText?.endsWith("…") === true &&
    directEllipsisText.lines[0]?.positionedGlyphs?.at(-1)?.syntheticKind === "ellipsis" &&
    JSON.stringify(directEllipsisText) === JSON.stringify(workerEllipsisText)
  );
}

type SvgIrArtifacts = { svg: string; ir: { root: IRNode } };
const MATERIALIZED_RESOURCE_ID_PREFIX = "rich path:";

async function hasMaterializedTextPathParity(
  directEngine: Engine,
  workerEngine: NonNullable<ReturnType<typeof useBoundSvg>["workerEngine"]>,
  inputs: readonly MaterializedFrameInput[],
): Promise<boolean> {
  const directArtifacts = inputs.map((input) =>
    directEngine.renderToSvgAndIR(input.scene, {
      animation: "static",
      timeMs: input.timeMs,
      resourceIdPrefix: MATERIALIZED_RESOURCE_ID_PREFIX,
    }),
  );
  const workerArtifacts = await Promise.all(
    inputs.map((input) =>
      workerEngine.renderToSvgAndIR(input.scene, {
        animation: "static",
        timeMs: input.timeMs,
        resourceIdPrefix: MATERIALIZED_RESOURCE_ID_PREFIX,
      }),
    ),
  );
  const directNodes = directArtifacts.map((artifacts) =>
    findTextIrNode(artifacts.ir.root, "materialized-text-path-units"),
  );
  const workerNodes = workerArtifacts.map((artifacts) =>
    findTextIrNode(artifacts.ir.root, "materialized-text-path-units"),
  );
  const firstUnitIds = directNodes[0]?.unitMap?.units.map((unit) => unit.unitId);
  const directDecorations = directArtifacts.map((artifacts) =>
    findTextIrNode(artifacts.ir.root, "materialized-decoration"),
  );
  const workerDecorations = workerArtifacts.map((artifacts) =>
    findTextIrNode(artifacts.ir.root, "materialized-decoration"),
  );
  const directRichDecorations = directArtifacts.map((artifacts) =>
    findTextIrNode(artifacts.ir.root, "materialized-rich-decoration"),
  );
  const workerRichDecorations = workerArtifacts.map((artifacts) =>
    findTextIrNode(artifacts.ir.root, "materialized-rich-decoration"),
  );
  const ellipsisNode = directNodes.at(-1);
  const ellipsisGlyphs = ellipsisNode?.lines[0]?.positionedGlyphs ?? [];
  const ellipsisGlyphIndex = ellipsisGlyphs.length - 1;
  const expectedPathPaint = [
    ["#67e8f9", "#0e7490", "#08334480"],
    ["#fb7185", "#9f1239", "#4c051980"],
    ["#67e8f9", "#0e7490", "#08334480"],
    ["#fb7185", "#9f1239", "#4c051980"],
    ["#fb7185", "#9f1239", "#4c051980"],
  ];
  const contentChangedUnitIds = directNodes[3]?.unitMap?.units.map((unit) => unit.unitId);
  return (
    firstUnitIds !== undefined &&
    JSON.stringify(directNodes.map((node) => node.textPath?.pathFit)) ===
      JSON.stringify(["spacing", "shrink", "scale", "spacing", "spacing"]) &&
    JSON.stringify(directDecorations.map((node) => node.textDecorations?.[0]?.style)) ===
      JSON.stringify(["dotted", "dashed", "wavy", "dashed", "dotted"]) &&
    directDecorations.every(
      (node, index) =>
        node.textDecorations?.[0]?.skipInk === "all" &&
        JSON.stringify(node) === JSON.stringify(workerDecorations[index]),
    ) &&
    JSON.stringify(directRichDecorations.map((node) => node.textPath?.pathFit)) ===
      JSON.stringify(["spacing", "shrink", "scale", "spacing", "spacing"]) &&
    JSON.stringify(directRichDecorations.map((node) => node.textDecorations?.[0]?.style)) ===
      JSON.stringify(["dotted", "dashed", "wavy", "dashed", "dotted"]) &&
    directRichDecorations.every(
      (node, index) =>
        node.textDecorations?.[0]?.skipInk === "all" &&
        node.lines[0]?.positionedGlyphs?.some(
          (glyph) =>
            glyph.fontAlias === "JetBrainsMono" &&
            glyph.textStrokes?.length === 1 &&
            glyph.textShadows?.length === 1,
        ) &&
        JSON.stringify(node) === JSON.stringify(workerRichDecorations[index]),
    ) &&
    directNodes.every((node, index) => {
      const [fill, stroke, shadow] = expectedPathPaint[index] ?? [];
      return node.lines[0]?.positionedGlyphs?.some(
        (glyph) =>
          glyph.fill === fill &&
          glyph.textStrokes?.[0]?.color === stroke &&
          glyph.textShadows?.[0]?.color === shadow,
      );
    }) &&
    ellipsisNode?.sourceText === "MATERIALIZED fitted path identity route 日本語" &&
    ellipsisNode.displayText?.endsWith("…") === true &&
    ellipsisGlyphs[ellipsisGlyphIndex]?.syntheticKind === "ellipsis" &&
    ellipsisNode.unitMap?.units.some((unit) =>
      unit.members.some((member) => member.glyphIndex === ellipsisGlyphIndex),
    ) === false &&
    contentChangedUnitIds !== undefined &&
    contentChangedUnitIds.length > firstUnitIds.length &&
    JSON.stringify(contentChangedUnitIds.slice(0, firstUnitIds.length)) ===
      JSON.stringify(firstUnitIds) &&
    directNodes[3]?.sourceText?.endsWith(" 追加") === true &&
    directArtifacts.every(
      (artifacts) => artifacts.svg.includes("rich_path:") && !artifacts.svg.includes("rich path:"),
    ) &&
    directArtifacts.every(
      (artifacts, index) =>
        artifacts.svg === workerArtifacts[index]?.svg &&
        JSON.stringify(directNodes[index]?.unitMap) ===
          JSON.stringify(workerNodes[index]?.unitMap) &&
        JSON.stringify(directNodes[index]?.unitAnimationSamples) ===
          JSON.stringify(workerNodes[index]?.unitAnimationSamples) &&
        (index === 3 ||
          JSON.stringify(directNodes[index]?.unitMap?.units.map((unit) => unit.unitId)) ===
            JSON.stringify(firstUnitIds)),
    ) &&
    new Set(directNodes.map(textPathSignature)).size === inputs.length
  );
}

async function collectWorkerFrames(iterable: AsyncIterable<Frame>): Promise<Frame[]> {
  const frames: Frame[] = [];
  for await (const frame of iterable) {
    frames.push(frame);
  }
  return frames;
}

function materializedFrameSource(
  inputs: MaterializedFrameInput[],
  asynchronous: boolean,
): MaterializedFrameInput[] | AsyncIterable<MaterializedFrameInput> {
  if (!asynchronous) {
    return inputs;
  }
  return (async function* asynchronousFrames() {
    for (const input of inputs) {
      await Promise.resolve();
      yield input;
    }
  })();
}

function structuredErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }
  return String(Reflect.get(error, "code") ?? "");
}

async function verifyV2PoolLifecycle(
  pool: WorkerPool,
  scene: SceneNode,
  textPathInputs: readonly MaterializedFrameInput[],
  directEngine: Engine,
): Promise<boolean> {
  const abortController = new AbortController();
  const abortIterator = pool
    .renderMaterializedFrames(textPathInputs, {
      format: "svg",
      signal: abortController.signal,
    })
    [Symbol.asyncIterator]();
  const firstBeforeAbort = await abortIterator.next();
  abortController.abort("materialized lifecycle abort");
  let abortClosed = false;
  try {
    await abortIterator.next();
  } catch (abortError: unknown) {
    abortClosed = abortError instanceof DOMException && abortError.name === "AbortError";
  }

  const returnedIterator = pool
    .renderMaterializedFrames(textPathInputs, { format: "png" })
    [Symbol.asyncIterator]();
  const firstBeforeReturn = await returnedIterator.next();
  await returnedIterator.return?.();

  const invalidInput: MaterializedFrameInput = {
    timeMs: 0,
    scene: buildMaterializedTextPathScene({
      d: "M0 0",
      startOffsetPx: 0,
      textAnchor: "start",
      pathFit: "spacing",
      decorationStyle: "dotted",
      pathPaintVariant: "cool",
    }),
  };
  let fatalCode = "";
  try {
    await collectWorkerFrames(
      pool.renderMaterializedFrames([invalidInput], {
        format: "svg",
      }),
    );
  } catch (fatalError: unknown) {
    fatalCode = structuredErrorCode(fatalError);
  }

  const recoveryInput = textPathInputs[2];
  if (!recoveryInput) {
    throw new TypeError("Missing materialized recovery input");
  }
  const invalidRichScene = buildMaterializedTextPathScene({
    d: "M20 120L440 120",
    startOffsetPx: 20,
    textAnchor: "start",
    pathFit: "scale",
    decorationStyle: "dashed",
    pathPaintVariant: "warm",
  });
  if (invalidRichScene.type !== "Canvas") {
    throw new TypeError("Missing rich TextOnPath Canvas");
  }
  const invalidRichTextPath = invalidRichScene.children.find(
    (child) => child.type === "TextOnPath",
  );
  if (!invalidRichTextPath || invalidRichTextPath.type !== "TextOnPath") {
    throw new TypeError("Missing rich TextOnPath node");
  }
  invalidRichTextPath.children = [
    { type: "Inline", textDecoration: { line: "underline" }, children: ["invalid"] },
  ] as unknown as typeof invalidRichTextPath.children;
  let richFatalCode = "";
  try {
    await collectWorkerFrames(
      pool.renderMaterializedFrames([{ timeMs: 0, scene: invalidRichScene }], {
        format: "svg",
      }),
    );
  } catch (richFatalError: unknown) {
    richFatalCode = structuredErrorCode(richFatalError);
  }

  const recoveryFrames = await collectWorkerFrames(
    pool.renderMaterializedFrames([recoveryInput], { format: "svg" }),
  );
  const expectedRecoverySvg = directEngine.renderToSvg(recoveryInput.scene, {
    animation: "static",
    timeMs: recoveryInput.timeMs,
  });

  pool.dispose();
  let disposedRejected = false;
  try {
    pool.renderFrames(scene, { timesMs: [0], format: "svg" });
  } catch (disposeError: unknown) {
    disposedRejected = disposeError instanceof Error && disposeError.message.includes("disposed");
  }

  return (
    firstBeforeAbort.done === false &&
    abortClosed &&
    firstBeforeReturn.done === false &&
    fatalCode === "TEXT_PATH_ZERO_LENGTH" &&
    richFatalCode === "TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED" &&
    recoveryFrames.length === 1 &&
    recoveryFrames[0]?.data === expectedRecoverySvg &&
    disposedRejected
  );
}

function hasMaterializedTextUnitParity(
  directNarrowArtifacts: SvgIrArtifacts,
  directWideArtifacts: SvgIrArtifacts,
  workerNarrowArtifacts: SvgIrArtifacts,
  workerWideArtifacts: SvgIrArtifacts,
): boolean {
  const directNarrowText = findTextIrNode(directNarrowArtifacts.ir.root, "materialized-text-units");
  const directWideText = findTextIrNode(directWideArtifacts.ir.root, "materialized-text-units");
  const workerNarrowText = findTextIrNode(workerNarrowArtifacts.ir.root, "materialized-text-units");
  const workerWideText = findTextIrNode(workerWideArtifacts.ir.root, "materialized-text-units");
  const narrowUnitMap = directNarrowText.unitMap;
  const wideUnitMap = directWideText.unitMap;
  const sourceRoles = [
    ...new Set(
      narrowUnitMap?.units.flatMap((unit) => unit.members.map((member) => member.sourceRole)),
    ),
  ].sort();
  return (
    directNarrowArtifacts.svg === workerNarrowArtifacts.svg &&
    directWideArtifacts.svg === workerWideArtifacts.svg &&
    JSON.stringify(narrowUnitMap) === JSON.stringify(workerNarrowText.unitMap) &&
    JSON.stringify(wideUnitMap) === JSON.stringify(workerWideText.unitMap) &&
    JSON.stringify(narrowUnitMap?.units.map((unit) => unit.unitId)) ===
      JSON.stringify(wideUnitMap?.units.map((unit) => unit.unitId)) &&
    JSON.stringify(narrowUnitMap?.units.map((unit) => unit.lineId)) !==
      JSON.stringify(wideUnitMap?.units.map((unit) => unit.lineId)) &&
    directNarrowText.lines.length > directWideText.lines.length &&
    JSON.stringify(sourceRoles) === JSON.stringify(["content", "rubyAnnotation", "rubyBase"])
  );
}

function flowedRouteMatches(
  directArtifacts: readonly SvgIrArtifacts[],
  workerArtifacts: readonly SvgIrArtifacts[],
  directTexts: readonly IRTextNode[],
  workerTexts: readonly IRTextNode[],
): boolean {
  return directArtifacts.every((artifacts, index) => {
    const matchingWorkerArtifacts = workerArtifacts[index];
    const directText = directTexts[index];
    const workerText = workerTexts[index];
    return (
      matchingWorkerArtifacts !== undefined &&
      directText !== undefined &&
      workerText !== undefined &&
      artifacts.svg === matchingWorkerArtifacts.svg &&
      JSON.stringify(directText.unitMap) === JSON.stringify(workerText.unitMap) &&
      JSON.stringify(directText.unitAnimationSamples) ===
        JSON.stringify(workerText.unitAnimationSamples)
    );
  });
}

function hasStableFlowedTextIdentity(startText: IRTextNode, endText: IRTextNode): boolean {
  const startUnits = startText.unitMap?.units;
  const endUnits = endText.unitMap?.units;
  if (!startUnits || startUnits.length === 0 || !endUnits) {
    return false;
  }
  const sourceRoles = [
    ...new Set(startUnits.flatMap((unit) => unit.members.map((member) => member.sourceRole))),
  ].sort();
  return (
    JSON.stringify(startUnits.map((unit) => unit.unitId)) ===
      JSON.stringify(endUnits.map((unit) => unit.unitId)) &&
    flowedTextSignature(startText) !== flowedTextSignature(endText) &&
    JSON.stringify(startText.unitAnimationSamples?.map((sample) => sample.unitId)) ===
      JSON.stringify(startUnits.map((unit) => unit.unitId)) &&
    JSON.stringify(sourceRoles) === JSON.stringify(["content", "rubyAnnotation", "rubyBase"])
  );
}

function requireFlowedTextPairs(
  textNodes: readonly IRTextNode[],
): readonly [readonly [IRTextNode, IRTextNode], readonly [IRTextNode, IRTextNode]] {
  const [horizontalStart, horizontalEnd, verticalStart, verticalEnd] = textNodes;
  if (!horizontalStart || !horizontalEnd || !verticalStart || !verticalEnd) {
    throw new TypeError("Missing direct flowed-text parity fixture");
  }
  return [
    [horizontalStart, horizontalEnd],
    [verticalStart, verticalEnd],
  ];
}

// ---------------------------------------------------------------------------
// Content — exposes all render state via data-testid
// ---------------------------------------------------------------------------

function WorkerTestContent() {
  const { status, error, workerEngine } = useBoundSvg();
  const vnode = useMemo(() => buildTestVNode(), []);
  const routeParity = useRouteParity(status, workerEngine, vnode);

  const svgResult = useRenderToSvgAsync(vnode);
  const pngResult = useRenderToPngAsync(vnode);

  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="error">{error?.message ?? ""}</div>
      <div data-testid="has-worker-engine">{workerEngine ? "true" : "false"}</div>

      <div data-testid="svg-ready">{String(svgResult.isReady)}</div>
      <div data-testid="svg-error">{svgResult.error?.message ?? ""}</div>
      {svgResult.svg && (
        <div data-testid="svg-output" dangerouslySetInnerHTML={{ __html: svgResult.svg }} />
      )}

      <div data-testid="png-ready">{String(pngResult.isReady)}</div>
      <div data-testid="png-error">{pngResult.error?.message ?? ""}</div>
      {pngResult.dataUrl && (
        <img data-testid="png-output" src={pngResult.dataUrl} alt="Worker PNG test" />
      )}
      <div data-testid="png-byte-length">{pngResult.png?.byteLength ?? 0}</div>

      <div data-testid="route-parity-ready">{String(routeParity.ready)}</div>
      <div data-testid="route-parity-ok">{String(routeParity.equal)}</div>
      <div data-testid="route-parity-count">{routeParity.comparisonCount}</div>
      <div data-testid="route-parity-error">{routeParity.error}</div>
      <div data-testid="text-unit-ir-parity-ok">{String(routeParity.textUnitIrEqual)}</div>
      <div data-testid="text-path-ir-parity-ok">{String(routeParity.textPathIrEqual)}</div>
      <div data-testid="materialized-text-unit-identity-ok">
        {String(routeParity.materializedTextUnitIdentity)}
      </div>
      <div data-testid="flowed-text-unit-identity-ok">
        {String(routeParity.flowedTextUnitIdentity)}
      </div>
      <div data-testid="materialized-text-path-identity-ok">
        {String(routeParity.materializedTextPathIdentity)}
      </div>
      <div data-testid="pool-parity-ok">{String(routeParity.poolEqual)}</div>
      <div data-testid="pool-lifecycle-recovery-ok">
        {String(routeParity.poolLifecycleRecovery)}
      </div>
      <div data-testid="pool-startup-ms-one">{routeParity.poolStartupMsOne}</div>
      <div data-testid="pool-startup-ms-default">{routeParity.poolStartupMsDefault}</div>
      <div data-testid="pool-font-bytes">{routeParity.poolFontBytes}</div>
      <div data-testid="materialized-parity-ok">{String(routeParity.materializedEqual)}</div>
      <div data-testid="materialized-fixture-count">{routeParity.materializedFixtureCount}</div>
      <div data-testid="typing-composition-parity-ok">
        {String(routeParity.typingCompositionEqual)}
      </div>
      <div data-testid="materialized-layout-changes">
        {String(routeParity.materializedLayoutChanges)}
      </div>
      <div data-testid="materialized-exclusion-margin-ok">
        {String(routeParity.materializedExclusionMarginChanges)}
      </div>
    </div>
  );
}

type RouteParityState = {
  ready: boolean;
  equal: boolean;
  comparisonCount: number;
  error: string;
  textUnitIrEqual: boolean;
  textPathIrEqual: boolean;
  materializedTextUnitIdentity: boolean;
  flowedTextUnitIdentity: boolean;
  materializedTextPathIdentity: boolean;
  poolEqual: boolean;
  poolLifecycleRecovery: boolean;
  poolStartupMsOne: number;
  poolStartupMsDefault: number;
  poolFontBytes: number;
  materializedEqual: boolean;
  materializedFixtureCount: number;
  typingCompositionEqual: boolean;
  materializedLayoutChanges: boolean;
  materializedExclusionMarginChanges: boolean;
};

const initialRouteParity: RouteParityState = {
  ready: false,
  equal: false,
  comparisonCount: 0,
  error: "",
  textUnitIrEqual: false,
  textPathIrEqual: false,
  materializedTextUnitIdentity: false,
  flowedTextUnitIdentity: false,
  materializedTextPathIdentity: false,
  poolEqual: false,
  poolLifecycleRecovery: false,
  poolStartupMsOne: 0,
  poolStartupMsDefault: 0,
  poolFontBytes: 0,
  materializedEqual: false,
  materializedFixtureCount: 0,
  typingCompositionEqual: false,
  materializedLayoutChanges: false,
  materializedExclusionMarginChanges: false,
};

function useRouteParity(
  status: string,
  workerEngine: ReturnType<typeof useBoundSvg>["workerEngine"],
  vnode: VNode,
): RouteParityState {
  const [state, setState] = useState<RouteParityState>(initialRouteParity);

  useEffect(() => {
    if (status !== "ready" || !workerEngine) {
      return;
    }

    let cancelled = false;
    let directEngine: Engine | undefined;
    let activePool: WorkerPool | undefined;
    void (async () => {
      const [wasmModule, primaryFontResponse, fallbackFontResponse] = await Promise.all([
        loadWasmModule(),
        fetch("/fonts/JetBrainsMono-Regular.woff2"),
        fetch("/fonts/NotoSansJP-Regular.subset.woff2"),
      ]);
      if (!primaryFontResponse.ok || !fallbackFontResponse.ok) {
        throw new Error(
          `Failed to load parity fonts: ${primaryFontResponse.status}/${fallbackFontResponse.status}`,
        );
      }
      if (cancelled) {
        return;
      }
      initWasm(wasmModule);
      const primaryFontData = await primaryFontResponse.arrayBuffer();
      const fallbackFontData = await fallbackFontResponse.arrayBuffer();
      const createdEngine = await createEngineAsync({
        fonts: [
          {
            alias: "JetBrainsMono",
            weight: 400,
            style: "normal",
            data: new Uint8Array(primaryFontData.slice(0)),
          },
          {
            alias: "NotoSansJP-woff2",
            weight: 400,
            style: "normal",
            data: new Uint8Array(fallbackFontData.slice(0)),
          },
        ],
      });
      if (cancelled) {
        createdEngine.dispose();
        return;
      }
      directEngine = createdEngine;

      const common = {
        text: "日本語組版の Worker 経路比較です。",
        fontFamily: "JetBrainsMono",
        fallback: ["NotoSansJP-woff2"],
        fontSizePx: 20,
        lineHeight: 1.5,
        language: "ja" as const,
        wrap: "char" as const,
      };
      const scene = toSceneDocument(vnode);
      const directValues: unknown[] = [
        createdEngine.renderToSvg(scene),
        createdEngine.renderToSvgAndIR(scene),
        createdEngine.renderToPng(scene),
        createdEngine.layoutTextFlow({ ...common, lineWidths: [80, 120, 160] }),
        createdEngine.layoutTextFlowWithExclusions({
          ...common,
          lineHeightPx: 32,
          flowBox: { x: 0, y: 0, width: 180, height: 160 },
          exclusions: [{ kind: "circle", cx: 50, cy: 50, r: 24 }],
        }),
        createdEngine.measureTextBlock({
          ...common,
          lineHeightPx: 32,
          textIndent: 20,
          maxWidth: 160,
        }),
        createdEngine.shrinkwrapText({
          ...common,
          lineHeightPx: 32,
          maxWidth: 180,
          targetLineCount: 2,
        }),
        createdEngine.shrinkwrapFlow({
          ...common,
          lineHeightPx: 32,
          flowBox: { x: 0, y: 0, width: 180, height: 160 },
          exclusions: [],
          targetLineCount: 2,
        }),
        createdEngine.measureIntrinsicInlineSize({
          ...common,
          lineHeightPx: 32,
          textIndent: 20,
        }),
      ];
      const workerValues = await Promise.all([
        workerEngine.renderToSvg(scene),
        workerEngine.renderToSvgAndIR(scene),
        workerEngine.renderToPng(scene),
        workerEngine.layoutTextFlow({ ...common, lineWidths: [80, 120, 160] }),
        workerEngine.layoutTextFlowWithExclusions({
          ...common,
          lineHeightPx: 32,
          flowBox: { x: 0, y: 0, width: 180, height: 160 },
          exclusions: [{ kind: "circle", cx: 50, cy: 50, r: 24 }],
        }),
        workerEngine.measureTextBlock({
          ...common,
          lineHeightPx: 32,
          textIndent: 20,
          maxWidth: 160,
        }),
        workerEngine.shrinkwrapText({
          ...common,
          lineHeightPx: 32,
          maxWidth: 180,
          targetLineCount: 2,
        }),
        workerEngine.shrinkwrapFlow({
          ...common,
          lineHeightPx: 32,
          flowBox: { x: 0, y: 0, width: 180, height: 160 },
          exclusions: [],
          targetLineCount: 2,
        }),
        workerEngine.measureIntrinsicInlineSize({ ...common, lineHeightPx: 32, textIndent: 20 }),
      ]);
      const routeEqual = workerValues.every(
        (workerValue, index) => JSON.stringify(workerValue) === JSON.stringify(directValues[index]),
      );
      const textUnitIrEqual = JSON.stringify(workerValues[1]) === JSON.stringify(directValues[1]);
      const directSceneArtifacts = directValues[1] as SvgIrArtifacts;
      const workerSceneArtifacts = workerValues[1] as SvgIrArtifacts;
      const directPathText = findTextIrNode(directSceneArtifacts.ir.root, "worker-path-units");
      const workerPathText = findTextIrNode(workerSceneArtifacts.ir.root, "worker-path-units");
      const directEllipsisText = findTextIrNode(
        directSceneArtifacts.ir.root,
        "worker-path-ellipsis",
      );
      const workerEllipsisText = findTextIrNode(
        workerSceneArtifacts.ir.root,
        "worker-path-ellipsis",
      );
      const textPathIrEqual = hasOneShotTextPathParity(
        directPathText,
        workerPathText,
        directEllipsisText,
        workerEllipsisText,
      );
      const narrowTextUnitScene = buildMaterializedTextUnitScene(100);
      const wideTextUnitScene = buildMaterializedTextUnitScene(260);
      const directNarrowTextUnit = createdEngine.renderToSvgAndIR(narrowTextUnitScene, {
        animation: "static",
        timeMs: 420,
      });
      const directWideTextUnit = createdEngine.renderToSvgAndIR(wideTextUnitScene, {
        animation: "static",
        timeMs: 420,
      });
      const [workerNarrowTextUnit, workerWideTextUnit] = await Promise.all([
        workerEngine.renderToSvgAndIR(narrowTextUnitScene, {
          animation: "static",
          timeMs: 420,
        }),
        workerEngine.renderToSvgAndIR(wideTextUnitScene, {
          animation: "static",
          timeMs: 420,
        }),
      ]);
      const materializedTextUnitIdentity = hasMaterializedTextUnitParity(
        directNarrowTextUnit,
        directWideTextUnit,
        workerNarrowTextUnit,
        workerWideTextUnit,
      );

      const frameTimes = [600, 0, 1_400, 600] as const;
      const directSvgFrames = [
        ...createdEngine.renderFrames(scene, { timesMs: frameTimes, format: "svg" }),
      ];
      const directPngFrames = [
        ...createdEngine.renderFrames(scene, { timesMs: frameTimes, format: "png" }),
      ];
      const movingExclusionStart = buildMovingExclusionScene(92);
      const movingExclusionWithoutMargin = buildMovingExclusionScene(92, 0, 0);
      const rigidMovingExclusion = buildMovingExclusionScene(92, 292);
      const movingExclusionEnd = buildMovingExclusionScene(384);
      const verticalMovingExclusionStart = buildMovingExclusionScene(500, 0, 8, "vertical-rl");
      const verticalMovingExclusionEnd = buildMovingExclusionScene(260, 0, 8, "vertical-rl");
      const flowedScenes = [
        movingExclusionStart,
        movingExclusionEnd,
        verticalMovingExclusionStart,
        verticalMovingExclusionEnd,
      ];
      const directFlowedArtifacts = flowedScenes.map((flowedScene) =>
        createdEngine.renderToSvgAndIR(flowedScene, { animation: "static", timeMs: 420 }),
      );
      const workerFlowedArtifacts = await Promise.all(
        flowedScenes.map((flowedScene) =>
          workerEngine.renderToSvgAndIR(flowedScene, { animation: "static", timeMs: 420 }),
        ),
      );
      const directFlowedTexts = directFlowedArtifacts.map((artifacts) =>
        findTextIrNode(artifacts.ir.root, "materialized-flowed-text-units"),
      );
      const workerFlowedTexts = workerFlowedArtifacts.map((artifacts) =>
        findTextIrNode(artifacts.ir.root, "materialized-flowed-text-units"),
      );
      const flowedTextPairs = requireFlowedTextPairs(directFlowedTexts);
      const [[horizontalFlowStartText, horizontalFlowEndText]] = flowedTextPairs;
      const flowedTextUnitIdentity =
        flowedRouteMatches(
          directFlowedArtifacts,
          workerFlowedArtifacts,
          directFlowedTexts,
          workerFlowedTexts,
        ) &&
        flowedTextPairs.every(([startText, endText]) =>
          hasStableFlowedTextIdentity(startText, endText),
        );
      const existingMaterializedInputs: MaterializedFrameInput[] = [
        { timeMs: 600, scene: buildGrowingBoxScene(112, 112) },
        { timeMs: 0, scene: buildGrowingBoxScene(220, 168) },
        { timeMs: 1_400, scene: buildGrowingBoxScene(328, 244) },
        { timeMs: 600, scene: movingExclusionStart },
        { timeMs: 600, scene: rigidMovingExclusion },
        { timeMs: 200, scene: movingExclusionEnd },
        { timeMs: 600, scene: verticalMovingExclusionStart },
        { timeMs: 200, scene: verticalMovingExclusionEnd },
        { timeMs: 0, scene: buildJustificationScene("start") },
        { timeMs: 0, scene: buildJustificationScene("space-between") },
      ];
      const textPathInputs: MaterializedFrameInput[] = [
        {
          timeMs: 0,
          scene: buildMaterializedTextPathScene({
            d: "M20 120L440 120",
            startOffsetPx: 210,
            pathFit: "spacing",
            decorationStyle: "dotted",
            pathPaintVariant: "cool",
          }),
        },
        {
          timeMs: 200,
          scene: buildMaterializedTextPathScene({
            d: "M20 180C110 10 350 10 440 180",
            startOffsetPx: 250,
            pathFit: "shrink",
            decorationStyle: "dashed",
            pathPaintVariant: "warm",
          }),
        },
        {
          timeMs: 400,
          scene: buildMaterializedTextPathScene({
            d: "M20 190L440 190L440 70L20 70Z",
            startOffsetPx: 540,
            pathDirection: "reverse",
            pathNormal: "right",
            pathFit: "scale",
            decorationStyle: "wavy",
            pathPaintVariant: "cool",
          }),
        },
        {
          timeMs: 400,
          scene: buildMaterializedTextPathScene({
            d: "M20 170Q230 20 440 170",
            startOffsetPx: 230,
            pathFit: "spacing",
            decorationStyle: "dashed",
            pathPaintVariant: "warm",
            pathSuffix: " 追加",
          }),
        },
        {
          timeMs: 600,
          scene: buildMaterializedTextPathScene({
            d: "M20 170L180 170",
            startOffsetPx: 0,
            textAnchor: "start",
            pathFit: "spacing",
            pathOverflow: "ellipsis",
            decorationStyle: "dotted",
            pathPaintVariant: "warm",
          }),
        },
      ];
      const materializedTextPathIdentity = await hasMaterializedTextPathParity(
        createdEngine,
        workerEngine,
        textPathInputs,
      );
      const typingCompositionInputs = buildTypingCompositionInputs();
      const materializedInputs = [
        ...existingMaterializedInputs,
        ...textPathInputs,
        ...typingCompositionInputs,
      ];
      const directMaterializedSvg = materializedInputs.map((input, index) => ({
        index,
        timeMs: input.timeMs,
        format: "svg" as const,
        data: createdEngine.renderToSvg(input.scene, {
          animation: "static",
          timeMs: input.timeMs,
          resourceIdPrefix: MATERIALIZED_RESOURCE_ID_PREFIX,
        }),
      }));
      const directMaterializedPng = materializedInputs.map((input, index) => ({
        index,
        timeMs: input.timeMs,
        format: "png" as const,
        data: createdEngine.renderToPng(input.scene, {
          animation: "static",
          timeMs: input.timeMs,
          resourceIdPrefix: MATERIALIZED_RESOURCE_ID_PREFIX,
        }),
      }));
      const materializedLayoutChanges =
        new Set(directMaterializedSvg.map((frame) => frame.data)).size ===
          materializedInputs.length &&
        flowedTextSignature(horizontalFlowStartText) ===
          flowedTextSignature(
            findTextIrNode(
              createdEngine.renderToIR(rigidMovingExclusion).root,
              "materialized-flowed-text-units",
            ),
          ) &&
        flowedTextSignature(horizontalFlowStartText) !== flowedTextSignature(horizontalFlowEndText);
      const movingExclusionWithoutMarginText = findTextIrNode(
        createdEngine.renderToIR(movingExclusionWithoutMargin).root,
        "materialized-flowed-text-units",
      );
      const materializedExclusionMarginChanges =
        flowedTextSignature(horizontalFlowStartText) !==
        flowedTextSignature(movingExclusionWithoutMarginText);
      const poolFonts = [
        {
          alias: "JetBrainsMono",
          weight: 400,
          style: "normal" as const,
          data: primaryFontData,
        },
        {
          alias: "NotoSansJP-woff2",
          weight: 400,
          style: "normal" as const,
          data: fallbackFontData,
        },
      ];
      const renderWithPool = async (concurrency: number) => {
        const startupStart = performance.now();
        const pool = await WorkerPool.create({
          worker: () =>
            new Worker(new URL("@boundsvg/worker/worker", import.meta.url), {
              type: "module",
            }),
          concurrency,
          fonts: poolFonts,
        });
        activePool = pool;
        const startupMs = performance.now() - startupStart;
        const svgFrames = await collectWorkerFrames(
          pool.renderFrames(scene, { timesMs: frameTimes, format: "svg" }),
        );
        const pngFrames = await collectWorkerFrames(
          pool.renderFrames(scene, { timesMs: frameTimes, format: "png" }),
        );
        const materializedSvgFrames = await collectWorkerFrames(
          pool.renderMaterializedFrames(
            materializedFrameSource(materializedInputs, concurrency > 1),
            {
              format: "svg",
              resourceIdPrefix: MATERIALIZED_RESOURCE_ID_PREFIX,
            },
          ),
        );
        const materializedPngFrames = await collectWorkerFrames(
          pool.renderMaterializedFrames(
            materializedFrameSource(materializedInputs, concurrency === 1),
            {
              format: "png",
              resourceIdPrefix: MATERIALIZED_RESOURCE_ID_PREFIX,
            },
          ),
        );
        const poolLifecycleRecovery = await verifyV2PoolLifecycle(
          pool,
          scene,
          textPathInputs,
          createdEngine,
        );
        activePool = undefined;
        return {
          startupMs,
          svgFrames,
          pngFrames,
          materializedSvgFrames,
          materializedPngFrames,
          poolLifecycleRecovery,
        };
      };
      const oneWorker = await renderWithPool(1);
      const defaultPool = await renderWithPool(2);
      const poolEqual =
        JSON.stringify(oneWorker.svgFrames) === JSON.stringify(directSvgFrames) &&
        JSON.stringify(oneWorker.pngFrames) === JSON.stringify(directPngFrames) &&
        JSON.stringify(defaultPool.svgFrames) === JSON.stringify(directSvgFrames) &&
        JSON.stringify(defaultPool.pngFrames) === JSON.stringify(directPngFrames);
      const poolLifecycleRecovery =
        oneWorker.poolLifecycleRecovery && defaultPool.poolLifecycleRecovery;
      const materializedEqual =
        JSON.stringify(oneWorker.materializedSvgFrames) === JSON.stringify(directMaterializedSvg) &&
        JSON.stringify(oneWorker.materializedPngFrames) === JSON.stringify(directMaterializedPng) &&
        JSON.stringify(defaultPool.materializedSvgFrames) ===
          JSON.stringify(directMaterializedSvg) &&
        JSON.stringify(defaultPool.materializedPngFrames) === JSON.stringify(directMaterializedPng);
      const typingCompositionStart = existingMaterializedInputs.length + textPathInputs.length;
      const typingCompositionEqual =
        typingCompositionInputs.length === 12 &&
        JSON.stringify(oneWorker.materializedSvgFrames.slice(typingCompositionStart)) ===
          JSON.stringify(directMaterializedSvg.slice(typingCompositionStart)) &&
        JSON.stringify(oneWorker.materializedPngFrames.slice(typingCompositionStart)) ===
          JSON.stringify(directMaterializedPng.slice(typingCompositionStart)) &&
        JSON.stringify(defaultPool.materializedSvgFrames.slice(typingCompositionStart)) ===
          JSON.stringify(directMaterializedSvg.slice(typingCompositionStart)) &&
        JSON.stringify(defaultPool.materializedPngFrames.slice(typingCompositionStart)) ===
          JSON.stringify(directMaterializedPng.slice(typingCompositionStart));
      const allRouteParity = [
        routeEqual,
        textPathIrEqual,
        materializedTextUnitIdentity,
        flowedTextUnitIdentity,
        materializedTextPathIdentity,
        poolEqual,
        poolLifecycleRecovery,
        materializedEqual,
        typingCompositionEqual,
        materializedLayoutChanges,
        materializedExclusionMarginChanges,
      ].every(Boolean);
      if (!cancelled) {
        setState({
          ready: true,
          equal: allRouteParity,
          // 9 one-shot routes, 4 fixed-scene route/concurrency pairs, 4 materialized route/concurrency
          // pairs, 2 text-unit widths, 4 flowed-text geometry/mode scenes, and
          // 5 TextOnPath materialized content/style/geometry/fitting frames.
          comparisonCount: workerValues.length + 18,
          error: "",
          textUnitIrEqual,
          textPathIrEqual,
          materializedTextUnitIdentity,
          flowedTextUnitIdentity,
          materializedTextPathIdentity,
          poolEqual,
          poolLifecycleRecovery,
          poolStartupMsOne: oneWorker.startupMs,
          poolStartupMsDefault: defaultPool.startupMs,
          poolFontBytes: primaryFontData.byteLength + fallbackFontData.byteLength,
          materializedEqual,
          materializedFixtureCount: materializedInputs.length,
          typingCompositionEqual,
          materializedLayoutChanges,
          materializedExclusionMarginChanges,
        });
      }
    })().catch((parityError: unknown) => {
      if (!cancelled) {
        setState({
          ready: true,
          equal: false,
          comparisonCount: 0,
          error: parityError instanceof Error ? parityError.message : String(parityError),
          textUnitIrEqual: false,
          textPathIrEqual: false,
          materializedTextUnitIdentity: false,
          flowedTextUnitIdentity: false,
          materializedTextPathIdentity: false,
          poolEqual: false,
          poolLifecycleRecovery: false,
          poolStartupMsOne: 0,
          poolStartupMsDefault: 0,
          poolFontBytes: 0,
          materializedEqual: false,
          materializedFixtureCount: 0,
          typingCompositionEqual: false,
          materializedLayoutChanges: false,
          materializedExclusionMarginChanges: false,
        });
      }
    });

    return () => {
      cancelled = true;
      activePool?.dispose();
      directEngine?.dispose();
    };
  }, [status, workerEngine, vnode]);

  return state;
}

// ---------------------------------------------------------------------------
// App — provider wraps content
// ---------------------------------------------------------------------------

function App() {
  return (
    <BoundSvgProvider config={config} fallback={<div data-testid="status">loading</div>}>
      <WorkerTestContent />
    </BoundSvgProvider>
  );
}

createRoot(getElement("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
