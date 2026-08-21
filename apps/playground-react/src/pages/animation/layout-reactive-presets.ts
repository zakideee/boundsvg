import {
  Box,
  Canvas,
  Flex,
  Inline,
  InlineRect,
  Path,
  Text,
  type TextFlowExclusion,
  TextOnPath,
  type TextUnitAnimation,
  type VNode,
} from "@boundsvg/core";
import {
  DEFAULT_LAYOUT_REACTIVE_PLAYGROUND_CONTROLS,
  type LayoutReactivePlaygroundControls,
} from "../../../../playground-shared/animation-playground.js";

const FONT = "NotoSansJP-woff2";
const MONO_FONT = "JetBrainsMono-woff2";
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 360;
const GROWING_MIN_WIDTH = 224;
const GROWING_MAX_WIDTH = 432;
const GROWING_MIN_HEIGHT = 220;
const GROWING_MAX_HEIGHT = 260;
const FLOW_FONT_SIZE_PX = 21;
const FLOW_LINE_HEIGHT = 1.38;
const FLOW_FRAME = { left: 42, top: 54, width: 556, height: 268 } as const;
const FLOW_TEXT =
  "移動する二つの障害物を避けながら文章を配置します。形状の位置を各時刻の静的sceneへ焼き込むと、行と断片は通常のレイアウトとして再計算されます。縦組みでも同じ境界を保ちます。";

const MOVING_EXCLUSION_TEXT_NODE_ID = "moving-exclusion-copy";
const TERMINAL_ANIMATION_TEXT_NODE_ID = "terminal-animation-copy";
const TEXT_PATH_ANIMATION_TEXT_NODE_ID = "text-path-animation-copy";
/** The wipe cover whose leading edge carries the declarative terminal caret. */
const TERMINAL_DECLARATIVE_COVER_ID = "terminal-declarative-cover";
const TERMINAL_DECLARATIVE_CARET_ID = "terminal-declarative-caret";

export type LayoutReactivePresetKey =
  | "growing-box"
  | "moving-exclusion"
  | "terminal-typing"
  | "text-path-motion";

type GrowingBoxValues = {
  kind: "growing-box";
  progress: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
};

type MovingExclusionValues = {
  kind: "moving-exclusion";
  progress: number;
  rectX: number;
  rectY: number;
  circleCx: number;
  circleCy: number;
};

/** One colored run of terminal output; segments concatenate into a single line box. */
type TerminalOutputSegment = {
  text: string;
  color: string;
};

type TerminalTypingValues = {
  kind: "terminal-typing";
  progress: number;
  frameIndex: number;
  command: string;
  output: string;
  outputSegments: readonly TerminalOutputSegment[];
  status: string;
  /** Empty once the run finishes. */
  spinnerFrame: string;
  runProgress: number;
};

type TextPathMotionValues = {
  kind: "text-path-motion";
  progress: number;
  d: string;
  startOffsetPx: number;
  controlY: number;
};

export type LayoutReactiveValues =
  | GrowingBoxValues
  | MovingExclusionValues
  | TerminalTypingValues
  | TextPathMotionValues;

export type LayoutReactiveFrame = {
  rigidScene: VNode;
  materializedScene: VNode;
  values: LayoutReactiveValues;
};

type LayoutReactiveFrameGenerator = (timeMs: number) => LayoutReactiveFrame;

