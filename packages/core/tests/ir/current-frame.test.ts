import { describe, expect, it } from "vitest";
import {
  evaluateHitClips,
  type HitClip,
  type HitPose,
  isPointInViewport,
  queryFrameContainment,
} from "../../src/ir/hit-geometry.js";
import {
  buildIRSourceIndex,
  isSemanticFrame,
  resolveInteractionTarget,
} from "../../src/ir/source-index.js";
import type { BoxClip, IR } from "../../src/ir/types.js";
import {
  applyInverseAffineMatrixToPoint,
  createResolvedTransformMatrix,
  multiplyAffineMatrices,
} from "../../src/transform.js";

/** A local Frame whose left edge moves across the fixed point at 700ms. */
const FRAME = { x: 40, y: 40, w: 100, h: 80 };
/** Identity coefficients keep expected arithmetic independent of the implementation. */
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
/** Square corners exercise the canonical contour in both positive and short-circuit paths. */
const FRAME_CLIP = {
  kind: "boxContour",
  bbox: FRAME,
  corners: [
    { rx: 0, ry: 0 },
    { rx: 0, ry: 0 },
    { rx: 0, ry: 0 },
    { rx: 0, ry: 0 },
  ],
} satisfies BoxClip;

describe("checked current Frame geometry", () => {
  it("uses independent linear evidence without composing it into the main position", () => {
    const pose: HitPose = { matrix: IDENTITY, linearWitnesses: [{ a: 2, b: 0, c: 0, d: 2 }] };
    expect(queryFrameContainment(FRAME, pose, null, { x: 130, y: 80 })).toEqual({
      status: "ready",
      contains: true,
    });
    expect(
      queryFrameContainment(
        FRAME,
        { ...pose, linearWitnesses: [{ a: -0, b: 0, c: 0, d: 1 }] },
        null,
        { x: 80, y: 80 },
      ),
    ).toEqual({ status: "ready", contains: false });
    expect(
      queryFrameContainment(
        FRAME,
        { matrix: { ...IDENTITY, b: 1, c: 1 }, linearWitnesses: [{ a: 0, b: 0, c: 1, d: 1 }] },
        null,
        { x: 80, y: 80 },
      ),
    ).toEqual({ status: "ready", contains: false });
    expect(
      queryFrameContainment(
        FRAME,
        { ...pose, linearWitnesses: [{ a: Number.MIN_VALUE, b: 0, c: 0, d: 1 }] },
        null,
        { x: 80, y: 80 },
      ),
    ).toEqual({ status: "ready", contains: true });
  });

  it("validates every required input before accepting another constraint's empty proof", () => {
    const zero: HitPose = { matrix: { ...IDENTITY, a: 0 }, linearWitnesses: [] };
    const invalid: HitClip = {
      parent: null,
      pose: { matrix: { ...IDENTITY, e: Number.NaN }, linearWitnesses: [] },
      geometry: { kind: "empty" },
    };
    expect(queryFrameContainment(FRAME, zero, invalid, { x: 80, y: 80 })).toEqual({
      status: "unavailable",
      reason: "nonFiniteMatrix",
    });
    expect(
      queryFrameContainment({ x: 1e308, y: 0, w: 1e308, h: 1 }, zero, null, { x: 0, y: 0 }),
    ).toEqual({ status: "unavailable", reason: "nonFiniteGeometry" });
    expect(
      queryFrameContainment(
        FRAME,
        { ...zero, linearWitnesses: [{ a: 1, b: 0, c: 0, d: Number.POSITIVE_INFINITY }] },
        null,
        { x: 80, y: 80 },
      ),
    ).toEqual({ status: "unavailable", reason: "nonFiniteMatrix" });
    expect(
      queryFrameContainment(
        { ...FRAME, w: 0 },
        { matrix: { ...IDENTITY, a: Number.NaN }, linearWitnesses: [] },
        null,
        { x: 80, y: 80 },
      ),
    ).toEqual({ status: "unavailable", reason: "nonFiniteMatrix" });
    expect(() =>
      queryFrameContainment(
        FRAME,
        zero,
        {
          ...invalid,
          pose: { matrix: IDENTITY, linearWitnesses: [] },
          geometry: {
            ...FRAME_CLIP,
            corners: [
              { rx: 100, ry: 0 },
              { rx: 0, ry: 0 },
              { rx: 0, ry: 0 },
              { rx: 0, ry: 0 },
            ],
          },
        },
        { x: 80, y: 80 },
      ),
    ).toThrow(/resolved box clip/);
  });

  it("prefers independently proven exclusion over unresolved or overflowing projection in either order", () => {
    const unresolved: HitClip = {
      parent: null,
      pose: { matrix: { ...IDENTITY, b: 1, c: 1 }, linearWitnesses: [] },
      geometry: FRAME_CLIP,
    };
    const outside: HitClip = {
      parent: null,
      pose: { matrix: { ...IDENTITY, e: 500 }, linearWitnesses: [] },
      geometry: FRAME_CLIP,
    };
    for (const clips of [
      { ...unresolved, parent: outside },
      { ...outside, parent: unresolved },
    ]) {
      expect(evaluateHitClips(clips, { x: 80, y: 80 })).toEqual({
        status: "ready",
        contains: false,
      });
    }
    expect(
      queryFrameContainment(
        FRAME,
        { matrix: { ...IDENTITY, e: -1e308 }, linearWitnesses: [] },
        { ...outside, geometry: { kind: "empty" } },
        { x: 1e308, y: 0 },
      ),
    ).toEqual({ status: "ready", contains: false });
    expect(
      queryFrameContainment(
        FRAME,
        { matrix: IDENTITY, linearWitnesses: [{ a: 1, b: 1, c: 1, d: 1 }] },
        null,
        { x: 80, y: 80 },
      ),
    ).toEqual({ status: "unavailable", reason: "unresolvedDeterminant" });
    expect(
      queryFrameContainment(
        FRAME,
        { matrix: IDENTITY, linearWitnesses: [{ a: 1, b: 1, c: 1, d: 1 }] },
        null,
        { x: 500, y: 80 },
      ),
    ).toEqual({ status: "ready", contains: false });
  });
  for (const kind of ["empty", "zeroColumn", "unavailable"] as const) {
    it(`combines the innermost ${kind} clip with its ancestor independently of order`, () => {
      const unavailable: HitClip = {
        parent: null,
        geometry: FRAME_CLIP,
        pose: { matrix: { ...IDENTITY, b: 1, c: 1 }, linearWitnesses: [] },
      };
      const inner: HitClip = {
        parent: unavailable,
        geometry: kind === "empty" ? { kind: "empty" } : FRAME_CLIP,
        pose: {
          matrix: kind === "zeroColumn" ? { ...IDENTITY, a: 0 } : { ...IDENTITY, b: 1, c: 1 },
          linearWitnesses: [],
        },
      };
      expect(evaluateHitClips(inner, { x: 80, y: 80 })).toEqual(
        kind === "unavailable"
          ? { status: "unavailable", reason: "unresolvedDeterminant" }
          : { status: "ready", contains: false },
      );
      expect(
        evaluateHitClips({ ...unavailable, parent: { ...inner, parent: null } }, { x: 80, y: 80 }),
      ).toEqual(
        kind === "unavailable"
          ? { status: "unavailable", reason: "unresolvedDeterminant" }
          : { status: "ready", contains: false },
      );
    });
  }

  it("contains an independently fixed point through two canonical square-corner clips", () => {
    const clips: HitClip = {
      parent: {
        parent: null,
        geometry: FRAME_CLIP,
        pose: { matrix: IDENTITY, linearWitnesses: [] },
      },
      geometry: FRAME_CLIP,
      pose: { matrix: { ...IDENTITY, e: 20 }, linearWitnesses: [] },
    };
    expect(evaluateHitClips(clips, { x: 80, y: 80 })).toEqual({
      status: "ready",
      contains: true,
    });
    expect(
      queryFrameContainment(FRAME, { matrix: IDENTITY, linearWitnesses: [] }, clips, {
        x: 80,
        y: 80,
      }),
    ).toEqual({
      status: "ready",
      contains: true,
    });
    expect(evaluateHitClips(clips, { x: 50, y: 80 })).toEqual({
      status: "ready",
      contains: false,
    });
  });

  it("distinguishes zero columns, unresolved determinants and derived overflow", () => {
    expect(applyInverseAffineMatrixToPoint({ ...IDENTITY, a: 0 }, { x: 0, y: 0 })).toEqual({
      status: "degenerate",
      reason: "zeroColumn",
    });
    expect(applyInverseAffineMatrixToPoint({ ...IDENTITY, b: 1, c: 1 }, { x: 0, y: 0 })).toEqual({
      status: "unavailable",
      reason: "unresolvedDeterminant",
    });
    expect(applyInverseAffineMatrixToPoint({ ...IDENTITY, e: -1e308 }, { x: 1e308, y: 0 })).toEqual(
      { status: "unavailable", reason: "nonFiniteProjection" },
    );
    expect(applyInverseAffineMatrixToPoint({ ...IDENTITY, f: Number.NaN }, { x: 0, y: 0 })).toEqual(
      { status: "unavailable", reason: "nonFiniteMatrix" },
    );
  });

  it("projects a point even when materializing an inverse coefficient would overflow", () => {
    expect(
      applyInverseAffineMatrixToPoint({ ...IDENTITY, a: Number.MIN_VALUE }, { x: 0, y: 2 }),
    ).toEqual({ status: "ready", point: { x: 0, y: 2 } });
    expect(
      applyInverseAffineMatrixToPoint({ a: 2, b: 0, c: 0, d: 4, e: 10, f: 20 }, { x: 14, y: 32 }),
    ).toEqual({ status: "ready", point: { x: 2, y: 3 } });
  });

  it("rejects the stale pose at independent paused and stationary crossing points", () => {
    const moved = { ...IDENTITY, e: 30 };
    expect(
      queryFrameContainment(FRAME, { matrix: moved, linearWitnesses: [] }, null, { x: 150, y: 80 }),
    ).toEqual({
      status: "ready",
      contains: true,
    });
    expect(
      queryFrameContainment(FRAME, { matrix: IDENTITY, linearWitnesses: [] }, null, {
        x: 150,
        y: 80,
      }),
    ).toEqual({
      status: "ready",
      contains: false,
    });
    expect(
      queryFrameContainment(FRAME, { matrix: { ...IDENTITY, e: 40 }, linearWitnesses: [] }, null, {
        x: 75,
        y: 80,
      }),
    ).toEqual({
      status: "ready",
      contains: false,
    });
    expect(
      queryFrameContainment(FRAME, { matrix: IDENTITY, linearWitnesses: [] }, null, {
        x: 75,
        y: 80,
      }),
    ).toEqual({
      status: "ready",
      contains: true,
    });
  });

  it("uses each canonical clip's current pose and distinguishes failure from a miss", () => {
    const clip = {
      parent: null,
      pose: { matrix: { ...IDENTITY, e: 40 }, linearWitnesses: [] },
      geometry: {
        kind: "boxContour",
        bbox: { x: 20, y: 20, w: 100, h: 100 },
        corners: [
          { rx: 30, ry: 30 },
          { rx: 30, ry: 30 },
          { rx: 30, ry: 30 },
          { rx: 30, ry: 30 },
        ],
      },
    } satisfies HitClip;
    expect(
      queryFrameContainment(
        { x: 0, y: 0, w: 200, h: 160 },
        { matrix: IDENTITY, linearWitnesses: [] },
        clip,
        { x: 55, y: 70 },
      ),
    ).toEqual({ status: "ready", contains: false });
    expect(
      queryFrameContainment(
        FRAME,
        { matrix: { ...IDENTITY, b: 1, c: 1 }, linearWitnesses: [] },
        null,
        { x: 80, y: 80 },
      ),
    ).toEqual({ status: "unavailable", reason: "unresolvedDeterminant" });
    expect(
      queryFrameContainment(FRAME, { matrix: { ...IDENTITY, a: 0 }, linearWitnesses: [] }, null, {
        x: 80,
        y: 80,
      }),
    ).toEqual({
      status: "ready",
      contains: false,
    });
    expect(
      queryFrameContainment({ ...FRAME, w: 0 }, { matrix: IDENTITY, linearWitnesses: [] }, null, {
        x: 40,
        y: 80,
      }),
    ).toEqual({
      status: "ready",
      contains: false,
    });
  });
});

