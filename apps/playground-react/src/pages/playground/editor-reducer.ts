import type { BooleanOp } from "@boundsvg/shape";
import {
  createBoxLayer,
  createEditorId,
  createShapeLayer,
  createTextLayer,
  type EditorDocument,
  type EditorLayer,
  type EditorPresent,
  type EditorState,
  type EditorTextLayer,
  type EditorTextRun,
  splitEditorGraphemes,
} from "./editor-model";
import { createEditorBooleanGeometry } from "./editor-shape-geometry";

export type EditorAction =
  | {
      type: "select";
      layerId: string | null;
      additive?: boolean;
      preserveSelection?: boolean;
    }
  | { type: "select-range"; layerIds: string[]; additive?: boolean }
  | { type: "set-canvas-mode"; mode: EditorState["canvasMode"] }
  | { type: "set-text-edit"; enabled: boolean }
  | {
      type: "set-text-selection";
      layerId: string;
      anchor: number;
      focus: number;
      focusAffinity?: "before" | "after";
    }
  | {
      type: "replace-text";
      layerId: string;
      text: string;
      anchor: number;
      focus: number;
      record?: boolean;
    }
  | { type: "clear-text-selection" }
  | { type: "patch-canvas"; patch: Partial<EditorDocument["canvas"]> }
  | { type: "patch-layer"; layerId: string; patch: Partial<EditorLayer>; record?: boolean }
  | {
      type: "patch-layers";
      patches: Array<{ layerId: string; patch: Partial<EditorLayer> }>;
      record?: boolean;
    }
  | {
      type: "set-writing-mode";
      layerId: string;
      writingMode: EditorTextLayer["writingMode"];
    }
  | { type: "commit-preview"; before: EditorPresent }
  | { type: "add-layer"; layerType: EditorLayer["type"] }
  | { type: "duplicate-layer"; layerId: string }
  | { type: "delete-layer"; layerId: string }
  | { type: "move-layer-order"; layerId: string; direction: -1 | 1 }
  | { type: "group-selection" }
  | { type: "ungroup-selection" }
  | { type: "apply-shape-boolean"; operation: BooleanOp }
  | { type: "apply-ruby"; rubyText: string }
  | {
      type: "apply-inline";
      patch: {
        color?: string;
        textOrientation?: "mixed" | "upright";
        textCombineUpright?: "none" | "all";
      };
    }
  | { type: "clear-rich-format" }
  | { type: "replace-document"; document: EditorDocument; selectedLayerId?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "set-zoom"; zoom: number }
  | { type: "set-output-open"; open: boolean };

function record(state: EditorState, present: EditorPresent): EditorState {
  return {
    ...state,
    past: [...state.past.slice(-49), state.present],
    present,
    future: [],
  };
}

function patchLayer(
  present: EditorPresent,
  layerId: string,
  patch: Partial<EditorLayer>,
): EditorPresent {
  return {
    ...present,
    document: {
      ...present.document,
      layers: present.document.layers.map((layer) =>
        layer.id === layerId ? ({ ...layer, ...patch } as EditorLayer) : layer,
      ),
    },
  };
}

function patchLayers(
  present: EditorPresent,
  patches: Array<{ layerId: string; patch: Partial<EditorLayer> }>,
): EditorPresent {
  const patchByLayerId = new Map(patches.map(({ layerId, patch }) => [layerId, patch]));
  return {
    ...present,
    document: {
      ...present.document,
      layers: present.document.layers.map((layer) => {
        const patch = patchByLayerId.get(layer.id);
        return patch ? ({ ...layer, ...patch } as EditorLayer) : layer;
      }),
    },
  };
}

type EditorLayerSelection = Pick<EditorPresent, "selectedLayerId" | "selectedLayerIds">;