type LayoutReactivePreset = {
  label: string;
  description: string;
  posterTimeMs: number;
  defaultControls: LayoutReactivePlaygroundControls;
  supportsTextControls: boolean;
  /**
   * How the comparison panel is emitted. `declarative` means its scene is a
   * single self-animating SVG that is rendered once, so playback must not
   * rewrite it per tick or the CSS animations restart every frame.
   */
  rigidAnimation: "static" | "declarative";
  textNodeId?: string;
  createFrameGenerator: (
    controls: LayoutReactivePlaygroundControls,
  ) => LayoutReactiveFrameGenerator;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function roundedInterpolation(start: number, end: number, progress: number): number {
  return Math.round(interpolate(start, end, progress));
}

function timelineProgress(timeMs: number, durationMs: number): number {
  return clamp(timeMs / durationMs, 0, 1);
}

const TERMINAL_COMMAND = "pnpm test --filter @boundsvg/core";

/**
 * Fraction of the timeline spent typing the command before the run starts.
 * Sized so the 27 keystrokes land at roughly one per 40 ms playback step,
 * which is the finest reveal the static playback clock can show.
 */
const TERMINAL_TYPING_END = 0.45;
const TERMINAL_RUN_END = 0.88;

/**
 * Spinner frames restricted to glyphs present in both playground mono fonts.
 * Braille (the usual CLI spinner) is absent from JetBrains Mono, so the
 * quadrant block run is used instead.
 */
const TERMINAL_SPINNER_FRAMES = ["▖", "▘", "▝", "▗"] as const;
const TERMINAL_SPINNER_STEP_MS = 110;
const TERMINAL_PROGRESS_CELLS = 14;

const TERMINAL_FONT_SIZE_PX = 18;
const TERMINAL_LINE_HEIGHT = 1.45;
/** JetBrains Mono advances every glyph by 0.6 em. */
const TERMINAL_ADVANCE_PX = TERMINAL_FONT_SIZE_PX * 0.6;
const TERMINAL_LINE_STEP_PX = Math.round(TERMINAL_FONT_SIZE_PX * TERMINAL_LINE_HEIGHT);
const TERMINAL_CONTENT_LEFT = 54;
const TERMINAL_CONTENT_TOP = 94;
const TERMINAL_CONTENT_WIDTH = 532;
const TERMINAL_SCREEN_BACKGROUND = "#0b1220";
const TERMINAL_PROMPT = "$ ";

const TERMINAL_INK = {
  prompt: "#4ade80",
  command: "#e2e8f0",
  pass: "#4ade80",
  running: "#fbbf24",
  path: "#93c5fd",
  muted: "#94a3b8",
  dim: "#64748b",
  /** Amber, not the caret's cyan, so the run indicator never reads as a caret. */
  spinner: "#fbbf24",
} as const;

/**
 * Output arrives in whole blocks the way real stdout does, so only the phase
 * boundary is authored here. Character-level motion belongs to the command
 * line alone.
 */
type TerminalPhase = {
  startProgress: number;
  status: string;
  spinning: boolean;
  output: readonly TerminalOutputSegment[];
};

/**
 * Output lines are authored newline-free so the declarative panel can place
 * each one as its own node; the materialized panel prefixes the line breaks.
 */
const RUNS_LINE: readonly TerminalOutputSegment[] = [
  { text: " RUNS ", color: TERMINAL_INK.running },
  { text: " packages/core", color: TERMINAL_INK.muted },
];

const FIRST_SUITE_LINE: readonly TerminalOutputSegment[] = [
  { text: " ✓ ", color: TERMINAL_INK.pass },
  { text: "typing-ime.test.ts", color: TERMINAL_INK.path },
  { text: "   312ms", color: TERMINAL_INK.dim },
];

const SECOND_SUITE_LINE: readonly TerminalOutputSegment[] = [
  { text: " ✓ ", color: TERMINAL_INK.pass },
  { text: "text-on-path.test.ts", color: TERMINAL_INK.path },
  { text: " 268ms", color: TERMINAL_INK.dim },
];

const PASS_LINE: readonly TerminalOutputSegment[] = [
  { text: " PASS ", color: TERMINAL_INK.pass },
  { text: " 2 suites", color: TERMINAL_INK.command },
  { text: "  in 2.4s", color: TERMINAL_INK.dim },
];

function terminalBlock(
  leading: string,
  line: readonly TerminalOutputSegment[],
): readonly TerminalOutputSegment[] {
  const [head, ...rest] = line;
  return head ? [{ text: `${leading}${head.text}`, color: head.color }, ...rest] : line;
}

const RUNS_BLOCK = terminalBlock("\n\n", RUNS_LINE);
const FIRST_SUITE_BLOCK = terminalBlock("\n", FIRST_SUITE_LINE);
const SECOND_SUITE_BLOCK = terminalBlock("\n", SECOND_SUITE_LINE);
const PASS_BLOCK = terminalBlock("\n\n", PASS_LINE);

const TERMINAL_TYPING_PHASE: TerminalPhase = {
  startProgress: 0,
  status: "TYPING",
  spinning: false,
  output: [],
};

const TERMINAL_PHASES: readonly TerminalPhase[] = [
  TERMINAL_TYPING_PHASE,
  { startProgress: TERMINAL_TYPING_END, status: "RUNNING", spinning: true, output: RUNS_BLOCK },
  {
    startProgress: 0.62,
    status: "RUNNING",
    spinning: true,
    output: [...RUNS_BLOCK, ...FIRST_SUITE_BLOCK],
  },
  {
    startProgress: 0.76,
    status: "RUNNING",
    spinning: true,
    output: [...RUNS_BLOCK, ...FIRST_SUITE_BLOCK, ...SECOND_SUITE_BLOCK],
  },
  {
    startProgress: TERMINAL_RUN_END,
    status: "PASS",
    spinning: false,
    output: [...RUNS_BLOCK, ...FIRST_SUITE_BLOCK, ...SECOND_SUITE_BLOCK, ...PASS_BLOCK],
  },
];

function deriveGrowingBoxValues(timeMs: number, durationMs: number): GrowingBoxValues {
  const progress = timelineProgress(timeMs, durationMs);
  const width = roundedInterpolation(GROWING_MIN_WIDTH, GROWING_MAX_WIDTH, progress);
  const height = roundedInterpolation(GROWING_MIN_HEIGHT, GROWING_MAX_HEIGHT, progress);
  return {
    kind: "growing-box",
    progress,
    width,
    height,
    scaleX: width / GROWING_MAX_WIDTH,
    scaleY: height / GROWING_MAX_HEIGHT,
  };
}

function deriveMovingExclusionValues(timeMs: number, durationMs: number): MovingExclusionValues {
  const progress = timelineProgress(timeMs, durationMs);
  return {
    kind: "moving-exclusion",
    progress,
    rectX: roundedInterpolation(92, 388, progress),
    rectY: roundedInterpolation(62, 128, progress),
    circleCx: roundedInterpolation(486, 202, progress),
    circleCy: roundedInterpolation(238, 188, progress),
  };
}

/** The last phase whose start has been reached, with its index. */
function terminalPhaseAt(progress: number): { phase: TerminalPhase; index: number } {
  let resolved = { phase: TERMINAL_TYPING_PHASE, index: 0 };
  TERMINAL_PHASES.forEach((phase, index) => {
    if (progress >= phase.startProgress) {
      resolved = { phase, index };
    }
  });
  return resolved;
}

/**
 * The run indicator, shared by both panels: the materialized scene appends it
 * as a trailing output line, the declarative scene stacks one copy per step.
 */
function terminalRunLineSegments(
  spinnerFrame: string,
  runProgress: number,
  leading = "",
): readonly TerminalOutputSegment[] {
  const filledCells = Math.round(runProgress * TERMINAL_PROGRESS_CELLS);
  const percent = `${Math.round(runProgress * 100)}`.padStart(3, " ");
  return [
    { text: `${leading}${spinnerFrame}`, color: TERMINAL_INK.spinner },
    { text: " running  ", color: TERMINAL_INK.muted },
    { text: "█".repeat(filledCells), color: TERMINAL_INK.pass },
    { text: "░".repeat(TERMINAL_PROGRESS_CELLS - filledCells), color: TERMINAL_INK.dim },
    { text: ` ${percent}%`, color: TERMINAL_INK.muted },
  ];
}

function deriveTerminalTypingValues(timeMs: number, durationMs: number): TerminalTypingValues {
  const progress = timelineProgress(timeMs, durationMs);
  const { phase, index: frameIndex } = terminalPhaseAt(progress);

  // Keystrokes are materialized one grapheme at a time; nothing about the
  // command line is a post-layout paint channel.
  const typedCount = Math.min(
    TERMINAL_COMMAND.length,
    Math.floor((progress / TERMINAL_TYPING_END) * TERMINAL_COMMAND.length),
  );
  const command = TERMINAL_COMMAND.slice(0, typedCount);
  const runProgress = clamp(
    (progress - TERMINAL_TYPING_END) / (TERMINAL_RUN_END - TERMINAL_TYPING_END),
    0,
    1,
  );
  const spinnerFrame = phase.spinning
    ? (TERMINAL_SPINNER_FRAMES[
        Math.floor(timeMs / TERMINAL_SPINNER_STEP_MS) % TERMINAL_SPINNER_FRAMES.length
      ] ?? TERMINAL_SPINNER_FRAMES[0])
    : "";
  const outputSegments = phase.spinning
    ? [...phase.output, ...terminalRunLineSegments(spinnerFrame, runProgress, "\n\n")]
    : phase.output;

  return {
    kind: "terminal-typing",
    progress,
    frameIndex,
    command,
    output: outputSegments.map((segment) => segment.text).join(""),
    outputSegments,
    spinnerFrame,
    runProgress,
    status: typedCount === 0 ? "READY" : phase.status,
  };
}

function deriveTextPathMotionValues(timeMs: number, durationMs: number): TextPathMotionValues {
  const progress = timelineProgress(timeMs, durationMs);
  const phase = progress * Math.PI * 2;
  const controlY = Math.round(188 - Math.sin(phase) * 118);
  const startOffsetPx = Math.round(264 + Math.sin(phase - Math.PI / 2) * 104);
  return {
    kind: "text-path-motion",
    progress,
    d: `M56 188C180 ${controlY} 460 ${controlY} 584 188`,
    startOffsetPx,
    controlY,
  };
}

function fitProps(controls: LayoutReactivePlaygroundControls) {
  return controls.fit === "shrink" ? { fit: "shrink" as const, minFontSizePx: 12 } : ({} as const);
}

function growingTextFrame(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(116, width - 48),
    height: Math.max(62, height - 82),
  };
}