it("resolves one outermost handler Frame without treating labels as persistent refs", () => {
  const ir: IR = {
    width: 100,
    height: 100,
    warnings: [],
    root: {
      type: "group",
      nodeId: "outer",
      bbox: FRAME,
      ownership: { role: "source", on: { onClick: "outer" } },
      children: [
        {
          type: "group",
          nodeId: "inner",
          bbox: FRAME,
          ownership: { role: "source", on: { onClick: "inner" } },
          children: [
            {
              type: "rect",
              nodeId: "paint",
              bbox: FRAME,
              ownership: { role: "source" },
              fill: "red",
            },
          ],
        },
      ],
    },
  };
  const index = buildIRSourceIndex(ir);
  expect(isSemanticFrame(index.sources.get(0)!)).toBe(true);
  expect(isSemanticFrame(index.sources.get(1)!)).toBe(true);
  expect(isSemanticFrame(index.sources.get(2)!)).toBe(false);
  const emptyFrame = buildIRSourceIndex({ ...ir, root: { ...ir.root, bbox: { ...FRAME, w: 0 } } });
  expect(isSemanticFrame(emptyFrame.sources.get(0)!)).toBe(true);
  const handlerless = buildIRSourceIndex({
    ...ir,
    root: { ...ir.root, ownership: { role: "source", on: {} } },
  });
  expect(isSemanticFrame(handlerless.sources.get(0)!)).toBe(false);
  const source = index.sources.get(2)!.source;
  expect(resolveInteractionTarget(index, source)).toBe(index.sources.get(0)!.source);
  expect(() => resolveInteractionTarget(buildIRSourceIndex(ir), source)).toThrow(
    /another IR snapshot/,
  );
});

