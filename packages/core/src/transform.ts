import { FatalError, type PipelineStage } from "./errors.js";
import type { Transform2D } from "./shape/types.js";

/** Authored transform keys accepted at the numeric input boundary. */
const TRANSFORM_KEYS = [
  "translateX",
  "translateY",
  "scaleX",
  "scaleY",
  "rotateDeg",
  "skewXDeg",
  "skewYDeg",
  "originX",
  "originY",
] as const;

/** One supported key of the authored transform DTO. */
type TransformKey = (typeof TRANSFORM_KEYS)[number];

/** Owning node and pipeline stage attached to transform validation failures. */
type TransformErrorOptions = {
  code: string;
  stage: PipelineStage;
  /** Required: transform errors must always carry the owning node's id. */
  nodeId: string;
  ownerName?: string;
};

/** Layout origin used to resolve node-local transform origins. */
type BBoxLike = {
  x: number;
  y: number;
};

/** A point in the coordinate system of the accompanying matrix. */
export type Point2D = {
  x: number;
  y: number;
};

/** SVG affine coefficients mapping source points into their parent coordinates. */
export type AffineMatrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type { Transform2D };

/** Immutable identity coefficients; callers receive a copy. */
const IDENTITY_AFFINE_MATRIX: AffineMatrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

/**
 * Accept an absent transform or a supported object of finite numeric fields.
 * @throws {FatalError} Using the supplied code/stage/node id for invalid fields or keys.
 */
export function assertValidTransform2D(
  transform: unknown,
  options: TransformErrorOptions,
): asserts transform is Transform2D {
  if (transform === undefined) {
    return;
  }
  if (typeof transform !== "object" || transform === null || Array.isArray(transform)) {
    throw new FatalError(
      options.code,
      `${describeTransformOwner(options.ownerName)} transform must be an object`,
      {
        stage: options.stage,
        nodeId: options.nodeId,
      },
    );
  }

  const transformRecord = transform as Record<string, unknown>;
  for (const key of Object.keys(transformRecord)) {
    if (!TRANSFORM_KEYS.includes(key as TransformKey)) {
      throw new FatalError(
        options.code,
        `${describeTransformOwner(options.ownerName)} transform does not support key "${key}"`,
        {
          stage: options.stage,
          nodeId: options.nodeId,
        },
      );
    }
  }

  for (const key of TRANSFORM_KEYS) {
    const value = transformRecord[key];
    if (value === undefined) {
      continue;
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      ((key === "skewXDeg" || key === "skewYDeg") && Math.abs(value) > 60)
    ) {
      throw new FatalError(
        options.code,
        `${describeTransformOwner(options.ownerName)} transform "${key}" must be a finite number`,
        {
          stage: options.stage,
          nodeId: options.nodeId,
          context: {
            key,
            received: typeof value === "number" ? String(value) : typeof value,
          },
        },
      );
    }
  }
}

/** Serialize the ordered linear commands inside the shared origin pair. */
function skewAndScaleCommands(transform: Transform2D): string[] {
  const commands: string[] = [];
  const skewX = transform.skewXDeg ?? 0;
  const skewY = transform.skewYDeg ?? 0;
  if (skewX !== 0) {
    commands.push(`skewX(${formatSvgNumber(skewX)})`);
  }
  if (skewY !== 0) {
    commands.push(`skewY(${formatSvgNumber(skewY)})`);
  }
  if (transform.scaleX !== undefined || transform.scaleY !== undefined) {
    commands.push(
      `scale(${formatSvgNumber(transform.scaleX ?? 1)} ${formatSvgNumber(transform.scaleY ?? 1)})`,
    );
  }
  return commands;
}