function buildGrowingBoxScene(
  values: GrowingBoxValues,
  controls: LayoutReactivePlaygroundControls,
  rigid: boolean,
): VNode {
  const boxWidth = rigid ? GROWING_MAX_WIDTH : values.width;
  const boxHeight = rigid ? GROWING_MAX_HEIGHT : values.height;
  const textFrame = growingTextFrame(boxWidth, boxHeight);
  const left = Math.round((CANVAS_WIDTH - boxWidth) / 2);
  const top = Math.round((CANVAS_HEIGHT - boxHeight) / 2);
  const transform = rigid
    ? {
        scaleX: values.scaleX,
        scaleY: values.scaleY,
        originX: GROWING_MAX_WIDTH / 2,
        originY: GROWING_MAX_HEIGHT / 2,
      }
    : undefined;

  return Canvas(
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#08111f" },
    Box({
      position: "absolute",
      left: 24,
      top: 22,
      width: 592,
      height: 316,
      borderRadius: 22,
      background: "#111c31",
      borderWidth: 1,
      borderColor: "#334155",
    }),
    Flex(
      {
        id: "growing-card",
        position: "absolute",
        left,
        top,
        width: boxWidth,
        height: boxHeight,
        direction: "column",
        justifyContent: "space-between",
        gap: 8,
        padding: [18, 24, 18, 24],
        overflow: "clip",
        borderRadius: 20,
        borderWidth: 2,
        borderColor: rigid ? "#f59e0b" : "#22d3ee",
        background: rigid ? "#451a03" : "#083344",
        ...(transform ? { transform } : {}),
      },
      Text(
        {
          font: FONT,
          fontSizePx: 11,
          letterSpacingPx: 1.8,
          color: rigid ? "#fcd34d" : "#67e8f9",
          wrap: "none",
        },
        rigid ? "POST-LAYOUT SCALE" : "FULL-SCENE REFIT",
      ),
      Text(
        {
          id: "growing-copy",
          width: textFrame.width,
          height: textFrame.height,
          font: FONT,
          fontSizePx: 31,
          lineHeight: 1.35,
          wrap: controls.wrap,
          writingMode: controls.writingMode,
          language: "ja",
          maxLines: 4,
          ellipsis: true,
          color: "#f8fafc",
          ...fitProps(controls),
        },
        "箱が育つたび、文字サイズ・折返し・省略と空き領域を再解決します。",
      ),
      Text(
        { font: FONT, fontSizePx: 11, color: "#94a3b8", wrap: "none" },
        rigid
          ? "resolved paint · non-uniform scale can distort"
          : "static props · layout runs again",
      ),
    ),
  );
}

