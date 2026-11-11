/** Current native paint and semantic Frame queries for one mounted SVG binding. */
import {
  type AffineMatrix,
  applyInverseAffineMatrixToPoint,
  type HitClip,
  type HitContainmentResult,
  type HitPose,
  type IRNodeOccurrence,
  isPointInViewport,
  queryFrameContainment,
} from "@boundsvg/core/scene";
import type { SvgCoordinateResult, SvgHitQueryResult } from "./interaction-types.js";
import { getBoundFrames, type IRDomBinding } from "./ir-dom-binding.js";

type MatrixRead =
  | { status: "ready"; matrix: AffineMatrix }
  | { status: "unavailable"; error?: unknown };
type LocalLinearRead =
  | { status: "ready"; linear: HitPose["linearWitnesses"][number] | null }
  | { status: "unavailable"; error?: unknown };
type PoseRead =
  | { status: "ready"; pose: HitPose }
  | { status: "unavailable"; error?: unknown; element?: Element };
type RootProjection = Readonly<{
  result: SvgCoordinateResult;
  checked?: ReturnType<typeof applyInverseAffineMatrixToPoint>;
}>;

/** Selected-branch native witness used by Text menus without a second public query. */
export type SvgInteractionQuery = Readonly<{
  result: SvgHitQueryResult;
  /** Native paint in the selected branch; it may be inside the selected Frame. */
  paint: IRNodeOccurrence | null;
  /** Physical winner retained for snapshot correspondence before target promotion. */
  selected: IRNodeOccurrence | null;
  failure?:
    | Readonly<{
        phase: "root";
        read: MatrixRead;
        checked?: RootProjection["checked"];
      }>
    | Readonly<{ phase: "frame" | "clip"; nodeIndex: number; read: PoseRead }>
    | Readonly<{ phase: "scope"; detail: unknown }>
    | Readonly<{
        phase: "containment";
        frameNodeIndex: number;
        clipNodeIndices: readonly number[];
        detail: HitContainmentResult;
      }>;
}>;

