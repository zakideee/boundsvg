import type { IRNode } from "@boundsvg/core";
import {
  Box,
  Canvas,
  type Engine,
  Flex,
  Inline,
  InlineRect,
  Path,
  Text,
  TextOnPath,
  toVNode,
  type VNode,
} from "@boundsvg/react";
import type { TemplateDef } from "./types";

const FONT = "NotoSansJP-woff2";
const MONO_FONT = "JetBrainsMono-woff2";

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

function TimelineCaret() {
  return (
    <InlineRect
      inlineSizePx={2}
      blockSizePx={22}
      advancePx={3}
      blockAlign="center"
      color="#67e8f9"
      borderRadiusPx={1}
      animate={CARET_BLINK}
    />
  );
}

function timelineContent(frame: TimelineFrame, left: number, top: number) {
  const font = frame.mode === "terminal" ? MONO_FONT : FONT;
  return (
    <>
      <Text
        id={`timeline-${frame.mode}-${frame.timeMs}`}
        position="absolute"
        left={left + 12}
        top={top + 18}
        width={188}
        height={68}
        font={font}
        fallback={[FONT]}
        fontSizePx={frame.mode === "terminal" ? 14 : 18}
        lineHeight={1.45}
        whiteSpace="pre-wrap"
        wrap="char"
        color="#e2e8f0"
      >
        {frame.committed}
        {frame.composing ? (
          <Inline
            color="#fef3c7"
            textDecoration={{
              line: "underline",
              color: "#facc15",
              thicknessPx: 2,
            }}
          >
            {frame.composing}
          </Inline>
        ) : null}
        {TimelineCaret()}
      </Text>
      {frame.candidates ? (
        <>
          <Box
            position="absolute"
            left={left + 12}
            top={top + 70}
            width={178}
            height={40}
            background="#f8fafc"
            borderColor="#94a3b8"
            borderWidth={1}
            borderRadius={6}
          />
          <Text
            position="absolute"
            left={left + 20}
            top={top + 78}
            width={162}
            font={FONT}
            fontSizePx={14}
            color="#0f172a"
            wrap="none"
          >
            {frame.candidates
              .map((candidate, index) => `${index === 0 ? "▸" : " "}${candidate}`)
              .join("  ")}
          </Text>
        </>
      ) : null}
    </>
  );
}

