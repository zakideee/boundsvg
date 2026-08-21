import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createEngineAsync, type Engine, type IRNode, type IRTextNode } from "@boundsvg/core";
import { initNodeWasm } from "@boundsvg/core/node";
import {
  canMoveLayerSelection,
  resolveLayerSelectionBounds,
  resolveMarqueeLayerIds,
  resolvePointerLayerId,
  resolveSelectionMoveDelta,
  rotateLayerSelection,
  scaleLayerSelection,
} from "../src/pages/playground/EditorCanvas.tsx";
import { buildEditorVNode } from "../src/pages/playground/editor-builder.tsx";
import {
  createBoxLayer,
  createInitialEditorState,
  createShapeLayer,
  createTextLayer,
  layerText,
  splitEditorGraphemes,
} from "../src/pages/playground/editor-model.ts";
import { EDITOR_PRESETS } from "../src/pages/playground/editor-presets.ts";
import {
  editorReducer,
  replaceRunRange,
  replaceTextContent,
  resolveLayerRangeSelection,
} from "../src/pages/playground/editor-reducer.ts";

test("initial writing mode follows a portrait canvas and supports undo/redo", () => {
  const initial = createInitialEditorState();
  const initialTextLayer = initial.present.document.layers[0];
  assert.equal(initialTextLayer?.type, "text");
  assert.equal(
    initialTextLayer?.type === "text" ? layerText(initialTextLayer) : "",
    "春の朝、空にやわらかな光が広がります。縦書きもルビも、キャンバス上で編集できます。\nboundsvg visual editor",
  );
  const vertical = editorReducer(initial, {
    type: "set-writing-mode",
    layerId: "text-main",
    writingMode: "vertical-rl",
  });

  assert.equal(vertical.present.document.canvas.width, 640);
  assert.equal(vertical.present.document.canvas.height, 960);
  assert.equal(vertical.present.document.layers[0]?.width, 520);
  assert.equal(vertical.present.document.layers[0]?.height, 840);

  const undone = editorReducer(vertical, { type: "undo" });
  assert.equal(undone.present.document.canvas.width, 960);
  const redone = editorReducer(undone, { type: "redo" });
  assert.equal(redone.present.document.canvas.height, 960);
});

test("frontmost Box frame wins over a rendered Text hit", () => {
  const textLayer = createTextLayer({ id: "text", x: 0, y: 0, width: 300, height: 200 });
  const boxLayer = createBoxLayer({ id: "box", x: 20, y: 20, width: 120, height: 80 });

  assert.equal(
    resolvePointerLayerId("text", { x: 60, y: 60 }, textLayer, [textLayer, boxLayer]),
    "box",
  );
  assert.equal(
    resolvePointerLayerId("text", { x: 60, y: 60 }, textLayer, [boxLayer, textLayer]),
    "text",
  );
});

test("Box hit fallback respects visibility and rotation", () => {
  const textLayer = createTextLayer({ id: "text", x: 0, y: 0, width: 300, height: 200 });
  const rotatedBox = createBoxLayer({
    id: "box",
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    rotateDeg: 90,
  });

  assert.equal(
    resolvePointerLayerId("text", { x: 50, y: 10 }, textLayer, [textLayer, rotatedBox]),
    "box",
  );
  assert.equal(
    resolvePointerLayerId("text", { x: 5, y: 5 }, textLayer, [textLayer, rotatedBox]),
    "text",
  );
  assert.equal(
    resolvePointerLayerId("text", { x: 50, y: 10 }, textLayer, [
      textLayer,
      { ...rotatedBox, visible: false },
    ]),
    "text",
  );
});

test("marquee selection intersects transformed visible layer quads", () => {
  const inside = createBoxLayer({ id: "inside", x: 10, y: 10, width: 20, height: 20 });
  const rotated = createShapeLayer({
    id: "rotated",
    x: 0,
    y: 45,
    width: 100,
    height: 10,
    rotateDeg: 45,
  });
  const hidden = createBoxLayer({
    id: "hidden",
    x: 15,
    y: 15,
    width: 10,
    height: 10,
    visible: false,
  });
  const outside = createBoxLayer({ id: "outside", x: 200, y: 200, width: 20, height: 20 });

  assert.deepEqual(
    resolveMarqueeLayerIds([inside, rotated, hidden, outside], {
      left: 5,
      top: 5,
      right: 55,
      bottom: 55,
    }),
    ["inside", "rotated"],
  );
});