function buildGrowingBoxMaterializedScene(
  values: GrowingBoxValues,
  controls: LayoutReactivePlaygroundControls,
): VNode {
  return buildGrowingBoxScene(values, controls, false);
}

type FlowGeometry = {
  rect: { x: number; y: number; width: number; height: number };
  circle: { cx: number; cy: number; r: number };
};

function geometryFromValues(values: MovingExclusionValues): FlowGeometry {
  return {
    rect: { x: values.rectX, y: values.rectY, width: 104, height: 92 },
    circle: { cx: values.circleCx, cy: values.circleCy, r: 42 },
  };
}

function initialFlowGeometry(durationMs: number): FlowGeometry {
  return geometryFromValues(deriveMovingExclusionValues(0, durationMs));
}

function flowExclusionsFromGeometry(geometry: FlowGeometry): readonly TextFlowExclusion[] {
  return [
    {
      kind: "rect",
      x: geometry.rect.x - FLOW_FRAME.left,
      y: geometry.rect.y - FLOW_FRAME.top,
      width: geometry.rect.width,
      height: geometry.rect.height,
      marginPx: 9,
    },
    {
      kind: "circle",
      cx: geometry.circle.cx - FLOW_FRAME.left,
      cy: geometry.circle.cy - FLOW_FRAME.top,
      r: geometry.circle.r,
      marginPx: 9,
    },
  ];
}

function flowUnitAnimation(controls: LayoutReactivePlaygroundControls): TextUnitAnimation {
  const initialTransform =
    controls.writingMode === "vertical-rl" ? { translateX: 7 } : { translateY: 7 };
  return {
    by: "cluster",
    delayStepMs: 22,
    order: "logical",
    ruby: "with-base",
    animation: {
      keyframes: [
        { at: 0, opacity: 0.28, transform: initialTransform },
        { at: 1, opacity: 1, transform: { translateX: 0, translateY: 0 } },
      ],
      durationMs: 420,
      easing: "ease-out",
      fill: "both",
    },
  };
}

function flowFitProps(controls: LayoutReactivePlaygroundControls) {
  return controls.fit === "shrink" ? { fit: "shrink" as const, minFontSizePx: 13 } : ({} as const);
}

function buildFlowScene(
  flowGeometry: FlowGeometry,
  visibleGeometry: FlowGeometry,
  controls: LayoutReactivePlaygroundControls,
  transforms?: { rectX: number; rectY: number; circleX: number; circleY: number },
): VNode {
  const vertical = controls.writingMode === "vertical-rl";
  return Canvas(
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#08111f" },
    Box({
      position: "absolute",
      left: 24,
      top: 22,
      width: 592,
      height: 316,
      borderRadius: 22,
      background: "#111c31",
      borderWidth: 1,
      borderColor: "#334155",
    }),
    Text(
      {
        position: "absolute",
        left: 42,
        top: 30,
        font: FONT,
        fontSizePx: 11,
        letterSpacingPx: 1.6,
        color: transforms ? "#fcd34d" : "#67e8f9",
        wrap: "none",
      },
      transforms ? "PAINT MOVES · FLOW STAYS" : "GEOMETRY MOVES · FLOW RECOMPUTES",
    ),
    Text(
      {
        id: MOVING_EXCLUSION_TEXT_NODE_ID,
        position: "absolute",
        left: FLOW_FRAME.left,
        top: FLOW_FRAME.top,
        width: FLOW_FRAME.width,
        height: FLOW_FRAME.height,
        font: FONT,
        fontSizePx: FLOW_FONT_SIZE_PX,
        lineHeight: FLOW_LINE_HEIGHT,
        wrap: controls.wrap,
        whiteSpace: "pre-wrap",
        writingMode: controls.writingMode,
        textOrientation: vertical ? "upright" : "mixed",
        language: "ja",
        maxLines: vertical ? 9 : 8,
        ellipsis: true,
        color: "#e2e8f0",
        flowExclusions: flowExclusionsFromGeometry(flowGeometry),
        animateUnits: flowUnitAnimation(controls),
        ...flowFitProps(controls),
      },
      FLOW_TEXT,
    ),
    Flex(
      {
        id: "moving-exclusion-rect",
        position: "absolute",
        left: visibleGeometry.rect.x,
        top: visibleGeometry.rect.y,
        width: visibleGeometry.rect.width,
        height: visibleGeometry.rect.height,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: 16,
        background: "#f97316",
        opacity: 0.9,
        ...(transforms
          ? { transform: { translateX: transforms.rectX, translateY: transforms.rectY } }
          : {}),
      },
      Text({ font: FONT, fontSizePx: 11, color: "#431407", wrap: "none" }, "RECT"),
    ),
    Flex(
      {
        id: "moving-exclusion-circle",
        position: "absolute",
        left: visibleGeometry.circle.cx - visibleGeometry.circle.r,
        top: visibleGeometry.circle.cy - visibleGeometry.circle.r,
        width: visibleGeometry.circle.r * 2,
        height: visibleGeometry.circle.r * 2,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: visibleGeometry.circle.r,
        background: "#a78bfa",
        opacity: 0.88,
        ...(transforms
          ? { transform: { translateX: transforms.circleX, translateY: transforms.circleY } }
          : {}),
      },
      Text({ font: FONT, fontSizePx: 10, color: "#2e1065", wrap: "none" }, "CIRCLE"),
    ),
  );
}

