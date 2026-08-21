import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { hitTest } from "../../src/ir/hit-test.js";
import {
  buildInspectHitTestIndex,
  inspectHitTestCandidates,
} from "../../src/ir/inspect-hit-test.js";
import type { IR, IRNode } from "../../src/ir/types.js";
import { renderLayeredSvg, snapshotLayerSourceMetadata } from "../../src/layered-svg.js";
import type { LayoutNode } from "../../src/layout/types.js";
import type { LayoutTransitionInput } from "../../src/layout-transition.js";
import { LAYOUT_TRANSITION_WRAPPER_META } from "../../src/layout-transition.js";
import type { SceneNode } from "../../src/scene/types.js";
import {
  type AffineMatrix,
  applyAffineMatrixToPoint,
  createIdentityAffineMatrix,
  multiplyAffineMatrices,
} from "../../src/transform.js";
import type { WasmEngineHandle } from "../../src/wasm/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";
import {
  collectFixtureNodes,
  createLayoutTransitionNegativeFixtures,
  createPortableLayoutTransitionInput,
  createPortableLayoutTransitionState,
  findFixtureNode,
  PORTABLE_LAYOUT_TRANSITION_CANVAS,
  PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS,
  PORTABLE_LAYOUT_TRANSITION_GOLDEN_BBOXES,
  PORTABLE_LAYOUT_TRANSITION_SHOVE_PX,
  PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS,
} from "./fixtures/layout-transition.js";

function findLayoutNode(root: LayoutNode, nodeId: string): LayoutNode {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.shift();
    if (node?.nodeId === nodeId) {
      return node;
    }
    if (node) {
      pending.unshift(...node.children);
    }
  }
  throw new RangeError(`Missing layout node ${nodeId}`);
}

function collectLayoutBBoxes(root: LayoutNode): Record<string, LayoutNode["bbox"]> {
  const bboxes: Record<string, LayoutNode["bbox"]> = {};
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.shift();
    if (!node) {
      continue;
    }
    bboxes[node.nodeId] = node.bbox;
    pending.unshift(...node.children);
  }
  return bboxes;
}

function findIrNode(root: IRNode, nodeId: string): IRNode {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.shift();
    if (!node) {
      continue;
    }
    if (node.nodeId === nodeId) {
      return node;
    }
    if (node.type === "group") {
      pending.unshift(...node.children);
    }
  }
  throw new RangeError(`Missing IR node ${nodeId}`);
}

type RawAnimationStateSample = {
  nodeId: string;
  transform?: AffineMatrix;
};

function sampleGeneratedBBoxes(
  handle: WasmEngineHandle,
  ir: IR,
  timeMs: number,
): Map<string, { x: number; y: number; width: number; height: number }> {
  const samples = JSON.parse(
    handle.sampleAnimationState(JSON.stringify(ir), timeMs),
  ) as RawAnimationStateSample[];
  const generatedTransforms = new Map(
    samples
      .filter((sample) => sample.nodeId.startsWith("__boundsvg:layout-transition-wrapper:"))
      .map((sample) => [sample.nodeId, sample.transform ?? createIdentityAffineMatrix()]),
  );
  const sampledBBoxes = new Map<string, { x: number; y: number; width: number; height: number }>();

  function walk(node: IRNode, ancestorMatrix: AffineMatrix): void {
    const ownMatrix = generatedTransforms.get(node.nodeId) ?? createIdentityAffineMatrix();
    const worldMatrix = multiplyAffineMatrices(ancestorMatrix, ownMatrix);
    const corners = [
      { x: node.bbox.x, y: node.bbox.y },
      { x: node.bbox.x + node.bbox.w, y: node.bbox.y },
      { x: node.bbox.x, y: node.bbox.y + node.bbox.h },
      { x: node.bbox.x + node.bbox.w, y: node.bbox.y + node.bbox.h },
    ].map((point) => applyAffineMatrixToPoint(worldMatrix, point));
    const xValues = corners.map((point) => point.x);
    const yValues = corners.map((point) => point.y);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    if (node.type === "group") {
      sampledBBoxes.set(node.nodeId, {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      });
      for (const child of node.children) {
        walk(child, worldMatrix);
      }
    }
  }

  walk(ir.root, createIdentityAffineMatrix());
  return sampledBBoxes;
}

function semanticSignature(root: SceneNode): Array<{
  id: string | undefined;
  type: string;
  parentId: string | null;
  order: number;
}> {
  const signature: Array<{
    id: string | undefined;
    type: string;
    parentId: string | null;
    order: number;
  }> = [];
  const pending: Array<{ node: SceneNode; parentId: string | null; order: number }> = [
    { node: root, parentId: null, order: 0 },
  ];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) {
      continue;
    }
    signature.push({
      id: current.node.id,
      type: current.node.type,
      parentId: current.parentId,
      order: current.order,
    });
    const children =
      "children" in current.node && Array.isArray(current.node.children)
        ? current.node.children.filter((child): child is SceneNode => typeof child !== "string")
        : [];
    pending.unshift(
      ...children.map((node, order) => ({ node, parentId: current.node.id ?? null, order })),
    );
  }
  return signature;
}