export function resolveLayerSelection(
  present: EditorPresent,
  layerId: string | null,
  options: { additive?: boolean; preserveSelection?: boolean } = {},
): EditorLayerSelection {
  const layers = present.document.layers;
  if (!layerId || !layers.some((layer) => layer.id === layerId)) {
    return { selectedLayerId: null, selectedLayerIds: [] };
  }
  const selectedLayerIds = normalizeSelectedLayerIds(layers, present.selectedLayerIds);
  if (options.preserveSelection && selectedLayerIds.includes(layerId)) {
    return {
      selectedLayerId: selectedLayerIds.includes(present.selectedLayerId ?? "")
        ? present.selectedLayerId
        : layerId,
      selectedLayerIds,
    };
  }
  const selectionUnitIds = resolveSelectionUnitIds(layers, layerId);
  if (!options.additive) {
    return { selectedLayerId: layerId, selectedLayerIds: selectionUnitIds };
  }
  const selectedIdSet = new Set(selectedLayerIds);
  const removeUnit = selectionUnitIds.every((candidateId) => selectedIdSet.has(candidateId));
  for (const candidateId of selectionUnitIds) {
    if (removeUnit) {
      selectedIdSet.delete(candidateId);
    } else {
      selectedIdSet.add(candidateId);
    }
  }
  const nextSelectedLayerIds = normalizeSelectedLayerIds(layers, Array.from(selectedIdSet));
  const selectedLayerId = removeUnit
    ? selectedIdSet.has(present.selectedLayerId ?? "")
      ? present.selectedLayerId
      : (nextSelectedLayerIds.at(-1) ?? null)
    : layerId;
  return { selectedLayerId, selectedLayerIds: nextSelectedLayerIds };
}

export function resolveLayerRangeSelection(
  present: EditorPresent,
  layerIds: string[],
  additive = false,
): EditorLayerSelection {
  const layers = present.document.layers;
  const selectedIdSet = new Set(
    additive ? normalizeSelectedLayerIds(layers, present.selectedLayerIds) : [],
  );
  for (const layerId of layerIds) {
    for (const selectionUnitId of resolveSelectionUnitIds(layers, layerId)) {
      selectedIdSet.add(selectionUnitId);
    }
  }
  const selectedLayerIds = normalizeSelectedLayerIds(layers, Array.from(selectedIdSet));
  const lastRangeLayerId = [...layerIds]
    .reverse()
    .find((layerId) => selectedLayerIds.includes(layerId));
  const selectedLayerId =
    lastRangeLayerId ??
    (additive && selectedLayerIds.includes(present.selectedLayerId ?? "")
      ? present.selectedLayerId
      : (selectedLayerIds.at(-1) ?? null));
  return { selectedLayerId, selectedLayerIds };
}

function resolveSelectionUnitIds(layers: EditorLayer[], layerId: string): string[] {
  const layer = layers.find((candidate) => candidate.id === layerId);
  if (!layer?.groupId) {
    return layer ? [layer.id] : [];
  }
  return layers
    .filter((candidate) => candidate.groupId === layer.groupId)
    .map((candidate) => candidate.id);
}