function buildMovingExclusionMaterializedScene(
  values: MovingExclusionValues,
  controls: LayoutReactivePlaygroundControls,
): VNode {
  const geometry = geometryFromValues(values);
  return buildFlowScene(geometry, geometry, controls);
}

const TERMINAL_CARET_BLINK_MS = 560;

const TERMINAL_CARET_ANIMATION = {
  keyframes: [
    { at: 0, opacity: 1 },
    { at: 1, opacity: 0 },
  ],
  durationMs: TERMINAL_CARET_BLINK_MS,
  easing: { type: "steps", count: 2, position: "jump-none" },
  iterations: "infinite",
  fill: "both",
} as const;

/** Window chrome shared by the declarative and materialized terminals. */
function terminalChrome(accent: string, badgeLabel: string, badgeBackground: string): VNode[] {
  return [
    Box({
      position: "absolute",
      left: 24,
      top: 22,
      width: 592,
      height: 316,
      borderRadius: 18,
      background: TERMINAL_SCREEN_BACKGROUND,
      borderWidth: 1,
      borderColor: "#164e63",
    }),
    Box({
      position: "absolute",
      left: 24,
      top: 22,
      width: 592,
      height: 46,
      borderRadius: 18,
      background: "#111827",
    }),
    ...["#fb7185", "#fbbf24", "#4ade80"].map((background, index) =>
      Box({
        position: "absolute",
        left: 44 + index * 20,
        top: 39,
        width: 10,
        height: 10,
        borderRadius: 5,
        background,
      }),
    ),
    Text(
      {
        position: "absolute",
        left: 238,
        top: 34,
        width: 240,
        font: MONO_FONT,
        fallback: [FONT],
        fontSizePx: 12,
        color: "#64748b",
        textAlign: "center",
        wrap: "none",
      },
      "boundsvg — test runner",
    ),
    Box({
      position: "absolute",
      left: 506,
      top: 34,
      width: 86,
      height: 24,
      borderRadius: 12,
      background: badgeBackground,
    }),
    Text(
      {
        position: "absolute",
        left: 520,
        top: 39,
        width: 58,
        font: MONO_FONT,
        fallback: [FONT],
        fontSizePx: 10,
        color: accent,
        textAlign: "center",
        wrap: "none",
      },
      badgeLabel,
    ),
  ];
}

function terminalStatusBackground(status: string): string {
  return status === "PASS" ? "#052e16" : "#083344";
}

function terminalAccent(status: string): string {
  return status === "PASS" ? "#4ade80" : "#22d3ee";
}

function buildTerminalTypingScene(values: TerminalTypingValues): VNode {
  const accent = terminalAccent(values.status);
  return Canvas(
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#070b14" },
    ...terminalChrome(accent, values.status, terminalStatusBackground(values.status)),
    Text(
      {
        id: TERMINAL_ANIMATION_TEXT_NODE_ID,
        position: "absolute",
        left: TERMINAL_CONTENT_LEFT,
        top: TERMINAL_CONTENT_TOP,
        width: TERMINAL_CONTENT_WIDTH,
        height: 206,
        font: MONO_FONT,
        fallback: [FONT],
        fontSizePx: TERMINAL_FONT_SIZE_PX,
        lineHeight: TERMINAL_LINE_HEIGHT,
        whiteSpace: "pre-wrap",
        wrap: "char",
        color: TERMINAL_INK.command,
      },
      Inline({ color: TERMINAL_INK.prompt }, TERMINAL_PROMPT),
      values.command,
      // The caret trails the keystrokes, not the emitted output below it.
      InlineRect({
        inlineSizePx: 2,
        blockSizePx: 20,
        advancePx: 3,
        blockAlign: "center",
        color: accent,
        borderRadiusPx: 1,
        animate: TERMINAL_CARET_ANIMATION,
      }),
      ...values.outputSegments.map((segment) => Inline({ color: segment.color }, segment.text)),
    ),
    terminalCaption(
      "#64748b",
      `${values.command.length}/${TERMINAL_COMMAND.length} keystrokes · phase ${values.frameIndex + 1}/${TERMINAL_PHASES.length} · content resolved before layout`,
    ),
  );
}

