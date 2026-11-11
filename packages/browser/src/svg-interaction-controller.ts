/** Attachment-owned input, scene reconciliation, gesture and hover delivery. */
import {
  type HandlersRef,
  type IRNodeOccurrence,
  type IRSourceIndex,
  type IRSourceRef,
  resolveInteractionTarget,
  type SvgPoint,
  type TextMap,
} from "@boundsvg/core/scene";
import type {
  EventCallback,
  PointerEventInfo,
  SvgHoverState,
  TextContextMenuHit,
} from "./interaction-types.js";
import { getBoundFrames, type IRDomBinding } from "./ir-dom-binding.js";
import {
  querySvgInteraction,
  type SvgInteractionQuery,
  translateSvgCoords,
} from "./svg-event-utils.js";

/** One committed document and its callback snapshot; null binding reports a mount mismatch. */
export type SvgInteractionScene = Readonly<{
  binding: IRDomBinding | null;
  renderMode: "static" | "animated";
  handlers: ReadonlyMap<string, EventCallback>;
  textMap: TextMap | null;
  showPointerCursor?: boolean;
  enableTextCopy?: boolean;
  onHoverState: (hover: SvgHoverState) => void;
  onHoverChange?: (source: IRSourceRef | null) => void;
  onTextContextMenu?: (hit: TextContextMenuHit) => void;
}>;

/** A controller follows one container attachment; scene updates preserve its listeners and clock. */
export type SvgInteractionController = Readonly<{
  setScene: (scene: SvgInteractionScene | null) => void;
  dispose: () => void;
}>;

type BoundScene = SvgInteractionScene & { binding: IRDomBinding };
type Entity = Readonly<{ scene: BoundScene; selected: IRNodeOccurrence; target: IRSourceRef }>;
type Position = Readonly<{
  clientX: number;
  clientY: number;
  pointerId: number | null;
  pointerType: string;
}>;
type Cause = Readonly<{ point: SvgPoint | null; pointerId: number | null; pointerType: string }> &
  (
    | { cause: "input"; nativeEvent: PointerEvent | MouseEvent }
    | { cause: "scene"; nativeEvent: null }
  );
type Group = Readonly<{ entity: Entity; names: readonly (keyof HandlersRef)[]; cause: Cause }>;
type PositionState = Readonly<{ lifecyclePointerType: string | null }> &
  (
    | Readonly<{ kind: "known"; position: Position }>
    | Readonly<{ kind: "frozen" }>
    | Readonly<{ kind: "cleared"; cause: Cause }>
  );
type HoverEffect = "update" | "none" | "clearAfterTerminal";
type DeliveryPhase = "obligation" | "hover";

/** A hover exit is one indivisible source notification group. */
const LEAVE_EVENTS = ["onPointerLeave", "onPointerOut", "onMouseLeave", "onMouseOut"] as const;
/** A hover entry is one indivisible source notification group. */
const ENTER_EVENTS = ["onPointerEnter", "onPointerOver", "onMouseEnter", "onMouseOver"] as const;

function sourceHandlers(entity: Entity): HandlersRef | undefined {
  const node = entity.scene.binding.sourceIndex.sources.get(entity.target.sourceIndex)?.node;
  return node?.ownership.role === "source" ? node.ownership.on : undefined;
}

function isPointer(event: MouseEvent): event is PointerEvent {
  return "pointerId" in event;
}

/** A click may be a PointerEvent without providing independent pointer-position authority. */
function isPointerLifecycle(event: MouseEvent): event is PointerEvent {
  return (
    isPointer(event) &&
    [
      "pointerenter",
      "pointermove",
      "pointerdown",
      "pointerup",
      "pointercancel",
      "pointerleave",
    ].includes(event.type)
  );
}

function inputCause(event: MouseEvent, point: SvgPoint | null): Cause {
  return {
    cause: "input",
    nativeEvent: event,
    point,
    pointerId: isPointer(event) ? event.pointerId : null,
    pointerType: isPointer(event) ? event.pointerType : "mouse",
  };
}

function sceneCause(position: Position | null, point: SvgPoint | null = null): Cause {
  return {
    cause: "scene",
    nativeEvent: null,
    point,
    pointerId: position?.pointerId ?? null,
    pointerType: position?.pointerType ?? "mouse",
  };
}