describe("strict clip membership with closed Frame rectangles", () => {
  for (const [x, y] of [
    [40, 80],
    [140, 80],
    [80, 40],
    [80, 120],
    [40, 40],
    [140, 40],
    [40, 120],
    [140, 120],
  ] as const) {
    it(`keeps the Frame boundary (${x}, ${y}) but excludes its own clip boundary`, () => {
      const point = { x, y };
      const pose = { matrix: IDENTITY, linearWitnesses: [] };
      expect(queryFrameContainment(FRAME, pose, null, point)).toEqual({
        status: "ready",
        contains: true,
      });
      expect(
        queryFrameContainment(FRAME, pose, { parent: null, pose, geometry: FRAME_CLIP }, point),
      ).toEqual({ status: "ready", contains: false });
    });
  }

  it("retains a fractional point immediately inside a clip without excluding a pixel-wide band", () => {
    expect(
      queryFrameContainment(
        FRAME,
        { matrix: IDENTITY, linearWitnesses: [] },
        {
          parent: null,
          pose: { matrix: IDENTITY, linearWitnesses: [] },
          geometry: FRAME_CLIP,
        },
        { x: 40.25, y: 80 },
      ),
    ).toEqual({ status: "ready", contains: true });
  });

  it("excludes the fixed elliptical contact while retaining an independent inside point", () => {
    const pose = { matrix: IDENTITY, linearWitnesses: [] };
    const bbox = { x: 0, y: 0, w: 10, h: 10 };
    const geometry = {
      kind: "boxContour",
      bbox,
      corners: [
        { rx: 5, ry: 5 },
        { rx: 5, ry: 5 },
        { rx: 5, ry: 5 },
        { rx: 5, ry: 5 },
      ],
    } satisfies BoxClip;
    const clips = { parent: null, pose, geometry };
    // (2-5)^2 + (1-5)^2 = 25; this observes the actual floating predicate too.
    expect(queryFrameContainment(bbox, pose, clips, { x: 2, y: 1 })).toEqual({
      status: "ready",
      contains: false,
    });
    expect(queryFrameContainment(bbox, pose, clips, { x: 3, y: 2 })).toEqual({
      status: "ready",
      contains: true,
    });
  });

  for (const matrix of [
    { a: -1, b: 0, c: 0, d: -1, e: 0, f: 10 },
    { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 },
  ]) {
    it(`excludes a shared straight contact for clip pose ${JSON.stringify(matrix)}`, () => {
      const bbox = { x: 0, y: 0, w: 10, h: 10 };
      const geometry = {
        kind: "boxContour",
        bbox,
        corners: [
          { rx: 0, ry: 0 },
          { rx: 0, ry: 0 },
          { rx: 0, ry: 0 },
          { rx: 0, ry: 0 },
        ],
      } satisfies BoxClip;
      expect(
        queryFrameContainment(
          bbox,
          { matrix: IDENTITY, linearWitnesses: [] },
          { parent: null, pose: { matrix, linearWitnesses: [] }, geometry },
          { x: 0, y: 5 },
        ),
      ).toEqual({ status: "ready", contains: false });
    });
  }
});