/**
 * Step-holds a node hidden until `fromProgress`, and hides it again at
 * `toProgress`. Every declarative terminal animation shares the timeline
 * duration and loops infinitely, so the whole scene stays phase-locked.
 */
function terminalReveal(fromProgress: number, toProgress: number | null, durationMs: number) {
  const closing = toProgress !== null && toProgress < 1;
  const keyframes: { at: number; opacity: number }[] = [];
  if (fromProgress > 0) {
    keyframes.push({ at: 0, opacity: 0 });
  }
  keyframes.push({ at: fromProgress, opacity: 1 });
  if (closing) {
    keyframes.push({ at: toProgress, opacity: 0 });
  }
  keyframes.push({ at: 1, opacity: closing ? 0 : 1 });
  return {
    keyframes,
    durationMs,
    easing: "step-end",
    iterations: "infinite",
    fill: "both",
  } as const;
}

function terminalRow(row: number): number {
  return TERMINAL_CONTENT_TOP + row * TERMINAL_LINE_STEP_PX;
}

/** One output line, revealed whole the way a real stdout flush arrives. */
function terminalOutputLine(
  row: number,
  segments: readonly TerminalOutputSegment[],
  animate: ReturnType<typeof terminalReveal>,
): VNode {
  return Text(
    {
      position: "absolute",
      left: TERMINAL_CONTENT_LEFT,
      top: terminalRow(row),
      width: TERMINAL_CONTENT_WIDTH,
      font: MONO_FONT,
      fallback: [FONT],
      fontSizePx: TERMINAL_FONT_SIZE_PX,
      lineHeight: TERMINAL_LINE_HEIGHT,
      // Each output line is its own node, so the leading indent and the padded
      // percent column have to survive whitespace collapsing.
      whiteSpace: "pre-wrap",
      color: TERMINAL_INK.command,
      wrap: "none",
      animate,
    },
    ...segments.map((segment) => Inline({ color: segment.color }, segment.text)),
  );
}

/**
 * A single self-animating SVG: the command is wiped in one glyph advance at a
 * time by a background-colored cover whose left edge carries the caret, and
 * every output line is a step-held reveal. Nothing here re-runs layout, which
 * is exactly the boundary this panel demonstrates — the cover can only uncover
 * glyphs that were already laid out at their final positions.
 */
function buildTerminalDeclarativeScene(controls: LayoutReactivePlaygroundControls): VNode {
  const durationMs = controls.durationMs;
  const commandWidth = TERMINAL_COMMAND.length * TERMINAL_ADVANCE_PX;
  const commandLeft = TERMINAL_PROMPT.length * TERMINAL_ADVANCE_PX;
  const runStep = (TERMINAL_RUN_END - TERMINAL_TYPING_END) / TERMINAL_PROGRESS_CELLS;
  const runLineRow = 6;

  return Canvas(
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#070b14" },
    ...terminalChrome(TERMINAL_INK.spinner, "SVG", "#422006"),
    Box(
      {
        position: "absolute",
        left: TERMINAL_CONTENT_LEFT,
        top: terminalRow(0),
        width: TERMINAL_CONTENT_WIDTH,
        height: TERMINAL_LINE_STEP_PX,
        background: TERMINAL_SCREEN_BACKGROUND,
        overflow: "clip",
      },
      Text(
        {
          position: "absolute",
          left: 0,
          top: 0,
          width: TERMINAL_CONTENT_WIDTH,
          font: MONO_FONT,
          fallback: [FONT],
          fontSizePx: TERMINAL_FONT_SIZE_PX,
          lineHeight: TERMINAL_LINE_HEIGHT,
          color: TERMINAL_INK.command,
          wrap: "none",
        },
        Inline({ color: TERMINAL_INK.prompt }, TERMINAL_PROMPT),
        TERMINAL_COMMAND,
      ),
      // One easing step per keystroke; keyframe easing is per-segment, so the
      // count is the command length rather than a fraction of the timeline.
      Box(
        {
          id: TERMINAL_DECLARATIVE_COVER_ID,
          position: "absolute",
          left: commandLeft,
          top: 0,
          width: commandWidth,
          height: TERMINAL_LINE_STEP_PX,
          background: TERMINAL_SCREEN_BACKGROUND,
          animate: {
            keyframes: [
              { at: 0, transform: { translateX: 0 } },
              { at: TERMINAL_TYPING_END, transform: { translateX: commandWidth } },
              { at: 1, transform: { translateX: commandWidth } },
            ],
            durationMs,
            easing: {
              type: "steps",
              count: TERMINAL_COMMAND.length,
              position: "jump-end",
            },
            iterations: "infinite",
            fill: "both",
          },
        },
        // Riding the cover's leading edge is what keeps the caret with the
        // keystrokes without any per-character layout.
        Box({
          id: TERMINAL_DECLARATIVE_CARET_ID,
          position: "absolute",
          left: 0,
          top: 3,
          width: 2,
          height: 20,
          borderRadius: 1,
          background: terminalAccent("TYPING"),
          animate: TERMINAL_CARET_ANIMATION,
        }),
      ),
    ),
    terminalOutputLine(2, RUNS_LINE, terminalReveal(TERMINAL_TYPING_END, null, durationMs)),
    terminalOutputLine(3, FIRST_SUITE_LINE, terminalReveal(0.62, null, durationMs)),
    terminalOutputLine(4, SECOND_SUITE_LINE, terminalReveal(0.76, null, durationMs)),
    ...Array.from({ length: TERMINAL_PROGRESS_CELLS }, (_unused, cell) =>
      terminalOutputLine(
        runLineRow,
        terminalRunLineSegments(
          TERMINAL_SPINNER_FRAMES[cell % TERMINAL_SPINNER_FRAMES.length] ?? "",
          (cell + 1) / TERMINAL_PROGRESS_CELLS,
        ),
        terminalReveal(
          TERMINAL_TYPING_END + cell * runStep,
          TERMINAL_TYPING_END + (cell + 1) * runStep,
          durationMs,
        ),
      ),
    ),
    terminalOutputLine(runLineRow, PASS_LINE, terminalReveal(TERMINAL_RUN_END, null, durationMs)),
    terminalCaption(
      TERMINAL_INK.spinner,
      "One declarative SVG · paint-only reveal over a layout resolved once",
    ),
  );
}