/** Whole-tree correspondence prevents a uniform duplicate insertion from matching a prefix. */
function sameTopology(previous: IRSourceIndex, next: IRSourceIndex): boolean {
  if (previous.nodes.size !== next.nodes.size) {
    return false;
  }
  for (const [ordinal, before] of previous.nodes) {
    const after = next.nodes.get(ordinal);
    if (
      !after ||
      before.node.type !== after.node.type ||
      before.node.nodeId !== after.node.nodeId ||
      before.parentNodeIndex !== after.parentNodeIndex ||
      before.source.sourceIndex !== after.source.sourceIndex
    ) {
      return false;
    }
    const left = before.node.ownership;
    const right = after.node.ownership;
    if (left.role !== right.role) {
      return false;
    }
    if (
      left.role !== "source" &&
      (right.role === "source" || left.ownerNodeId !== right.ownerNodeId)
    ) {
      return false;
    }
    if (
      left.role === "wrapper" &&
      (right.role !== "wrapper" || left.placement !== right.placement)
    ) {
      return false;
    }
  }
  return true;
}

function entityFor(scene: SvgInteractionScene | null, query: SvgInteractionQuery): Entity | null {
  if (!scene?.binding || query.result.status !== "ready" || !query.selected) {
    return null;
  }
  return {
    scene: scene as BoundScene,
    selected: query.selected,
    target: resolveInteractionTarget(scene.binding.sourceIndex, query.selected.source),
  };
}

/** Keep static labels selectable in animated documents when their physical ancestry has no tracks. */
function hasSampledTextPoint(scene: BoundScene, query: SvgInteractionQuery): boolean {
  if (scene.renderMode === "static") {
    return true;
  }
  const paint = query.paint;
  if (!paint || paint.node.type !== "text" || paint.node.unitAnimation) {
    return false;
  }
  let occurrence = scene.binding.sourceIndex.nodes.get(paint.nodeIndex);
  while (occurrence) {
    if (occurrence.node.type === "group" && occurrence.node.animation) {
      return false;
    }
    occurrence =
      occurrence.parentNodeIndex === null
        ? undefined
        : scene.binding.sourceIndex.nodes.get(occurrence.parentNodeIndex);
  }
  return true;
}

/**
 * Own input and notification lifetimes for one mounted container.
 * Scene changes reconcile after the current transaction; dispose stops delivery
 * immediately. Only observed primary positions drive stationary reevaluation.
 */
