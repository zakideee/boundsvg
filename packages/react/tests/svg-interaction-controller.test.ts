// @vitest-environment happy-dom
import {
  bindIRToSvg,
  createSvgInteractionController,
  type EventCallback,
  type PointerEventInfo,
  queryCurrentSvgHit,
  type SvgHoverState,
} from "@boundsvg/browser/events";
import type { IR, IRNode } from "@boundsvg/core";
import { buildIRSourceIndex, buildTextMap } from "@boundsvg/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installSvgDomPrimitives, svgForIr } from "./svg-dom-primitives.js";

/** Controllers created by a test must close before its DOM disappears. */
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function sceneIr(firstId = "A", count = 2): IR {
  const keys = [
    "onPointerDown",
    "onPointerUp",
    "onPointerCancel",
    "onPointerMove",
    "onPointerEnter",
    "onPointerOver",
    "onPointerLeave",
    "onPointerOut",
    "onMouseEnter",
    "onMouseOver",
    "onMouseLeave",
    "onMouseOut",
    "onMouseDown",
    "onMouseUp",
    "onTouchStart",
    "onTouchEnd",
    "onClick",
  ];
  const children: IRNode[] = Array.from({ length: count }, (_, ordinal) => {
    const nodeId = ordinal === 0 ? firstId : "B";
    return {
      type: "group",
      nodeId,
      bbox: { x: ordinal * 60, y: 0, w: 40, h: 100 },
      ownership: {
        role: "source",
        on: Object.fromEntries(keys.map((key) => [key, `${nodeId}.${key}`])),
      },
      children: [],
    };
  });
  return {
    width: 200,
    height: 100,
    warnings: [],
    root: {
      type: "group",
      nodeId: "root",
      bbox: { x: 0, y: 0, w: 200, h: 100 },
      ownership: { role: "source" },
      children,
    },
  };
}

function fixture(mode: "static" | "animated" = "static") {
  const container = document.createElement("div");
  document.body.append(container);
  let root: SVGSVGElement;
  let top: Element | null = null;
  installSvgDomPrimitives(() => top ?? root);
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  const controller = createSvgInteractionController(container);
  cleanups.push(controller.dispose);
  const callbacks: PointerEventInfo[] = [];
  const hoverStates: SvgHoverState[] = [];
  const changes: (string | null)[] = [];
  let markup = "";
  let binding: ReturnType<typeof bindIRToSvg>;
  function commit(ir = sceneIr(), overrides: Record<string, EventCallback> = {}) {
    const index = buildIRSourceIndex(ir);
    const nextMarkup = svgForIr(ir);
    if (markup !== nextMarkup) {
      container.innerHTML = nextMarkup;
      markup = nextMarkup;
    }
    root = container.querySelector("svg")!;
    binding = bindIRToSvg(root, index);
    const handlers = new Map<string, EventCallback>();
    for (const info of index.sources.values()) {
      if (info.node.ownership.role !== "source") {
        continue;
      }
      for (const reference of Object.values(info.node.ownership.on ?? {})) {
        handlers.set(reference, (event) => {
          callbacks.push(event);
          overrides[reference]?.(event);
        });
      }
    }
    controller.setScene({
      binding,
      renderMode: mode,
      handlers,
      textMap: buildTextMap(index),
      onHoverState: (state) => hoverStates.push(state),
      onHoverChange: (source) => changes.push(source?.nodeId ?? null),
    });
  }
  function input(type: string, x = 20, pointerId = 1, pointerType = "mouse", isPrimary = true) {
    container.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        clientX: x,
        clientY: 20,
        pointerId,
        pointerType,
        isPrimary,
      }),
    );
  }
  function tick() {
    const queued = [...frames.values()];
    frames.clear();
    for (const callback of queued) {
      callback(0);
    }
  }
  commit();
  return {
    controller,
    container,
    commit,
    input,
    tick,
    frames,
    callbacks,
    hoverStates,
    changes,
    root: () => root,
    binding: () => binding,
    top(element: Element | null) {
      top = element;
    },
    trace: () => callbacks.map((event) => `${event.handlerName}:${event.cause}`),
  };
}

