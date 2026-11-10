// @vitest-environment happy-dom
import type { BoxClip, IR, IRGroupNode, IRNode } from "@boundsvg/core";
import { buildIRSourceIndex } from "@boundsvg/core/scene";
import { afterEach, expect, it, vi } from "vitest";
import { bindIRToSvg } from "../src/ir-dom-binding.js";
import { querySvgInteraction } from "../src/svg-event-utils.js";

/** Unit-only acquisition inputs; geometry and points are independent of the query. */
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
/** Restore the optional DOM capability after each independent unit input. */
const originalHitApi = Object.getOwnPropertyDescriptor(document, "elementsFromPoint");
/** Native constructor doubles are restored after their focused capability control. */
const originalMatrixApi = Object.getOwnPropertyDescriptor(window, "DOMMatrixReadOnly");

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  if (originalMatrixApi) {
    Object.defineProperty(window, "DOMMatrixReadOnly", originalMatrixApi);
  } else {
    Reflect.deleteProperty(window, "DOMMatrixReadOnly");
  }
  if (originalHitApi) {
    Object.defineProperty(document, "elementsFromPoint", originalHitApi);
  } else {
    Reflect.deleteProperty(document, "elementsFromPoint");
  }
});

function fixture(innerEmpty = false, paintPlacement?: "front" | "back") {
  const bbox = { x: 0, y: 0, w: 200, h: 200 };
  const group = (nodeId: string, children: IRNode[]): IRGroupNode => ({
    type: "group",
    nodeId,
    bbox,
    ownership: { role: "source" },
    children,
  });
  const frame = group("frame", []);
  frame.ownership = { role: "source", on: { onClick: "select" } };
  const inner = group("inner", [frame]);
  const outer = group("outer", [inner]);
  const area = {
    kind: "boxContour",
    bbox,
    corners: [
      { rx: 0, ry: 0 },
      { rx: 0, ry: 0 },
      { rx: 0, ry: 0 },
      { rx: 0, ry: 0 },
    ],
  } satisfies BoxClip;
  inner.clip = innerEmpty ? { kind: "empty" } : area;
  outer.clip = area;
  const paint: IRNode = {
    type: "rect",
    nodeId: "paint",
    ownership: { role: "source" },
    bbox,
    fill: "red",
  };
  const ir: IR = {
    width: 200,
    height: 200,
    warnings: [],
    root: group(
      "root",
      paintPlacement === "front"
        ? [outer, paint]
        : paintPlacement === "back"
          ? [paint, outer]
          : [outer],
    ),
  };
  const index = buildIRSourceIndex(ir);
  const root = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.body.append(root);
  const endpoints = new Map<number, Element>();
  for (const occurrence of index.nodes.values()) {
    const endpoint = document.createElementNS(
      "http://www.w3.org/2000/svg",
      occurrence.node.type === "rect" ? "rect" : "g",
    );
    endpoint.setAttribute("data-boundsvg-node-index", String(occurrence.nodeIndex));
    endpoint.setAttribute("data-boundsvg-source-index", String(occurrence.source.sourceIndex));
    endpoint.setAttribute("data-boundsvg-role", "source");
    endpoint.setAttribute("data-boundsvg-node-id", occurrence.node.nodeId);
    (occurrence.parentNodeIndex === null
      ? root
      : endpoints.get(occurrence.parentNodeIndex)!
    ).append(endpoint);
    endpoints.set(occurrence.nodeIndex, endpoint);
  }
  for (const endpoint of [root, ...endpoints.values()]) {
    Object.defineProperty(endpoint, "getScreenCTM", { configurable: true, value: () => IDENTITY });
    Object.defineProperty(endpoint, "computedStyleMap", {
      configurable: true,
      value: () => ({ get: () => ({ value: "none" }) }),
    });
  }
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [root] });
  return { root, endpoints, binding: bindIRToSvg(root, index) };
}

for (const location of [
  { phase: "root" },
  { phase: "frame", nodeIndex: 3 },
  { phase: "clip", nodeIndex: 1 },
] as const) {
  const { phase } = location;
  it(`retains the ${phase} getter exception in a private acquisition witness`, () => {
    const scene = fixture();
    const endpoint =
      location.phase === "root" ? scene.root : scene.endpoints.get(location.nodeIndex)!;
    const error = new TypeError(`${phase} CTM unavailable`);
    Object.defineProperty(endpoint, "getScreenCTM", {
      value: () => {
        throw error;
      },
    });
    const query = querySvgInteraction(scene.binding, 80, 80);
    expect(query.result).toEqual({ status: "unavailable", reason: "coordinatesUnavailable" });
    expect(query.failure).toEqual({
      ...location,
      read:
        phase === "root"
          ? { status: "unavailable", error }
          : { status: "unavailable", error, element: endpoint },
    });
    expect(query.result).not.toHaveProperty("failure");
  });
}