describe("IR viewport strict interior", () => {
  it("excludes four edges and corners while retaining fractional interior coordinates", () => {
    const dimensions = { width: 100, height: 80 };
    for (const point of [
      { x: 0, y: 40 },
      { x: 100, y: 40 },
      { x: 50, y: 0 },
      { x: 50, y: 80 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 80 },
      { x: 100, y: 80 },
      { x: -1, y: 40 },
      { x: 101, y: 40 },
    ]) {
      expect(isPointInViewport(dimensions, point)).toBe(false);
    }
    expect(isPointInViewport(dimensions, { x: 0.25, y: 40 })).toBe(true);
    expect(isPointInViewport(dimensions, { x: 99.75, y: 79.75 })).toBe(true);
    expect(isPointInViewport({ width: 0, height: 80 }, { x: 0, y: 40 })).toBe(false);
    expect(isPointInViewport({ width: 100, height: 0 }, { x: 50, y: 0 })).toBe(false);
  });

  it("validates both dimensions before zero-area emptiness", () => {
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => isPointInViewport({ width: invalid, height: 0 }, { x: 1, y: 1 })).toThrow(
        /resolved box clip/,
      );
      expect(() => isPointInViewport({ width: 0, height: invalid }, { x: 1, y: 1 })).toThrow(
        /resolved box clip/,
      );
    }
  });
});

describe("floating transform contact", () => {
  it("retains tiny computed overlap rather than snapping authored quarter-turn contact", () => {
    const bbox = { x: 0, y: 0, w: 10, h: 10 };
    const parent = createResolvedTransformMatrix(
      { translateX: 50, translateY: 20, originX: 0, originY: 0 },
      bbox,
    );
    const clipMatrix = multiplyAffineMatrices(
      parent,
      createResolvedTransformMatrix({ rotateDeg: 90, originX: 0, originY: 0 }, bbox),
    );
    const frameMatrix = multiplyAffineMatrices(
      clipMatrix,
      createResolvedTransformMatrix({ rotateDeg: -90, originX: 0, originY: 0 }, bbox),
    );
    const geometry = { ...FRAME_CLIP, bbox };
    // Ideal real interiors only touch at x=50; finite cosine coefficients leave a tiny overlap.
    expect(
      queryFrameContainment(
        bbox,
        { matrix: frameMatrix, linearWitnesses: [] },
        { parent: null, pose: { matrix: clipMatrix, linearWitnesses: [] }, geometry },
        { x: 50, y: 25 },
      ),
    ).toEqual({ status: "ready", contains: true });
  });
});
