import { FatalError } from "../errors.js";
import type { NodePosition } from "../ir/internal.js";
import { generateNodeId } from "../ir/node-id.js";
import type { IR, IRNode } from "../ir/types.js";
import type { VNode } from "../vnode/types.js";

/** Identity carried by an authored timeline-domain failure. */
export type TimelineAuthoredDomainOwner = {
  ownerKind: "node" | "textUnit";
  ownerId: string;
  unitId?: string;
};

/** Migration text shared with the Rust timeline compiler's domain error. */
const AUTHORED_TIMELINE_DOMAIN_MIGRATION =
  "Use playback mode independent or change the authored value to the supported timeline range.";

type TimelineAuthoredDomainField = "durationMs" | "delayMs" | "iterations";

type TimelineAuthoredTimingValues = {
  durationMs?: unknown;
  delayMs?: unknown;
  iterations?: unknown;
};

function authoredTimelineValueOutOfDomain(
  owner: TimelineAuthoredDomainOwner,
  field: TimelineAuthoredDomainField,
  received: number,
): FatalError {
  return new FatalError(
    "ANIMATED_SVG_TIMELINE_UNREPRESENTABLE",
    `Animated SVG timeline cannot represent ${owner.ownerKind} track ${JSON.stringify(owner.ownerId)}: authored ${field} is outside the supported timeline range`,
    {
      ownerKind: owner.ownerKind,
      ownerId: owner.ownerId,
      ...(owner.unitId === undefined ? {} : { unitId: owner.unitId }),
      reason: "authored-value-out-of-domain",
      field,
      received: String(received),
      migration: AUTHORED_TIMELINE_DOMAIN_MIGRATION,
      stage: "emit",
      nodeId: owner.ownerId,
    },
  );
}

/** Route authored values that JSON cannot preserve to the timeline-domain error. */
export function assertTimelineAuthoredSpecJsonRepresentable(
  animation: TimelineAuthoredTimingValues,
  owner: TimelineAuthoredDomainOwner,
): void {
  for (const [field, received] of [
    ["durationMs", animation.durationMs],
    ["delayMs", animation.delayMs],
    ["iterations", animation.iterations === "infinite" ? undefined : animation.iterations],
  ] as const) {
    if (typeof received === "number" && !Number.isFinite(received)) {
      throw authoredTimelineValueOutOfDomain(owner, field, received);
    }
  }
}

function assertTimelineAuthoredDelayJsonRepresentable(
  delayMs: number,
  owner: TimelineAuthoredDomainOwner,
): void {
  if (!Number.isFinite(delayMs)) {
    throw authoredTimelineValueOutOfDomain(owner, "delayMs", delayMs);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertVNodeOwnerJsonRepresentable(node: VNode, ownerId: string): void {
  const props = node.props as Record<string, unknown>;
  const animation = Reflect.get(props, "animate");
  if (isRecord(animation)) {
    assertTimelineAuthoredSpecJsonRepresentable(animation, {
      ownerKind: "node",
      ownerId,
    });
  }
  const unitAnimation = Reflect.get(props, "animateUnits");
  if (isRecord(unitAnimation) && isRecord(unitAnimation.animation)) {
    assertTimelineAuthoredSpecJsonRepresentable(unitAnimation.animation, {
      ownerKind: "textUnit",
      ownerId,
    });
  }
}

/** Preserve the timeline domain error even when ordinary VNode validation is skipped. */
export function assertAnimatedSvgTimelineVNodeJsonRepresentable(root: VNode): void {
  const visit = (node: VNode, position: NodePosition): void => {
    const { id: ownerId } = generateNodeId(node, position);
    assertVNodeOwnerJsonRepresentable(node, ownerId);
    let siblingIndex = 0;
    for (const child of node.children) {
      if (typeof child === "string") {
        continue;
      }
      visit(child, {
        depth: position.depth + 1,
        siblingIndex,
        parentNodeId: ownerId,
      });
      siblingIndex += 1;
    }
  };
  visit(root, { depth: 0, siblingIndex: 0 });
}

function assertIrOwnerJsonRepresentable(node: IRNode): void {
  if (node.type === "group" && node.animation !== undefined) {
    assertTimelineAuthoredSpecJsonRepresentable(node.animation, {
      ownerKind: "node",
      ownerId: node.nodeId,
    });
  }
  if (node.type === "text" && node.unitAnimation !== undefined) {
    const unitAnimation = node.unitAnimation;
    assertTimelineAuthoredSpecJsonRepresentable(unitAnimation.animation, {
      ownerKind: "textUnit",
      ownerId: node.nodeId,
    });
    const baseDelayMs = unitAnimation.animation.delayMs ?? 0;
    const delayStepMs = unitAnimation.delayStepMs ?? 0;
    const useVisualOrder = unitAnimation.order === "visual";
    for (const unit of node.unitMap?.units ?? []) {
      const orderIndex = useVisualOrder ? unit.visualOrder : unit.logicalOrder;
      const effectiveDelayMs = baseDelayMs + orderIndex * delayStepMs;
      if (effectiveDelayMs !== baseDelayMs) {
        assertTimelineAuthoredDelayJsonRepresentable(effectiveDelayMs, {
          ownerKind: "textUnit",
          ownerId: node.nodeId,
          unitId: unit.unitId,
        });
      }
    }
  }
  if (node.type === "group") {
    for (const child of node.children ?? []) {
      assertIrOwnerJsonRepresentable(child);
    }
  }
}

/** Route compiled-IR values that JSON cannot preserve before the WASM transport. */
export function assertAnimatedSvgTimelineIrJsonRepresentable(ir: IR): void {
  assertIrOwnerJsonRepresentable(ir.root);
}