export function createSvgInteractionController(container: HTMLElement): SvgInteractionController {
  let scene: SvgInteractionScene | null = null;
  let requested: SvgInteractionScene | null | undefined;
  let revision = 0;
  let depth = 0;
  let isSettling = false;
  let isDisposed = false;
  let document = container.ownerDocument;
  let positionState: PositionState = {
    kind: "cleared",
    cause: sceneCause(null),
    lifecyclePointerType: null,
  };
  let pendingMove: PointerEvent | null = null;
  let frame: { window: Window; id: number } | null = null;
  let notified: Entity | null = null;
  let published: Entity | null = null;
  let hoverState: SvgHoverState = { status: "inactive" };
  let projectedScene: SvgInteractionScene | null = null;
  const gestures = new Map<number, Entity>();
  let isPositionListening = false;
  let isTerminalListening = false;
  let styledRoot: { root: SVGSVGElement; touchAction: string } | null = null;
  const originalStyle = {
    cursor: container.style.cursor,
    touchAction: container.style.touchAction,
    userSelect: container.style.userSelect,
    webkitUserSelect: container.style.getPropertyValue("-webkit-user-select"),
  };
  container.style.touchAction = "none";
  container.style.userSelect = "none";
  container.style.setProperty("-webkit-user-select", "none");

  function isLive(): boolean {
    return !isDisposed && container.isConnected && container.ownerDocument === document;
  }

  function cancelFrame(): void {
    if (frame) {
      frame.window.cancelAnimationFrame(frame.id);
      frame = null;
    }
  }

  function removeContextListeners(): void {
    document.defaultView?.removeEventListener("blur", handleBlur);
    document.removeEventListener("visibilitychange", handleVisibility);
    document.removeEventListener("pointerup", handleDocumentTerminal);
    document.removeEventListener("pointercancel", handleDocumentTerminal);
    isPositionListening = false;
    isTerminalListening = false;
  }

  /** Context teardown has no callback obligations in a different Document. */
  function resetContext(): void {
    cancelFrame();
    removeContextListeners();
    positionState = { kind: "cleared", cause: sceneCause(null), lifecyclePointerType: null };
    pendingMove = null;
    gestures.clear();
    notified = null;
    published = null;
    hoverState = { status: "inactive" };
    projectedScene = null;
    container.style.cursor = originalStyle.cursor;
    document = container.ownerDocument;
  }

  function checkContext(): boolean {
    if (!isLive()) {
      resetContext();
    }
    return isLive();
  }

  /** Started groups resolve all callbacks before invoking the first one. */
  function deliver(group: Group, lease: number, phase: DeliveryPhase): void {
    if (!isLive() || (phase === "hover" && revision !== lease)) {
      return;
    }
    const references = sourceHandlers(group.entity);
    const callbacks = group.names.flatMap((name) => {
      const handlerName = references?.[name];
      const callback = handlerName ? group.entity.scene.handlers.get(handlerName) : undefined;
      return handlerName && callback ? [{ handlerName, callback }] : [];
    });
    for (const entry of callbacks) {
      if (!isLive()) {
        return;
      }
      const fields = {
        source: group.entity.target,
        nodeId: group.entity.target.nodeId,
        handlerName: entry.handlerName,
        point: group.cause.point,
        pointerId: group.cause.pointerId,
      };
      const payload: PointerEventInfo =
        group.cause.cause === "input"
          ? { ...fields, cause: "input", nativeEvent: group.cause.nativeEvent }
          : { ...fields, cause: "scene", nativeEvent: null };
      entry.callback(payload);
    }
  }

  function transition(entity: Entity | null, cause: Cause, lease: number): void {
    if (!isLive() || revision !== lease) {
      return;
    }
    if (notified?.target === entity?.target) {
      if (entity) {
        notified = entity;
      }
      return;
    }
    const previous = notified;
    if (previous) {
      notified = null;
      deliver({ entity: previous, names: LEAVE_EVENTS, cause }, lease, "hover");
    }
    if (isLive() && revision === lease && entity) {
      notified = entity;
      deliver({ entity, names: ENTER_EVENTS, cause }, lease, "hover");
    }
  }

  function publish(
    entity: Entity | null,
    state: SvgHoverState,
    sink: SvgInteractionScene | null,
    lease: number,
    isContinuation: boolean,
  ): void {
    if (!sink || !isLive() || revision !== lease) {
      return;
    }
    container.style.cursor =
      sink.showPointerCursor !== false && entity && sourceHandlers(entity) !== undefined
        ? "pointer"
        : originalStyle.cursor;
    // A new receiver or IR needs seeding; a new handler bundle alone does not change the projection.
    const hasStateChanged =
      sink.onHoverState !== projectedScene?.onHoverState ||
      sink.binding?.sourceIndex !== projectedScene?.binding?.sourceIndex ||
      state.status !== hoverState.status ||
      (state.status === "ready" &&
        (hoverState.status !== "ready" || state.source !== hoverState.source)) ||
      ((state.status === "invalid" || state.status === "unavailable") &&
        (hoverState.status !== state.status ||
          !("reason" in hoverState) ||
          state.reason !== hoverState.reason));
    hoverState = state;
    projectedScene = sink;
    if (hasStateChanged) {
      sink.onHoverState(state);
    }
    if (!isLive() || revision !== lease) {
      return;
    }
    const hasTargetChanged = published?.target !== entity?.target && !isContinuation;
    published = entity;
    if (hasTargetChanged) {
      sink.onHoverChange?.(entity?.target ?? null);
    }
  }

  function queryCurrent(position: Position): SvgInteractionQuery {
    if (
      !scene?.binding ||
      !container.contains(scene.binding.root) ||
      scene.binding.root.ownerDocument !== document
    ) {
      return {
        result: { status: "invalid", reason: "bindingMismatch" },
        paint: null,
        selected: null,
      };
    }
    return querySvgInteraction(scene.binding, position.clientX, position.clientY);
  }

  /** Reentrant cancellation can leave an entity owned by a scene older than the current one. */
  function projectEntity(entity: Entity, next: SvgInteractionScene | null): Entity | null {
    const before = entity.scene.binding;
    const after = next?.binding;
    if (!before.isComplete || !after?.isComplete) {
      return null;
    }
    if (
      before !== after &&
      (!sameTopology(before.sourceIndex, after.sourceIndex) ||
        (before.root === after.root &&
          ![...before.sourceIndex.nodes.keys()].every(
            (ordinal) => before.elementForNode(ordinal) === after.elementForNode(ordinal),
          )))
    ) {
      return null;
    }
    const index = after.sourceIndex;
    const selected = index.nodes.get(entity.selected.nodeIndex);
    const source = selected?.source;
    const target = index.sources.get(entity.target.sourceIndex)?.source;
    const frames = getBoundFrames(after);
    if (
      !selected ||
      !source ||
      !target ||
      !frames ||
      (selected.node.type === "group" && !frames.some((frame) => frame.occurrence === selected)) ||
      resolveInteractionTarget(index, source) !== target
    ) {
      return null;
    }
    return { scene: next as BoundScene, selected, target };
  }

  function stateFor(query: SvgInteractionQuery, entity: Entity | null): SvgHoverState {
    return query.result.status === "ready"
      ? { status: "ready", source: entity?.target ?? null }
      : query.result;
  }

  function reevaluate(): void {
    const lease = revision;
    if (!scene || positionState.kind !== "known") {
      return;
    }
    const known = positionState.position;
    const query = queryCurrent(known);
    const entity = entityFor(scene, query);
    const cause = sceneCause(known, query.result.status === "ready" ? query.result.point : null);
    transition(entity, cause, lease);
    publish(entity, stateFor(query, entity), scene, lease, false);
  }

  /** Reconcile only the latest committed scene after started groups and inputs finish. */
  function applyScene(next: SvgInteractionScene | null): void {
    const previous = scene;
    scene = next;
    const lease = revision;
    if (styledRoot?.root !== next?.binding?.root) {
      if (styledRoot) {
        styledRoot.root.style.touchAction = styledRoot.touchAction;
      }
      styledRoot = next?.binding
        ? { root: next.binding.root, touchAction: next.binding.root.style.touchAction }
        : null;
      if (styledRoot) {
        styledRoot.root.style.touchAction = "none";
      }
    }
    const cancellations: Group[] = [];
    for (const [pointerId, entity] of gestures) {
      const mapped = projectEntity(entity, next);
      if (mapped) {
        gestures.set(pointerId, mapped);
      } else {
        gestures.delete(pointerId);
        cancellations.push({
          entity,
          names: ["onPointerCancel"],
          cause: { ...sceneCause(null), pointerId },
        });
      }
    }
    syncResources();
    for (const group of cancellations) {
      deliver(group, lease, "obligation");
    }
    if (!isLive() || revision !== lease) {
      return;
    }
    const mappedPublished = published ? projectEntity(published, next) : null;
    const mappedNotified = notified ? projectEntity(notified, next) : null;
    // Projection belongs to the old entity, even when the current target has changed.
    if (mappedPublished) {
      published = mappedPublished;
    }
    if (mappedNotified) {
      notified = mappedNotified;
    }
    if (positionState.kind !== "known") {
      if (positionState.kind === "frozen" && mappedPublished && (!notified || mappedNotified)) {
        transition(mappedPublished, sceneCause(null), lease);
        publish(
          mappedPublished,
          { status: "ready", source: mappedPublished.target },
          next,
          lease,
          true,
        );
      } else {
        transition(
          null,
          positionState.kind === "cleared" ? positionState.cause : sceneCause(null),
          lease,
        );
        publish(
          null,
          next && (!next.binding?.isComplete || !container.contains(next.binding.root))
            ? { status: "invalid", reason: "bindingMismatch" }
            : { status: "inactive" },
          next ?? previous,
          lease,
          false,
        );
      }
      return;
    }
    const known = positionState.position;
    if (!next) {
      transition(null, sceneCause(known), lease);
      publish(null, { status: "inactive" }, previous, lease, false);
      return;
    }
    const query = queryCurrent(known);
    const entity = entityFor(next, query);
    const isContinuation = !!entity && mappedPublished?.target === entity.target;
    transition(
      entity,
      sceneCause(known, query.result.status === "ready" ? query.result.point : null),
      lease,
    );
    publish(entity, stateFor(query, entity), next, lease, isContinuation);
  }

  function settle(): void {
    if (isSettling || isDisposed) {
      return;
    }
    isSettling = true;
    try {
      while (requested !== undefined && !isDisposed) {
        const next = requested;
        requested = undefined;
        depth++;
        try {
          if (checkContext()) {
            applyScene(next);
          } else {
            scene = next;
          }
        } finally {
          depth--;
        }
      }
    } finally {
      isSettling = false;
      syncResources();
    }
  }

  function transact(operation: () => void): void {
    if (!checkContext()) {
      return;
    }
    depth++;
    try {
      operation();
    } finally {
      depth--;
      if (depth === 0) {
        settle();
        syncResources();
      }
    }
  }

  /** Hover authority is independent of whether an actual discrete input must be delivered. */
  function classifyHoverInput(event: MouseEvent): HoverEffect {
    if (isPointerLifecycle(event)) {
      if (!event.isPrimary) {
        return "none";
      }
      if (
        event.type === "pointerleave" ||
        event.type === "pointercancel" ||
        (event.type === "pointerup" && event.pointerType === "touch")
      ) {
        return "clearAfterTerminal";
      }
    } else if (
      positionState.lifecyclePointerType === "touch" ||
      (isPointer(event) && !event.isPrimary)
    ) {
      return "none";
    }
    return document.visibilityState === "hidden" ? "none" : "update";
  }

  function rememberPosition(event: MouseEvent): HoverEffect {
    const effect = classifyHoverInput(event);
    if (effect !== "update") {
      return effect;
    }
    positionState = {
      kind: "known",
      lifecyclePointerType: isPointerLifecycle(event)
        ? event.pointerType
        : positionState.lifecyclePointerType,
      position: {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: isPointer(event)
          ? event.pointerId
          : positionState.kind === "known"
            ? positionState.position.pointerId
            : null,
        pointerType: isPointer(event) ? event.pointerType : "mouse",
      },
    };
    return effect;
  }

  function inputNames(type: string, cause: Cause): readonly (keyof HandlersRef)[] {
    switch (type) {
      case "pointerdown":
        return cause.pointerType === "touch"
          ? ["onPointerDown", "onTouchStart"]
          : ["onPointerDown"];
      case "pointerup":
        return cause.pointerType === "touch" ? ["onPointerUp", "onTouchEnd"] : ["onPointerUp"];
      case "pointermove":
        return cause.pointerType === "touch"
          ? ["onPointerMove", "onMouseMove", "onTouchMove"]
          : ["onPointerMove", "onMouseMove"];
      case "mousedown":
        return ["onMouseDown"];
      case "mouseup":
        return ["onMouseUp"];
      case "click":
        return ["onClick"];
      case "dblclick":
        return ["onDoubleClick"];
      case "contextmenu":
        return ["onContextMenu"];
      default:
        return [];
    }
  }

  function offerTextMenu(entity: Entity, query: SvgInteractionQuery, event: MouseEvent): void {
    const snapshot = entity.scene;
    const paint = query.paint;
    if (
      !snapshot.enableTextCopy ||
      !snapshot.onTextContextMenu ||
      !paint ||
      paint.node.type !== "text" ||
      query.result.status !== "ready" ||
      snapshot.textMap?.sourceIndex !== snapshot.binding.sourceIndex ||
      !snapshot.textMap.nodes.has(paint.source.sourceIndex) ||
      resolveInteractionTarget(snapshot.binding.sourceIndex, paint.source) !== entity.target
    ) {
      return;
    }
    event.preventDefault();
    snapshot.onTextContextMenu({
      source: paint.source,
      point: hasSampledTextPoint(snapshot, query) ? query.result.point : null,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }

  /** Consume the old gesture before callbacks; this batch survives a scene lease change. */
  function consumeTerminal(
    event: MouseEvent,
    entity: Entity | null,
    cause: Cause,
  ): { groups: Group[]; isConsumed: boolean } {
    const groups: Group[] = [];
    let isConsumed = false;
    if (isPointer(event) && ["pointerdown", "pointerup", "pointercancel"].includes(event.type)) {
      const owner = gestures.get(event.pointerId);
      if (owner) {
        gestures.delete(event.pointerId);
        if (event.type === "pointerup" && entity?.target === owner.target) {
          groups.push({ entity: owner, names: inputNames("pointerup", cause), cause });
          isConsumed = true;
        } else {
          groups.push({ entity: owner, names: ["onPointerCancel"], cause });
        }
      }
    }
    return { groups, isConsumed };
  }

  /** Clearing is input state, not a successful publication side effect or an unknown-position freeze. */
  function clearPosition(cause: Cause): void {
    positionState = {
      kind: "cleared",
      cause,
      lifecyclePointerType:
        cause.cause === "input" &&
        isPointerLifecycle(cause.nativeEvent) &&
        cause.nativeEvent.isPrimary
          ? cause.nativeEvent.pointerType
          : positionState.lifecyclePointerType,
    };
    pendingMove = null;
    cancelFrame();
  }

  /** Unstarted hover work requires the original scene lease; obligations do not. */
  function reconcileInputHover(
    query: SvgInteractionQuery,
    position: Position,
    cause: Cause,
    lease: number,
    hoverEffect: HoverEffect,
  ): SvgInteractionQuery {
    if (positionState.kind === "cleared") {
      transition(null, positionState.cause, lease);
      return query;
    }
    if (positionState.kind !== "known" || revision !== lease) {
      return query;
    }
    const known = positionState.position;
    const primaryQuery =
      known.clientX === position.clientX && known.clientY === position.clientY
        ? query
        : queryCurrent(known);
    const hoverCause =
      hoverEffect === "none"
        ? sceneCause(
            known,
            primaryQuery.result.status === "ready" ? primaryQuery.result.point : null,
          )
        : cause;
    transition(entityFor(scene, primaryQuery), hoverCause, lease);
    return primaryQuery;
  }

  /** Actual discrete input is captured before hover callbacks and is never retargeted after a commit. */
  function deliverInput(
    event: MouseEvent,
    entity: Entity | null,
    query: SvgInteractionQuery,
    cause: Cause,
    lease: number,
    isConsumed: boolean,
  ): void {
    if (!isLive()) {
      return;
    }
    if (event.type === "pointerdown" && isPointer(event) && entity) {
      gestures.set(event.pointerId, entity);
      syncResources();
    }
    const names = inputNames(event.type, cause);
    if (!entity || isConsumed || !names.length) {
      return;
    }
    if (event.type === "contextmenu" && !sourceHandlers(entity)?.onContextMenu) {
      offerTextMenu(entity, query, event);
    } else {
      if (event.type === "contextmenu") {
        event.preventDefault();
      }
      deliver(
        { entity, names, cause },
        lease,
        event.type === "pointermove" ? "hover" : "obligation",
      );
    }
  }

  /** Public state is committed only under the current lease; a deferred clear remains explicit for reconcile. */
  function publishInputHover(query: SvgInteractionQuery, lease: number): void {
    if (positionState.kind === "cleared") {
      publish(null, { status: "inactive" }, scene, lease, false);
    } else if (positionState.kind === "known") {
      publish(notified, stateFor(query, notified), scene, lease, false);
    }
  }

  function processInput(event: MouseEvent): void {
    transact(() => {
      if (!scene) {
        return;
      }
      const hoverEffect = rememberPosition(event);
      const lease = revision;
      const position = {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: isPointer(event) ? event.pointerId : null,
        pointerType: isPointer(event) ? event.pointerType : "mouse",
      };
      const query = queryCurrent(position);
      const entity = entityFor(scene, query);
      const cause = inputCause(event, query.result.status === "ready" ? query.result.point : null);
      const terminal = consumeTerminal(event, entity, cause);
      if (hoverEffect === "clearAfterTerminal") {
        clearPosition(cause);
      }
      syncResources();
      for (const group of terminal.groups) {
        deliver(group, lease, "obligation");
      }
      const primaryQuery = reconcileInputHover(query, position, cause, lease, hoverEffect);
      deliverInput(event, entity, query, cause, lease, terminal.isConsumed);
      publishInputHover(primaryQuery, lease);
    });
  }

  function flushMove(): void {
    const event = pendingMove;
    pendingMove = null;
    if (event) {
      processInput(event);
    }
  }

  function handleDiscrete(event: Event): void {
    flushMove();
    if (!isDisposed) {
      processInput(event as MouseEvent);
    }
  }

  function handleMove(event: Event): void {
    if (!checkContext()) {
      return;
    }
    rememberPosition(event as PointerEvent);
    pendingMove = event as PointerEvent;
    syncResources();
  }

  function handleLeave(event: Event): void {
    if (classifyHoverInput(event as PointerEvent) !== "clearAfterTerminal") {
      return;
    }
    pendingMove = null;
    cancelFrame();
    transact(() => {
      const lease = revision;
      const pointer = event as PointerEvent;
      if (!pointer.isPrimary) {
        return;
      }
      const coordinates = scene?.binding
        ? translateSvgCoords(scene.binding.root, pointer.clientX, pointer.clientY)
        : null;
      const cause = inputCause(pointer, coordinates?.status === "ready" ? coordinates.point : null);
      clearPosition(cause);
      transition(null, cause, lease);
      publish(null, { status: "inactive" }, scene, lease, false);
    });
  }

  function handleBlur(): void {
    if (positionState.kind === "known") {
      positionState = { kind: "frozen", lifecyclePointerType: positionState.lifecyclePointerType };
    }
    pendingMove = null;
    cancelFrame();
    syncResources();
  }

  function handleVisibility(): void {
    if (document.visibilityState === "hidden") {
      handleBlur();
    }
  }

  function handleDocumentTerminal(event: Event): void {
    const pointer = event as PointerEvent;
    const owner = gestures.get(pointer.pointerId);
    if (!owner) {
      return;
    }
    gestures.delete(pointer.pointerId);
    syncResources();
    transact(() => {
      const lease = revision;
      const cause = inputCause(pointer, null);
      const shouldClear = classifyHoverInput(pointer) === "clearAfterTerminal";
      if (shouldClear) {
        clearPosition(cause);
      }
      deliver({ entity: owner, names: ["onPointerCancel"], cause }, lease, "obligation");
      if (shouldClear) {
        transition(null, cause, lease);
        publish(null, { status: "inactive" }, scene, lease, false);
      }
    });
  }

  function syncResources(): void {
    const window = document.defaultView;
    const shouldListenPosition = !isDisposed && positionState.kind === "known";
    if (shouldListenPosition !== isPositionListening) {
      isPositionListening = shouldListenPosition;
      if (shouldListenPosition) {
        window?.addEventListener("blur", handleBlur);
        document.addEventListener("visibilitychange", handleVisibility);
      } else {
        window?.removeEventListener("blur", handleBlur);
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    }
    const shouldListenTerminal = !isDisposed && gestures.size > 0;
    if (shouldListenTerminal !== isTerminalListening) {
      isTerminalListening = shouldListenTerminal;
      if (shouldListenTerminal) {
        document.addEventListener("pointerup", handleDocumentTerminal);
        document.addEventListener("pointercancel", handleDocumentTerminal);
      } else {
        document.removeEventListener("pointerup", handleDocumentTerminal);
        document.removeEventListener("pointercancel", handleDocumentTerminal);
      }
    }
    const shouldTick =
      !isDisposed &&
      container.isConnected &&
      document.visibilityState !== "hidden" &&
      (pendingMove !== null ||
        (positionState.kind === "known" && scene?.renderMode === "animated"));
    if (!shouldTick) {
      cancelFrame();
    } else if (!frame && window) {
      const id = window.requestAnimationFrame(() => {
        frame = null;
        if (!checkContext()) {
          return;
        }
        if (pendingMove) {
          flushMove();
        } else {
          transact(reevaluate);
        }
        syncResources();
      });
      frame = { window, id };
    }
  }

  const listeners: readonly (readonly [string, EventListener])[] = [
    ["pointermove", handleMove],
    ["pointerleave", handleLeave],
    ["pointerenter", handleDiscrete],
    ...[
      "pointerdown",
      "pointerup",
      "pointercancel",
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "contextmenu",
    ].map((type) => [type, handleDiscrete] as const),
  ];
  for (const [type, listener] of listeners) {
    container.addEventListener(type, listener);
  }
  return {
    setScene(next) {
      if (isDisposed) {
        return;
      }
      requested = next ? { ...next, handlers: new Map(next.handlers) } : null;
      revision++;
      if (depth === 0) {
        settle();
      }
    },
    dispose() {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      revision++;
      requested = undefined;
      cancelFrame();
      removeContextListeners();
      positionState = { kind: "cleared", cause: sceneCause(null), lifecyclePointerType: null };
      pendingMove = null;
      gestures.clear();
      notified = null;
      published = null;
      scene = null;
      for (const [type, listener] of listeners) {
        container.removeEventListener(type, listener);
      }
      if (styledRoot) {
        styledRoot.root.style.touchAction = styledRoot.touchAction;
        styledRoot = null;
      }
      container.style.cursor = originalStyle.cursor;
      container.style.touchAction = originalStyle.touchAction;
      container.style.userSelect = originalStyle.userSelect;
      container.style.setProperty("-webkit-user-select", originalStyle.webkitUserSelect);
    },
  };
}