function normalizeSelectedLayerIds(layers: EditorLayer[], selectedLayerIds: string[]): string[] {
  const selectedIdSet = new Set(selectedLayerIds);
  return layers.filter((layer) => selectedIdSet.has(layer.id)).map((layer) => layer.id);
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        present: {
          ...state.present,
          ...resolveLayerSelection(state.present, action.layerId, action),
          textSelection: null,
          textEditMode: false,
        },
      };
    case "select-range":
      return {
        ...state,
        present: {
          ...state.present,
          ...resolveLayerRangeSelection(state.present, action.layerIds, action.additive),
          textSelection: null,
          textEditMode: false,
        },
      };
    case "set-canvas-mode":
      return {
        ...state,
        canvasMode: action.mode,
        present:
          action.mode === "text"
            ? state.present
            : { ...state.present, textEditMode: false, textSelection: null },
      };
    case "set-text-edit":
      return {
        ...state,
        canvasMode: action.enabled
          ? "text"
          : state.canvasMode === "text"
            ? "move"
            : state.canvasMode,
        present: { ...state.present, textEditMode: action.enabled },
      };
    case "set-text-selection":
      return {
        ...state,
        canvasMode: "text",
        present: {
          ...state.present,
          selectedLayerId: action.layerId,
          selectedLayerIds: [action.layerId],
          textSelection: {
            layerId: action.layerId,
            anchor: action.anchor,
            focus: action.focus,
            focusAffinity: action.focusAffinity,
          },
          textEditMode: true,
        },
      };
    case "replace-text":
      return reduceReplaceText(state, action);
    case "clear-text-selection":
      return { ...state, present: { ...state.present, textSelection: null } };
    case "patch-canvas":
      return record(state, {
        ...state.present,
        document: {
          ...state.present.document,
          canvas: { ...state.present.document.canvas, ...action.patch },
        },
      });
    case "patch-layer": {
      const nextPresent = patchLayer(state.present, action.layerId, action.patch);
      return action.record === false
        ? { ...state, present: nextPresent }
        : record(state, nextPresent);
    }
    case "patch-layers": {
      const nextPresent = patchLayers(state.present, action.patches);
      return action.record === false
        ? { ...state, present: nextPresent }
        : record(state, nextPresent);
    }
    case "set-writing-mode":
      return reduceSetWritingMode(state, action);
    case "commit-preview":
      return {
        ...state,
        past: [...state.past.slice(-49), action.before],
        future: [],
      };
    case "add-layer":
      return reduceAddLayer(state, action);
    case "duplicate-layer":
      return reduceDuplicateLayer(state, action);
    case "delete-layer":
      return reduceDeleteLayer(state, action);
    case "move-layer-order":
      return reduceMoveLayerOrder(state, action);
    case "group-selection":
      return reduceGroupSelection(state);
    case "ungroup-selection":
      return reduceUngroupSelection(state);
    case "apply-shape-boolean":
      return reduceShapeBoolean(state, action.operation);
    case "apply-ruby":
      return applySelectionFormat(state, (text) => ({
        id: createEditorId("run"),
        kind: "ruby",
        base: text,
        rubyText: action.rubyText,
        rubyPosition: "over",
        rubyAlign: "center",
        rubyGapPx: 0,
        rubyOffsetPx: 0,
        rubyLineSizing: "stable",
      }));
    case "apply-inline":
      return applyInlineSelectionFormat(state, action.patch);
    case "clear-rich-format":
      return applySelectionFormat(state, (text) => ({
        id: createEditorId("run"),
        kind: "text",
        text,
      }));
    case "replace-document":
      return record(state, {
        document: structuredClone(action.document),
        selectedLayerId: action.selectedLayerId ?? action.document.layers.at(-1)?.id ?? null,
        selectedLayerIds: [action.selectedLayerId ?? action.document.layers.at(-1)?.id].filter(
          (layerId): layerId is string => layerId !== undefined,
        ),
        textSelection: null,
        textEditMode: false,
      });
    case "undo":
      return reduceUndo(state);
    case "redo":
      return reduceRedo(state);
    case "set-zoom":
      return { ...state, zoom: Math.min(2, Math.max(0.25, action.zoom)) };
    case "set-output-open":
      return { ...state, outputOpen: action.open };
  }
}

function reduceReplaceText(
  state: EditorState,
  action: Extract<EditorAction, { type: "replace-text" }>,
): EditorState {
  const sourceLayer = state.present.document.layers.find(
    (layer): layer is EditorTextLayer => layer.id === action.layerId && layer.type === "text",
  );
  if (!sourceLayer) {
    return state;
  }
  const nextRuns = replaceTextContent(sourceLayer.runs, action.text);
  const nextPresent = {
    ...patchLayer(state.present, sourceLayer.id, { runs: nextRuns }),
    textEditMode: true,
    textSelection: {
      layerId: sourceLayer.id,
      anchor: action.anchor,
      focus: action.focus,
      focusAffinity: "after" as const,
    },
  };
  if (nextRuns === sourceLayer.runs || action.record === false) {
    return { ...state, present: nextPresent };
  }
  return record(state, nextPresent);
}

function reduceSetWritingMode(
  state: EditorState,
  action: Extract<EditorAction, { type: "set-writing-mode" }>,
): EditorState {
  const document = state.present.document;
  const sourceLayer = document.layers.find(
    (layer): layer is EditorTextLayer => layer.id === action.layerId && layer.type === "text",
  );
  if (!sourceLayer) {
    return state;
  }
  const shouldFollow =
    document.canvas.followWritingMode &&
    !document.canvas.sizeLocked &&
    document.layers.length === 1;
  if (!shouldFollow) {
    return record(state, {
      ...patchLayer(state.present, sourceLayer.id, { writingMode: action.writingMode }),
      textSelection: null,
      textEditMode: false,
    });
  }
  const vertical = action.writingMode === "vertical-rl";
  return record(state, {
    ...state.present,
    textSelection: null,
    textEditMode: false,
    document: {
      ...document,
      canvas: {
        ...document.canvas,
        width: vertical ? 640 : 960,
        height: vertical ? 960 : 540,
      },
      layers: [
        {
          ...sourceLayer,
          writingMode: action.writingMode,
          x: vertical ? 60 : 80,
          y: 60,
          width: vertical ? 520 : 800,
          height: vertical ? 840 : 420,
        },
      ],
    },
  });
}