test("range selection expands groups and can add to the current selection", () => {
  const initial = createInitialEditorState();
  const first = createShapeLayer({ id: "first", groupId: "group-a" });
  const second = createShapeLayer({ id: "second", groupId: "group-a" });
  const third = createBoxLayer({ id: "third" });
  const present = {
    ...initial.present,
    document: { ...initial.present.document, layers: [first, second, third] },
    selectedLayerId: "third",
    selectedLayerIds: ["third"],
  };

  assert.deepEqual(resolveLayerRangeSelection(present, ["first"]), {
    selectedLayerId: "first",
    selectedLayerIds: ["first", "second"],
  });
  assert.deepEqual(resolveLayerRangeSelection(present, ["first"], true), {
    selectedLayerId: "first",
    selectedLayerIds: ["first", "second", "third"],
  });
});

test("canvas mode stays outside document undo history", () => {
  const initial = createInitialEditorState();
  const rangeMode = editorReducer(initial, { type: "set-canvas-mode", mode: "range" });
  const changed = editorReducer(rangeMode, { type: "add-layer", layerType: "shape" });
  const undone = editorReducer(changed, { type: "undo" });

  assert.equal(rangeMode.past.length, 0);
  assert.equal(undone.canvasMode, "range");
  assert.equal(undone.present.document.layers.length, 1);
});

test("adding a layer disables automatic writing-mode canvas following", () => {
  const initial = createInitialEditorState();
  const withShape = editorReducer(initial, { type: "add-layer", layerType: "shape" });
  const changed = editorReducer(withShape, {
    type: "set-writing-mode",
    layerId: "text-main",
    writingMode: "vertical-rl",
  });

  assert.equal(changed.present.document.canvas.followWritingMode, false);
  assert.equal(changed.present.document.canvas.width, 960);
  assert.equal(changed.present.document.canvas.height, 540);
});

test("ruby formatting splits runs by grapheme and preserves the fixed base text", () => {
  const initial = createInitialEditorState();
  const selected = editorReducer(initial, {
    type: "set-text-selection",
    layerId: "text-main",
    anchor: 2,
    focus: 0,
  });
  const formatted = editorReducer(selected, { type: "apply-ruby", rubyText: "はるの" });
  const layer = formatted.present.document.layers[0];

  assert.equal(layer?.type, "text");
  if (layer?.type !== "text") {
    return;
  }
  assert.equal(layerText(layer), layerText(initial.present.document.layers[0] as typeof layer));
  assert.equal(layer.runs[0]?.kind, "ruby");
  assert.deepEqual(
    layer.runs[0]?.kind === "ruby"
      ? { base: layer.runs[0].base, reading: layer.runs[0].rubyText }
      : null,
    { base: "春の", reading: "はるの" },
  );
});

test("inline formatting preserves Ruby runs across a larger selection", () => {
  const preset = EDITOR_PRESETS.find((candidate) => candidate.id === "vertical-ruby");
  assert.ok(preset);
  let state = editorReducer(createInitialEditorState(), {
    type: "replace-document",
    document: preset.document,
  });
  const sourceLayer = state.present.document.layers[0];
  assert.equal(sourceLayer?.type, "text");
  if (sourceLayer?.type !== "text") {
    return;
  }
  const sourceText = layerText(sourceLayer);
  state = editorReducer(state, {
    type: "set-text-selection",
    layerId: sourceLayer.id,
    anchor: 0,
    focus: splitEditorGraphemes(sourceText).length,
  });
  state = editorReducer(state, {
    type: "apply-inline",
    patch: { textOrientation: "upright" },
  });
  const formattedLayer = state.present.document.layers[0];

  assert.equal(formattedLayer?.type, "text");
  if (formattedLayer?.type !== "text") {
    return;
  }
  assert.equal(layerText(formattedLayer), sourceText);
  assert.equal(
    formattedLayer.runs.some(
      (run) => run.kind === "ruby" && run.base === "山の端" && run.rubyText === "やまのは",
    ),
    true,
  );
  assert.equal(
    formattedLayer.runs.some((run) => run.kind === "inline" && run.textOrientation === "upright"),
    true,
  );
});