function terminalCaption(color: string, text: string): VNode {
  return Text(
    {
      position: "absolute",
      left: TERMINAL_CONTENT_LEFT,
      top: 309,
      width: TERMINAL_CONTENT_WIDTH,
      font: FONT,
      fontSizePx: 11,
      color,
      wrap: "none",
    },
    text,
  );
}

const TEXT_PATH_UNIT_ANIMATION: TextUnitAnimation = {
  by: "cluster",
  animation: {
    keyframes: [
      { at: 0, opacity: 0.28, transform: { translateY: 8, scaleX: 0.92, scaleY: 0.92 } },
      { at: 1, opacity: 1, transform: { translateY: 0, scaleX: 1, scaleY: 1 } },
    ],
    durationMs: 520,
    easing: "ease-out",
    fill: "both",
  },
  delayStepMs: 20,
  order: "logical",
};

function buildTextPathMotionScene(values: TextPathMotionValues, rigid: boolean): VNode {
  const accent = rigid ? "#f59e0b" : "#67e8f9";
  return Canvas(
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#071827" },
    Box({
      position: "absolute",
      left: 24,
      top: 22,
      width: 592,
      height: 316,
      borderRadius: 20,
      background: "#102a43",
      borderColor: rigid ? "#92400e" : "#155e75",
      borderWidth: 1,
    }),
    Text(
      {
        position: "absolute",
        left: 46,
        top: 38,
        width: 320,
        font: FONT,
        fontSizePx: 20,
        color: "#f8fafc",
        wrap: "none",
      },
      "Text Path Motion",
    ),
    Text(
      {
        position: "absolute",
        left: 46,
        top: 68,
        width: 548,
        font: MONO_FONT,
        fallback: [FONT],
        fontSizePx: 10,
        color: rigid ? "#fbbf24" : "#94a3b8",
        wrap: "none",
      },
      rigid
        ? "FIXED-LAYOUT LIMIT · initial d/startOffsetPx stay fixed"
        : `MATERIALIZED · d + startOffsetPx · offset ${values.startOffsetPx}`,
    ),
    Path({
      id: "text-path-animation-guide",
      position: "absolute",
      left: 0,
      top: 30,
      d: values.d,
      width: CANVAS_WIDTH,
      height: 260,
      fill: "none",
      stroke: rigid ? "#b45309" : "#64748b",
      strokeWidth: 1,
      strokeDasharray: "6,6",
    }),
    TextOnPath(
      {
        id: TEXT_PATH_ANIMATION_TEXT_NODE_ID,
        position: "absolute",
        left: 0,
        top: 30,
        d: values.d,
        width: CANVAS_WIDTH,
        height: 260,
        font: FONT,
        fallback: [MONO_FONT],
        fontSizePx: 28,
        color: accent,
        startOffsetPx: values.startOffsetPx,
        textAnchor: "middle",
        pathNormal: "right",
        pathOffsetPx: 8,
        pathOverflow: "error",
        textStroke: "#0f172a",
        textStrokeWidth: 3,
        animateUnits: TEXT_PATH_UNIT_ANIMATION,
      },
      "字幕 Text Path Motion",
    ),
    Text(
      {
        position: "absolute",
        left: 46,
        top: 309,
        width: 548,
        font: FONT,
        fontSizePx: 11,
        color: rigid ? "#fbbf24" : "#64748b",
        wrap: "none",
      },
      rigid
        ? "Paint animation cannot reshape the authored text path."
        : "The normal static layout pipeline resolves every geometry checkpoint.",
    ),
  );
}