function createAddedLayer(layerType: EditorLayer["type"], index: number): EditorLayer {
  if (layerType === "text") {
    return createTextLayer({ x: 70 + index * 18, y: 60 + index * 18 });
  }
  if (layerType === "box") {
    return createBoxLayer({ x: 120 + index * 18, y: 100 + index * 18 });
  }
  return createShapeLayer({ x: 160 + index * 18, y: 120 + index * 18 });
}

function reduceAddLayer(
  state: EditorState,
  action: Extract<EditorAction, { type: "add-layer" }>,
): EditorState {
  const layer = createAddedLayer(action.layerType, state.present.document.layers.length);
  return record(state, {
    ...state.present,
    document: {
      ...state.present.document,
      canvas: { ...state.present.document.canvas, followWritingMode: false },
      layers: [...state.present.document.layers, layer],
    },
    selectedLayerId: layer.id,
    selectedLayerIds: [layer.id],
    textSelection: null,
  });
}

function reduceDuplicateLayer(
  state: EditorState,
  action: Extract<EditorAction, { type: "duplicate-layer" }>,
): EditorState {
  if (
    state.present.selectedLayerIds.length !== 1 ||
    state.present.selectedLayerIds[0] !== action.layerId
  ) {
    return state;
  }
  const source = state.present.document.layers.find((layer) => layer.id === action.layerId);
  if (!source) {
    return state;
  }
  const clone = structuredClone(source);
  clone.id = createEditorId(source.type);
  clone.name = `${source.name} copy`;
  clone.x += 24;
  clone.y += 24;
  if (clone.type === "text") {
    clone.runs = clone.runs.map((run) => ({ ...run, id: createEditorId("run") }));
  }
  return record(state, {
    ...state.present,
    document: {
      ...state.present.document,
      canvas: { ...state.present.document.canvas, followWritingMode: false },
      layers: [...state.present.document.layers, clone],
    },
    selectedLayerId: clone.id,
    selectedLayerIds: [clone.id],
  });
}

function reduceDeleteLayer(
  state: EditorState,
  action: Extract<EditorAction, { type: "delete-layer" }>,
): EditorState {
  const selectedLayerIds = state.present.selectedLayerIds.includes(action.layerId)
    ? state.present.selectedLayerIds
    : [action.layerId];
  const deletedLayerIdSet = new Set(selectedLayerIds);
  const layers = state.present.document.layers
    .filter((layer) => !deletedLayerIdSet.has(layer.id))
    .map((layer) =>
      layer.type === "text"
        ? {
            ...layer,
            flowBindings: layer.flowBindings.filter(
              (binding) => !deletedLayerIdSet.has(binding.layerId),
            ),
          }
        : layer,
    );
  const normalizedLayers = clearOrphanGroupIds(layers);
  const nextSelectedLayerId = normalizedLayers.at(-1)?.id ?? null;
  return record(state, {
    ...state.present,
    document: { ...state.present.document, layers: normalizedLayers },
    selectedLayerId: nextSelectedLayerId,
    selectedLayerIds: nextSelectedLayerId ? [nextSelectedLayerId] : [],
    textSelection: null,
  });
}

function clearOrphanGroupIds(layers: EditorLayer[]): EditorLayer[] {
  const groupCounts = new Map<string, number>();
  for (const layer of layers) {
    if (layer.groupId) {
      groupCounts.set(layer.groupId, (groupCounts.get(layer.groupId) ?? 0) + 1);
    }
  }
  return layers.map((layer) =>
    layer.groupId && groupCounts.get(layer.groupId) === 1
      ? ({ ...layer, groupId: undefined } as EditorLayer)
      : layer,
  );
}

function reduceMoveLayerOrder(
  state: EditorState,
  action: Extract<EditorAction, { type: "move-layer-order" }>,
): EditorState {
  if (state.present.selectedLayerIds.length !== 1) {
    return state;
  }
  const layers = [...state.present.document.layers];
  const index = layers.findIndex((layer) => layer.id === action.layerId);
  const target = index + action.direction;
  if (index < 0 || target < 0 || target >= layers.length) {
    return state;
  }
  const current = layers[index];
  const adjacent = layers[target];
  if (!current || !adjacent) {
    return state;
  }
  layers[index] = adjacent;
  layers[target] = current;
  return record(state, {
    ...state.present,
    document: { ...state.present.document, layers },
  });
}

