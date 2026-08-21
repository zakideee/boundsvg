import {
  Box,
  Canvas,
  type Engine,
  Inline,
  InlineRect,
  type IRNode,
  Text,
  type VNode,
} from "@boundsvg/core";
import { FONT_ALIAS as FA, JETBRAINS_ALIAS } from "../config";
import type { Preset } from "../types";

type TimelineFrame = {
  mode: "terminal" | "ime";
  timeMs: number;
  committed: string;
  composing: string;
  candidates?: readonly string[];
};

type FrameStats = {
  lineCount: number;
  glyphCount: number;
  svgBytes: number;
};

const CARET_BLINK = {
  keyframes: [
    { at: 0, opacity: 1 },
    { at: 1, opacity: 0 },
  ],
  durationMs: 560,
  easing: { type: "steps", count: 2, position: "jump-none" },
  iterations: "infinite",
  fill: "both",
} as const;

const TERMINAL_FRAMES: readonly TimelineFrame[] = [
  { mode: "terminal", timeMs: 0, committed: "$ ", composing: "" },
  { mode: "terminal", timeMs: 240, committed: "$ pnpm", composing: "" },
  {
    mode: "terminal",
    timeMs: 480,
    committed: "$ pnpm test --filter @boundsvg/core",
    composing: "",
  },
  {
    mode: "terminal",
    timeMs: 720,
    committed: "$ pnpm test\nPASS 24 tests",
    composing: "",
  },
];

const IME_FRAMES: readonly TimelineFrame[] = [
  { mode: "ime", timeMs: 0, committed: "入力: ", composing: "" },
  { mode: "ime", timeMs: 240, committed: "入力: ", composing: "きょう" },
  {
    mode: "ime",
    timeMs: 480,
    committed: "入力: ",
    composing: "今日",
    candidates: ["今日", "教", "京"],
  },
  { mode: "ime", timeMs: 720, committed: "入力: 今日", composing: "" },
];

function caret(): VNode {
  return InlineRect({
    inlineSizePx: 2,
    blockSizePx: 22,
    advancePx: 3,
    blockAlign: "center",
    color: "#67e8f9",
    borderRadiusPx: 1,
    animate: CARET_BLINK,
  });
}

function timelineContent(frame: TimelineFrame, left: number, top: number): VNode[] {
  const font = frame.mode === "terminal" ? JETBRAINS_ALIAS : FA;
  const children: VNode[] = [
    Text(
      {
        id: `timeline-${frame.mode}-${frame.timeMs}`,
        position: "absolute",
        left: left + 12,
        top: top + 18,
        width: 188,
        height: 68,
        font,
        fallback: [FA],
        fontSizePx: frame.mode === "terminal" ? 14 : 18,
        lineHeight: 1.45,
        whiteSpace: "pre-wrap",
        wrap: "char",
        color: "#e2e8f0",
      },
      frame.committed,
      frame.composing
        ? Inline(
            {
              color: "#fef3c7",
              textDecoration: {
                line: "underline",
                color: "#facc15",
                thicknessPx: 2,
              },
            },
            frame.composing,
          )
        : "",
      caret(),
    ),
  ];

  if (frame.candidates) {
    children.push(
      Box({
        position: "absolute",
        left: left + 12,
        top: top + 70,
        width: 178,
        height: 40,
        background: "#f8fafc",
        borderColor: "#94a3b8",
        borderWidth: 1,
        borderRadius: 6,
      }),
      Text(
        {
          position: "absolute",
          left: left + 20,
          top: top + 78,
          width: 162,
          font: FA,
          fontSizePx: 14,
          color: "#0f172a",
          wrap: "none",
        },
        frame.candidates
          .map((candidate, index) => `${index === 0 ? "▸" : " "}${candidate}`)
          .join("  "),
      ),
    );
  }
  return children;
}

function framePreview(frame: TimelineFrame): VNode {
  return Canvas(
    { width: 212, height: 116, background: "#0b1220" },
    ...timelineContent(frame, 0, 0),
  );
}

function collectStats(node: IRNode): Omit<FrameStats, "svgBytes"> {
  let lineCount = 0;
  let glyphCount = 0;
  if (node.type === "text") {
    lineCount += node.lines.length;
    glyphCount += node.lines.reduce(
      (count, line) => count + (line.positionedGlyphs?.length ?? line.glyphs.length),
      0,
    );
  }
  for (const child of node.children ?? []) {
    const childStats = collectStats(child);
    lineCount += childStats.lineCount;
    glyphCount += childStats.glyphCount;
  }
  return { lineCount, glyphCount };
}