it("selects a Frame through two canonical square-corner clips at an authored inside point", () => {
  const scene = fixture();
  const query = querySvgInteraction(scene.binding, 80, 80);
  expect(query.result).toEqual({
    status: "ready",
    point: { svgX: 80, svgY: 80 },
    hit: scene.binding.sourceIndex.sources.get(3)!.source,
  });
  expect(query.selected).toBe(scene.binding.sourceIndex.nodes.get(3));
  expect(query.failure).toBeUndefined();
  expect(querySvgInteraction(scene.binding, 220, 80).result).toEqual({
    status: "ready",
    point: { svgX: 220, svgY: 80 },
    hit: null,
  });
});

it("shares unique screen and local native reads across Frame and clip ancestry", () => {
  const scene = fixture();
  const screens = new Map<Element, number>();
  const styles = new Map<Element, number>();
  for (const endpoint of [scene.root, ...scene.endpoints.values()]) {
    Object.defineProperty(endpoint, "getScreenCTM", {
      value: () => {
        screens.set(endpoint, (screens.get(endpoint) ?? 0) + 1);
        return IDENTITY;
      },
    });
    Object.defineProperty(endpoint, "computedStyleMap", {
      value: () => {
        styles.set(endpoint, (styles.get(endpoint) ?? 0) + 1);
        return { get: () => ({ value: "none" }) };
      },
    });
  }
  expect(querySvgInteraction(scene.binding, 80, 80).result.status).toBe("ready");
  expect([...screens.values()]).toEqual([1, 1, 1, 1, 1]);
  expect([...styles.values()]).toEqual([1, 1, 1, 1, 1]);
});

it("uses direct Typed OM coefficients without string rounding or composing witnesses", () => {
  const scene = fixture();
  const endpoint = scene.endpoints.get(3)!;
  const toMatrix = vi.fn(() => ({ ...IDENTITY, a: Number.MIN_VALUE, is2D: true }));
  Object.defineProperty(endpoint, "computedStyleMap", {
    value: () => ({
      get: () => ({
        is2D: true,
        toMatrix,
        toString: () => {
          throw new TypeError("Forbidden string roundtrip");
        },
      }),
    }),
  });
  expect(querySvgInteraction(scene.binding, 80, 80).result).toMatchObject({
    status: "ready",
    hit: { nodeId: "frame" },
  });
  expect(toMatrix).toHaveBeenCalledTimes(1);
  Object.defineProperty(endpoint, "computedStyleMap", {
    value: () => ({
      get: () => ({ is2D: true, toMatrix: () => ({ ...IDENTITY, a: 0, is2D: true }) }),
    }),
  });
  expect(querySvgInteraction(scene.binding, 80, 80).result).toMatchObject({
    status: "ready",
    hit: null,
  });
});

for (const invalid of ["null", "unknown", "value3d", "matrix3d", "throw"] as const) {
  it(`does not fall through a present Typed OM ${invalid} result to CSSOM`, () => {
    const scene = fixture();
    const cssom = vi.spyOn(window, "getComputedStyle");
    const value =
      invalid === "null"
        ? null
        : invalid === "unknown"
          ? {}
          : {
              is2D: invalid !== "value3d",
              toMatrix: () => ({ ...IDENTITY, is2D: invalid !== "matrix3d" }),
            };
    Object.defineProperty(scene.endpoints.get(3)!, "computedStyleMap", {
      value: () => {
        if (invalid === "throw") {
          throw new TypeError("Native failure");
        }
        return { get: () => value };
      },
    });
    expect(querySvgInteraction(scene.binding, 80, 80).result).toEqual({
      status: "unavailable",
      reason: "coordinatesUnavailable",
    });
    expect(cssom).not.toHaveBeenCalled();
  });
}

it("uses native CSSOM matrix parsing only when Typed OM capability is absent", () => {
  const scene = fixture();
  const endpoint = scene.endpoints.get(3)!;
  Object.defineProperty(endpoint, "computedStyleMap", { value: undefined });
  const originalStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = originalStyle(element);
    Object.defineProperty(style, "transform", { value: "matrix(0, 0, 0, 1, 0, 0)" });
    return style;
  });
  const parsed: string[] = [];
  Object.defineProperty(window, "DOMMatrixReadOnly", {
    configurable: true,
    value: class {
      a = 0;
      b = 0;
      c = 0;
      d = 1;
      is2D = true;
      constructor(value: string) {
        parsed.push(value);
      }
    },
  });
  expect(querySvgInteraction(scene.binding, 80, 80).result).toMatchObject({
    status: "ready",
    hit: null,
  });
  expect(parsed).toEqual(["matrix(0, 0, 0, 1, 0, 0)"]);
});