function createGrowingBoxGenerator(
  controls: LayoutReactivePlaygroundControls,
): LayoutReactiveFrameGenerator {
  return (timeMs) => {
    const values = deriveGrowingBoxValues(timeMs, controls.durationMs);
    return {
      rigidScene: buildGrowingBoxScene(values, controls, true),
      materializedScene: buildGrowingBoxMaterializedScene(values, controls),
      values,
    };
  };
}

function createMovingExclusionGenerator(
  controls: LayoutReactivePlaygroundControls,
): LayoutReactiveFrameGenerator {
  const initialGeometry = initialFlowGeometry(controls.durationMs);
  return (timeMs) => {
    const values = deriveMovingExclusionValues(timeMs, controls.durationMs);
    const currentGeometry = geometryFromValues(values);
    return {
      rigidScene: buildFlowScene(initialGeometry, initialGeometry, controls, {
        rectX: currentGeometry.rect.x - initialGeometry.rect.x,
        rectY: currentGeometry.rect.y - initialGeometry.rect.y,
        circleX: currentGeometry.circle.cx - initialGeometry.circle.cx,
        circleY: currentGeometry.circle.cy - initialGeometry.circle.cy,
      }),
      materializedScene: buildMovingExclusionMaterializedScene(values, controls),
      values,
    };
  };
}

function createTerminalTypingGenerator(
  controls: LayoutReactivePlaygroundControls,
): LayoutReactiveFrameGenerator {
  const declarativeScene = buildTerminalDeclarativeScene(controls);
  return (timeMs) => {
    const values = deriveTerminalTypingValues(timeMs, controls.durationMs);
    return {
      rigidScene: declarativeScene,
      materializedScene: buildTerminalTypingScene(values),
      values,
    };
  };
}

function createTextPathMotionGenerator(
  controls: LayoutReactivePlaygroundControls,
): LayoutReactiveFrameGenerator {
  const initialValues = deriveTextPathMotionValues(0, controls.durationMs);
  return (timeMs) => {
    const values = deriveTextPathMotionValues(timeMs, controls.durationMs);
    return {
      rigidScene: buildTextPathMotionScene(initialValues, true),
      materializedScene: buildTextPathMotionScene(values, false),
      values,
    };
  };
}

export const LAYOUT_REACTIVE_PRESETS: Record<LayoutReactivePresetKey, LayoutReactivePreset> = {
  "growing-box": {
    label: "Growing Box → Refit Text",
    description:
      "Compare a fixed layout scaled after layout with a time-materialized box that reruns fit, wrap, ellipsis, and flex distribution.",
    posterTimeMs: 1_480,
    defaultControls: { ...DEFAULT_LAYOUT_REACTIVE_PLAYGROUND_CONTROLS },
    supportsTextControls: true,
    rigidAnimation: "static",
    textNodeId: "growing-copy",
    createFrameGenerator: createGrowingBoxGenerator,
  },
  "moving-exclusion": {
    label: "Moving Exclusion → Text Reflow",
    description:
      "Compare intentional transform-only desynchronization with static obstacle geometry materialized at each time for full text reflow.",
    posterTimeMs: 1_360,
    defaultControls: { ...DEFAULT_LAYOUT_REACTIVE_PLAYGROUND_CONTROLS },
    supportsTextControls: true,
    rigidAnimation: "static",
    textNodeId: MOVING_EXCLUSION_TEXT_NODE_ID,
    createFrameGenerator: createMovingExclusionGenerator,
  },
  "terminal-typing": {
    label: "Terminal Typing",
    description:
      "The command is materialized one keystroke at a time while stdout arrives in whole colored blocks; a block-glyph spinner and progress bar track the run, and InlineRect keeps the caret blink as post-layout paint.",
    // Late enough to land in the PASS phase, so the reduced-motion still
    // shows a completed run.
    posterTimeMs: 2_280,
    defaultControls: { ...DEFAULT_LAYOUT_REACTIVE_PLAYGROUND_CONTROLS },
    supportsTextControls: false,
    rigidAnimation: "declarative",
    textNodeId: TERMINAL_ANIMATION_TEXT_NODE_ID,
    createFrameGenerator: createTerminalTypingGenerator,
  },
  "text-path-motion": {
    label: "Text Path Motion",
    description:
      "Each frame materializes cubic path geometry and startOffsetPx; the fixed comparison demonstrates why path reshaping is not a post-layout paint channel.",
    posterTimeMs: 600,
    defaultControls: { ...DEFAULT_LAYOUT_REACTIVE_PLAYGROUND_CONTROLS },
    supportsTextControls: false,
    rigidAnimation: "static",
    textNodeId: TEXT_PATH_ANIMATION_TEXT_NODE_ID,
    createFrameGenerator: createTextPathMotionGenerator,
  },
};

export const LAYOUT_REACTIVE_PRESET_OPTIONS = Object.entries(LAYOUT_REACTIVE_PRESETS).map(
  ([value, preset]) => ({ value, label: preset.label }),
);

export function isLayoutReactivePresetKey(value: string): value is LayoutReactivePresetKey {
  return (
    value === "growing-box" ||
    value === "moving-exclusion" ||
    value === "terminal-typing" ||
    value === "text-path-motion"
  );
}