/** Serialize translate, origin-relative rotation, sequential skews, and scale. */
export function transformToSvg(transform: Transform2D): string {
  const commands: string[] = [];
  const translateX = transform.translateX ?? 0;
  const translateY = transform.translateY ?? 0;
  if (translateX !== 0 || translateY !== 0) {
    commands.push(`translate(${formatSvgNumber(translateX)} ${formatSvgNumber(translateY)})`);
  }
  const originX = transform.originX ?? 0;
  const originY = transform.originY ?? 0;
  if (transform.rotateDeg !== undefined) {
    commands.push(
      `rotate(${formatSvgNumber(transform.rotateDeg)} ${formatSvgNumber(originX)} ${formatSvgNumber(originY)})`,
    );
  }
  const linearCommands = skewAndScaleCommands(transform);
  if (linearCommands.length > 0) {
    const hasOrigin = originX !== 0 || originY !== 0;
    if (hasOrigin) {
      commands.push(`translate(${formatSvgNumber(originX)} ${formatSvgNumber(originY)})`);
    }
    commands.push(...linearCommands);
    if (hasOrigin) {
      commands.push(`translate(${formatSvgNumber(-originX)} ${formatSvgNumber(-originY)})`);
    }
  }
  return commands.join(" ");
}

/** Offset an authored transform origin by its node's layout position. */
function resolveNodeLocalTransform(transform: Transform2D, bbox: BBoxLike): Transform2D {
  return {
    ...transform,
    originX: bbox.x + (transform.originX ?? 0),
    originY: bbox.y + (transform.originY ?? 0),
  };
}

/** Whether serialization produces a nonempty post-layout transform. */
export function hasTransform(transform: Transform2D | undefined): boolean {
  if (!transform) {
    return false;
  }
  return transformToSvg(transform).length > 0;
}

/** Return independently mutable identity coefficients. */
export function createIdentityAffineMatrix(): AffineMatrix {
  return { ...IDENTITY_AFFINE_MATRIX };
}

/** Compose matrices so rhs acts first and lhs maps its result. */
export function multiplyAffineMatrices(lhs: AffineMatrix, rhs: AffineMatrix): AffineMatrix {
  return {
    a: lhs.a * rhs.a + lhs.c * rhs.b,
    b: lhs.b * rhs.a + lhs.d * rhs.b,
    c: lhs.a * rhs.c + lhs.c * rhs.d,
    d: lhs.b * rhs.c + lhs.d * rhs.d,
    e: lhs.a * rhs.e + lhs.c * rhs.f + lhs.e,
    f: lhs.b * rhs.e + lhs.d * rhs.f + lhs.f,
  };
}