function framePreview(frame: TimelineFrame): VNode {
  return toVNode(
    <Canvas width={212} height={116} background="#0b1220">
      {timelineContent(frame, 0, 0)}
    </Canvas>,
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
  if (node.type === "group") {
    for (const child of node.children ?? []) {
      const childStats = collectStats(child);
      lineCount += childStats.lineCount;
      glyphCount += childStats.glyphCount;
    }
  }
  return { lineCount, glyphCount };
}

function measureFrame(engine: Engine, frame: TimelineFrame): FrameStats {
  const { svg, ir } = engine.renderToSvgAndIR(framePreview(frame), {
    animation: "static",
    timeMs: frame.timeMs,
  });
  return {
    ...collectStats(ir.root),
    svgBytes: new TextEncoder().encode(svg).byteLength,
  };
}

function TimelineCard({
  frame,
  stats,
  left,
  top,
}: {
  frame: TimelineFrame;
  stats: FrameStats;
  left: number;
  top: number;
}) {
  const accent = frame.mode === "terminal" ? "#22d3ee" : "#facc15";
  return (
    <>
      <Box
        position="absolute"
        left={left}
        top={top}
        width={216}
        height={188}
        background="#111827"
        borderColor={accent}
        borderWidth={1}
        borderRadius={10}
      />
      <Text
        position="absolute"
        left={left + 12}
        top={top + 8}
        width={192}
        font={MONO_FONT}
        fallback={[FONT]}
        fontSizePx={11}
        color={accent}
        wrap="none"
      >
        {`${frame.mode.toUpperCase()} · t=${frame.timeMs}ms`}
      </Text>
      <Box
        position="absolute"
        left={left + 2}
        top={top + 30}
        width={212}
        height={116}
        background="#0b1220"
        borderRadius={7}
      />
      {timelineContent(frame, left + 2, top + 30)}
      <Text
        position="absolute"
        left={left + 12}
        top={top + 151}
        width={192}
        font={MONO_FONT}
        fontSizePx={10}
        color="#94a3b8"
        wrap="none"
      >
        {`${stats.lineCount} lines · ${stats.glyphCount} glyphs`}
      </Text>
      <Text
        position="absolute"
        left={left + 12}
        top={top + 167}
        width={192}
        font={MONO_FONT}
        fontSizePx={10}
        color="#64748b"
        wrap="none"
      >
        {`${stats.svgBytes} SVG bytes`}
      </Text>
    </>
  );
}

function buildTypingImeTimeline(engine: Engine): VNode {
  const frames = [...TERMINAL_FRAMES, ...IME_FRAMES];
  return toVNode(
    <Canvas width={960} height={520} background="#07111f">
      <Text
        position="absolute"
        left={24}
        top={20}
        width={520}
        font={FONT}
        fontSizePx={22}
        color="#f8fafc"
        wrap="none"
      >
        Terminal / IME Timeline
      </Text>
      <Text
        position="absolute"
        left={24}
        top={50}
        width={820}
        font={FONT}
        fontSizePx={12}
        color="#94a3b8"
        wrap="none"
      >
        Each frame switches authored text state; boundsvg renders committed/composing content
        deterministically.
      </Text>
      {frames.map((frame, index) =>
        TimelineCard({
          frame,
          stats: measureFrame(engine, frame),
          left: 24 + (index % 4) * 228,
          top: index < 4 ? 82 : 306,
        }),
      )}
    </Canvas>,
  );
}

type PathCardDefinition = {
  id: string;
  left: number;
  title: string;
  d: string;
  text: string;
  startOffsetPx: number;
  textAnchor: "start" | "middle" | "end";
  pathNormal: "left" | "right";
  pathOffsetPx: number;
  color: string;
  effects?: boolean;
};

const PATH_CARDS: readonly PathCardDefinition[] = [
  {
    id: "straight",
    left: 24,
    title: "STRAIGHT · LATIN",
    d: "M14 92L266 92",
    text: "START OFFSET",
    startOffsetPx: 28,
    textAnchor: "start",
    pathNormal: "right",
    pathOffsetPx: 8,
    color: "#67e8f9",
  },
  {
    id: "cubic",
    left: 340,
    title: "CUBIC · EFFECTS",
    d: "M14 126C72 28 208 28 266 126",
    text: "CURVED TYPE",
    startOffsetPx: 140,
    textAnchor: "middle",
    pathNormal: "right",
    pathOffsetPx: 5,
    color: "#f8fafc",
    effects: true,
  },
  {
    id: "arc",
    left: 656,
    title: "ARC · 日本語",
    d: "M14 118A126 62 0 0 1 266 118",
    text: "円弧の日本語",
    startOffsetPx: 252,
    textAnchor: "end",
    pathNormal: "left",
    pathOffsetPx: 5,
    color: "#fde68a",
  },
];

function PathCard({ card }: { card: PathCardDefinition }) {
  return (
    <>
      <Box
        position="absolute"
        left={card.left}
        top={70}
        width={280}
        height={226}
        background="#102a43"
        borderColor="#1e3a5f"
        borderWidth={1}
        borderRadius={12}
      />
      <Text
        position="absolute"
        left={card.left + 14}
        top={84}
        width={252}
        font={MONO_FONT}
        fallback={[FONT]}
        fontSizePx={11}
        color="#94a3b8"
        wrap="none"
      >
        {card.title}
      </Text>
      <Path
        id={`path-basics-${card.id}-guide`}
        position="absolute"
        left={card.left}
        top={96}
        d={card.d}
        width={280}
        height={150}
        fill="none"
        stroke="#64748b"
        strokeWidth={1}
        strokeDasharray="5,5"
      />
      <TextOnPath
        id={`path-basics-${card.id}`}
        position="absolute"
        left={card.left}
        top={96}
        d={card.d}
        width={280}
        height={150}
        font={card.id === "straight" ? MONO_FONT : FONT}
        fallback={[FONT]}
        fontSizePx={card.id === "arc" ? 22 : 21}
        color={card.color}
        startOffsetPx={card.startOffsetPx}
        textAnchor={card.textAnchor}
        pathNormal={card.pathNormal}
        pathOffsetPx={card.pathOffsetPx}
        pathOverflow="error"
        textShadows={card.effects ? [{ dx: 3, dy: 4, blurPx: 0, color: "#020617" }] : undefined}
        textStrokes={
          card.effects
            ? [
                { color: "#0e7490", widthPx: 5 },
                { color: "#ffffff", widthPx: 2 },
              ]
            : undefined
        }
      >
        {card.text}
      </TextOnPath>
      <Text
        position="absolute"
        left={card.left + 14}
        top={250}
        width={252}
        font={MONO_FONT}
        fallback={[FONT]}
        fontSizePx={10}
        color="#cbd5e1"
        wrap="none"
      >
        {`offset ${card.startOffsetPx} · anchor ${card.textAnchor}`}
      </Text>
      <Text
        position="absolute"
        left={card.left + 14}
        top={268}
        width={252}
        font={MONO_FONT}
        fontSizePx={10}
        color="#64748b"
        wrap="none"
      >
        {`normal ${card.pathNormal} · pathOffset ${card.pathOffsetPx}`}
      </Text>
    </>
  );
}

function OverflowExample() {
  const d = "M18 94L894 94";
  return (
    <>
      <Box
        position="absolute"
        left={24}
        top={322}
        width={912}
        height={190}
        background="#111827"
        borderColor="#334155"
        borderWidth={1}
        borderRadius={12}
      />
      <Text
        position="absolute"
        left={42}
        top={338}
        width={860}
        font={MONO_FONT}
        fontSizePx={11}
        color="#f97316"
        wrap="none"
      >
        PATH OVERFLOW · hidden omits off-path ink · error throws TEXT_PATH_OVERFLOW
      </Text>
      <Path
        position="absolute"
        left={24}
        top={350}
        d={d}
        width={912}
        height={140}
        fill="none"
        stroke="#64748b"
        strokeWidth={1}
        strokeDasharray="5,5"
      />
      <TextOnPath
        id="path-basics-overflow-hidden"
        position="absolute"
        left={24}
        top={350}
        d={d}
        width={912}
        height={140}
        font={MONO_FONT}
        fallback={[FONT]}
        fontSizePx={25}
        color="#fb923c"
        startOffsetPx={-54}
        textAnchor="start"
        pathOverflow="hidden"
      >
        LEADING GLYPHS ARE HIDDEN BUT LOGICAL TEXT REMAINS
      </TextOnPath>
      <Text
        position="absolute"
        left={42}
        top={478}
        width={860}
        font={FONT}
        fontSizePx={11}
        color="#94a3b8"
        wrap="none"
      >
        The guide path is node-local; the explicit width/height frame does not scale it.
      </Text>
    </>
  );
}

function buildTextOnPathBasics(): VNode {
  return toVNode(
    <Canvas width={960} height={540} background="#071827">
      <Text
        position="absolute"
        left={24}
        top={20}
        width={560}
        font={FONT}
        fontSizePx={22}
        color="#f8fafc"
        wrap="none"
      >
        Text on Path Basics
      </Text>
      <Text
        position="absolute"
        left={24}
        top={48}
        width={820}
        font={FONT}
        fontSizePx={12}
        color="#94a3b8"
        wrap="none"
      >
        Handwritten guides show local path geometry; glyph outlines are shared by SVG and PNG.
      </Text>
      {PATH_CARDS.map((card) => PathCard({ card }))}
      {OverflowExample()}
    </Canvas>,
  );
}

type DecorationV2CardDefinition = {
  left: number;
  style: "dotted" | "dashed" | "wavy";
  color: string;
  text: string;
};

type FitV2CardDefinition = {
  id: string;
  left: number;
  title: string;
  text: string;
  d: string;
  pathFit: "none" | "spacing" | "scale" | "shrink";
  pathOverflow: "error" | "ellipsis";
  color: string;
};

const DECORATION_V2_CARDS: readonly DecorationV2CardDefinition[] = [
  { left: 24, style: "dotted", color: "#67e8f9", text: "gyp 装飾" },
  { left: 336, style: "dashed", color: "#fde68a", text: "gyp 装飾" },
  { left: 648, style: "wavy", color: "#f0abfc", text: "gyp 装飾" },
];

const FIT_V2_CARDS: readonly FitV2CardDefinition[] = [
  {
    id: "spacing",
    left: 24,
    title: "SPACING",
    text: "SPACE",
    d: "M12 76L204 76",
    pathFit: "spacing",
    pathOverflow: "error",
    color: "#67e8f9",
  },
  {
    id: "scale",
    left: 252,
    title: "SCALE",
    text: "SCALE",
    d: "M12 76L204 76",
    pathFit: "scale",
    pathOverflow: "error",
    color: "#a7f3d0",
  },
  {
    id: "shrink",
    left: 480,
    title: "SHRINK",
    text: "SHRINK WHEN NEEDED",
    d: "M12 76L204 76",
    pathFit: "shrink",
    pathOverflow: "error",
    color: "#fde68a",
  },
  {
    id: "ellipsis",
    left: 708,
    title: "ELLIPSIS",
    text: "ELLIPSIS PRESERVES SOURCE",
    d: "M12 76L170 76",
    pathFit: "none",
    pathOverflow: "ellipsis",
    color: "#fb923c",
  },
];

function DecorationV2Card({ card }: { card: DecorationV2CardDefinition }) {
  return (
    <>
      <Box
        position="absolute"
        left={card.left}
        top={78}
        width={288}
        height={172}
        background="#102a43"
        borderColor="#1e3a5f"
        borderWidth={1}
        borderRadius={12}
      />
      <Text
        position="absolute"
        left={card.left + 14}
        top={92}
        width={260}
        font={MONO_FONT}
        fallback={[FONT]}
        fontSizePx={11}
        color={card.color}
        wrap="none"
      >
        {card.style.toUpperCase()}
      </Text>
      <Text
        position="absolute"
        left={card.left + 14}
        top={116}
        width={46}
        font={MONO_FONT}
        fontSizePx={9}
        color="#64748b"
        wrap="none"
      >
        NONE
      </Text>
      <Text
        id={`path-decoration-${card.style}-none`}
        position="absolute"
        left={card.left + 64}
        top={110}
        width={208}
        font={FONT}
        fallback={[MONO_FONT]}
        fontSizePx={22}
        color="#f8fafc"
        wrap="none"
        textDecoration={{
          line: "underline",
          style: card.style,
          color: card.color,
          thicknessPx: 2,
          offsetPx: 2,
          skipInk: "none",
        }}
      >
        {card.text}
      </Text>
      <Text
        position="absolute"
        left={card.left + 14}
        top={184}
        width={46}
        font={MONO_FONT}
        fontSizePx={9}
        color="#94a3b8"
        wrap="none"
      >
        ALL
      </Text>
      <Text
        id={`path-decoration-${card.style}-all`}
        position="absolute"
        left={card.left + 64}
        top={178}
        width={208}
        font={FONT}
        fallback={[MONO_FONT]}
        fontSizePx={22}
        color="#f8fafc"
        wrap="none"
        textDecoration={{
          line: "underline",
          style: card.style,
          color: card.color,
          thicknessPx: 2,
          offsetPx: 2,
          skipInk: "all",
        }}
      >
        {card.text}
      </Text>
    </>
  );
}

function ClosedV2Traversal() {
  const d = "M20 46L408 46L408 130L20 130Z";
  return (
    <>
      <Box
        position="absolute"
        left={24}
        top={270}
        width={440}
        height={192}
        background="#111827"
        borderColor="#334155"
        borderWidth={1}
        borderRadius={12}
      />
      <Text
        position="absolute"
        left={38}
        top={284}
        width={412}
        font={MONO_FONT}
        fontSizePx={11}
        color="#f0abfc"
        wrap="none"
      >
        AUTHORED CLOSED · DIRECTION / SIDE / SEAM
      </Text>
      <Path
        id="closed-path-guide"
        position="absolute"
        left={24}
        top={300}
        d={d}
        width={440}
        height={150}
        fill="none"
        stroke="#64748b"
        strokeWidth={1}
        strokeDasharray="5,5"
      />
      <TextOnPath
        id="closed-path-forward-left"
        position="absolute"
        left={24}
        top={300}
        d={d}
        width={440}
        height={150}
        font={MONO_FONT}
        fallback={[FONT]}
        fontSizePx={16}
        color="#67e8f9"
        startOffsetPx={180}
        textAnchor="start"
        pathDirection="forward"
        pathNormal="left"
        pathOffsetPx={8}
        pathOverflow="error"
      >
        FORWARD · LEFT
      </TextOnPath>
      <TextOnPath
        id="closed-path-reverse-right-seam"
        position="absolute"
        left={24}
        top={300}
        d={d}
        width={440}
        height={150}
        font={MONO_FONT}
        fallback={[FONT]}
        fontSizePx={16}
        color="#fde68a"
        // Places the seam between words so "SEAM" alone turns the corner;
        // a larger offset splits "RIGHT" across the 90 degree seam.
        startOffsetPx={880}
        textAnchor="middle"
        pathDirection="reverse"
        pathNormal="right"
        pathOffsetPx={8}
        pathOverflow="error"
      >
        REVERSE · RIGHT · SEAM
      </TextOnPath>
    </>
  );
}

function V2CapabilityBoundary() {
  const rows = [
    ["✓", "plain string TextOnPath"],
    ["✓", "authored closed path + fitting"],
    ["→", "Rich Text on Path: Inline + curved decoration"],
    ["—", "InlineBox · Ruby · vertical · bidi · native morph"],
  ] as const;

  return (
    <>
      <Box
        position="absolute"
        left={480}
        top={270}
        width={456}
        height={192}
        background="#111827"
        borderColor="#334155"
        borderWidth={1}
        borderRadius={12}
      />
      <Text
        position="absolute"
        left={494}
        top={284}
        width={428}
        font={MONO_FONT}
        fontSizePx={11}
        color="#fb923c"
        wrap="none"
      >
        CAPABILITY BOUNDARY
      </Text>
      {rows.flatMap(([badge, text], index) => [
        <Text
          key={`badge-${badge}-${index}`}
          position="absolute"
          left={498}
          top={316 + index * 32}
          width={32}
          font={MONO_FONT}
          fallback={[FONT]}
          fontSizePx={12}
          color={index < 2 ? "#67e8f9" : index === 2 ? "#facc15" : "#64748b"}
          wrap="none"
        >
          {badge}
        </Text>,
        <Text
          key={`boundary-${index}`}
          position="absolute"
          left={536}
          top={314 + index * 32}
          width={378}
          font={FONT}
          fallback={[MONO_FONT]}
          fontSizePx={13}
          color={index === 3 ? "#64748b" : "#cbd5e1"}
          wrap="none"
        >
          {text}
        </Text>,
      ])}
    </>
  );
}

function FitV2Card({ card }: { card: FitV2CardDefinition }) {
  return (
    <>
      <Box
        position="absolute"
        left={card.left}
        top={484}
        width={216}
        height={190}
        background="#102a43"
        borderColor="#1e3a5f"
        borderWidth={1}
        borderRadius={12}
      />
      <Text
        position="absolute"
        left={card.left + 12}
        top={498}
        width={192}
        font={MONO_FONT}
        fontSizePx={11}
        color={card.color}
        wrap="none"
      >
        {card.title}
      </Text>
      <Path
        id={`path-fit-${card.id}-guide`}
        position="absolute"
        left={card.left}
        top={516}
        d={card.d}
        width={216}
        height={112}
        fill="none"
        stroke="#64748b"
        strokeWidth={1}
        strokeDasharray="4,4"
      />
      <TextOnPath
        id={`path-fit-${card.id}`}
        position="absolute"
        left={card.left}
        top={516}
        d={card.d}
        width={216}
        height={112}
        font={MONO_FONT}
        fallback={[FONT]}
        fontSizePx={card.id === "shrink" || card.id === "ellipsis" ? 20 : 17}
        color={card.color}
        startOffsetPx={0}
        textAnchor="start"
        pathNormal="right"
        pathOffsetPx={4}
        pathFit={card.pathFit}
        pathOverflow={card.pathOverflow}
      >
        {card.text}
      </TextOnPath>
      <Text
        position="absolute"
        left={card.left + 12}
        top={640}
        width={192}
        font={MONO_FONT}
        fontSizePx={9}
        color="#94a3b8"
        wrap="none"
      >
        {card.pathOverflow === "ellipsis"
          ? "display truncates · source stays"
          : `pathFit ${card.pathFit}`}
      </Text>
    </>
  );
}

function buildTextMotionV2(): VNode {
  return toVNode(
    <Canvas width={960} height={710} background="#071827">
      <Text
        position="absolute"
        left={24}
        top={20}
        width={560}
        font={FONT}
        fontSizePx={22}
        color="#f8fafc"
        wrap="none"
      >
        Decoration & Path Fit
      </Text>
      <Text
        position="absolute"
        left={24}
        top={48}
        width={900}
        font={FONT}
        fontSizePx={12}
        color="#94a3b8"
        wrap="none"
      >
        Resolved decoration geometry and deterministic plain-text path traversal share SVG / PNG
        output.
      </Text>
      {DECORATION_V2_CARDS.map((card) => DecorationV2Card({ card }))}
      {ClosedV2Traversal()}
      {V2CapabilityBoundary()}
      {FIT_V2_CARDS.map((card) => FitV2Card({ card }))}
      <Text
        position="absolute"
        left={24}
        top={686}
        width={912}
        font={MONO_FONT}
        fallback={[FONT]}
        fontSizePx={9}
        color="#64748b"
        wrap="none"
      >
        Rich Text on Path adds Inline and curved decoration; InlineBox, Ruby, vertical, bidi, and
        native path morph stay unsupported.
      </Text>
    </Canvas>,
  );
}

type V3A2FrameDefinition = {
  id: string;
  label: string;
  left: number;
  d: string;
  startOffsetPx: number;
  direction: "forward" | "reverse";
  normal: "left" | "right";
  fit: "none" | "spacing" | "shrink";
  color: string;
  prefix: string;
  accent: string;
  suffix: string;
  monoAccent: boolean;
};

const V3_UNIT_ANIMATION = {
  by: "cluster",
  animation: {
    keyframes: [
      { at: 0, opacity: 0.35, transform: { translateY: 7, scaleX: 0.92, scaleY: 0.92 } },
      { at: 1, opacity: 1, transform: { translateY: 0, scaleX: 1, scaleY: 1 } },
    ],
    durationMs: 520,
    easing: "ease-out",
    fill: "both",
  },
  delayStepMs: 22,
  order: "logical",
} as const;

const V3_IDENTITY_TEXT = "Shaping fidelity 日本語";

const V3_A2_FRAMES: readonly V3A2FrameDefinition[] = [
  {
    id: "0",
    label: "MATERIALIZED · CONTENT",
    left: 40,
    d: "M12 92L260 92",
    startOffsetPx: 124,
    direction: "forward",
    normal: "left",
    fit: "none",
    color: "#67e8f9",
    prefix: "RICH ",
    accent: "STATE",
    suffix: "",
    monoAccent: false,
  },
  {
    id: "1",
    label: "MATERIALIZED · STYLE / D",
    left: 344,
    d: "M12 112C70 20 202 20 260 112",
    startOffsetPx: 144,
    direction: "forward",
    normal: "left",
    fit: "spacing",
    color: "#a7f3d0",
    prefix: "",
    accent: "PATH",
    suffix: " 状態",
    monoAccent: true,
  },
  {
    id: "2",
    label: "MATERIALIZED · DIRECTION / FIT",
    left: 648,
    d: "M260 104A124 70 0 0 0 12 104",
    startOffsetPx: 176,
    direction: "reverse",
    normal: "right",
    fit: "shrink",
    color: "#fb923c",
    prefix: "REVERSE ",
    accent: "縮小 FRAME",
    suffix: "",
    monoAccent: false,
  },
];

function V3Label({
  text,
  left,
  top,
  width,
  color,
}: {
  text: string;
  left: number;
  top: number;
  width: number;
  color: string;
}) {
  return (
    <Text
      position="absolute"
      left={left}
      top={top}
      width={width}
      font={MONO_FONT}
      fallback={[FONT]}
      fontSizePx={10}
      color={color}
      wrap="none"
    >
      {text}
    </Text>
  );
}

function V3IdentityCard() {
  const d = "M12 82C92 18 308 18 388 82";
  const common = {
    position: "absolute" as const,
    top: 116,
    width: 400,
    height: 108,
    d,
    font: FONT,
    fallback: [MONO_FONT],
    fontSizePx: 22,
    color: "#e2e8f0",
    startOffsetPx: 200,
    textAnchor: "middle" as const,
    pathOverflow: "error" as const,
    animateUnits: V3_UNIT_ANIMATION,
  };

  return (
    <>
      <Box
        position="absolute"
        left={24}
        top={82}
        width={976}
        height={152}
        background="#111827"
        borderColor="#334155"
        borderWidth={1}
        borderRadius={12}
      />
      {V3Label({ text: "PLAIN STRING", left: 40, top: 96, width: 400, color: "#67e8f9" })}
      {V3Label({
        text: "SINGLE INLINE · SAME SHAPING / UNITMAP",
        left: 496,
        top: 96,
        width: 420,
        color: "#f0abfc",
      })}
      <Path
        position="absolute"
        left={40}
        top={116}
        width={400}
        height={108}
        d={d}
        fill="none"
        stroke="#475569"
        strokeWidth={1}
        strokeDasharray="4,4"
      />
      <TextOnPath id="path-identity-plain" left={40} {...common}>
        {V3_IDENTITY_TEXT}
      </TextOnPath>
      <Path
        position="absolute"
        left={496}
        top={116}
        width={400}
        height={108}
        d={d}
        fill="none"
        stroke="#475569"
        strokeWidth={1}
        strokeDasharray="4,4"
      />
      <TextOnPath id="path-identity-inline" left={496} {...common}>
        <Inline>{V3_IDENTITY_TEXT}</Inline>
      </TextOnPath>
    </>
  );
}

function V3RichPaintCard() {
  const d = "M16 158C88 34 350 34 422 158";
  return (
    <>
      <Box
        position="absolute"
        left={24}
        top={252}
        width={440}
        height={214}
        background="#102a43"
        borderColor="#1e3a5f"
        borderWidth={1}
        borderRadius={12}
      />
      {V3Label({
        text: "MIXED FONT · COLOR · EFFECT LAYERS",
        left: 40,
        top: 268,
        width: 408,
        color: "#67e8f9",
      })}
      <Path
        position="absolute"
        left={24}
        top={286}
        width={440}
        height={170}
        d={d}
        fill="none"
        stroke="#475569"
        strokeWidth={1}
        strokeDasharray="5,5"
      />
      <TextOnPath
        id="rich-path-mixed"
        position="absolute"
        left={24}
        top={286}
        width={440}
        height={170}
        d={d}
        font={FONT}
        fallback={[MONO_FONT]}
        fontSizePx={24}
        color="#e2e8f0"
        startOffsetPx={220}
        textAnchor="middle"
        pathOverflow="error"
        textShadows={[{ dx: 2, dy: 2, blurPx: 0, color: "#020617" }]}
      >
        Rich{" "}
        <Inline font={MONO_FONT} color="#fde68a" textStrokes={[{ color: "#92400e", widthPx: 2 }]}>
          PATH
        </Inline>
        <Inline color="#f0abfc"> 日本語</Inline>
      </TextOnPath>
      {V3Label({
        text: "one logical text · layer-first paint",
        left: 40,
        top: 438,
        width: 408,
        color: "#94a3b8",
      })}
    </>
  );
}

function V3CurvedDecorationCard() {
  // `scale` fits the whole cluster sequence to the full path length, so the text
  // must be long enough to keep the inline scale near 1. Short text on a
  // card-sized closed path would demand a double-digit scale, which blows the
  // glyphs out of the card and makes curved skip-ink cost hundreds of ms.
  const d = "M30 120C120 44 380 44 470 120L470 26L30 26Z";
  return (
    <>
      <Box
        position="absolute"
        left={480}
        top={252}
        width={536}
        height={214}
        background="#111827"
        borderColor="#334155"
        borderWidth={1}
        borderRadius={12}
      />
      {V3Label({
        text: "CLOSED · REVERSE / RIGHT · SCALE · SKIP INK",
        left: 496,
        top: 268,
        width: 424,
        color: "#fb923c",
      })}
      <Path
        position="absolute"
        left={494}
        top={292}
        width={512}
        height={150}
        d={d}
        fill="none"
        stroke="#475569"
        strokeWidth={1}
        strokeDasharray="5,5"
      />
      <TextOnPath
        id="rich-path-decorated-closed"
        position="absolute"
        left={494}
        top={292}
        width={512}
        height={150}
        d={d}
        font={FONT}
        fallback={[MONO_FONT]}
        fontSizePx={28}
        color="#67e8f9"
        startOffsetPx={260}
        textAnchor="middle"
        pathDirection="reverse"
        pathNormal="right"
        pathOffsetPx={5}
        pathFit="scale"
        pathOverflow="error"
        textDecoration={{
          line: "underline",
          style: "dashed",
          skipInk: "all",
          color: "#67e8f9",
          thicknessPx: 2,
          offsetPx: -9,
        }}
      >
        CLOSED REVERSE RIGHT NORMAL{" "}
        <Inline
          fontWeight={700}
          fontSizePx={36}
          color="#f0abfc"
          textStrokes={[{ color: "#9f1239", widthPx: 2 }]}
          textShadows={[{ dx: 1, dy: 2, blurPx: 0, color: "#4c0519" }]}
          textDecoration={{
            line: "underline",
            style: "wavy",
            skipInk: "all",
            color: "#f0abfc",
            thicknessPx: 2,
            offsetPx: -11,
          }}
        >
          曲線
        </Inline>
        <Inline color="#fde68a" textDecoration="none">
          {" SCALE FIT SKIP INK PATH Z"}
        </Inline>
      </TextOnPath>
      {V3Label({
        text: "decoration owns path-distance phase",
        left: 496,
        top: 438,
        width: 424,
        color: "#94a3b8",
      })}
    </>
  );
}

function V3A2Frame({ frame }: { frame: V3A2FrameDefinition }) {
  return (
    <>
      <Box
        position="absolute"
        left={frame.left}
        top={520}
        width={272}
        height={164}
        background="#0f2942"
        borderColor="#1e3a5f"
        borderWidth={1}
        borderRadius={10}
      />
      {V3Label({
        text: frame.label,
        left: frame.left + 12,
        top: 534,
        width: 248,
        color: frame.color,
      })}
      <Path
        position="absolute"
        left={frame.left}
        top={552}
        width={272}
        height={124}
        d={frame.d}
        fill="none"
        stroke="#475569"
        strokeWidth={1}
        strokeDasharray="4,4"
      />
      <TextOnPath
        id={`materialized-path-frame-${frame.id}`}
        position="absolute"
        left={frame.left}
        top={552}
        width={272}
        height={124}
        d={frame.d}
        font={FONT}
        fallback={[MONO_FONT]}
        fontSizePx={17}
        color={frame.color}
        startOffsetPx={frame.startOffsetPx}
        textAnchor="middle"
        pathDirection={frame.direction}
        pathNormal={frame.normal}
        pathFit={frame.fit}
        pathOverflow="error"
        animateUnits={V3_UNIT_ANIMATION}
      >
        {frame.prefix}
        <Inline
          font={frame.monoAccent ? MONO_FONT : undefined}
          color={frame.id === "1" ? "#f0abfc" : "#fde68a"}
        >
          {frame.accent}
        </Inline>
        {frame.suffix}
      </TextOnPath>
    </>
  );
}

function buildTextMotionV3(): VNode {
  return toVNode(
    <Canvas width={1024} height={740} background="#071827">
      <Text
        position="absolute"
        left={24}
        top={20}
        width={700}
        font={FONT}
        fallback={[MONO_FONT]}
        fontSizePx={22}
        color="#f8fafc"
        wrap="none"
      >
        Rich Text on Path
      </Text>
      <Text
        position="absolute"
        left={24}
        top={50}
        width={976}
        font={FONT}
        fallback={[MONO_FONT]}
        fontSizePx={12}
        color="#94a3b8"
        wrap="none"
      >
        Inline shaping, paint ranges, curved decoration, UnitMap animation, and materialized states.
      </Text>
      {V3IdentityCard()}
      {V3RichPaintCard()}
      {V3CurvedDecorationCard()}
      {V3Label({
        text: "POST-LAYOUT UNIT PAINT INSIDE EACH MATERIALIZED FRAME",
        left: 40,
        top: 494,
        width: 880,
        color: "#a7f3d0",
      })}
      {V3_A2_FRAMES.map((frame) => V3A2Frame({ frame }))}
      <Text
        position="absolute"
        left={24}
        top={708}
        width={976}
        font={MONO_FONT}
        fallback={[FONT]}
        fontSizePx={9}
        color="#64748b"
        wrap="none"
      >
        Unsupported on path: InlineBox · InlineRect · Ruby · vertical · bidi · native path morph.
        Materialized scenes rebuild content/style/d/fit.
      </Text>
    </Canvas>,
  );
}

type MotionFrame = {
  timeMs: number;
  d: string;
  startOffsetPx: number;
  label: string;
  color: string;
};

const UNIT_ANIMATION = {
  by: "cluster",
  animation: {
    keyframes: [
      { at: 0, opacity: 0.3, transform: { translateY: 8, scaleX: 0.9, scaleY: 0.9 } },
      { at: 1, opacity: 1, transform: { translateY: 0, scaleX: 1, scaleY: 1 } },
    ],
    durationMs: 500,
    easing: "ease-out",
    fill: "both",
  },
  delayStepMs: 18,
  order: "logical",
} as const;

const MOTION_FRAMES: readonly MotionFrame[] = [
  {
    timeMs: 0,
    d: "M16 110L264 110",
    startOffsetPx: 76,
    label: "straight",
    color: "#67e8f9",
  },
  {
    timeMs: 400,
    d: "M16 146C70 24 210 24 264 146",
    startOffsetPx: 142,
    label: "cubic",
    color: "#fde68a",
  },
  {
    timeMs: 800,
    d: "M264 120A124 68 0 0 0 16 120",
    startOffsetPx: 194,
    label: "reverse arc",
    color: "#a5f3fc",
  },
];

function MotionContent({
  frame,
  left,
  top,
  nodeId,
}: {
  frame: MotionFrame;
  left: number;
  top: number;
  nodeId: string;
}) {
  return (
    <>
      <Path
        id={`${nodeId}-guide`}
        position="absolute"
        left={left}
        top={top}
        d={frame.d}
        width={280}
        height={180}
        fill="none"
        stroke="#64748b"
        strokeWidth={1}
        strokeDasharray="5,5"
      />
      <TextOnPath
        id={nodeId}
        position="absolute"
        left={left}
        top={top}
        d={frame.d}
        width={280}
        height={180}
        font={FONT}
        fallback={[MONO_FONT]}
        fontSizePx={23}
        color={frame.color}
        startOffsetPx={frame.startOffsetPx}
        textAnchor="middle"
        pathNormal="right"
        pathOffsetPx={4}
        pathOverflow="error"
        textStroke="#0f172a"
        textStrokeWidth={2}
        animateUnits={UNIT_ANIMATION}
      >
        字幕 Motion
      </TextOnPath>
    </>
  );
}

function motionPreview(frame: MotionFrame): VNode {
  return toVNode(
    <Canvas width={280} height={180} background="#102a43">
      {MotionContent({ frame, left: 0, top: 0, nodeId: "materialized-path" })}
    </Canvas>,
  );
}

function measureMotionSvgBytes(engine: Engine, frame: MotionFrame): number {
  const svg = engine.renderToSvg(motionPreview(frame), {
    animation: "static",
    timeMs: frame.timeMs,
  });
  return new TextEncoder().encode(svg).byteLength;
}

function MotionCard({
  frame,
  svgBytes,
  left,
  index,
}: {
  frame: MotionFrame;
  svgBytes: number;
  left: number;
  index: number;
}) {
  return (
    <>
      <Box
        position="absolute"
        left={left}
        top={88}
        width={280}
        height={238}
        background="#102a43"
        borderColor="#1e3a5f"
        borderWidth={1}
        borderRadius={12}
      />
      <Text
        position="absolute"
        left={left + 14}
        top={102}
        width={252}
        font={MONO_FONT}
        fallback={[FONT]}
        fontSizePx={11}
        color={frame.color}
        wrap="none"
      >
        {`FRAME ${index + 1} · t=${frame.timeMs}ms · ${frame.label}`}
      </Text>
      {MotionContent({ frame, left, top: 116, nodeId: `materialized-path-frame-${index}` })}
      <Text
        position="absolute"
        left={left + 14}
        top={286}
        width={252}
        font={MONO_FONT}
        fontSizePx={10}
        color="#cbd5e1"
        wrap="none"
      >
        {`startOffset ${frame.startOffsetPx} · ${svgBytes} SVG bytes`}
      </Text>
      <Text
        position="absolute"
        left={left + 14}
        top={304}
        width={252}
        font={FONT}
        fontSizePx={10}
        color="#64748b"
        wrap="none"
      >
        geometry baked before render
      </Text>
    </>
  );
}

function buildTextPathMotion(engine: Engine): VNode {
  return toVNode(
    <Canvas width={960} height={360} background="#071827">
      {/* A Flex centers the label instead of hand-placed offsets, so the text
          stays inside the chip against the backdrop. */}
      <Flex
        position="absolute"
        left={24}
        top={20}
        width={90}
        height={28}
        justifyContent="center"
        alignItems="center"
        background="#f97316"
        borderRadius={14}
      >
        <Text font={MONO_FONT} fontSizePx={10} color="#071827" wrap="none">
          MATERIALIZED
        </Text>
      </Flex>
      <Text
        position="absolute"
        left={118}
        top={20}
        width={420}
        font={FONT}
        fontSizePx={22}
        color="#f8fafc"
        wrap="none"
      >
        Text Path Motion
      </Text>
      <Text
        position="absolute"
        left={24}
        top={56}
        width={900}
        font={FONT}
        fontSizePx={12}
        color="#94a3b8"
        wrap="none"
      >
        Downstream state materializes d/startOffsetPx per frame; this is not a native layout
        animation channel.
      </Text>
      {MOTION_FRAMES.map((frame, index) =>
        MotionCard({
          frame,
          svgBytes: measureMotionSvgBytes(engine, frame),
          left: 24 + index * 316,
          index,
        }),
      )}
    </Canvas>,
  );
}

export const TEXT_MOTION_TEMPLATE_DEFINITIONS = {
  "typing-ime-timeline": {
    title: "Terminal / IME Timeline",
    description:
      "Authored terminal and Japanese IME states with composition underline, a step-blinking InlineRect caret, candidate UI, and per-frame render diagnostics.",
    build: buildTypingImeTimeline,
  },
  "text-on-path-basics": {
    title: "Text on Path Basics",
    description:
      "Straight, cubic, arc, Latin, Japanese, effects, anchor/offset/normal offset, and hidden/error overflow semantics using handwritten local guide paths.",
    vnode: buildTextOnPathBasics(),
  },
  "decoration-path-fit": {
    title: "Decoration & Path Fit",
    description:
      "Dotted, dashed, and wavy skip-ink geometry plus closed reverse/right traversal, spacing/scale/shrink, ellipsis source identity, and explicit capability boundaries.",
    licenseNotice:
      "Fonts: Noto Sans JP and JetBrains Mono (SIL Open Font License 1.1). No third-party SVG assets.",
    vnode: buildTextMotionV2(),
  },
  "rich-text-on-path": {
    title: "Rich Text on Path",
    description:
      "Plain/single-Inline identity, mixed font and paint ranges, curved skip-ink decoration, closed fitting, decoration-free unit animation, and downstream-materialized checkpoints.",
    licenseNotice:
      "Fonts: Noto Sans JP and JetBrains Mono (SIL Open Font License 1.1). No third-party SVG assets.",
    vnode: buildTextMotionV3(),
  },
  "text-path-motion": {
    title: "Materialized Text Path Motion",
    description:
      "Three downstream-materialized frames change d and startOffsetPx before rendering. The MATERIALIZED badge distinguishes state reconstruction from native opacity/transform animation.",
    build: buildTextPathMotion,
  },
} satisfies Record<string, TemplateDef>;