function reduceGroupSelection(state: EditorState): EditorState {
  const selectedLayerIds = normalizeSelectedLayerIds(
    state.present.document.layers,
    state.present.selectedLayerIds,
  );
  if (selectedLayerIds.length < 2) {
    return state;
  }
  const selectedLayers = state.present.document.layers.filter((layer) =>
    selectedLayerIds.includes(layer.id),
  );
  const existingGroupId = selectedLayers[0]?.groupId;
  if (
    existingGroupId !== undefined &&
    selectedLayers.every((layer) => layer.groupId === existingGroupId)
  ) {
    return state;
  }
  const groupId = createEditorId("group");
  const selectedLayerIdSet = new Set(selectedLayerIds);
  return record(state, {
    ...state.present,
    document: {
      ...state.present.document,
      layers: state.present.document.layers.map((layer) =>
        selectedLayerIdSet.has(layer.id) ? { ...layer, groupId } : layer,
      ),
    },
    selectedLayerIds,
  });
}

function reduceUngroupSelection(state: EditorState): EditorState {
  const selectedLayers = state.present.document.layers.filter((layer) =>
    state.present.selectedLayerIds.includes(layer.id),
  );
  const groupIdSet = new Set(
    selectedLayers.flatMap((layer) => (layer.groupId ? [layer.groupId] : [])),
  );
  if (groupIdSet.size === 0) {
    return state;
  }
  return record(state, {
    ...state.present,
    document: {
      ...state.present.document,
      layers: state.present.document.layers.map((layer) =>
        layer.groupId && groupIdSet.has(layer.groupId)
          ? ({ ...layer, groupId: undefined } as EditorLayer)
          : layer,
      ),
    },
  });
}

function reduceShapeBoolean(state: EditorState, operation: BooleanOp): EditorState {
  const selectedIdSet = new Set(state.present.selectedLayerIds);
  const selectedLayers = state.present.document.layers.filter((layer) =>
    selectedIdSet.has(layer.id),
  );
  if (
    selectedLayers.length < 2 ||
    !selectedLayers.every((layer) => layer.type === "shape" && layer.visible && !layer.locked)
  ) {
    return state;
  }
  const shapeLayers = selectedLayers.filter((layer) => layer.type === "shape");
  const bounds = resolveLayerBounds(shapeLayers);
  const frontmostLayer = shapeLayers.at(-1);
  if (!bounds || !frontmostLayer) {
    return state;
  }
  const resultLayerId = createEditorId("shape");
  const resultLayer: EditorLayer = {
    ...frontmostLayer,
    id: resultLayerId,
    name: booleanResultName(operation),
    groupId: undefined,
    x: bounds.left,
    y: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
    rotateDeg: 0,
    customGeometry: createEditorBooleanGeometry(operation, shapeLayers, bounds),
  };
  const replacedLayers = state.present.document.layers.flatMap((layer) => {
    if (layer.id === frontmostLayer.id) {
      return [resultLayer];
    }
    return selectedIdSet.has(layer.id)
      ? []
      : [remapFlowBindings(layer, selectedIdSet, resultLayerId)];
  });
  return record(state, {
    ...state.present,
    document: {
      ...state.present.document,
      layers: clearOrphanGroupIds(replacedLayers),
    },
    selectedLayerId: resultLayerId,
    selectedLayerIds: [resultLayerId],
    textSelection: null,
    textEditMode: false,
  });
}

function remapFlowBindings(
  layer: EditorLayer,
  replacedLayerIds: Set<string>,
  resultLayerId: string,
): EditorLayer {
  if (layer.type !== "text") {
    return layer;
  }
  const bindingByLayerId = new Map<string, number>();
  for (const binding of layer.flowBindings) {
    const layerId = replacedLayerIds.has(binding.layerId) ? resultLayerId : binding.layerId;
    bindingByLayerId.set(layerId, Math.max(bindingByLayerId.get(layerId) ?? 0, binding.marginPx));
  }
  return {
    ...layer,
    flowBindings: Array.from(bindingByLayerId, ([layerId, marginPx]) => ({ layerId, marginPx })),
  };
}

function booleanResultName(operation: BooleanOp): string {
  switch (operation) {
    case "union":
      return "Union";
    case "subtract":
      return "Subtract";
    case "intersect":
      return "Intersect";
    case "xor":
      return "Exclude";
  }
}