test("vertical-only inline formatting is ignored in horizontal text", () => {
  const selected = editorReducer(createInitialEditorState(), {
    type: "set-text-selection",
    layerId: "text-main",
    anchor: 42,
    focus: 50,
  });
  const formatted = editorReducer(selected, {
    type: "apply-inline",
    patch: { textOrientation: "upright" },
  });

  assert.equal(formatted, selected);
});

test("format removal merges adjacent plain runs", () => {
  const runs = [
    { id: "a", kind: "text" as const, text: "AB" },
    { id: "b", kind: "inline" as const, text: "CD", color: "#ff0000" },
    { id: "c", kind: "text" as const, text: "EF" },
  ];
  const result = replaceRunRange(runs, 1, 5, (text) => ({ id: "plain", kind: "text", text }));

  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind === "text" ? result[0].text : "", "ABCDEF");
});

test("format removal is pure when React evaluates the reducer more than once", () => {
  const initial = createInitialEditorState();
  const initialLayer = initial.present.document.layers[0];
  assert.equal(initialLayer?.type, "text");
  if (initialLayer?.type !== "text") {
    return;
  }
  const originalText = layerText(initialLayer);
  const selected = editorReducer(initial, {
    type: "set-text-selection",
    layerId: initialLayer.id,
    anchor: 25,
    focus: 64,
  });
  const accented = editorReducer(selected, {
    type: "apply-inline",
    patch: { color: "#38bdf8" },
  });
  const accentedSnapshot = structuredClone(accented);

  const firstEvaluation = editorReducer(accented, { type: "clear-rich-format" });
  const secondEvaluation = editorReducer(accented, { type: "clear-rich-format" });

  assert.deepEqual(accented, accentedSnapshot);
  for (const result of [firstEvaluation, secondEvaluation]) {
    const resultLayer = result.present.document.layers[0];
    assert.equal(resultLayer?.type === "text" ? layerText(resultLayer) : "", originalText);
  }
});

test("direct text editing preserves rich runs outside the changed range", () => {
  const runs = [
    { id: "a", kind: "text" as const, text: "Start " },
    {
      id: "ruby",
      kind: "ruby" as const,
      base: "春",
      rubyText: "はる",
      rubyPosition: "over" as const,
      rubyAlign: "center" as const,
      rubyGapPx: 0,
      rubyOffsetPx: 0,
      rubyLineSizing: "stable" as const,
    },
    { id: "b", kind: "text" as const, text: " end" },
  ];
  const result = replaceTextContent(runs, "New Start 春 end");

  assert.equal(result.find((run) => run.id === "ruby")?.kind, "ruby");
  assert.equal(
    result.map((run) => (run.kind === "ruby" ? run.base : run.text)).join(""),
    "New Start 春 end",
  );
});

test("IME composition previews collapse into one undo transaction", () => {
  const initial = createInitialEditorState();
  const selected = editorReducer(initial, {
    type: "set-text-selection",
    layerId: "text-main",
    anchor: 0,
    focus: 0,
  });
  const beforeComposition = selected.present;
  const preview = editorReducer(selected, {
    type: "replace-text",
    layerId: "text-main",
    text: "は",
    anchor: 1,
    focus: 1,
    record: false,
  });
  const converted = editorReducer(preview, {
    type: "replace-text",
    layerId: "text-main",
    text: "春",
    anchor: 1,
    focus: 1,
    record: false,
  });

  assert.equal(converted.past.length, selected.past.length);
  const committed = editorReducer(converted, {
    type: "commit-preview",
    before: beforeComposition,
  });
  assert.equal(committed.past.length, selected.past.length + 1);
  const undone = editorReducer(committed, { type: "undo" });
  const layer = undone.present.document.layers[0];
  assert.equal(
    layer?.type === "text" ? layerText(layer) : "",
    layerText(initial.present.document.layers[0] as ReturnType<typeof createTextLayer>),
  );
});