/** Map a source point into parent/world coordinates without altering the matrix. */
export function applyAffineMatrixToPoint(matrix: AffineMatrix, point: Point2D): Point2D {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

/**
 * Map a world point into the matrix's source coordinates. A singular matrix
 * has no painted area and returns null. Normalizing each column avoids
 * overflowing the determinant for finite, large supported scales.
 */
export function applyInverseAffineMatrixToPoint(
  matrix: AffineMatrix,
  point: Point2D,
): Point2D | null {
  const xScale = Math.max(Math.abs(matrix.a), Math.abs(matrix.b));
  const yScale = Math.max(Math.abs(matrix.c), Math.abs(matrix.d));
  if (!Number.isFinite(xScale) || !Number.isFinite(yScale) || xScale === 0 || yScale === 0) {
    return null;
  }
  const normA = matrix.a / xScale;
  const normB = matrix.b / xScale;
  const normC = matrix.c / yScale;
  const normD = matrix.d / yScale;
  const determinant = normA * normD - normB * normC;
  if (determinant === 0 || !Number.isFinite(determinant)) {
    return null;
  }
  const deltaX = point.x - matrix.e;
  const deltaY = point.y - matrix.f;
  const x = (normD * deltaX - normC * deltaY) / determinant / xScale;
  const y = (normA * deltaY - normB * deltaX) / determinant / yScale;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Append each shear around the resolved origin without changing multiplication order. */
function appendSkewMatrix(matrix: AffineMatrix, transform: Transform2D): AffineMatrix {
  const originX = transform.originX ?? 0;
  const originY = transform.originY ?? 0;
  const tangentX = Math.tan(((transform.skewXDeg ?? 0) * Math.PI) / 180);
  const tangentY = Math.tan(((transform.skewYDeg ?? 0) * Math.PI) / 180);
  let skewedMatrix = multiplyAffineMatrices(matrix, createTranslateMatrix(originX, originY));
  skewedMatrix = multiplyAffineMatrices(skewedMatrix, {
    a: 1,
    b: 0,
    c: tangentX,
    d: 1,
    e: 0,
    f: 0,
  });
  skewedMatrix = multiplyAffineMatrices(skewedMatrix, {
    a: 1,
    b: tangentY,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
  });
  skewedMatrix = multiplyAffineMatrices(skewedMatrix, createTranslateMatrix(-originX, -originY));
  return skewedMatrix;
}

/** Compose a node transform in the same order and layout-relative origin as SVG emission. */
export function createResolvedTransformMatrix(
  transform: Transform2D | undefined,
  bbox: BBoxLike,
): AffineMatrix {
  if (!transform || !hasTransform(transform)) {
    return createIdentityAffineMatrix();
  }

  const resolvedTransform = resolveNodeLocalTransform(transform, bbox);
  let matrix = createIdentityAffineMatrix();

  const translateX = resolvedTransform.translateX ?? 0;
  const translateY = resolvedTransform.translateY ?? 0;
  if (translateX !== 0 || translateY !== 0) {
    matrix = multiplyAffineMatrices(matrix, createTranslateMatrix(translateX, translateY));
  }

  if (resolvedTransform.rotateDeg !== undefined) {
    matrix = multiplyAffineMatrices(
      matrix,
      createRotateMatrix(
        resolvedTransform.rotateDeg,
        resolvedTransform.originX ?? 0,
        resolvedTransform.originY ?? 0,
      ),
    );
  }

  if ((resolvedTransform.skewXDeg ?? 0) !== 0 || (resolvedTransform.skewYDeg ?? 0) !== 0) {
    matrix = appendSkewMatrix(matrix, resolvedTransform);
  }

  if (resolvedTransform.scaleX !== undefined || resolvedTransform.scaleY !== undefined) {
    matrix = multiplyAffineMatrices(
      matrix,
      createScaleMatrix({
        scaleX: resolvedTransform.scaleX ?? 1,
        scaleY: resolvedTransform.scaleY ?? 1,
        originX: resolvedTransform.originX ?? 0,
        originY: resolvedTransform.originY ?? 0,
      }),
    );
  }

  return matrix;
}

/** Translate a point without changing its basis vectors. */
function createTranslateMatrix(tx: number, ty: number): AffineMatrix {
  return {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: tx,
    f: ty,
  };
}

/** Rotate around the supplied source-coordinate origin in degrees. */
function createRotateMatrix(angleDeg: number, originX: number, originY: number): AffineMatrix {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotation = {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: 0,
    f: 0,
  };

  return multiplyAffineMatrices(
    multiplyAffineMatrices(createTranslateMatrix(originX, originY), rotation),
    createTranslateMatrix(-originX, -originY),
  );
}

/** Apply independent axis scales around the supplied source-coordinate origin. */
function createScaleMatrix(options: {
  scaleX: number;
  scaleY: number;
  originX: number;
  originY: number;
}): AffineMatrix {
  const { scaleX, scaleY, originX, originY } = options;
  const scale = {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: 0,
    f: 0,
  };

  if (originX === 0 && originY === 0) {
    return scale;
  }

  return multiplyAffineMatrices(
    multiplyAffineMatrices(createTranslateMatrix(originX, originY), scale),
    createTranslateMatrix(-originX, -originY),
  );
}

/** Identify the node category in a transform validation message. */
function describeTransformOwner(ownerName: string | undefined): string {
  return ownerName ? `${ownerName} node` : "Node";
}

/** Serialize a transform scalar with negative zero normalized to zero. */
function formatSvgNumber(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  const stringValue = normalized.toString();
  return stringValue.endsWith(".0") ? stringValue.slice(0, -2) : stringValue;
}
