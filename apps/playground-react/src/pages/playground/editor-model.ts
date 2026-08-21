import type { GeometryDoc, TextShadowLayer, TextStrokeLayer } from "@boundsvg/core";

type EditorFrame = { x: number; y: number; width: number; height: number };

type EditorLayerBase = EditorFrame & {
  id: string;
  name: string;
  groupId?: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  rotateDeg: number;
};

export type EditorTextRun =
  | { id: string; kind: "text"; text: string }
  | {
      id: string;
      kind: "inline";
      text: string;
      color?: string;
      fontSizePx?: number;
      textOrientation?: "mixed" | "upright";
      textCombineUpright?: "none" | "all";
    }
  | {
      id: string;
      kind: "ruby";
      base: string;
      rubyText: string;
      extraRubyText?: string;
      rubyPosition: "over" | "under" | "alternate" | "inter-character";
      rubyAlign: "start" | "center" | "space-between" | "space-around";
      rubyGapPx: number;
      rubyOffsetPx: number;
      rubyLineSizing: "stable" | "css";
    };

export type FlowBinding = { layerId: string; marginPx: number };

export type EditorTextLayer = EditorLayerBase & {
  type: "text";
  runs: EditorTextRun[];
  font: string;
  fontSizePx: number;
  lineHeight: number;
  letterSpacingPx: number;
  color: string;
  writingMode: "horizontal-tb" | "vertical-rl";
  textOrientation: "mixed" | "upright";
  textAlign: "start" | "center" | "end";
  wrap: "none" | "word" | "char";
  fit: "none" | "shrink" | "grow";
  minFontSizePx: number;
  maxFontSizePx: number;
  maxLines: number;
  ellipsis: boolean;
  hangingPunctuation: boolean;
  fontVariationSettings: string;
  fontFeatureSettings: string;
  strokes: TextStrokeLayer[];
  shadows: TextShadowLayer[];
  flowBindings: FlowBinding[];
};

export type EditorBoxLayer = EditorLayerBase & {
  type: "box";
  background: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  boxShadow: string;
};

export type EditorShapeKind = "circle" | "pill" | "notch" | "callout";

export type EditorShapeLayer = EditorLayerBase & {
  type: "shape";
  shapeKind: EditorShapeKind;
  customGeometry?: GeometryDoc;
  fill: string;
  stroke: string;
  strokeWidth: number;
};

export type EditorLayer = EditorTextLayer | EditorBoxLayer | EditorShapeLayer;

export type EditorDocument = {
  canvas: {
    width: number;
    height: number;
    background: string;
    sizeLocked: boolean;
    followWritingMode: boolean;
  };
  layers: EditorLayer[];
};

export type EditorTextSelection = {
  layerId: string;
  anchor: number;
  focus: number;
  focusAffinity?: "before" | "after";
};

export type EditorPresent = {
  document: EditorDocument;
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  textSelection: EditorTextSelection | null;
  textEditMode: boolean;
};

export type EditorState = {
  past: EditorPresent[];
  present: EditorPresent;
  future: EditorPresent[];
  canvasMode: "move" | "text" | "range";
  zoom: number;
  outputOpen: boolean;
};

let nextId = 1;
export function createEditorId(prefix: string): string {
  const id = `${prefix}-${nextId}`;
  nextId += 1;
  return id;
}

export function createTextLayer(overrides: Partial<EditorTextLayer> = {}): EditorTextLayer {
  const id = overrides.id ?? createEditorId("text");
  return {
    id,
    type: "text",
    name: "Text",
    x: 80,
    y: 60,
    width: 800,
    height: 420,
    visible: true,
    locked: false,
    opacity: 1,
    rotateDeg: 0,
    runs: [
      {
        id: createEditorId("run"),
        kind: "text",
        text: "春の朝、空にやわらかな光が広がります。縦書きもルビも、キャンバス上で編集できます。\nboundsvg visual editor",
      },
    ],
    font: "NotoSansJP-woff2",
    fontSizePx: 42,
    lineHeight: 1.45,
    letterSpacingPx: 0,
    color: "#f8fafc",
    writingMode: "horizontal-tb",
    textOrientation: "mixed",
    textAlign: "start",
    wrap: "char",
    fit: "shrink",
    minFontSizePx: 14,
    maxFontSizePx: 96,
    maxLines: 0,
    ellipsis: false,
    hangingPunctuation: true,
    fontVariationSettings: "",
    fontFeatureSettings: "",
    strokes: [],
    shadows: [],
    flowBindings: [],
    ...overrides,
  };
}

export function createBoxLayer(overrides: Partial<EditorBoxLayer> = {}): EditorBoxLayer {
  return {
    id: createEditorId("box"),
    type: "box",
    name: "Box",
    x: 100,
    y: 100,
    width: 240,
    height: 140,
    visible: true,
    locked: false,
    opacity: 1,
    rotateDeg: 0,
    background: "#1e3a5f",
    borderColor: "#38bdf8",
    borderWidth: 2,
    borderRadius: 18,
    boxShadow: "0 12 28 0 rgba(0, 0, 0, 0.35)",
    ...overrides,
  };
}

export function createShapeLayer(overrides: Partial<EditorShapeLayer> = {}): EditorShapeLayer {
  return {
    id: createEditorId("shape"),
    type: "shape",
    name: "Shape",
    x: 630,
    y: 170,
    width: 180,
    height: 140,
    visible: true,
    locked: false,
    opacity: 1,
    rotateDeg: 0,
    shapeKind: "circle",
    fill: "#f59e0b",
    stroke: "#fef3c7",
    strokeWidth: 3,
    ...overrides,
  };
}

const INITIAL_EDITOR_DOCUMENT: EditorDocument = {
  canvas: {
    width: 960,
    height: 540,
    background: "#0f172a",
    sizeLocked: false,
    followWritingMode: true,
  },
  layers: [createTextLayer({ id: "text-main", name: "Main text" })],
};

export function createInitialEditorState(): EditorState {
  return {
    past: [],
    present: {
      document: structuredClone(INITIAL_EDITOR_DOCUMENT),
      selectedLayerId: "text-main",
      selectedLayerIds: ["text-main"],
      textSelection: null,
      textEditMode: false,
    },
    future: [],
    canvasMode: "move",
    zoom: 0.8,
    outputOpen: false,
  };
}

export function layerText(layer: EditorTextLayer): string {
  return layer.runs.map((run) => (run.kind === "ruby" ? run.base : run.text)).join("");
}

export function splitEditorGraphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (entry) => entry.segment);
  }
  return Array.from(text);
}