test("vertical Ruby sample uses one coherent passage with supported common kanji", () => {
  const preset = EDITOR_PRESETS.find((candidate) => candidate.id === "vertical-ruby");
  const layer = preset?.document.layers[0];

  assert.equal(layer?.type, "text");
  if (layer?.type !== "text") {
    return;
  }
  assert.equal(
    layerText(layer),
    "春の朝、空が少しずつ明るくなり、山の端にやわらかな光が広がります。縦書きでもAPI 2026の文字方向を確認できます。",
  );
  assert.equal(
    layer.runs.some((run) => run.kind === "ruby" && run.rubyText === "やまのは"),
    true,
  );
});

test("deleting an obstacle removes every text flow reference", () => {
  const textLayer = createTextLayer({
    id: "text",
    flowBindings: [{ layerId: "box", marginPx: 12 }],
  });
  const boxLayer = createBoxLayer({ id: "box" });
  const initial = createInitialEditorState();
  const populated = editorReducer(initial, {
    type: "replace-document",
    document: {
      canvas: initial.present.document.canvas,
      layers: [textLayer, boxLayer],
    },
  });
  const deleted = editorReducer(populated, { type: "delete-layer", layerId: "box" });
  const remaining = deleted.present.document.layers[0];

  assert.equal(remaining?.type, "text");
  assert.deepEqual(remaining?.type === "text" ? remaining.flowBindings : [], []);
});

test("Shift-click selection stays in document order and keeps a stable primary layer", () => {
  const initial = createInitialEditorState();
  const document = {
    canvas: initial.present.document.canvas,
    layers: [
      createTextLayer({ id: "text" }),
      createBoxLayer({ id: "box" }),
      createShapeLayer({ id: "shape" }),
    ],
  };
  let state = editorReducer(initial, { type: "replace-document", document });

  state = editorReducer(state, { type: "select", layerId: "text", additive: true });
  assert.deepEqual(state.present.selectedLayerIds, ["text", "shape"]);
  assert.equal(state.present.selectedLayerId, "text");

  state = editorReducer(state, { type: "select", layerId: "box", additive: true });
  assert.deepEqual(state.present.selectedLayerIds, ["text", "box", "shape"]);
  assert.equal(state.present.selectedLayerId, "box");

  state = editorReducer(state, { type: "select", layerId: "box", additive: true });
  assert.deepEqual(state.present.selectedLayerIds, ["text", "shape"]);
  assert.equal(state.present.selectedLayerId, "shape");

  const preserved = editorReducer(state, {
    type: "select",
    layerId: "text",
    preserveSelection: true,
  });
  assert.deepEqual(preserved.present.selectedLayerIds, ["text", "shape"]);
  assert.equal(preserved.present.selectedLayerId, "shape");
});

test("grouping mixed layers expands selection and supports undo, redo, and ungroup", () => {
  const initial = createInitialEditorState();
  const document = {
    canvas: initial.present.document.canvas,
    layers: [
      createTextLayer({ id: "text" }),
      createBoxLayer({ id: "box" }),
      createShapeLayer({ id: "shape" }),
    ],
  };
  let state = editorReducer(initial, { type: "replace-document", document });
  state = editorReducer(state, { type: "select", layerId: "text", additive: true });
  state = editorReducer(state, { type: "select", layerId: "box", additive: true });
  const beforeGrouping = state;
  state = editorReducer(state, { type: "group-selection" });

  const groupIds = new Set(state.present.document.layers.map((layer) => layer.groupId));
  assert.equal(groupIds.size, 1);
  assert.notEqual(state.present.document.layers[0]?.groupId, undefined);

  state = editorReducer(state, { type: "select", layerId: "box" });
  assert.deepEqual(state.present.selectedLayerIds, ["text", "box", "shape"]);
  assert.equal(state.present.selectedLayerId, "box");

  const undone = editorReducer(state, { type: "undo" });
  assert.deepEqual(
    undone.present.document.layers.map((layer) => layer.groupId),
    beforeGrouping.present.document.layers.map((layer) => layer.groupId),
  );
  const redone = editorReducer(undone, { type: "redo" });
  assert.equal(new Set(redone.present.document.layers.map((layer) => layer.groupId)).size, 1);

  const ungrouped = editorReducer(redone, { type: "ungroup-selection" });
  assert.deepEqual(
    ungrouped.present.document.layers.map((layer) => layer.groupId),
    [undefined, undefined, undefined],
  );
  const regrouped = editorReducer(ungrouped, { type: "undo" });
  assert.equal(new Set(regrouped.present.document.layers.map((layer) => layer.groupId)).size, 1);
});