function readMatrix(element: Element): MatrixRead {
  try {
    const matrix = (element as SVGGraphicsElement).getScreenCTM();
    return matrix &&
      [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(
        (coefficient) => typeof coefficient === "number",
      )
      ? {
          status: "ready",
          matrix: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f },
        }
      : { status: "unavailable" };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

/** Native representation choice is capability-based; failed Typed OM never falls through to CSSOM. */
function readLocalLinear(element: Element): LocalLinearRead {
  try {
    const view = element.ownerDocument.defaultView;
    if (!view) {
      return { status: "unavailable" };
    }
    let matrix: DOMMatrixReadOnly;
    if (typeof element.computedStyleMap === "function") {
      const value = element.computedStyleMap().get("transform");
      if (!value) {
        return { status: "unavailable" };
      }
      if ("value" in value && value.value === "none") {
        return { status: "ready", linear: null };
      }
      if (
        !("is2D" in value) ||
        value.is2D !== true ||
        !("toMatrix" in value) ||
        typeof value.toMatrix !== "function"
      ) {
        return { status: "unavailable" };
      }
      matrix = value.toMatrix();
    } else {
      const value = view.getComputedStyle(element).transform;
      if (value === "none") {
        return { status: "ready", linear: null };
      }
      if (!value) {
        return { status: "unavailable" };
      }
      matrix = new view.DOMMatrixReadOnly(value);
    }
    if (
      !matrix ||
      matrix.is2D !== true ||
      ![matrix.a, matrix.b, matrix.c, matrix.d].every(
        (coefficient) => typeof coefficient === "number",
      )
    ) {
      return { status: "unavailable" };
    }
    return { status: "ready", linear: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d } };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

function projectRoot(
  root: SVGSVGElement,
  clientX: number,
  clientY: number,
  pose: MatrixRead,
): RootProjection {
  if (!root.isConnected) {
    return { result: { status: "unavailable", reason: "detached" } };
  }
  if (pose.status !== "ready") {
    return { result: { status: "unavailable", reason: "coordinatesUnavailable" } };
  }
  const projection = applyInverseAffineMatrixToPoint(pose.matrix, { x: clientX, y: clientY });
  return {
    checked: projection,
    result:
      projection.status === "ready"
        ? { status: "ready", point: { svgX: projection.point.x, svgY: projection.point.y } }
        : { status: "unavailable", reason: "coordinatesUnavailable" },
  };
}

/**
 * Project finite client CSS pixels using the current root CTM.
 * Missing, degenerate or unresolved coordinates remain distinct from a miss.
 */
export function translateSvgCoords(
  root: SVGSVGElement,
  clientX: number,
  clientY: number,
): SvgCoordinateResult {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return { status: "invalid", reason: "nonFiniteClientPoint" };
  }
  return projectRoot(root, clientX, clientY, readMatrix(root)).result;
}

type Scope = Document | ShadowRoot;

function ownedScope(node: Node): Scope | null {
  const scope = node.getRootNode();
  return scope.nodeType === 9 || (scope.nodeType === 11 && "host" in scope)
    ? (scope as Scope)
    : null;
}

/** Outer scopes must reach their host; the innermost scope must reach the actual SVG. */
function nativeTop(
  root: SVGSVGElement,
  clientX: number,
  clientY: number,
): { status: "ready"; element: Element | null } | { status: "unavailable"; error?: unknown } {
  const scope = ownedScope(root);
  if (!scope) {
    return { status: "unavailable" };
  }
  const scopes: { scope: Scope; host: Element | null }[] = [{ scope, host: null }];
  let current = scope;
  while ("host" in current) {
    const host = current.host;
    const outer = ownedScope(host);
    if (!outer) {
      return { status: "unavailable" };
    }
    scopes.push({ scope: outer, host });
    current = outer;
  }
  try {
    let element: Element | null = null;
    for (let ordinal = scopes.length - 1; ordinal >= 0; ordinal--) {
      const entry = scopes[ordinal];
      if (!entry || typeof entry.scope.elementsFromPoint !== "function") {
        return { status: "unavailable" };
      }
      element = entry.scope.elementsFromPoint(clientX, clientY)[0] ?? null;
      if (entry.host ? element !== entry.host : element !== root && !root.contains(element)) {
        return { status: "ready", element: null };
      }
    }
    return { status: "ready", element };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

/** Query once, retaining only the native paint witness needed by the controller. */
export function querySvgInteraction(
  binding: IRDomBinding,
  clientX: number,
  clientY: number,
): SvgInteractionQuery {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return {
      result: { status: "invalid", reason: "nonFiniteClientPoint" },
      paint: null,
      selected: null,
    };
  }
  const frames = getBoundFrames(binding);
  if (!binding.isComplete || !frames) {
    return {
      result: { status: "invalid", reason: "bindingMismatch" },
      paint: null,
      selected: null,
    };
  }
  const rootPose = readMatrix(binding.root);
  const rootProjection = projectRoot(binding.root, clientX, clientY, rootPose);
  const coordinate = rootProjection.result;
  if (coordinate.status !== "ready") {
    return {
      result: coordinate,
      paint: null,
      selected: null,
      failure: { phase: "root", read: rootPose, checked: rootProjection.checked },
    };
  }
  const native = nativeTop(binding.root, clientX, clientY);
  if (native.status !== "ready") {
    return {
      result: { status: "unavailable", reason: "hitTestUnavailable" },
      paint: null,
      selected: null,
      failure: { phase: "scope", detail: native },
    };
  }
  if (!native.element) {
    return {
      result: { status: "ready", point: coordinate.point, hit: null },
      paint: null,
      selected: null,
    };
  }
  const occurrence =
    native.element === binding.root ? null : binding.occurrenceForElement(native.element);
  const paint = occurrence && occurrence.node.type !== "group" ? occurrence : null;
  let selected = paint;
  let order = paint?.enterOrder ?? -1;
  const poses = new Map<Element, MatrixRead>([[binding.root, rootPose]]);
  const localReads = new Map<Element, LocalLinearRead>();
  const framePoses = new Map<Element, PoseRead>();
  const screenFor = (element: Element): MatrixRead => {
    let pose = poses.get(element);
    if (!pose) {
      pose = readMatrix(element);
      poses.set(element, pose);
    }
    return pose;
  };
  const poseFor = (element: Element): PoseRead => {
    const cached = framePoses.get(element);
    if (cached) {
      return cached;
    }
    const main = screenFor(element);
    if (main.status !== "ready") {
      return { ...main, element };
    }
    const linearWitnesses: HitPose["linearWitnesses"][number][] = [];
    let current: Element | null = element;
    while (current) {
      if (current !== element && current !== binding.root) {
        const prefix = screenFor(current);
        if (prefix.status !== "ready") {
          return { ...prefix, element: current };
        }
        const { a, b, c, d } = prefix.matrix;
        linearWitnesses.push({ a, b, c, d });
      }
      let local = localReads.get(current);
      if (!local) {
        local = readLocalLinear(current);
        localReads.set(current, local);
      }
      if (local.status !== "ready") {
        return { ...local, element: current };
      }
      if (local.linear) {
        linearWitnesses.push(local.linear);
      }
      if (current === binding.root) {
        const result: PoseRead = {
          status: "ready",
          pose: { matrix: main.matrix, linearWitnesses },
        };
        framePoses.set(element, result);
        return result;
      }
      current = current.parentElement;
    }
    return { status: "unavailable" };
  };
  const eligibleFrames =
    frames[0] &&
    frames[0].occurrence.leaveOrder > order &&
    isPointInViewport(binding.sourceIndex.ir, {
      x: coordinate.point.svgX,
      y: coordinate.point.svgY,
    })
      ? frames
      : [];
  for (const frame of eligibleFrames) {
    if (frame.occurrence.leaveOrder <= order) {
      break;
    }
    const endpoint = binding.elementForNode(frame.occurrence.nodeIndex);
    if (!endpoint || !binding.root.contains(endpoint)) {
      return { result: { status: "invalid", reason: "bindingMismatch" }, paint, selected: null };
    }
    const framePose = poseFor(endpoint);
    if (framePose.status !== "ready") {
      const failedClip =
        framePose.element !== endpoint
          ? frame.clipOwners.find(
              (owner) => binding.elementForNode(owner.nodeIndex) === framePose.element,
            )
          : undefined;
      return {
        result: { status: "unavailable", reason: "coordinatesUnavailable" },
        paint,
        selected: null,
        failure: {
          phase: failedClip ? "clip" : "frame",
          nodeIndex: failedClip?.nodeIndex ?? frame.occurrence.nodeIndex,
          read: framePose,
        },
      };
    }
    let clips: HitClip | null = null;
    for (const owner of frame.clipOwners) {
      const clipEndpoint = binding.elementForNode(owner.nodeIndex);
      if (!clipEndpoint || !binding.root.contains(clipEndpoint)) {
        return { result: { status: "invalid", reason: "bindingMismatch" }, paint, selected: null };
      }
      // The Frame already carries its physical ancestry evidence; clip mains only add projections.
      const screen = screenFor(clipEndpoint);
      const pose: PoseRead =
        clipEndpoint === endpoint || clipEndpoint.contains(endpoint)
          ? screen.status === "ready"
            ? { status: "ready", pose: { matrix: screen.matrix, linearWitnesses: [] } }
            : { ...screen, element: clipEndpoint }
          : poseFor(clipEndpoint);
      if (pose.status !== "ready") {
        return {
          result: { status: "unavailable", reason: "coordinatesUnavailable" },
          paint,
          selected: null,
          failure: { phase: "clip", nodeIndex: owner.nodeIndex, read: pose },
        };
      }
      if (owner.node.type === "group" && owner.node.clip) {
        clips = { parent: clips, pose: pose.pose, geometry: owner.node.clip };
      }
    }
    const contained = queryFrameContainment(frame.occurrence.node.bbox, framePose.pose, clips, {
      x: clientX,
      y: clientY,
    });
    if (contained.status !== "ready") {
      return {
        result: { status: "unavailable", reason: "coordinatesUnavailable" },
        paint,
        selected: null,
        failure: {
          phase: "containment",
          frameNodeIndex: frame.occurrence.nodeIndex,
          clipNodeIndices: frame.clipOwners.map((owner) => owner.nodeIndex),
          detail: contained,
        },
      };
    }
    if (contained.contains && frame.occurrence.leaveOrder > order) {
      selected = frame.occurrence;
      order = frame.occurrence.leaveOrder;
    }
  }
  // A selected ancestor Frame keeps its native witness; another branch does not.
  const hit = selected?.source ?? null;
  let witness = paint;
  let ancestor = paint;
  while (ancestor && ancestor.source !== hit) {
    ancestor =
      ancestor.parentNodeIndex === null
        ? null
        : (binding.sourceIndex.nodes.get(ancestor.parentNodeIndex) ?? null);
  }
  if (!ancestor) {
    witness = null;
  }
  return { result: { status: "ready", point: coordinate.point, hit }, paint: witness, selected };
}

/** Return the current native paint or semantic Frame source; only ready.hit=null is a miss. */
export function queryCurrentSvgHit(
  binding: IRDomBinding,
  clientX: number,
  clientY: number,
): SvgHitQueryResult {
  return querySvgInteraction(binding, clientX, clientY).result;
}
