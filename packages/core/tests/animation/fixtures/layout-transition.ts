import type { LayoutTransitionInput } from "../../../src/layout-transition.js";
import type { SceneNode } from "../../../src/scene/types.js";
import type { AnimationSpec } from "../../../src/vnode/types.js";

export const PORTABLE_LAYOUT_TRANSITION_CANVAS = {
  width: 480,
  height: 480,
} as const;

export const PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS = {
  A: 48,
  B: 120,
} as const;

export const PORTABLE_LAYOUT_TRANSITION_SHOVE_PX =
  PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.B - PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A;

export const PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS = [
  { timeMs: 0, state: "A" },
  { timeMs: 300, state: "B" },
  { timeMs: 700, state: "B" },
  { timeMs: 1_000, state: "A" },
] as const;

export const PORTABLE_LAYOUT_TRANSITION_GOLDEN_BBOXES = {
  A: {
    scene: { x: 0, y: 0, width: 480, height: 480 },
    root: { x: 20, y: 20, width: 440, height: 440 },
    "message-0": { x: 36, y: 36, width: 408, height: 56 },
    "message-0-text": { x: 48, y: 44, width: 384, height: 24 },
    slot: { x: 36, y: 100, width: 408, height: 48 },
    "slot-content": { x: 48, y: 108, width: 384, height: 24 },
    "slot-text": { x: 48, y: 108, width: 384, height: 24 },
    tail: { x: 36, y: 156, width: 408, height: 144 },
    "message-1": { x: 36, y: 156, width: 408, height: 68 },
    "message-1-text": { x: 48, y: 166, width: 384, height: 24 },
    "message-2": { x: 36, y: 232, width: 408, height: 68 },
    "message-2-text": { x: 48, y: 242, width: 384, height: 24 },
  },
  B: {
    scene: { x: 0, y: 0, width: 480, height: 480 },
    root: { x: 20, y: 20, width: 440, height: 440 },
    "message-0": { x: 36, y: 36, width: 408, height: 56 },
    "message-0-text": { x: 48, y: 44, width: 384, height: 24 },
    slot: { x: 36, y: 100, width: 408, height: 120 },
    "slot-content": { x: 48, y: 108, width: 384, height: 24 },
    "slot-text": { x: 48, y: 108, width: 384, height: 24 },
    tail: { x: 36, y: 228, width: 408, height: 144 },
    "message-1": { x: 36, y: 228, width: 408, height: 68 },
    "message-1-text": { x: 48, y: 238, width: 384, height: 24 },
    "message-2": { x: 36, y: 304, width: 408, height: 68 },
    "message-2-text": { x: 48, y: 314, width: 384, height: 24 },
  },
} as const;

export type PortableLayoutState = "A" | "B";

export type FixtureLayoutTransitionInput = {
  states: Readonly<Record<string, SceneNode>>;
  checkpoints: readonly { timeMs: number; state: string }[];
};

export type LayoutTransitionNegativeFixture = {
  name: string;
  expectedCategory:
    | "animation"
    | "bbox"
    | "canvas"
    | "content"
    | "id"
    | "kind"
    | "order"
    | "paint"
    | "parent"
    | "schedule"
    | "stroke"
    | "topology"
    | "wrap";
  input: FixtureLayoutTransitionInput;
};

function entranceAnimation(delayMs: number): AnimationSpec {
  return {
    keyframes: [
      { at: 0, opacity: 0.15, transform: { translateY: 12 } },
      { at: 1, opacity: 1, transform: { translateY: 0 } },
    ],
    durationMs: 240,
    delayMs,
    easing: "ease-out",
    iterations: 1,
    fill: "both",
  };
}

function visibilityAnimation(delayMs: number): AnimationSpec {
  return {
    keyframes: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    durationMs: 180,
    delayMs,
    easing: "linear",
    iterations: 1,
    fill: "both",
  };
}

/**
 * Builds both portable states. `slotHeight` is the only varying layout input;
 * content, paint, animation, IDs, parentage, and order stay byte-equivalent.
 */