test("deleting a multi-selection clears flow bindings and orphaned groups", () => {
  const initial = createInitialEditorState();
  const textLayer = createTextLayer({
    id: "text",
    flowBindings: [
      { layerId: "box", marginPx: 8 },
      { layerId: "shape", marginPx: 8 },
    ],
  });
  const boxLayer = createBoxLayer({ id: "box", groupId: "group-a" });
  const shapeLayer = createShapeLayer({ id: "shape" });
  let state = editorReducer(initial, {
    type: "replace-document",
    document: {
      canvas: initial.present.document.canvas,
      layers: [textLayer, boxLayer, shapeLayer],
    },
    selectedLayerId: "shape",
  });
  state = editorReducer(state, { type: "select", layerId: "box", additive: true });
  const deleted = editorReducer(state, { type: "delete-layer", layerId: "box" });

  assert.equal(deleted.present.document.layers.length, 1);
  const remainingAfterMultiDelete = deleted.present.document.layers[0];
  assert.deepEqual(
    remainingAfterMultiDelete?.type === "text" ? remainingAfterMultiDelete.flowBindings : [],
    [],
  );
  assert.deepEqual(deleted.present.selectedLayerIds, ["text"]);
  assert.equal(deleted.present.selectedLayerId, "text");

  const groupedTextLayer = { ...textLayer, groupId: "group-a" };
  const orphanState = editorReducer(initial, {
    type: "replace-document",
    document: {
      canvas: initial.present.document.canvas,
      layers: [groupedTextLayer, boxLayer, shapeLayer],
    },
    selectedLayerId: "shape",
  });
  const orphanDeleted = editorReducer(orphanState, { type: "delete-layer", layerId: "box" });
  const remainingText = orphanDeleted.present.document.layers.find((layer) => layer.id === "text");
  assert.equal(remainingText?.groupId, undefined);
  assert.deepEqual(remainingText?.type === "text" ? remainingText.flowBindings : [], [
    { layerId: "shape", marginPx: 8 },
  ]);
});

test("multi-layer preview movement commits as one undo transaction", () => {
  const initial = createInitialEditorState();
  const document = {
    canvas: initial.present.document.canvas,
    layers: [
      createBoxLayer({ id: "box", x: 20, y: 30 }),
      createShapeLayer({ id: "shape", x: 100, y: 120 }),
    ],
  };
  let state = editorReducer(initial, { type: "replace-document", document });
  state = editorReducer(state, { type: "select", layerId: "box", additive: true });
  const beforeMove = state.present;
  const historyLength = state.past.length;
  state = editorReducer(state, {
    type: "patch-layers",
    record: false,
    patches: [
      { layerId: "box", patch: { x: 45, y: 50 } },
      { layerId: "shape", patch: { x: 125, y: 140 } },
    ],
  });
  assert.equal(state.past.length, historyLength);
  state = editorReducer(state, { type: "commit-preview", before: beforeMove });
  assert.equal(state.past.length, historyLength + 1);

  const undone = editorReducer(state, { type: "undo" });
  assert.deepEqual(
    undone.present.document.layers.map(({ x, y }) => ({ x, y })),
    [
      { x: 20, y: 30 },
      { x: 100, y: 120 },
    ],
  );
  const redone = editorReducer(undone, { type: "redo" });
  assert.deepEqual(
    redone.present.document.layers.map(({ x, y }) => ({ x, y })),
    [
      { x: 45, y: 50 },
      { x: 125, y: 140 },
    ],
  );
});