function createCanvasStrokeTransition(
  targetWidth: number,
  targetHeight: number,
  kind: "box" | "path" = "box",
): LayoutTransitionInput {
  const state = (width: number, height: number): SceneNode => {
    const strokeNode: SceneNode =
      kind === "box"
        ? {
            type: "Box",
            id: "stroke-box",
            width,
            height,
            borderWidth: 2,
            borderColor: "#ffffff",
            strokeScaling: "canvas",
            children: [],
          }
        : {
            type: "Path",
            id: "stroke-path",
            width,
            height,
            d: "M0 0H40V40H0Z",
            fill: "none",
            stroke: "#ffffff",
            strokeWidth: 2,
            strokeScaling: "canvas",
          };
    return {
      type: "Canvas",
      id: "stroke-scene",
      width: 200,
      height: 200,
      children: [strokeNode],
    };
  };
  return {
    states: { A: state(40, 40), B: state(targetWidth, targetHeight) },
    checkpoints: PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS,
  };
}

function createNestedResidualTransition(options: {
  targetChildWidth: number;
  targetChildHeight: number;
  authoredTransform: boolean;
  canvasStroke: boolean;
}): LayoutTransitionInput {
  const state = (
    parentWidth: number,
    parentHeight: number,
    childWidth: number,
    childHeight: number,
  ): SceneNode => ({
    type: "Canvas",
    id: "residual-scene",
    width: 240,
    height: 240,
    children: [
      {
        type: "Box",
        id: "residual-parent",
        position: "absolute",
        left: 20,
        top: 20,
        width: parentWidth,
        height: parentHeight,
        children: [
          {
            type: "Box",
            id: "residual-child",
            position: "absolute",
            left: 10,
            top: 10,
            width: childWidth,
            height: childHeight,
            ...(options.canvasStroke
              ? { borderWidth: 2, borderColor: "#ffffff", strokeScaling: "canvas" as const }
              : { backgroundColor: "#ffffff" }),
            ...(options.authoredTransform ? { transform: { translateX: 3 } } : {}),
            children: [],
          },
        ],
      },
    ],
  });
  return {
    states: {
      A: state(80, 80, 40, 20),
      B: state(160, 120, options.targetChildWidth, options.targetChildHeight),
    },
    checkpoints: PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS,
  };
}

function interpolateIrBBox(
  reference: IRNode["bbox"],
  target: IRNode["bbox"],
  progress: number,
): { x: number; y: number; width: number; height: number } {
  const interpolate = (from: number, to: number) => from + (to - from) * progress;
  return {
    x: interpolate(reference.x, target.x),
    y: interpolate(reference.y, target.y),
    width: interpolate(reference.w, target.w),
    height: interpolate(reference.h, target.h),
  };
}

function maxBBoxComponentError(
  observed: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
): number {
  return Math.max(
    Math.abs(observed.x - expected.x),
    Math.abs(observed.y - expected.y),
    Math.abs(observed.width - expected.width),
    Math.abs(observed.height - expected.height),
  );
}

