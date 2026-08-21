import type { AnimationSpec, LayoutTransitionInput, SceneNode } from "@boundsvg/core";

export const LAYOUT_TRANSITION_CHECKPOINTS = [
  { timeMs: 0, state: "A" },
  { timeMs: 300, state: "B" },
  { timeMs: 700, state: "B" },
  { timeMs: 1_000, state: "A" },
] as const;

export const PORTABLE_LAYOUT_TRANSITION_SLOT_HEIGHTS = {
  A: 48,
  B: 120,
} as const;

export const FLAT_FAN_OUT_COUNTS = [10, 100, 500] as const;
export const NESTED_FAN_OUT_COUNTS = [10, 100, 500] as const;
export const FAN_OUT_SAMPLE_TIMES_MS = Array.from(
  { length: 12 },
  (_, index) => (index * 1_000) / 12,
);
const FAN_OUT_DELTA_PX = 8;
export const NEAR_IDENTITY_DELTA_PX = 0.0001;

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

export function createPortableLayoutTransitionState(slotHeight: 48 | 120): SceneNode {
  return {
    type: "Canvas",
    id: "scene",
    width: 480,
    height: 480,
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
    checkpoints: LAYOUT_TRANSITION_CHECKPOINTS,
  };
}

function fanOutPosition(index: number): { left: number; top: number } {
  return {
    left: (index % 25) * 20,
    top: Math.floor(index / 25) * 20,
  };
}

export function createFlatFanOutTransition(
  count: number,
  targetDeltaPx = FAN_OUT_DELTA_PX,
): LayoutTransitionInput {
  const createState = (deltaPx: number): SceneNode => ({
    type: "Canvas",
    id: "flat-scene",
    width: 520,
    height: 520,
    background: "#0f172a",
    children: Array.from({ length: count }, (_, index) => {
      const position = fanOutPosition(index);
      return {
        type: "Box" as const,
        id: `flat-${index}`,
        position: "absolute" as const,
        left: position.left + deltaPx,
        top: position.top,
        width: 12,
        height: 12,
        background: index % 2 === 0 ? "#38bdf8" : "#a78bfa",
        children: [],
      };
    }),
  });

  return {
    states: { A: createState(0), B: createState(targetDeltaPx) },
    checkpoints: LAYOUT_TRANSITION_CHECKPOINTS,
  };
}

function createNestedChain(
  chainIndex: number,
  chainLength: number,
  parentDeltaPx: number,
  leafDeltaPx: number,
): SceneNode {
  const position = fanOutPosition(chainIndex);
  const createNode = (depth: number): SceneNode => {
    const isRoot = depth === 0;
    const isLeaf = depth === chainLength - 1;
    const children = isLeaf ? [] : [createNode(depth + 1)];
    return {
      type: "Box",
      id: `nested-${chainIndex}-${depth}`,
      position: "absolute",
      left: isRoot ? position.left + parentDeltaPx : 2 + (isLeaf ? leafDeltaPx : 0),
      top: isRoot ? position.top : 2,
      width: Math.max(6, 18 - depth * 4),
      height: Math.max(6, 18 - depth * 4),
      background: depth === 0 ? "#22c55e" : depth === 1 ? "#f59e0b" : "#ef4444",
      children,
    };
  };
  return createNode(0);
}

export function createNestedFanOutTransition(
  count: number,
  leafDeltaPx = 2,
): LayoutTransitionInput {
  const createState = (parentDeltaPx: number, nestedLeafDeltaPx: number): SceneNode => {
    const children: SceneNode[] = [];
    let remaining = count;
    let chainIndex = 0;
    while (remaining > 0) {
      const chainLength = Math.min(3, remaining);
      children.push(createNestedChain(chainIndex, chainLength, parentDeltaPx, nestedLeafDeltaPx));
      remaining -= chainLength;
      chainIndex += 1;
    }
    return {
      type: "Canvas",
      id: "nested-scene",
      width: 520,
      height: 520,
      background: "#020617",
      children,
    };
  };

  return {
    states: { A: createState(0, 0), B: createState(FAN_OUT_DELTA_PX, leafDeltaPx) },
    checkpoints: LAYOUT_TRANSITION_CHECKPOINTS,
  };
}

export function collectSceneNodeDepths(root: SceneNode): Map<string, number> {
  const depths = new Map<string, number>();
  const pending: Array<{ node: SceneNode; depth: number }> = [{ node: root, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) {
      continue;
    }
    const nodeId = "id" in current.node ? current.node.id : undefined;
    if (typeof nodeId === "string") {
      depths.set(nodeId, current.depth);
    }
    if ("children" in current.node && Array.isArray(current.node.children)) {
      const childNodes = current.node.children.filter(
        (child): child is SceneNode => typeof child !== "string",
      );
      pending.unshift(...childNodes.map((node) => ({ node, depth: current.depth + 1 })));
    }
  }
  return depths;
}