test("multi-selection bounds include rotated layer quads", () => {
  const bounds = resolveLayerSelectionBounds([
    createBoxLayer({ id: "box", x: 10, y: 20, width: 20, height: 10, rotateDeg: 90 }),
    createShapeLayer({ id: "shape", x: 50, y: 60, width: 10, height: 20 }),
  ]);

  assert.deepEqual(bounds, { left: 15, top: 15, right: 60, bottom: 80 });
});

test("multi-selection movement clamps the shared delta at canvas boundaries", () => {
  const layers = [
    createBoxLayer({ id: "box", x: 10, y: 20, width: 20, height: 10 }),
    createShapeLayer({ id: "shape", x: 70, y: 60, width: 20, height: 20 }),
  ];

  assert.deepEqual(resolveSelectionMoveDelta(layers, { width: 100, height: 100 }, -50, -50), {
    x: -10,
    y: -20,
  });
  assert.deepEqual(resolveSelectionMoveDelta(layers, { width: 100, height: 100 }, 50, 50), {
    x: 10,
    y: 20,
  });
});

test("a selection containing a locked group member cannot start shared movement", () => {
  const unlockedLayers = [
    createBoxLayer({ id: "box", groupId: "group-a" }),
    createShapeLayer({ id: "shape", groupId: "group-a" }),
  ];
  const lockedLayers = unlockedLayers.map((layer, index) => ({
    ...layer,
    locked: index === 1,
  }));

  assert.equal(canMoveLayerSelection(unlockedLayers), true);
  assert.equal(canMoveLayerSelection(lockedLayers), false);
});

test("group rotation updates member centers and rotations around shared bounds", () => {
  const layers = [
    createBoxLayer({ id: "box", x: 20, y: 50, width: 20, height: 20, rotateDeg: 10 }),
    createShapeLayer({ id: "shape", x: 60, y: 50, width: 20, height: 20 }),
  ];
  const patches = rotateLayerSelection(layers, { left: 20, top: 50, right: 80, bottom: 70 }, 90, {
    width: 200,
    height: 200,
  });

  assert.deepEqual(patches, [
    {
      layerId: "box",
      patch: { x: 40, y: 30, width: 20, height: 20, rotateDeg: 100 },
    },
    {
      layerId: "shape",
      patch: { x: 40, y: 70, width: 20, height: 20, rotateDeg: 90 },
    },
  ]);
});

test("group corner resize scales member frames proportionally", () => {
  const layers = [
    createBoxLayer({ id: "box", x: 20, y: 20, width: 20, height: 20 }),
    createShapeLayer({ id: "shape", x: 60, y: 20, width: 20, height: 20 }),
  ];
  const patches = scaleLayerSelection(
    layers,
    { left: 20, top: 20, right: 80, bottom: 40 },
    "se",
    { x: 140, y: 60 },
    { width: 300, height: 300 },
  );

  assert.deepEqual(patches, [
    {
      layerId: "box",
      patch: { x: 20, y: 20, width: 40, height: 40, rotateDeg: 0 },
    },
    {
      layerId: "shape",
      patch: { x: 100, y: 20, width: 40, height: 40, rotateDeg: 0 },
    },
  ]);
});