describe("portable layout transition fixture", () => {
  let handle: WasmEngineHandle;
  let engine: Engine;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
    engine = createEngineFromHandle(handle, { svgToPngFn: handle.createSvgToPngFn() });
  });

  afterAll(() => {
    engine.dispose();
    handle.dispose();
  });

  it("uses exactly two states and the A/B/hold/A acceptance schedule", () => {
    const input = createPortableLayoutTransitionInput();
    expect(Object.keys(input.states)).toEqual(["A", "B"]);
    expect(input.checkpoints).toEqual(PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS);
  });

  it("changes only the slot height while preserving semantic topology and authored data", () => {
    const stateA = createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A);
    const stateB = createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.B);

    const nodesA = collectFixtureNodes(stateA);
    const nodesB = collectFixtureNodes(stateB);
    expect(
      [...nodesA, ...nodesB].every((node) => typeof node.id === "string" && node.id.length > 0),
    ).toBe(true);
    expect(semanticSignature(stateB)).toEqual(semanticSignature(stateA));

    const normalizedA = structuredClone(stateA);
    const normalizedB = structuredClone(stateB);
    const slotA = findFixtureNode(normalizedA, "slot");
    const slotB = findFixtureNode(normalizedB, "slot");
    if (slotA.type !== "Box" || slotB.type !== "Box") {
      throw new TypeError("Expected slot fixture Boxes");
    }
    slotA.height = 0;
    slotB.height = 0;
    expect(normalizedB).toEqual(normalizedA);
  });

  it("produces an exact 72px nested shove in independent full-layout states", () => {
    const stateA = createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A);
    const stateB = createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.B);
    const layoutA = engine.renderToLayoutTree(stateA).root;
    const layoutB = engine.renderToLayoutTree(stateB).root;

    expect(collectLayoutBBoxes(layoutA)).toEqual(PORTABLE_LAYOUT_TRANSITION_GOLDEN_BBOXES.A);
    expect(collectLayoutBBoxes(layoutB)).toEqual(PORTABLE_LAYOUT_TRANSITION_GOLDEN_BBOXES.B);

    expect(layoutA.bbox).toEqual({
      x: 0,
      y: 0,
      width: PORTABLE_LAYOUT_TRANSITION_CANVAS.width,
      height: PORTABLE_LAYOUT_TRANSITION_CANVAS.height,
    });
    expect(layoutB.bbox).toEqual(layoutA.bbox);

    const slotA = findLayoutNode(layoutA, "slot").bbox;
    const slotB = findLayoutNode(layoutB, "slot").bbox;
    expect(slotA.height).toBe(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A);
    expect(slotB.height).toBe(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.B);
    expect(slotB.x).toBe(slotA.x);
    expect(slotB.y).toBe(slotA.y);
    expect(slotB.width).toBe(slotA.width);

    for (const nodeId of ["tail", "message-1", "message-1-text", "message-2", "message-2-text"]) {
      const bboxA = findLayoutNode(layoutA, nodeId).bbox;
      const bboxB = findLayoutNode(layoutB, nodeId).bbox;
      expect(bboxB.x).toBe(bboxA.x);
      expect(bboxB.y - bboxA.y).toBe(PORTABLE_LAYOUT_TRANSITION_SHOVE_PX);
      expect(bboxB.width).toBe(bboxA.width);
      expect(bboxB.height).toBe(bboxA.height);
    }

    const tailA = findLayoutNode(layoutA, "tail").bbox;
    const tailB = findLayoutNode(layoutB, "tail").bbox;
    for (const childId of ["message-1", "message-2"]) {
      const childA = findLayoutNode(layoutA, childId).bbox;
      const childB = findLayoutNode(layoutB, childId).bbox;
      expect(childA.y - tailA.y).toBe(childB.y - tailB.y);
    }
  });

  it("keeps authored transform/opacity and visibility tracks on movable groups", () => {
    const state = createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A);
    const tail = findFixtureNode(state, "tail");
    const message1 = findFixtureNode(state, "message-1");
    const message2 = findFixtureNode(state, "message-2");
    expect(tail.type === "Box" ? tail.animate?.keyframes : undefined).toEqual([
      { at: 0, opacity: 0.15, transform: { translateY: 12 } },
      { at: 1, opacity: 1, transform: { translateY: 0 } },
    ]);
    expect(message1.type === "Box" ? message1.animate?.keyframes : undefined).toEqual([
      { at: 0, opacity: 0.15, transform: { translateY: 12 } },
      { at: 1, opacity: 1, transform: { translateY: 0 } },
    ]);
    expect(message2.type === "Box" ? message2.animate?.keyframes : undefined).toEqual([
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ]);
  });

  it("returns an ordinary CompiledScene accepted by compiled SVG and PNG entries", () => {
    const compiled = engine.compileLayoutTransition(createPortableLayoutTransitionInput(), {
      textPathMode: "merged",
    });

    expect(Object.keys(compiled).sort()).toEqual(["height", "ir", "textPathMode", "width"]);
    expect(compiled.width).toBe(PORTABLE_LAYOUT_TRANSITION_CANVAS.width);
    expect(compiled.height).toBe(PORTABLE_LAYOUT_TRANSITION_CANVAS.height);
    expect(engine.renderCompiledToSvg(compiled, { animation: "static", timeMs: 0 })).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg"',
    );
    expect(
      Array.from(
        engine.renderCompiledToPng(compiled, { animation: "static", timeMs: 0 }).slice(0, 8),
      ),
    ).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("renders transition CompiledScene checkpoints through compiled SVG and PNG frames", () => {
    const compiled = engine.compileLayoutTransition(createPortableLayoutTransitionInput());
    const timesMs = PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS.map((checkpoint) => checkpoint.timeMs);
    const svgFrames = [...engine.renderCompiledFrames(compiled, { timesMs, format: "svg" })];
    const pngFrames = [...engine.renderCompiledFrames(compiled, { timesMs, format: "png" })];

    expect(svgFrames).toHaveLength(timesMs.length);
    expect(pngFrames).toHaveLength(timesMs.length);
    for (const [index, timeMs] of timesMs.entries()) {
      expect(svgFrames[index]).toEqual({
        index,
        timeMs,
        format: "svg",
        data: engine.renderCompiledToSvg(compiled, { animation: "static", timeMs }),
      });
      expect(pngFrames[index]).toEqual({
        index,
        timeMs,
        format: "png",
        data: engine.renderCompiledToPng(compiled, { animation: "static", timeMs }),
      });
    }
  });

  it("does not re-enter either compile transport while sampling compiled transition frames", () => {
    let transitionCompileCount = 0;
    let ordinaryCompileCount = 0;
    let prepareCount = 0;
    let frameRenderCount = 0;
    const countedEngine = createEngineFromHandle(handle, {
      compileLayoutTransitionFn: (...transportArgs) => {
        transitionCompileCount += 1;
        return handle.compileLayoutTransition(...transportArgs);
      },
      renderToIrFn: (inputJson, optionsJson) => {
        ordinaryCompileCount += 1;
        return handle.renderToIr(inputJson, optionsJson);
      },
      prepareSceneFn: (irJson, optionsJson) => {
        prepareCount += 1;
        const prepared = handle.prepareScene(irJson, optionsJson);
        return {
          renderToSvg: (renderOptionsJson) => {
            frameRenderCount += 1;
            return prepared.renderToSvg(renderOptionsJson);
          },
          dispose: () => prepared.dispose(),
        };
      },
    });

    try {
      const compiled = countedEngine.compileLayoutTransition(createPortableLayoutTransitionInput());
      expect(transitionCompileCount).toBe(1);
      expect(ordinaryCompileCount).toBe(0);

      const frames = [
        ...countedEngine.renderCompiledFrames(compiled, {
          timesMs: [0, 150, 500, 850, 1_000],
          format: "svg",
        }),
      ];
      expect(frames).toHaveLength(5);
      expect(transitionCompileCount).toBe(1);
      expect(ordinaryCompileCount).toBe(0);
      expect(prepareCount).toBe(1);
      expect(frameRenderCount).toBe(5);
    } finally {
      countedEngine.dispose();
    }
  });

  it("injects deterministic outer tracks while preserving authored semantic IR", () => {
    const reference = engine.compile(
      createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A),
    );
    const compiled = engine.compileLayoutTransition(createPortableLayoutTransitionInput());
    const slotWrapper = findIrNode(compiled.ir.root, "__boundsvg:layout-transition-wrapper:4:slot");
    const slotContentWrapper = findIrNode(
      compiled.ir.root,
      "__boundsvg:layout-transition-wrapper:5:slot-content",
    );
    const tailWrapper = findIrNode(compiled.ir.root, "__boundsvg:layout-transition-wrapper:7:tail");

    for (const [wrapper, sourceNodeId] of [
      [slotWrapper, "slot"],
      [slotContentWrapper, "slot-content"],
      [tailWrapper, "tail"],
    ] as const) {
      expect(wrapper.type).toBe("group");
      if (wrapper.type !== "group") {
        throw new TypeError("Generated layout-transition wrapper must be a Group");
      }
      expect(wrapper.meta).toEqual({
        [LAYOUT_TRANSITION_WRAPPER_META.generatedKey]:
          LAYOUT_TRANSITION_WRAPPER_META.generatedValue,
        [LAYOUT_TRANSITION_WRAPPER_META.sourceNodeIdKey]: sourceNodeId,
      });
      expect(wrapper.animation?.durationMs).toBe(1000);
      expect(wrapper.animation?.keyframes.map((keyframe) => keyframe.at)).toEqual([0, 0.3, 0.7, 1]);
      expect(wrapper.animation?.keyframes.every((keyframe) => keyframe.opacity == null)).toBe(true);
      expect(
        wrapper.animation?.keyframes.every(
          (keyframe) =>
            keyframe.transform?.translateX != null &&
            keyframe.transform.translateY != null &&
            keyframe.transform.scaleX != null &&
            keyframe.transform.scaleY != null,
        ),
      ).toBe(true);
      expect(wrapper.animation?.keyframes[2]?.transform).toEqual(
        wrapper.animation?.keyframes[1]?.transform,
      );
      expect(wrapper.animation?.keyframes[3]?.transform).toEqual(
        wrapper.animation?.keyframes[0]?.transform,
      );
    }

    expect(findIrNode(compiled.ir.root, "tail")).toEqual(findIrNode(reference.ir.root, "tail"));
    expect(findIrNode(compiled.ir.root, "message-1")).toEqual(
      findIrNode(reference.ir.root, "message-1"),
    );
    expect(() =>
      findIrNode(compiled.ir.root, "__boundsvg:layout-transition-wrapper:8:message-1"),
    ).toThrow(RangeError);
    expect(compiled.ir.drawOrder).toEqual(reference.ir.drawOrder);
  });

  it("emits generated outer and authored inner animations in declarative SVG", () => {
    const compiled = engine.compileLayoutTransition(createPortableLayoutTransitionInput());
    const declarativeSvg = engine.renderCompiledToSvg(compiled, { animation: "declarative" });

    expect(declarativeSvg).toContain(
      'data-boundsvg-node-id="__boundsvg:layout-transition-wrapper:7:tail"',
    );
    expect(declarativeSvg).toContain('data-boundsvg-node-id="tail"');
    expect(declarativeSvg).toContain("animation-duration: 1000ms");
    expect(declarativeSvg).toContain("animation-duration: 180ms");
  });

  it("folds generated wrapper provenance into authored layered source mapping", () => {
    const transitionInput = createPortableLayoutTransitionInput();
    for (const state of Object.values(transitionInput.states)) {
      const tail = findFixtureNode(state, "tail");
      const message = findFixtureNode(state, "message-1");
      if (tail.type !== "Box" || message.type !== "Box") {
        throw new TypeError("Expected tail/message fixture Boxes");
      }
      tail.layer = "tail-layer";
      tail.meta = {
        "boundsvg.generated": "layout-transition-wrapper",
        "boundsvg.sourceNodeId": "message-1",
      };
      message.layer = "message-layer";
    }
    const referenceState = transitionInput.states.A;
    const compiled = engine.compileLayoutTransition(transitionInput, { skipValidation: true });
    const sourceNodeMap = snapshotLayerSourceMetadata(
      engine.renderToLayoutTree(referenceState, { skipValidation: true }).root,
    );
    const layered = renderLayeredSvg({
      ir: compiled.ir,
      sourceNodeMap,
      options: { animation: "declarative" },
      emitLayerSvg: (layerIr) => JSON.stringify(layerIr),
    });

    expect(layered.layers.length).toBeGreaterThan(0);
    expect(layered.manifest.animated).toBe(true);
    expect(
      layered.layers
        .flatMap((layer) => layer.nodeIds)
        .some((nodeId) => nodeId.startsWith("__boundsvg:layout-transition-wrapper:")),
    ).toBe(false);
    expect(
      layered.layers.some((layer) =>
        layer.svg.includes("__boundsvg:layout-transition-wrapper:7:tail"),
      ),
    ).toBe(true);
    const tailLayer = layered.layers.find((layer) => layer.id === "tail-layer");
    expect(tailLayer?.nodeIds).toContain("tail");
    expect(tailLayer?.mode).toBe("atomic");
    expect(tailLayer?.collapsedFromLayers).toContain("message-layer");
    expect(tailLayer?.warnings).toContainEqual({
      code: "PARENT_OPACITY_PREVENTED_SPLIT",
      nodeId: "message-1",
      parentNodeId: "tail",
    });
    expect(tailLayer?.nodeMeta?.tail).toEqual({
      "boundsvg.generated": "layout-transition-wrapper",
      "boundsvg.sourceNodeId": "message-1",
    });
  });

  it("folds generated wrapper provenance for an empty authored source ID", () => {
    const transitionInput = createPortableLayoutTransitionInput();
    for (const state of Object.values(transitionInput.states)) {
      const tail = findFixtureNode(state, "tail");
      if (tail.type !== "Box") {
        throw new TypeError("Expected tail fixture Box");
      }
      tail.id = "";
      tail.layer = "empty-id-layer";
    }
    const referenceState = transitionInput.states.A;
    const compiled = engine.compileLayoutTransition(transitionInput);
    const sourceNodeMap = snapshotLayerSourceMetadata(
      engine.renderToLayoutTree(referenceState).root,
    );
    const layered = renderLayeredSvg({
      ir: compiled.ir,
      sourceNodeMap,
      options: { animation: "declarative" },
      emitLayerSvg: (layerIr) => JSON.stringify(layerIr),
    });

    const emptyIdLayer = layered.layers.find((layer) => layer.id === "empty-id-layer");
    expect(emptyIdLayer?.nodeIds).toContain("");
    expect(
      layered.layers
        .flatMap((layer) => layer.nodeIds)
        .some((nodeId) => nodeId.startsWith("__boundsvg:layout-transition-wrapper:")),
    ).toBe(false);
    expect(
      layered.layers.some((layer) => layer.svg.includes("__boundsvg:layout-transition-wrapper:")),
    ).toBe(true);
  });

  it("keeps wrapper provenance debug-visible while hit-test and handlers stay authored", () => {
    const input = createPortableLayoutTransitionInput();
    for (const state of Object.values(input.states)) {
      const tail = findFixtureNode(state, "tail");
      if (tail.type !== "Box") {
        throw new TypeError("Expected tail fixture Box");
      }
      tail.onClick = "select-tail";
    }
    const compiled = engine.compileLayoutTransition(input);
    const wrapper = findIrNode(compiled.ir.root, "__boundsvg:layout-transition-wrapper:7:tail");
    const authoredTail = findIrNode(compiled.ir.root, "tail");
    expect(wrapper.type === "group" ? wrapper.meta : undefined).toMatchObject({
      "boundsvg.generated": "layout-transition-wrapper",
      "boundsvg.sourceNodeId": "tail",
    });
    expect(wrapper.type === "group" ? wrapper.on : undefined).toBeUndefined();
    expect(authoredTail.type === "group" ? authoredTail.on : undefined).toEqual({
      onClick: "select-tail",
    });
    expect(hitTest(compiled.ir, 40, 158)).toBe("tail");
    expect(compiled.ir.drawOrder.some((nodeId) => nodeId.startsWith("__boundsvg:"))).toBe(false);
    const inspectCandidates = inspectHitTestCandidates(
      buildInspectHitTestIndex(compiled.ir),
      40,
      158,
    );
    expect(inspectCandidates).toContain("tail");
    expect(inspectCandidates).toContain("__boundsvg:layout-transition-wrapper:7:tail");

    const internalSamples = JSON.parse(
      handle.sampleAnimationState(JSON.stringify(compiled.ir), 150),
    ) as RawAnimationStateSample[];
    expect(
      internalSamples.some((sample) =>
        sample.nodeId.startsWith("__boundsvg:layout-transition-wrapper:"),
      ),
    ).toBe(true);
  });

  it("matches every independent full-layout bbox at A/B/hold/A checkpoints", () => {
    const compiled = engine.compileLayoutTransition(createPortableLayoutTransitionInput());
    const independent = {
      A: engine.compile(
        createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A),
      ),
      B: engine.compile(
        createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.B),
      ),
    };

    for (const [timeMs, state] of [
      [0, "A"],
      [300, "B"],
      [700, "B"],
      [1_000, "A"],
    ] as const) {
      const sampledBBoxes = sampleGeneratedBBoxes(handle, compiled.ir, timeMs);
      let checkpointMaxErrorPx = 0;
      for (const nodeId of Object.keys(PORTABLE_LAYOUT_TRANSITION_GOLDEN_BBOXES[state])) {
        const expectedBBox = findIrNode(independent[state].ir.root, nodeId).bbox;
        const observedBBox = sampledBBoxes.get(nodeId);
        expect(observedBBox, `${nodeId} at ${timeMs}ms`).toBeDefined();
        expect(
          Math.abs((observedBBox?.x ?? Number.NaN) - expectedBBox.x),
          `${nodeId}.x at ${timeMs}ms`,
        ).toBeLessThanOrEqual(1e-6);
        expect(
          Math.abs((observedBBox?.y ?? Number.NaN) - expectedBBox.y),
          `${nodeId}.y at ${timeMs}ms`,
        ).toBeLessThanOrEqual(1e-6);
        expect(
          Math.abs((observedBBox?.width ?? Number.NaN) - expectedBBox.w),
          `${nodeId}.width at ${timeMs}ms`,
        ).toBeLessThanOrEqual(1e-6);
        expect(
          Math.abs((observedBBox?.height ?? Number.NaN) - expectedBBox.h),
          `${nodeId}.height at ${timeMs}ms`,
        ).toBeLessThanOrEqual(1e-6);
        if (observedBBox) {
          checkpointMaxErrorPx = Math.max(
            checkpointMaxErrorPx,
            maxBBoxComponentError(observedBBox, {
              x: expectedBBox.x,
              y: expectedBBox.y,
              width: expectedBBox.w,
              height: expectedBBox.h,
            }),
          );
        }
      }
      expect(checkpointMaxErrorPx, `checkpoint max error at ${timeMs}ms`).toBe(0);
    }
  });

  it("rejects generated scale with authored transform but allows supported coexistence", () => {
    const scaleWithAuthoredTransform = createPortableLayoutTransitionInput();
    for (const state of Object.values(scaleWithAuthoredTransform.states)) {
      const slot = findFixtureNode(state, "slot");
      if (slot.type !== "Box") {
        throw new TypeError("Expected slot fixture Box");
      }
      slot.transform = { translateX: 4 };
    }
    let thrown: unknown;
    try {
      engine.compileLayoutTransition(scaleWithAuthoredTransform);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FatalError);
    expect(thrown).toMatchObject({
      code: "LAYOUT_TRANSITION_INCOMPATIBLE",
      stage: "layout",
      context: {
        stage: "layout",
        category: "paint",
        nodeId: "slot",
        expected: "no non-identity authored static transform under generated scale",
        observed: "generated world scale with authored static transform",
      },
    });

    const scaleWithOpacityOnly = createPortableLayoutTransitionInput();
    for (const state of Object.values(scaleWithOpacityOnly.states)) {
      const slot = findFixtureNode(state, "slot");
      if (slot.type !== "Box") {
        throw new TypeError("Expected slot fixture Box");
      }
      slot.animate = {
        keyframes: [
          { at: 0, opacity: 0.5 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 200,
        fill: "both",
      };
    }
    const opacityCompiled = engine.compileLayoutTransition(scaleWithOpacityOnly);
    const opacitySlot = findIrNode(opacityCompiled.ir.root, "slot");
    expect(opacitySlot.type === "group" ? opacitySlot.animation?.keyframes : undefined).toEqual([
      { at: 0, opacity: 0.5 },
      { at: 1, opacity: 1 },
    ]);

    const translationWithAuthoredTransform = engine.compileLayoutTransition(
      createPortableLayoutTransitionInput(),
    );
    const translatedTail = findIrNode(translationWithAuthoredTransform.ir.root, "tail");
    expect(translatedTail.type === "group" ? translatedTail.animation : undefined).toBeDefined();
  });

  it("allows uniform generated scale for canvas-stable stroke and rejects non-uniform scale", () => {
    for (const kind of ["box", "path"] as const) {
      const uniform = engine.compileLayoutTransition(createCanvasStrokeTransition(80, 80, kind));
      expect(engine.renderCompiledToSvg(uniform, { animation: "static", timeMs: 300 })).toContain(
        'stroke="#ffffff"',
      );
      expect(
        Array.from(
          engine.renderCompiledToPng(uniform, { animation: "static", timeMs: 300 }).slice(0, 8),
        ),
      ).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

      let thrown: unknown;
      try {
        engine.compileLayoutTransition(createCanvasStrokeTransition(80, 60, kind));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(FatalError);
      expect(thrown).toMatchObject({
        code: "LAYOUT_TRANSITION_INCOMPATIBLE",
        context: {
          stage: "layout",
          category: "stroke",
          nodeId: kind === "box" ? "stroke-box" : "stroke-path",
          expected:
            "uniform positive generated local scale on every wrapper ancestor for canvas-stable stroke",
          observed: `non-uniform generated local scale x=2, y=1.5 at source node "${kind === "box" ? "stroke-box" : "stroke-path"}"`,
        },
      });
    }
  });

  it("uses world scale for authored transforms but wrapper-path scale for canvas-stable strokes", () => {
    const cancelledWorldScale = engine.compileLayoutTransition(
      createNestedResidualTransition({
        targetChildWidth: 40,
        targetChildHeight: 20,
        authoredTransform: true,
        canvasStroke: false,
      }),
    );
    const cancelledChildWrapper = findIrNode(
      cancelledWorldScale.ir.root,
      "__boundsvg:layout-transition-wrapper:2:residual-child",
    );
    expect(
      cancelledChildWrapper.type === "group"
        ? cancelledChildWrapper.animation?.keyframes[1]?.transform
        : undefined,
    ).toMatchObject({ scaleX: 0.5, scaleY: 2 / 3 });
    const authoredChild = findIrNode(cancelledWorldScale.ir.root, "residual-child");
    expect(authoredChild.type === "group" ? authoredChild.transform : undefined).toMatchObject({
      translateX: 3,
    });
    expect(
      engine.renderCompiledToSvg(cancelledWorldScale, { animation: "static", timeMs: 300 }),
    ).toContain('data-boundsvg-node-id="residual-child"');

    let thrown: unknown;
    try {
      engine.compileLayoutTransition(
        createNestedResidualTransition({
          targetChildWidth: 80,
          targetChildHeight: 40,
          authoredTransform: false,
          canvasStroke: true,
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FatalError);
    expect(thrown).toMatchObject({
      code: "LAYOUT_TRANSITION_INCOMPATIBLE",
      stage: "layout",
      context: {
        stage: "layout",
        category: "stroke",
        nodeId: "residual-child",
        expected:
          "uniform positive generated local scale on every wrapper ancestor for canvas-stable stroke",
        observed: 'non-uniform generated local scale x=2, y=1.5 at source node "residual-parent"',
      },
    });
  });

  it("records bounded nested flight approximation and zero B-hold drift", () => {
    const compiled = engine.compileLayoutTransition(createPortableLayoutTransitionInput());
    const independentA = engine.compile(
      createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A),
    );
    const independentB = engine.compile(
      createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.B),
    );

    for (const timeMs of [150, 850]) {
      const sampled = sampleGeneratedBBoxes(handle, compiled.ir, timeMs);
      const slotContent = sampled.get("slot-content");
      if (!slotContent) {
        throw new RangeError("Missing sampled slot-content bbox");
      }
      const ideal = interpolateIrBBox(
        findIrNode(independentA.ir.root, "slot-content").bbox,
        findIrNode(independentB.ir.root, "slot-content").bbox,
        0.5,
      );
      expect(maxBBoxComponentError(slotContent, ideal)).toBeCloseTo(3.4247273279833337, 9);
      expect(slotContent.y - ideal.y).toBeCloseTo(1.1415757759944511, 9);
    }

    const holdSample = sampleGeneratedBBoxes(handle, compiled.ir, 500);
    let maxHoldDriftPx = 0;
    for (const nodeId of Object.keys(PORTABLE_LAYOUT_TRANSITION_GOLDEN_BBOXES.B)) {
      const observed = holdSample.get(nodeId);
      if (!observed) {
        throw new RangeError(`Missing hold sample for ${nodeId}`);
      }
      const target = findIrNode(independentB.ir.root, nodeId).bbox;
      const holdDriftPx = maxBBoxComponentError(observed, {
        x: target.x,
        y: target.y,
        width: target.w,
        height: target.h,
      });
      maxHoldDriftPx = Math.max(maxHoldDriftPx, holdDriftPx);
      expect(holdDriftPx, `${nodeId} hold drift`).toBeLessThanOrEqual(1e-6);
    }
    expect(maxHoldDriftPx).toBe(0);
  });

  it("defines every required negative compatibility and schedule class", () => {
    const fixtures = createLayoutTransitionNegativeFixtures();
    expect(new Set(fixtures.map((fixture) => fixture.expectedCategory))).toEqual(
      new Set([
        "animation",
        "bbox",
        "canvas",
        "content",
        "id",
        "kind",
        "order",
        "paint",
        "parent",
        "schedule",
        "stroke",
        "topology",
        "wrap",
      ]),
    );
    expect(fixtures).toHaveLength(20);
  });

  it("reports every S1 compatibility negative through the public structured Fatal surface", () => {
    const expectedContexts = new Map<
      string,
      { category: string; nodeId: string; expected: string; observed: string }
    >([
      [
        "missing explicit id",
        {
          category: "id",
          nodeId: "tail.1",
          expected: "authored explicit ID",
          observed: "generated ID",
        },
      ],
      [
        "duplicate explicit id",
        {
          category: "id",
          nodeId: "message-1",
          expected: "unique authored ID",
          observed: "duplicate authored ID",
        },
      ],
      [
        "effective canvas mismatch",
        {
          category: "canvas",
          nodeId: "scene",
          expected: "480x480",
          observed: "481x480",
        },
      ],
      [
        "removed persistent node",
        {
          category: "id",
          nodeId: "message-2",
          expected: "same authored ID set as reference",
          observed: "missing from target state",
        },
      ],
      [
        "node kind mismatch",
        {
          category: "kind",
          nodeId: "message-2",
          expected: "box",
          observed: "flex",
        },
      ],
      [
        "parent mismatch",
        {
          category: "parent",
          nodeId: "message-2",
          expected: 'parent "tail"',
          observed: 'parent "root"',
        },
      ],
      [
        "sibling order mismatch",
        { category: "order", nodeId: "message-1", expected: "0", observed: "1" },
      ],
      [
        "text content mismatch",
        {
          category: "content",
          nodeId: "message-1-text",
          expected: "same source content and line/glyph sequence as reference",
          observed: "content or text flow differs in target state",
        },
      ],
      [
        "paint mismatch",
        {
          category: "paint",
          nodeId: "message-1",
          expected: "same paint, static transform, metadata, and handlers as reference",
          observed: "paint or authored static data differs in target state",
        },
      ],
      [
        "text wrap geometry mismatch",
        {
          category: "content",
          nodeId: "message-1-text",
          expected: "same source content and line/glyph sequence as reference",
          observed: "content or text flow differs in target state",
        },
      ],
      [
        "authored animation mismatch",
        {
          category: "animation",
          nodeId: "message-1",
          expected: "same authored animation as reference",
          observed: "authored animation differs in target state",
        },
      ],
      [
        "authored static transform mismatch",
        {
          category: "paint",
          nodeId: "message-1",
          expected: "same paint, static transform, metadata, and handlers as reference",
          observed: "paint or authored static data differs in target state",
        },
      ],
      [
        "zero-width matched bbox",
        {
          category: "bbox",
          nodeId: "bbox-sentinel",
          expected: "non-zero dimensions on every axis that changes size",
          observed: "reference x=20, y=20, w=4, h=4, target x=20, y=20, w=0, h=4",
        },
      ],
    ]);

    for (const fixture of createLayoutTransitionNegativeFixtures()) {
      const expectedContext = expectedContexts.get(fixture.name);
      if (!expectedContext) {
        continue;
      }
      let thrown: unknown;
      try {
        engine.compileLayoutTransition(fixture.input as unknown as LayoutTransitionInput);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, fixture.name).toBeInstanceOf(FatalError);
      expect(thrown, fixture.name).toMatchObject({
        code: "LAYOUT_TRANSITION_INCOMPATIBLE",
        stage: "layout",
        context: { stage: "layout", ...expectedContext },
      });
    }
  });

  it("contains only self-authored boundsvg primitives and stable text", () => {
    const state = createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A);
    const nodes = collectFixtureNodes(state);
    expect(new Set(nodes.map((node) => node.type))).toEqual(new Set(["Canvas", "Box", "Text"]));
    expect(JSON.stringify(state)).not.toContain("data:");
    expect(JSON.stringify(state)).not.toContain("<svg");
  });
});