export function createPortableLayoutTransitionState(slotHeight: 48 | 120): SceneNode {
  return {
    type: "Canvas",
    id: "scene",
    width: PORTABLE_LAYOUT_TRANSITION_CANVAS.width,
    height: PORTABLE_LAYOUT_TRANSITION_CANVAS.height,
    background: "#0b1020",
    children: [
      {
        type: "Box",
        id: "root",
        width: 440,
        height: 440,
        margin: 20,
        padding: 16,
        background: "#111827",
        children: [
          {
            type: "Box",
            id: "message-0",
            width: 408,
            height: 56,
            margin: [0, 0, 8, 0],
            padding: [8, 12, 8, 12],
            borderRadius: 8,
            background: "#1e293b",
            animate: entranceAnimation(0),
            children: [
              {
                type: "Text",
                id: "message-0-text",
                width: 384,
                font: "NotoSansJP",
                fontSizePx: 16,
                lineHeightPx: 24,
                color: "#e2e8f0",
                wrap: "none",
                children: ["Stable transcript header"],
              },
            ],
          },
          {
            type: "Box",
            id: "slot",
            width: 408,
            height: slotHeight,
            margin: [0, 0, 8, 0],
            padding: [8, 12, 8, 12],
            borderRadius: 8,
            background: "#172554",
            children: [
              {
                type: "Box",
                id: "slot-content",
                width: 384,
                height: 24,
                children: [
                  {
                    type: "Text",
                    id: "slot-text",
                    width: 384,
                    height: 24,
                    font: "NotoSansJP",
                    fontSizePx: 16,
                    lineHeightPx: 24,
                    color: "#bfdbfe",
                    wrap: "none",
                    children: ["Persistent slot content"],
                  },
                ],
              },
            ],
          },
          {
            type: "Box",
            id: "tail",
            width: 408,
            height: 144,
            animate: entranceAnimation(80),
            children: [
              {
                type: "Box",
                id: "message-1",
                width: 408,
                height: 68,
                margin: [0, 0, 8, 0],
                padding: [10, 12, 10, 12],
                borderRadius: 8,
                background: "#1f2937",
                animate: entranceAnimation(120),
                children: [
                  {
                    type: "Text",
                    id: "message-1-text",
                    width: 384,
                    height: 24,
                    font: "NotoSansJP",
                    fontSizePx: 16,
                    lineHeightPx: 24,
                    color: "#f8fafc",
                    wrap: "none",
                    children: ["First persistent transcript row"],
                  },
                ],
              },
              {
                type: "Box",
                id: "message-2",
                width: 408,
                height: 68,
                padding: [10, 12, 10, 12],
                borderRadius: 8,
                background: "#1f2937",
                animate: visibilityAnimation(180),
                children: [
                  {
                    type: "Text",
                    id: "message-2-text",
                    width: 384,
                    height: 24,
                    font: "NotoSansJP",
                    fontSizePx: 16,
                    lineHeightPx: 24,
                    color: "#f8fafc",
                    wrap: "none",
                    children: ["Second persistent transcript row"],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

export function createPortableLayoutTransitionInput(): LayoutTransitionInput {
  return {
    states: {
      A: createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A),
      B: createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.B),
    },
    checkpoints: PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS,
  };
}

export function fixtureChildNodes(node: SceneNode): SceneNode[] {
  if (!("children" in node) || !Array.isArray(node.children)) {
    return [];
  }
  return node.children.filter((child): child is SceneNode => typeof child !== "string");
}

export function collectFixtureNodes(root: SceneNode): SceneNode[] {
  const nodes: SceneNode[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.shift();
    if (!node) {
      continue;
    }
    nodes.push(node);
    pending.unshift(...fixtureChildNodes(node));
  }
  return nodes;
}

export function findFixtureNode(root: SceneNode, nodeId: string): SceneNode {
  const node = collectFixtureNodes(root).find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new RangeError(`Missing fixture node ${nodeId}`);
  }
  return node;
}

function cloneScene(scene: SceneNode): SceneNode {
  return structuredClone(scene);
}

function createStatePair(): { A: SceneNode; B: SceneNode } {
  return {
    A: createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A),
    B: createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.B),
  };
}

function inputFromStates(
  states: Readonly<Record<string, SceneNode>>,
): FixtureLayoutTransitionInput {
  return { states, checkpoints: PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS };
}

function withMutatedTarget(mutate: (target: SceneNode) => void): FixtureLayoutTransitionInput {
  const states = createStatePair();
  const target = cloneScene(states.B);
  mutate(target);
  return inputFromStates({ A: states.A, B: target });
}

function requireBox(root: SceneNode, nodeId: string) {
  const node = findFixtureNode(root, nodeId);
  if (node.type !== "Box") {
    throw new TypeError(`Expected fixture Box ${nodeId}, got ${node.type}`);
  }
  return node;
}

function requireText(root: SceneNode, nodeId: string) {
  const node = findFixtureNode(root, nodeId);
  if (node.type !== "Text") {
    throw new TypeError(`Expected fixture Text ${nodeId}, got ${node.type}`);
  }
  return node;
}

/** Negative inputs remain data-only so Rust/core tests can share one corpus. */
export function createLayoutTransitionNegativeFixtures(): LayoutTransitionNegativeFixture[] {
  const missingId = withMutatedTarget((target) => {
    delete requireBox(target, "message-2").id;
  });
  const duplicateId = withMutatedTarget((target) => {
    requireBox(target, "message-2").id = "message-1";
  });
  const canvasMismatch = withMutatedTarget((target) => {
    if (target.type !== "Canvas") {
      throw new TypeError("Expected Canvas fixture root");
    }
    target.width = 481;
  });
  const removedNode = withMutatedTarget((target) => {
    const tail = requireBox(target, "tail");
    tail.children = tail.children.filter((child) => child.id !== "message-2");
  });
  const kindMismatch = withMutatedTarget((target) => {
    const tail = requireBox(target, "tail");
    const index = tail.children.findIndex((child) => child.id === "message-2");
    const original = requireBox(target, "message-2");
    tail.children[index] = { ...original, type: "Flex", direction: "column" };
  });
  const parentMismatch = withMutatedTarget((target) => {
    const tail = requireBox(target, "tail");
    const root = requireBox(target, "root");
    const message = tail.children.find((child) => child.id === "message-2");
    if (!message) {
      throw new RangeError("Missing message-2 for parent mismatch");
    }
    tail.children = tail.children.filter((child) => child.id !== "message-2");
    root.children.push(message);
  });
  const orderMismatch = withMutatedTarget((target) => {
    const tail = requireBox(target, "tail");
    tail.children.reverse();
  });
  const contentMismatch = withMutatedTarget((target) => {
    requireText(target, "message-1-text").children = ["State-specific transcript row"];
  });
  const paintMismatch = withMutatedTarget((target) => {
    requireBox(target, "message-1").background = "#334155";
  });
  const wrapMismatch = withMutatedTarget((target) => {
    const text = requireText(target, "message-1-text");
    text.width = 120;
    text.wrap = "word";
  });
  const animationMismatch = withMutatedTarget((target) => {
    const message = requireBox(target, "message-1");
    if (!message.animate) {
      throw new TypeError("Expected message-1 animation");
    }
    message.animate.durationMs = 241;
  });
  const staticTransformMismatch = withMutatedTarget((target) => {
    requireBox(target, "message-1").transform = { translateX: 1 };
  });
  const zeroBBox = (() => {
    const states = createStatePair();
    for (const [stateName, state] of Object.entries(states)) {
      const root = requireBox(state, "root");
      root.children.push({
        type: "Box",
        id: "bbox-sentinel",
        position: "absolute",
        left: 0,
        top: 0,
        width: stateName === "A" ? 4 : 0,
        height: 4,
        children: [],
      });
    }
    return inputFromStates(states);
  })();
  const generatedScaleWithAuthoredTransform = (() => {
    const states = createStatePair();
    requireBox(states.A, "slot").transform = { translateX: 4 };
    requireBox(states.B, "slot").transform = { translateX: 4 };
    return inputFromStates(states);
  })();
  const canvasStableStroke = (() => {
    const states = createStatePair();
    for (const state of [states.A, states.B]) {
      const slot = requireBox(state, "slot");
      slot.borderWidth = 1;
      slot.borderColor = "#93c5fd";
      slot.strokeScaling = "canvas";
    }
    return inputFromStates(states);
  })();
  const portableInput = createPortableLayoutTransitionInput();
  const nonFiniteCheckpoint: FixtureLayoutTransitionInput = {
    states: portableInput.states,
    checkpoints: [
      { timeMs: 0, state: "A" },
      { timeMs: Number.POSITIVE_INFINITY, state: "B" },
      { timeMs: 700, state: "B" },
      { timeMs: 1_000, state: "A" },
    ],
  };
  const duplicateCheckpoint: FixtureLayoutTransitionInput = {
    states: portableInput.states,
    checkpoints: [
      { timeMs: 0, state: "A" },
      { timeMs: 300, state: "B" },
      { timeMs: 300, state: "B" },
      { timeMs: 1_000, state: "A" },
    ],
  };
  const reverseCheckpoint: FixtureLayoutTransitionInput = {
    states: portableInput.states,
    checkpoints: [
      { timeMs: 0, state: "A" },
      { timeMs: 700, state: "B" },
      { timeMs: 300, state: "B" },
      { timeMs: 1_000, state: "A" },
    ],
  };
  const unknownState: FixtureLayoutTransitionInput = {
    states: portableInput.states,
    checkpoints: [
      { timeMs: 0, state: "A" },
      { timeMs: 300, state: "missing" },
      { timeMs: 700, state: "missing" },
      { timeMs: 1_000, state: "A" },
    ],
  };
  const threeStates: FixtureLayoutTransitionInput = {
    states: {
      ...portableInput.states,
      C: createPortableLayoutTransitionState(PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS.A),
    },
    checkpoints: PORTABLE_LAYOUT_TRANSITION_CHECKPOINTS,
  };

  return [
    { name: "missing explicit id", expectedCategory: "id", input: missingId },
    { name: "duplicate explicit id", expectedCategory: "id", input: duplicateId },
    { name: "effective canvas mismatch", expectedCategory: "canvas", input: canvasMismatch },
    { name: "removed persistent node", expectedCategory: "topology", input: removedNode },
    { name: "node kind mismatch", expectedCategory: "kind", input: kindMismatch },
    { name: "parent mismatch", expectedCategory: "parent", input: parentMismatch },
    { name: "sibling order mismatch", expectedCategory: "order", input: orderMismatch },
    { name: "text content mismatch", expectedCategory: "content", input: contentMismatch },
    { name: "paint mismatch", expectedCategory: "paint", input: paintMismatch },
    { name: "text wrap geometry mismatch", expectedCategory: "wrap", input: wrapMismatch },
    {
      name: "authored animation mismatch",
      expectedCategory: "animation",
      input: animationMismatch,
    },
    {
      name: "authored static transform mismatch",
      expectedCategory: "animation",
      input: staticTransformMismatch,
    },
    { name: "zero-width matched bbox", expectedCategory: "bbox", input: zeroBBox },
    {
      name: "generated scale with authored transform",
      expectedCategory: "animation",
      input: generatedScaleWithAuthoredTransform,
    },
    {
      name: "canvas-stable stroke with non-uniform generated scale",
      expectedCategory: "stroke",
      input: canvasStableStroke,
    },
    { name: "non-finite checkpoint", expectedCategory: "schedule", input: nonFiniteCheckpoint },
    { name: "duplicate checkpoint", expectedCategory: "schedule", input: duplicateCheckpoint },
    { name: "reverse checkpoint", expectedCategory: "schedule", input: reverseCheckpoint },
    { name: "unknown checkpoint state", expectedCategory: "schedule", input: unknownState },
    { name: "three distinct states", expectedCategory: "schedule", input: threeStates },
  ];
}