test("Shape Boolean operations preserve front paint, z-order, flow bindings, and Undo", () => {
  const initial = createInitialEditorState();
  const textLayer = createTextLayer({
    id: "text",
    flowBindings: [
      { layerId: "back", marginPx: 4 },
      { layerId: "front", marginPx: 8 },
    ],
  });
  const backShape = createShapeLayer({ id: "back", x: 20, y: 30, fill: "#111111" });
  const frontShape = createShapeLayer({
    id: "front",
    x: 80,
    y: 40,
    fill: "#abcdef",
    stroke: "#123456",
  });
  let state = editorReducer(initial, {
    type: "replace-document",
    document: {
      canvas: initial.present.document.canvas,
      layers: [textLayer, backShape, frontShape],
    },
    selectedLayerId: "front",
  });
  state = editorReducer(state, { type: "select", layerId: "back", additive: true });
  const beforeBoolean = state.present;
  state = editorReducer(state, { type: "apply-shape-boolean", operation: "subtract" });

  assert.equal(state.present.document.layers.length, 2);
  const resultLayer = state.present.document.layers[1];
  assert.equal(resultLayer?.type, "shape");
  if (resultLayer?.type !== "shape") {
    return;
  }
  assert.equal(resultLayer.name, "Subtract");
  assert.equal(resultLayer.fill, "#abcdef");
  assert.equal(resultLayer.stroke, "#123456");
  assert.equal(resultLayer.customGeometry?.root.kind, "boolean");
  if (resultLayer.customGeometry?.root.kind === "boolean") {
    assert.equal(resultLayer.customGeometry.root.op, "subtract");
    assert.equal(resultLayer.customGeometry.root.children.length, 2);
  }
  const remainingText = state.present.document.layers[0];
  assert.deepEqual(remainingText?.type === "text" ? remainingText.flowBindings : [], [
    { layerId: resultLayer.id, marginPx: 8 },
  ]);
  assert.deepEqual(state.present.selectedLayerIds, [resultLayer.id]);

  const undone = editorReducer(state, { type: "undo" });
  assert.deepEqual(undone.present.document, beforeBoolean.document);
});

test("all four Shape Boolean documents compile through the editor render path", async () => {
  await initNodeWasm();
  const engine = await createEngineAsync({ fonts: [] });
  const initial = createInitialEditorState();
  for (const operation of ["union", "subtract", "intersect", "xor"] as const) {
    let state = editorReducer(initial, {
      type: "replace-document",
      document: {
        canvas: initial.present.document.canvas,
        layers: [
          createShapeLayer({ id: `back-${operation}`, x: 20, y: 20 }),
          createShapeLayer({ id: `front-${operation}`, x: 90, y: 50, rotateDeg: 20 }),
        ],
      },
      selectedLayerId: `front-${operation}`,
    });
    state = editorReducer(state, {
      type: "select",
      layerId: `back-${operation}`,
      additive: true,
    });
    state = editorReducer(state, { type: "apply-shape-boolean", operation });
    const buildResult = buildEditorVNode(engine, state.present.document);
    const rendered = engine.renderToSvgAndIR(buildResult.vnode, { textPathMode: "glyphs" });
    assert.match(rendered.svg, /<path/);
  }
});