it("treats native none as absent evidence without reviving an authored attribute", () => {
  const scene = fixture();
  scene.endpoints.get(3)!.setAttribute("transform", "scale(0)");
  expect(querySvgInteraction(scene.binding, 80, 80).result).toMatchObject({
    status: "ready",
    hit: { nodeId: "frame" },
  });
});

for (const placement of ["front", "back"] as const) {
  it(`keeps the ${placement} native paint rank distinct from an unavailable Frame`, () => {
    const scene = fixture(false, placement);
    const frame = [...scene.endpoints.values()].find(
      (endpoint) => endpoint.getAttribute("data-boundsvg-node-id") === "frame",
    )!;
    const paint = [...scene.endpoints.values()].find(
      (endpoint) => endpoint.getAttribute("data-boundsvg-node-id") === "paint",
    )!;
    const read = vi.fn(() => {
      throw new TypeError("Unavailable semantic Frame");
    });
    Object.defineProperty(frame, "getScreenCTM", { value: read });
    Object.defineProperty(document, "elementsFromPoint", { value: () => [paint] });
    const query = querySvgInteraction(scene.binding, 80, 80);
    expect(query.result).toMatchObject(
      placement === "front"
        ? { status: "ready", hit: { nodeId: "paint" } }
        : { status: "unavailable", reason: "coordinatesUnavailable" },
    );
    expect(read).toHaveBeenCalledTimes(placement === "front" ? 0 : 1);
  });
}

it("evaluates the inner empty clip before a finite unresolved ancestor matrix", () => {
  const scene = fixture(true);
  Object.defineProperty(scene.endpoints.get(1)!, "getScreenCTM", {
    value: () => ({ ...IDENTITY, b: 1, c: 1 }),
  });
  expect(querySvgInteraction(scene.binding, 80, 80).result).toMatchObject({
    status: "ready",
    hit: null,
  });
});

it("evaluates an inner zero-column clip before an unresolved ancestor", () => {
  const scene = fixture();
  Object.defineProperty(scene.endpoints.get(1)!, "getScreenCTM", {
    value: () => ({ ...IDENTITY, b: 1, c: 1 }),
  });
  Object.defineProperty(scene.endpoints.get(2)!, "getScreenCTM", {
    value: () => ({ ...IDENTITY, a: 0 }),
  });
  expect(querySvgInteraction(scene.binding, 80, 80).result).toMatchObject({
    status: "ready",
    hit: null,
  });
});

it("retains a nonfinite root read separately from a normal miss", () => {
  const scene = fixture();
  const matrix = { ...IDENTITY, a: Number.NaN };
  Object.defineProperty(scene.root, "getScreenCTM", { value: () => matrix });
  const query = querySvgInteraction(scene.binding, 80, 80);
  expect(query.result).toEqual({ status: "unavailable", reason: "coordinatesUnavailable" });
  expect(query.failure).toMatchObject({
    phase: "root",
    read: { status: "ready", matrix },
    checked: { status: "unavailable", reason: "nonFiniteMatrix" },
  });
  expect(query.failure).not.toHaveProperty("nodeIndex");
});

it("retains finite unresolved Frame containment inputs without casting failure to null", () => {
  const scene = fixture();
  Object.defineProperty(scene.endpoints.get(3)!, "getScreenCTM", {
    value: () => ({ ...IDENTITY, b: 1, c: 1 }),
  });
  const query = querySvgInteraction(scene.binding, 80, 80);
  expect(query.result).toEqual({ status: "unavailable", reason: "coordinatesUnavailable" });
  expect(query.failure).toMatchObject({
    phase: "containment",
    frameNodeIndex: 3,
    detail: { status: "unavailable", reason: "unresolvedDeterminant" },
  });
});

it("retains derived containment failure and its Frame/clip input locations privately", () => {
  const scene = fixture();
  Object.defineProperty(scene.endpoints.get(2)!, "getScreenCTM", {
    value: () => ({ ...IDENTITY, b: 1, c: 1 }),
  });
  const query = querySvgInteraction(scene.binding, 80, 80);
  expect(query.failure).toEqual({
    phase: "containment",
    frameNodeIndex: 3,
    clipNodeIndices: [1, 2],
    detail: { status: "unavailable", reason: "unresolvedDeterminant" },
  });
  expect(query.result).toEqual({ status: "unavailable", reason: "coordinatesUnavailable" });
});