describe("single SVG interaction controller", () => {
  it("does not republish unchanged projection for a reentrant update to the same IR and receiver", () => {
    const test = fixture();
    const binding = test.binding();
    const onHoverState = vi.fn(() => {
      if (onHoverState.mock.calls.length < 3) {
        test.controller.setScene(scene());
      }
    });
    const scene = () => ({
      binding,
      renderMode: "static" as const,
      handlers: new Map(),
      textMap: null,
      onHoverState,
    });
    test.controller.setScene(scene());
    expect(onHoverState).toHaveBeenCalledTimes(1);
    const nextReceiver = vi.fn();
    test.controller.setScene({ ...scene(), onHoverState: nextReceiver });
    expect(nextReceiver).toHaveBeenCalledTimes(1);
    test.controller.setScene({
      ...scene(),
      binding: bindIRToSvg(test.root(), buildIRSourceIndex(sceneIr())),
      onHoverState: nextReceiver,
    });
    expect(nextReceiver).toHaveBeenCalledTimes(2);
  });

  for (const commitIn of ["up", "mouseDown"] as const) {
    for (const isCompatible of [false, true]) {
      for (const isPointerClick of [false, true]) {
        it(`retains touch authority across ${commitIn} commit and compatibility input (compatible=${isCompatible}, pointerClick=${isPointerClick})`, () => {
          const test = fixture("animated");
          const commit = () => test.commit(sceneIr(isCompatible ? "A" : "other"));
          test.commit(sceneIr(), {
            ...(commitIn === "up" ? { "A.onPointerUp": commit } : { "B.onMouseDown": commit }),
          });
          test.input("pointerdown", 20, 1, "touch");
          test.input("pointerup", 20, 1, "touch");
          const mouseDown = new MouseEvent("mousedown", {
            bubbles: true,
            clientX: 80,
            clientY: 20,
          });
          const mouseUp = new MouseEvent("mouseup", { bubbles: true, clientX: 80, clientY: 20 });
          const click = isPointerClick
            ? new PointerEvent("click", {
                bubbles: true,
                clientX: 80,
                clientY: 20,
                pointerType: "mouse",
                pointerId: 999,
                isPrimary: true,
              })
            : new MouseEvent("click", { bubbles: true, clientX: 80, clientY: 20 });
          for (const event of [mouseDown, mouseUp, click]) {
            test.container.dispatchEvent(event);
          }
          for (const [handlerName, nativeEvent] of [
            ["B.onMouseDown", mouseDown],
            ["B.onMouseUp", mouseUp],
            ["B.onClick", click],
          ] as const) {
            const deliveries = test.callbacks.filter((event) => event.handlerName === handlerName);
            expect(deliveries).toHaveLength(1);
            expect(deliveries[0]?.nativeEvent).toBe(nativeEvent);
            expect(deliveries[0]?.point).toEqual({ svgX: 80, svgY: 20 });
          }
          expect(
            test.callbacks.filter((event) => event.handlerName.endsWith("onPointerEnter")),
          ).toHaveLength(1);
          expect(
            test.callbacks.filter((event) => event.handlerName.endsWith("onPointerLeave")),
          ).toHaveLength(1);
          expect(test.changes).toEqual(["A", null]);
          expect(test.hoverStates.at(-1)).toEqual({ status: "inactive" });
          expect(test.frames.size).toBe(0);
        });
      }
    }
  }

  for (const pointerType of ["mouse", "pen"]) {
    it(`requires a primary ${pointerType} lifecycle input to replace touch authority`, () => {
      const test = fixture("animated");
      test.input("pointerdown", 20, 1, "touch");
      test.input("pointerup", 20, 1, "touch");
      test.input("pointermove", 80, 2, pointerType, false);
      test.tick();
      test.container.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 80, clientY: 20 }),
      );
      expect(test.changes).toEqual(["A", null]);
      expect(test.frames.size).toBe(0);
      test.input("pointermove", 80, 9, pointerType);
      test.tick();
      test.input("pointerup", 80, 9, pointerType);
      expect(test.hoverStates.at(-1)).toMatchObject({ status: "ready", source: { nodeId: "B" } });
      expect(test.frames.size).toBe(1);
    });
  }

  it("preserves fresh MouseEvent-only input before any pointer lifecycle", () => {
    const test = fixture("animated");
    for (const type of ["mousedown", "mouseup", "click"]) {
      test.container.dispatchEvent(
        new MouseEvent(type, { bubbles: true, clientX: 20, clientY: 20 }),
      );
    }
    expect(test.hoverStates.at(-1)).toMatchObject({ status: "ready", source: { nodeId: "A" } });
    expect(test.frames.size).toBe(1);
    expect(
      test.callbacks.filter((event) =>
        ["A.onMouseDown", "A.onMouseUp", "A.onClick"].includes(event.handlerName),
      ),
    ).toHaveLength(3);
  });

  it("keeps a real MouseEvent as the cause when it changes primary hover", () => {
    const test = fixture();
    test.input("pointermove", 20);
    test.tick();
    test.callbacks.length = 0;
    test.container.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 80, clientY: 20 }),
    );
    expect(test.callbacks.find((event) => event.handlerName === "B.onPointerEnter")).toMatchObject({
      cause: "input",
      nativeEvent: expect.any(MouseEvent),
    });
  });

  for (const terminal of ["ownedUp", "unownedUp", "cancel"] as const) {
    for (const isCompatible of [false, true]) {
      it(`clears primary touch after ${terminal} reentrant commit (compatible=${isCompatible})`, () => {
        const test = fixture("animated");
        const next = () => sceneIr(isCompatible ? "A" : "other");
        const commit = () => test.commit(next());
        test.commit(sceneIr(), { "A.onPointerUp": commit, "A.onPointerCancel": commit });
        test.input("pointerdown", 20, 1, "touch");
        test.callbacks.length = 0;
        test.changes.length = 0;
        test.input(
          terminal === "cancel" ? "pointercancel" : "pointerup",
          20,
          terminal === "unownedUp" ? 2 : 1,
          "touch",
        );
        expect(
          test.callbacks.filter((event) => event.handlerName.endsWith("onPointerEnter")),
        ).toHaveLength(0);
        expect(
          test.callbacks.filter((event) => event.handlerName.endsWith("onPointerLeave")),
        ).toHaveLength(1);
        expect(test.hoverStates.at(-1)).toEqual({ status: "inactive" });
        expect(test.changes).toEqual([null]);
        expect(test.frames.size).toBe(0);
      });
    }
  }

  for (const isCompatible of [false, true]) {
    it(`projects a mapped departing hover before querying a new target (compatible=${isCompatible})`, () => {
      const test = fixture("animated");
      test.input("pointermove", 20);
      test.tick();
      const oldSource = test.binding().sourceIndex.sources.get(1)!.source;
      const ir = sceneIr(isCompatible ? "A" : "other");
      const first = ir.root.children[0]!;
      const second = ir.root.children[1]!;
      first.bbox = { x: 120, y: 0, w: 40, h: 100 };
      second.bbox = { x: 0, y: 0, w: 40, h: 100 };
      const newestLeave = vi.fn();
      test.callbacks.length = 0;
      test.commit(ir, { "A.onPointerLeave": newestLeave });
      const leave = test.callbacks.find((event) => event.handlerName.endsWith("onPointerLeave"));
      expect(leave?.source).toBe(
        isCompatible ? test.binding().sourceIndex.sources.get(1)!.source : oldSource,
      );
      expect(newestLeave).toHaveBeenCalledTimes(isCompatible ? 1 : 0);
    });
  }

  it("publishes only declared callback fields for touch input and scene cancellation", () => {
    const test = fixture();
    test.input("pointerdown", 20, 7, "touch");
    test.commit(sceneIr("different"));
    const down = test.callbacks.find((event) => event.handlerName === "A.onPointerDown")!;
    const cancel = test.callbacks.find((event) => event.handlerName === "A.onPointerCancel")!;
    for (const event of [down, cancel]) {
      expect(Object.keys(event).sort()).toEqual([
        "cause",
        "handlerName",
        "nativeEvent",
        "nodeId",
        "point",
        "pointerId",
        "source",
      ]);
      expect(event.pointerId).toBe(7);
    }
    expect(cancel).toMatchObject({ cause: "scene", nativeEvent: null });
  });

  it("continues handlerless decoration paint across matching snapshots without a hover change", () => {
    const test = fixture();
    const decorated = (): IR => ({
      width: 200,
      height: 100,
      warnings: [],
      root: {
        type: "group",
        nodeId: "root",
        bbox: { x: 0, y: 0, w: 200, h: 100 },
        ownership: { role: "source" },
        children: [
          {
            type: "group",
            nodeId: "paint",
            bbox: { x: 0, y: 0, w: 100, h: 100 },
            ownership: { role: "source" },
            children: [
              {
                type: "rect",
                nodeId: "paint:bg",
                bbox: { x: 0, y: 0, w: 100, h: 100 },
                fill: "red",
                ownership: { role: "decoration", ownerNodeId: "paint" },
              },
            ],
          },
        ],
      },
    });
    test.commit(decorated());
    test.top(test.root().querySelector("rect"));
    test.input("pointermove", 20);
    test.tick();
    expect(test.changes).toEqual(["paint"]);
    test.changes.length = 0;
    test.commit(decorated());
    expect(test.hoverStates.at(-1)).toMatchObject({ status: "ready", source: { nodeId: "paint" } });
    expect(test.changes).toEqual([]);
  });

  for (const hasFrontFrame of [false, true]) {
    it(`keeps the Text witness only in the selected branch (front Frame=${hasFrontFrame})`, () => {
      const test = fixture();
      const bbox = { x: 100, y: 10, w: 80, h: 30 };
      const text: IRNode = {
        type: "text",
        nodeId: "label",
        ownership: { role: "source" },
        bbox,
        lines: [{ text: "label", glyphs: [], width: 80, baselineY: 25 }],
      };
      const front: IRNode = {
        type: "group",
        nodeId: "overlay",
        ownership: { role: "source", on: { onClick: "overlayClick" } },
        bbox,
        children: [],
      };
      const ir: IR = {
        width: 240,
        height: 80,
        warnings: [],
        root: {
          type: "group",
          nodeId: "outer",
          ownership: { role: "source", on: { onClick: "outerClick" } },
          bbox: { x: 0, y: 0, w: 40, h: 40 },
          children: hasFrontFrame ? [text, front] : [text],
        },
      };
      test.commit(ir);
      test.top(test.root().querySelector('[data-boundsvg-node-id="label"] [data-test-paint]'));
      const menu = vi.fn();
      test.controller.setScene({
        binding: test.binding(),
        renderMode: "static",
        handlers: new Map(),
        textMap: buildTextMap(test.binding().sourceIndex),
        enableTextCopy: true,
        onHoverState() {},
        onTextContextMenu: menu,
      });
      expect(queryCurrentSvgHit(test.binding(), 120, 20)).toMatchObject({
        status: "ready",
        hit: { nodeId: hasFrontFrame ? "overlay" : "label" },
      });
      test.container.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 120,
          clientY: 20,
        }),
      );
      expect(menu).toHaveBeenCalledTimes(hasFrontFrame ? 0 : 1);
      if (!hasFrontFrame) {
        expect(menu).toHaveBeenCalledWith(
          expect.objectContaining({
            source: expect.objectContaining({ nodeId: "label" }),
            point: { svgX: 120, svgY: 20 },
          }),
        );
      }
    });
  }

  it("does not map an older entity using only intermediate/latest topology", () => {
    const test = fixture();
    test.commit(sceneIr(), { "A.onPointerCancel": () => test.commit(sceneIr("replacement", 1)) });
    test.input("pointerdown", 20);
    test.callbacks.length = 0;
    test.changes.length = 0;
    test.commit(sceneIr("replacement", 1));
    expect(test.trace()).toContain("A.onPointerLeave:scene");
    expect(test.trace()).toContain("replacement.onPointerEnter:scene");
    expect(test.changes).toEqual(["replacement"]);
  });

  it("maps an older/latest match directly despite incompatible intermediate topology", () => {
    const test = fixture();
    test.commit(sceneIr(), { "A.onPointerCancel": () => test.commit(sceneIr()) });
    test.input("pointerdown", 20);
    test.callbacks.length = 0;
    test.changes.length = 0;
    test.commit(sceneIr("replacement", 1));
    expect(
      test.callbacks.filter(
        (event) => event.handlerName.includes("Leave") || event.handlerName.includes("Enter"),
      ),
    ).toHaveLength(0);
    expect(test.changes).toEqual([]);
  });

  it("coalesces moves, flushes before down and leaves static idle without RAF", () => {
    const test = fixture();
    test.input("pointermove", 20);
    test.input("pointermove", 80);
    expect(test.frames.size).toBe(1);
    test.input("pointerdown", 20);
    const moves = test.callbacks.filter((event) => event.handlerName.endsWith("onPointerMove"));
    expect(moves.map((event) => event.point?.svgX)).toEqual([80]);
    expect(
      test.callbacks.find((event) => event.handlerName === "A.onPointerDown")?.point?.svgX,
    ).toBe(20);
    expect(test.frames.size).toBe(0);
  });

  it("reevaluates a stationary position using endpoint CTM without forging move", () => {
    const test = fixture("animated");
    test.input("pointermove", 20);
    test.tick();
    expect(test.frames.size).toBe(1);
    const first = test.binding().elementForNode(1)!;
    Object.defineProperty(first, "getScreenCTM", {
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 50, f: 0 }),
    });
    const moves = test.callbacks.filter((event) =>
      event.handlerName.endsWith("onPointerMove"),
    ).length;
    test.tick();
    expect(test.changes).toEqual(["A", null]);
    const leave = test.callbacks.find((event) => event.handlerName === "A.onPointerLeave");
    expect(leave).toMatchObject({ cause: "scene", nativeEvent: null, pointerId: 1 });
    expect(
      test.callbacks.filter((event) => event.handlerName.endsWith("onPointerMove")),
    ).toHaveLength(moves);
    expect(test.frames.size).toBe(1);
    test.controller.dispose();
    expect(test.frames.size).toBe(0);
  });

  it("keeps a started leave group, drops old enter and compensates when returning to the same target", () => {
    const test = fixture();
    test.commit(sceneIr(), { "A.onPointerLeave": () => test.commit(sceneIr()) });
    test.input("pointermove", 20);
    test.tick();
    test.input("pointermove", 80);
    test.tick();
    expect(test.trace()).toContain("A.onMouseOut:input");
    expect(test.trace()).not.toContain("B.onPointerEnter:input");
    expect(test.trace()).toContain("B.onPointerEnter:scene");
    expect(test.changes).toEqual(["A", "B"]);

    test.callbacks.length = 0;
    test.changes.length = 0;
    test.commit(sceneIr(), { "B.onPointerLeave": () => test.commit(sceneIr()) });
    test.input("pointermove", 20);
    test.tick();
    expect(test.trace()).toContain("B.onMouseOut:input");
    expect(test.trace()).toContain("A.onPointerEnter:scene");
    expect(test.changes).toEqual(["A"]);
  });

  it("delivers actual down after enter replaces the scene, then cancels the old owner once", () => {
    const test = fixture();
    test.commit(sceneIr(), { "A.onPointerEnter": () => test.commit(sceneIr("replacement")) });
    test.input("pointerdown", 20, 1, "touch");
    expect(test.trace()).toContain("A.onTouchStart:input");
    expect(test.trace()).toContain("A.onMouseOver:input");
    expect(
      test.callbacks.filter((event) => event.handlerName === "A.onPointerCancel"),
    ).toHaveLength(1);
    expect(test.callbacks.find((event) => event.handlerName === "A.onPointerCancel")).toMatchObject(
      { cause: "scene", nativeEvent: null, point: null },
    );
    test.input("pointerup", 20, 1, "touch");
    expect(
      test.callbacks.filter((event) => event.handlerName === "A.onPointerCancel"),
    ).toHaveLength(1);
  });

  it("compensates a started leave when the latest scene returns to the same logical target", () => {
    const test = fixture();
    const latest = sceneIr();
    if (latest.root.type !== "group") {
      throw new TypeError("Missing group");
    }
    latest.root.children![0]!.bbox.x = 60;
    latest.root.children![1]!.bbox.x = 120;
    test.commit(sceneIr(), { "A.onPointerLeave": () => test.commit(latest) });
    test.input("pointermove", 20);
    test.tick();
    test.input("pointermove", 80);
    test.tick();
    expect(test.trace()).toContain("A.onMouseOut:input");
    expect(test.trace()).toContain("A.onPointerEnter:scene");
    expect(test.trace()).not.toContain("B.onPointerEnter:input");
    expect(test.changes).toEqual(["A"]);
  });

  it("does not send an old terminal through a reused handler ID on another entity", () => {
    const test = fixture();
    test.input("pointerdown", 20);
    const replacement = sceneIr("replacement");
    if (replacement.root.type !== "group") {
      throw new TypeError("Missing group");
    }
    replacement.root.children![0]!.ownership = {
      role: "source",
      on: { onPointerCancel: "A.onPointerCancel" },
    };
    const reusedCallback = vi.fn();
    test.commit(replacement, { "A.onPointerCancel": reusedCallback });
    expect(reusedCallback).not.toHaveBeenCalled();
    expect(
      test.callbacks.filter((event) => event.handlerName === "A.onPointerCancel"),
    ).toHaveLength(1);
    expect(
      test.callbacks.find((event) => event.handlerName === "A.onPointerCancel")?.source.nodeId,
    ).toBe("A");
  });

  it("projects unknown frozen ownership without using an old physical position", () => {
    const test = fixture("animated");
    test.input("pointermove", 20);
    test.tick();
    window.dispatchEvent(new Event("blur"));
    const next = sceneIr();
    if (next.root.type !== "group") {
      throw new TypeError("Missing group");
    }
    next.root.children![0]!.bbox.x = 120;
    test.commit(next);
    expect(test.frames.size).toBe(0);
    expect(test.changes).toEqual(["A"]);
    expect(test.hoverStates.at(-1)).toMatchObject({ status: "ready", source: { nodeId: "A" } });
    test.input("pointerenter", 20);
    expect(test.changes).toEqual(["A", null]);
  });

  it("retains old callbacks across incompatible ID reuse and completes every cancel obligation", () => {
    const test = fixture();
    test.commit(sceneIr(), { "A.onPointerCancel": () => test.commit(sceneIr("latest")) });
    test.input("pointerdown", 20, 1);
    test.input("pointerdown", 80, 2, "touch", false);
    test.commit(sceneIr("replacement", 1));
    expect(
      test.callbacks.filter((event) => event.handlerName === "A.onPointerCancel"),
    ).toHaveLength(1);
    expect(
      test.callbacks.filter((event) => event.handlerName === "B.onPointerCancel"),
    ).toHaveLength(1);
    expect(
      test.callbacks
        .filter(
          (event) =>
            event.handlerName === "A.onPointerCancel" || event.handlerName === "B.onPointerCancel",
        )
        .every((event) => event.cause === "scene" && event.point === null),
    ).toBe(true);
  });

  it("closes owned external releases at Document bubble, keeps blur ownership and ignores lost capture", () => {
    const test = fixture("animated");
    test.input("pointerdown", 20);
    test.container.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1 }));
    window.dispatchEvent(new Event("blur"));
    expect(test.frames.size).toBe(0);
    expect(
      test.callbacks.filter((event) => event.handlerName.endsWith("onPointerCancel")),
    ).toHaveLength(0);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
    expect(
      test.callbacks.filter((event) => event.handlerName === "A.onPointerCancel"),
    ).toHaveLength(1);
    expect(
      test.callbacks.find((event) => event.handlerName === "A.onPointerCancel")?.point,
    ).toBeNull();
  });

  it("closes an unknown frozen Frame when its new snapshot has no Frame references", () => {
    const test = fixture("animated");
    test.input("pointerdown", 20);
    window.dispatchEvent(new Event("blur"));
    const next = sceneIr();
    if (next.root.type !== "group") {
      throw new TypeError("Missing group");
    }
    const first = next.root.children?.[0];
    if (!first) {
      throw new TypeError("Missing first Frame");
    }
    first.ownership = { role: "source" };
    test.callbacks.length = 0;
    test.commit(next);
    expect(
      test.callbacks.filter((event) => event.handlerName === "A.onPointerCancel"),
    ).toHaveLength(1);
    expect(test.callbacks.filter((event) => event.handlerName === "A.onPointerLeave")).toHaveLength(
      1,
    );
    expect(test.changes).toEqual(["A", null]);
    expect(test.hoverStates.at(-1)).toEqual({ status: "inactive" });
  });

  it("does not let a secondary pointer steal hover or discard a primary queued move", () => {
    const test = fixture();
    test.input("pointermove", 20);
    test.input("pointerleave", 80, 2, "touch", false);
    test.tick();
    expect(test.changes).toEqual(["A"]);
    test.input("pointerdown", 80, 2, "touch", false);
    expect(test.changes).toEqual(["A"]);
    expect(test.callbacks.find((event) => event.handlerName === "B.onPointerDown")?.pointerId).toBe(
      2,
    );
  });

  it("uses at most two current point queries for distinct primary and secondary positions", () => {
    const test = fixture();
    test.input("pointermove", 20);
    test.tick();
    const nativeQueries = vi.spyOn(document, "elementsFromPoint");
    test.input("pointerdown", 80, 2, "touch", false);
    expect(nativeQueries).toHaveBeenCalledTimes(2);
    nativeQueries.mockClear();
    test.input("pointerdown", 20);
    expect(nativeQueries).toHaveBeenCalledTimes(1);
  });

  it("keeps normal blank Frame hits but blocks HTML and native handlerless paint", () => {
    const test = fixture();
    expect(queryCurrentSvgHit(test.binding(), 20, 20)).toMatchObject({
      status: "ready",
      hit: { nodeId: "A" },
    });
    const overlay = document.createElement("div");
    document.body.append(overlay);
    test.top(overlay);
    expect(queryCurrentSvgHit(test.binding(), 20, 20)).toMatchObject({
      status: "ready",
      hit: null,
    });
    const ir = sceneIr();
    if (ir.root.type !== "group") {
      throw new TypeError("Missing group");
    }
    ir.root.children?.push({
      type: "rect",
      nodeId: "opaque",
      ownership: { role: "source" },
      bbox: { x: 0, y: 0, w: 100, h: 100 },
      fill: "red",
    });
    test.commit(ir);
    test.top(test.root().querySelector("rect"));
    expect(queryCurrentSvgHit(test.binding(), 20, 20)).toMatchObject({
      status: "ready",
      hit: { nodeId: "opaque" },
    });
  });

  it("preserves failure states and stops a started group on dispose", () => {
    const test = fixture();
    Object.defineProperty(test.binding().elementForNode(1)!, "getScreenCTM", {
      configurable: true,
      value: () => null,
    });
    test.input("pointerdown");
    expect(test.hoverStates.at(-1)).toEqual({
      status: "unavailable",
      reason: "coordinatesUnavailable",
    });
    expect(test.callbacks).toHaveLength(0);
    test.commit(sceneIr("changed"), { "changed.onPointerEnter": () => test.controller.dispose() });
    test.input("pointerdown");
    expect(test.trace()).toEqual(["changed.onPointerEnter:scene"]);
  });

  it("keeps native paint when a separate semantic Frame has a zero column", () => {
    const test = fixture();
    const ir = sceneIr();
    if (ir.root.type !== "group") {
      throw new TypeError("Missing group");
    }
    ir.root.children?.push({
      type: "rect",
      nodeId: "paint",
      ownership: { role: "source" },
      bbox: { x: 0, y: 0, w: 100, h: 100 },
      fill: "red",
    });
    test.commit(ir);
    test.top(test.root().querySelector("rect"));
    Object.defineProperty(test.binding().elementForNode(1)!, "getScreenCTM", {
      value: () => ({ a: 0, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    });
    expect(queryCurrentSvgHit(test.binding(), 20, 20)).toMatchObject({
      status: "ready",
      hit: { nodeId: "paint" },
    });
  });

  it("reads a shared clip endpoint once per query without retaining its pose", () => {
    const test = fixture();
    const ir = sceneIr();
    if (ir.root.type !== "group") {
      throw new TypeError("Missing group");
    }
    ir.root.clip = {
      kind: "boxContour",
      bbox: ir.root.bbox,
      corners: [
        { rx: 0, ry: 0 },
        { rx: 0, ry: 0 },
        { rx: 0, ry: 0 },
        { rx: 0, ry: 0 },
      ],
    };
    test.commit(ir);
    const endpointReads = [...test.binding().sourceIndex.nodes.keys()].map((ordinal) =>
      vi.spyOn(test.binding().elementForNode(ordinal) as SVGGraphicsElement, "getScreenCTM"),
    );
    const rootRead = vi.spyOn(test.root(), "getScreenCTM");
    const nativeRead = vi.spyOn(document, "elementsFromPoint");
    queryCurrentSvgHit(test.binding(), 20, 20);
    expect(endpointReads.map((read) => read.mock.calls.length)).toEqual([1, 1, 1]);
    expect(rootRead).toHaveBeenCalledTimes(1);
    expect(nativeRead).toHaveBeenCalledTimes(1);
    queryCurrentSvgHit(test.binding(), 20, 20);
    expect(endpointReads.map((read) => read.mock.calls.length)).toEqual([2, 2, 2]);
  });
});