test("multiple Shape flow exclusions keep one renderable Text node", async () => {
  await initNodeWasm();
  const engine = await createEngineAsync({
    fonts: [
      {
        alias: "NotoSansJP-woff2",
        weight: 400,
        style: "normal",
        data: new Uint8Array(
          readFileSync(
            new URL("../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf", import.meta.url),
          ),
        ),
      },
    ],
  });
  const initial = createInitialEditorState();
  const shapes = [
    createShapeLayer({ id: "shape-a", x: 700, y: 165, width: 180, height: 140 }),
    createShapeLayer({ id: "shape-b", x: 720, y: 185, width: 180, height: 140 }),
  ];
  const textLayer = createTextLayer({
    id: "text-main",
    flowBindings: shapes.map((shape) => ({ layerId: shape.id, marginPx: 8 })),
  });

  const result = buildEditorVNode(engine, {
    canvas: initial.present.document.canvas,
    layers: [textLayer, ...shapes],
  });
  const textNodes = result.vnode.children.slice(0, -shapes.length);
  assert.equal(textNodes.length, 1);
  const textNode = textNodes[0];
  assert.notEqual(typeof textNode, "string");
  if (typeof textNode === "string" || !textNode) {
    return;
  }
  assert.equal(textNode.type, "Text");
  assert.equal(textNode.props.flowExclusions?.length, 2);
  assert.equal(textNode.props.whiteSpace, "pre-wrap");
  assert.equal(textNode.props.tabSize, 4);

  const rendered = engine.renderToSvgAndIR(result.vnode, { textPathMode: "glyphs" });
  assert.match(rendered.svg, /<path/);
  assert.equal(rendered.svg.includes("__flow__"), false);
  assert.deepEqual(
    [...engine.renderToPng(result.vnode).slice(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  const collectTextNodes = (node: IRNode): IRTextNode[] => [
    ...(node.type === "text" ? [node] : []),
    ...(node.children ?? []).flatMap(collectTextNodes),
  ];
  const renderedTextNodes = collectTextNodes(rendered.ir.root);
  assert.equal(renderedTextNodes.length, 1);
  assert.equal(renderedTextNodes[0]?.nodeId, "text-main");

  const regularResult = buildEditorVNode(engine, {
    canvas: initial.present.document.canvas,
    layers: [{ ...textLayer, flowBindings: [] }, ...shapes],
  });
  const regularRendered = engine.renderToSvgAndIR(regularResult.vnode, {
    textPathMode: "glyphs",
  });
  const regularTextNode = collectTextNodes(regularRendered.ir.root)[0];
  assert.notDeepEqual(
    renderedTextNodes[0]?.glyphPaths?.map((path) => path.bbox),
    regularTextNode?.glyphPaths?.map((path) => path.bbox),
  );
});

test("starting text selection collapses multi-selection to the edited text layer", () => {
  const initial = createInitialEditorState();
  const document = {
    canvas: initial.present.document.canvas,
    layers: [createTextLayer({ id: "text" }), createShapeLayer({ id: "shape" })],
  };
  let state = editorReducer(initial, { type: "replace-document", document });
  state = editorReducer(state, { type: "select", layerId: "text", additive: true });
  state = editorReducer(state, {
    type: "set-text-selection",
    layerId: "text",
    anchor: 0,
    focus: 0,
  });

  assert.deepEqual(state.present.selectedLayerIds, ["text"]);
  assert.equal(state.present.selectedLayerId, "text");
  assert.equal(state.present.textEditMode, true);
});

test("VNode is derived from the plain document and omits hidden layers", () => {
  const document = createInitialEditorState().present.document;
  const hiddenBox = createBoxLayer({ id: "hidden", visible: false });
  const groupedText = createTextLayer({ id: "text-main", groupId: "editor-group-secret" });
  const result = buildEditorVNode({} as unknown as Engine, {
    ...document,
    layers: [groupedText, hiddenBox],
  });

  assert.equal(result.vnode.type, "Canvas");
  assert.equal(result.vnode.props.width, 960);
  assert.equal(result.vnode.props.height, 540);
  assert.equal(result.vnode.children.length, 1);
  const text = result.vnode.children[0];
  assert.notEqual(typeof text, "string");
  if (typeof text === "string") {
    return;
  }
  assert.equal(text?.type, "Text");
  assert.equal(text?.props.id, "text-main");
  assert.equal(JSON.stringify(result.vnode).includes("editor-group-secret"), false);
});

test("flow exclusions bake obstacle rotation into Text-local geometry", async () => {
  await initNodeWasm();
  const engine = {} as unknown as Engine;
  const textLayer = createTextLayer({
    id: "flow-text",
    x: 5,
    y: 10,
    flowBindings: [{ layerId: "rotated-box", marginPx: 8 }],
  });
  const rotatedBox = createBoxLayer({
    id: "rotated-box",
    x: 10,
    y: 20,
    width: 20,
    height: 10,
    rotateDeg: 90,
  });
  const initial = createInitialEditorState();

  const result = buildEditorVNode(engine, {
    canvas: initial.present.document.canvas,
    layers: [textLayer, rotatedBox],
  });

  const textNode = result.vnode.children[0];
  assert.notEqual(typeof textNode, "string");
  if (typeof textNode === "string" || !textNode) {
    return;
  }
  const exclusion = textNode.props.flowExclusions?.[0];
  assert.equal(exclusion?.kind, "path");
  if (exclusion?.kind === "path") {
    assert.equal(exclusion.d, "M20 5L20 25L10 25L10 5L20 5Z");
    assert.equal(exclusion.marginPx, 8);
  }
});