function resolveLayerBounds(layers: EditorLayer[]) {
  if (layers.length === 0) {
    return null;
  }
  const points = layers.flatMap((layer) => {
    const centerX = layer.x + layer.width / 2;
    const centerY = layer.y + layer.height / 2;
    const radians = (layer.rotateDeg * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return [
      { x: layer.x, y: layer.y },
      { x: layer.x + layer.width, y: layer.y },
      { x: layer.x + layer.width, y: layer.y + layer.height },
      { x: layer.x, y: layer.y + layer.height },
    ].map((point) => {
      const offsetX = point.x - centerX;
      const offsetY = point.y - centerY;
      return {
        x: centerX + offsetX * cosine - offsetY * sine,
        y: centerY + offsetX * sine + offsetY * cosine,
      };
    });
  });
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function reduceUndo(state: EditorState): EditorState {
  const previous = state.past.at(-1);
  if (!previous) {
    return state;
  }
  return {
    ...state,
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future.slice(0, 49)],
  };
}

function reduceRedo(state: EditorState): EditorState {
  const next = state.future[0];
  if (!next) {
    return state;
  }
  return {
    ...state,
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
  };
}

function applySelectionFormat(
  state: EditorState,
  createRun: (text: string) => EditorTextRun,
): EditorState {
  const selection = state.present.textSelection;
  if (!selection || selection.anchor === selection.focus) {
    return state;
  }
  const layer = state.present.document.layers.find(
    (candidate): candidate is EditorTextLayer =>
      candidate.id === selection.layerId && candidate.type === "text",
  );
  if (!layer) {
    return state;
  }
  const start = Math.min(selection.anchor, selection.focus);
  const end = Math.max(selection.anchor, selection.focus);
  const nextRuns = replaceRunRange(layer.runs, start, end, createRun);
  const nextPresent = patchLayer(state.present, layer.id, { runs: nextRuns });
  return record(state, {
    ...nextPresent,
    textSelection: { ...selection, anchor: start, focus: end },
  });
}

function applyInlineSelectionFormat(
  state: EditorState,
  patch: Extract<EditorAction, { type: "apply-inline" }>["patch"],
): EditorState {
  const selection = state.present.textSelection;
  if (!selection || selection.anchor === selection.focus) {
    return state;
  }
  const layer = state.present.document.layers.find(
    (candidate): candidate is EditorTextLayer =>
      candidate.id === selection.layerId && candidate.type === "text",
  );
  if (!layer) {
    return state;
  }
  if (
    layer.writingMode !== "vertical-rl" &&
    (patch.textOrientation !== undefined || patch.textCombineUpright !== undefined)
  ) {
    return state;
  }
  const start = Math.min(selection.anchor, selection.focus);
  const end = Math.max(selection.anchor, selection.focus);
  const nextRuns = patchInlineRunRange(layer.runs, start, end, patch);
  if (nextRuns === layer.runs) {
    return state;
  }
  const nextPresent = patchLayer(state.present, layer.id, { runs: nextRuns });
  return record(state, {
    ...nextPresent,
    textSelection: { ...selection, anchor: start, focus: end },
  });
}

function patchInlineRunRange(
  runs: EditorTextRun[],
  start: number,
  end: number,
  patch: Extract<EditorAction, { type: "apply-inline" }>["patch"],
): EditorTextRun[] {
  const result: EditorTextRun[] = [];
  let cursor = 0;
  let changed = false;
  for (const run of runs) {
    const text = runText(run);
    const graphemes = splitEditorGraphemes(text);
    const runStart = cursor;
    const runEnd = cursor + graphemes.length;
    const overlapStart = Math.max(start, runStart);
    const overlapEnd = Math.min(end, runEnd);
    if (overlapStart >= overlapEnd || run.kind === "ruby") {
      result.push(run);
    } else {
      const before = graphemes.slice(0, overlapStart - runStart).join("");
      const middle = graphemes.slice(overlapStart - runStart, overlapEnd - runStart).join("");
      const after = graphemes.slice(overlapEnd - runStart).join("");
      if (before) {
        result.push(cloneRunWithText(run, before));
      }
      result.push({
        ...(run.kind === "inline" ? run : {}),
        id: createEditorId("run"),
        kind: "inline",
        text: middle,
        ...patch,
      });
      if (after) {
        result.push(cloneRunWithText(run, after));
      }
      changed = true;
    }
    cursor = runEnd;
  }
  return changed ? mergePlainRuns(result) : runs;
}

export function replaceRunRange(
  runs: EditorTextRun[],
  start: number,
  end: number,
  createRun: (text: string) => EditorTextRun,
): EditorTextRun[] {
  const result: EditorTextRun[] = [];
  let cursor = 0;
  let selectedText = "";
  for (const run of runs) {
    const text = run.kind === "ruby" ? run.base : run.text;
    const graphemes = splitEditorGraphemes(text);
    const runStart = cursor;
    const runEnd = cursor + graphemes.length;
    const overlapStart = Math.max(start, runStart);
    const overlapEnd = Math.min(end, runEnd);
    if (overlapStart >= overlapEnd) {
      result.push(run);
    } else {
      const before = graphemes.slice(0, overlapStart - runStart).join("");
      const middle = graphemes.slice(overlapStart - runStart, overlapEnd - runStart).join("");
      const after = graphemes.slice(overlapEnd - runStart).join("");
      if (before) {
        result.push(cloneRunWithText(run, before));
      }
      selectedText += middle;
      if (after) {
        result.push(cloneRunWithText(run, after));
      }
    }
    cursor = runEnd;
  }
  if (!selectedText) {
    return runs;
  }

  let insertionIndex = 0;
  let consumed = 0;
  for (const run of result) {
    const count = splitEditorGraphemes(run.kind === "ruby" ? run.base : run.text).length;
    if (consumed + count <= start) {
      insertionIndex += 1;
    }
    consumed += count;
  }
  result.splice(insertionIndex, 0, createRun(selectedText));
  return mergePlainRuns(result);
}

export function replaceTextContent(runs: EditorTextRun[], nextText: string): EditorTextRun[] {
  const currentText = runs.map(runText).join("");
  if (currentText === nextText) {
    return runs;
  }
  const currentGraphemes = splitEditorGraphemes(currentText);
  const nextGraphemes = splitEditorGraphemes(nextText);
  let prefixLength = 0;
  while (
    prefixLength < currentGraphemes.length &&
    prefixLength < nextGraphemes.length &&
    currentGraphemes[prefixLength] === nextGraphemes[prefixLength]
  ) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < currentGraphemes.length - prefixLength &&
    suffixLength < nextGraphemes.length - prefixLength &&
    currentGraphemes[currentGraphemes.length - 1 - suffixLength] ===
      nextGraphemes[nextGraphemes.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  const replacement = nextGraphemes
    .slice(prefixLength, nextGraphemes.length - suffixLength)
    .join("");
  const before = sliceRuns(runs, 0, prefixLength);
  const after = sliceRuns(runs, currentGraphemes.length - suffixLength, currentGraphemes.length);
  const replacementRuns: EditorTextRun[] = replacement
    ? [{ id: createEditorId("run"), kind: "text", text: replacement }]
    : [];
  return mergePlainRuns([...before, ...replacementRuns, ...after]);
}

function sliceRuns(runs: EditorTextRun[], start: number, end: number): EditorTextRun[] {
  if (start >= end) {
    return [];
  }
  const result: EditorTextRun[] = [];
  let cursor = 0;
  for (const run of runs) {
    const text = runText(run);
    const graphemes = splitEditorGraphemes(text);
    const overlapStart = Math.max(start, cursor);
    const overlapEnd = Math.min(end, cursor + graphemes.length);
    if (overlapStart < overlapEnd) {
      const slicedText = graphemes.slice(overlapStart - cursor, overlapEnd - cursor).join("");
      const includesWholeRun = overlapStart === cursor && overlapEnd === cursor + graphemes.length;
      result.push(includesWholeRun ? run : cloneRunWithText(run, slicedText));
    }
    cursor += graphemes.length;
  }
  return result;
}

function runText(run: EditorTextRun): string {
  return run.kind === "ruby" ? run.base : run.text;
}

function cloneRunWithText(run: EditorTextRun, text: string): EditorTextRun {
  if (run.kind === "ruby") {
    return { id: createEditorId("run"), kind: "text", text };
  }
  return { ...run, id: createEditorId("run"), text };
}

function mergePlainRuns(runs: EditorTextRun[]): EditorTextRun[] {
  const merged: EditorTextRun[] = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (previous?.kind === "text" && run.kind === "text") {
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + run.text,
      };
    } else {
      merged.push(run);
    }
  }
  return merged;
}