function measureFrame(engine: Engine | undefined, frame: TimelineFrame): FrameStats {
  if (!engine) {
    return { lineCount: 0, glyphCount: 0, svgBytes: 0 };
  }
  const { svg, ir } = engine.renderToSvgAndIR(framePreview(frame), {
    animation: "static",
    timeMs: frame.timeMs,
  });
  return {
    ...collectStats(ir.root),
    svgBytes: new TextEncoder().encode(svg).byteLength,
  };
}

function timelineCard(frame: TimelineFrame, stats: FrameStats, left: number, top: number): VNode[] {
  const accent = frame.mode === "terminal" ? "#22d3ee" : "#facc15";
  return [
    Box({
      position: "absolute",
      left,
      top,
      width: 216,
      height: 188,
      background: "#111827",
      borderColor: accent,
      borderWidth: 1,
      borderRadius: 10,
    }),
    Text(
      {
        position: "absolute",
        left: left + 12,
        top: top + 8,
        width: 192,
        font: JETBRAINS_ALIAS,
        fallback: [FA],
        fontSizePx: 11,
        color: accent,
        wrap: "none",
      },
      `${frame.mode.toUpperCase()} · t=${frame.timeMs}ms`,
    ),
    Box({
      position: "absolute",
      left: left + 2,
      top: top + 30,
      width: 212,
      height: 116,
      background: "#0b1220",
      borderRadius: 7,
    }),
    ...timelineContent(frame, left + 2, top + 30),
    Text(
      {
        position: "absolute",
        left: left + 12,
        top: top + 151,
        width: 192,
        font: JETBRAINS_ALIAS,
        fontSizePx: 10,
        color: "#94a3b8",
        wrap: "none",
      },
      `${stats.lineCount} lines · ${stats.glyphCount} glyphs`,
    ),
    Text(
      {
        position: "absolute",
        left: left + 12,
        top: top + 167,
        width: 192,
        font: JETBRAINS_ALIAS,
        fontSizePx: 10,
        color: "#64748b",
        wrap: "none",
      },
      `${stats.svgBytes} SVG bytes`,
    ),
  ];
}

function buildTimeline(engine?: Engine): VNode {
  const frames = [...TERMINAL_FRAMES, ...IME_FRAMES];
  const cards = frames.flatMap((frame, index) =>
    timelineCard(frame, measureFrame(engine, frame), 24 + (index % 4) * 228, index < 4 ? 82 : 306),
  );
  return Canvas(
    { width: 960, height: 520, background: "#07111f" },
    Text(
      {
        position: "absolute",
        left: 24,
        top: 20,
        width: 520,
        font: FA,
        fontSizePx: 22,
        color: "#f8fafc",
        wrap: "none",
      },
      "Terminal / IME Timeline",
    ),
    Text(
      {
        position: "absolute",
        left: 24,
        top: 50,
        width: 820,
        font: FA,
        fontSizePx: 12,
        color: "#94a3b8",
        wrap: "none",
      },
      "Each frame switches authored text state; boundsvg renders committed/composing content deterministically.",
    ),
    ...cards,
  );
}

export const typingImeTimelinePreset: Preset = {
  // Two full 560 ms caret-blink cycles, so the animated loop has no seam.
  animationDurationMs: 1120,
  title: "Terminal / IME Timeline",
  description:
    "Authored terminal and Japanese IME states with composition underline, a step-blinking InlineRect caret, candidate UI, and per-frame render diagnostics.",
  source: `import { Canvas, Inline, InlineRect, Text } from "@boundsvg/core";

// Toggle the authored state between terminal and IME snapshots.
const mode = "ime";
const frameTimeMs = 480;
const vnode = Canvas(
  { width: 420, height: 140, background: "#0b1220" },
  Text(
    { font: "${FA}", fontSizePx: 22, width: 380, whiteSpace: "pre-wrap" },
    mode === "ime" ? "入力: " : "$ pnpm test",
    mode === "ime"
      ? Inline({ textDecoration: { line: "underline", color: "#facc15", thicknessPx: 2 } }, "今日")
      : "",
    InlineRect({
      inlineSizePx: 2, blockSizePx: 22, advancePx: 3, color: "#67e8f9",
      animate: {
        keyframes: [{ at: 0, opacity: 1 }, { at: 1, opacity: 0 }],
        durationMs: 560,
        easing: { type: "steps", count: 2, position: "jump-none" },
        iterations: "infinite",
      },
    }),
  ),
);

const { svg, ir } = engine.renderToSvgAndIR(vnode, {
  animation: "static",
  timeMs: frameTimeMs,
});
const svgBytes = new TextEncoder().encode(svg).byteLength;
console.log({ frameTimeMs, lines: ir.root, svgBytes });`,
  build: (engine) => buildTimeline(engine),
};
