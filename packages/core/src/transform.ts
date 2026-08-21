import { FatalError, type PipelineStage } from "./errors.js";
import type { Transform2D } from "./shape/types.js";

const TRANSFORM_KEYS = [
  "translateX",
  "translateY",
  "scaleX",
  "scaleY",
  "rotateDeg",
  "originX",
  "originY",
] as const;

type TransformKey = (typeof TRANSFORM_KEYS)[number];

type TransformErrorOptions = {
  code: string;
  stage: PipelineStage;
  /** Required: transform errors must always carry the owning node's id. */
  nodeId: string;
  ownerName?: string;
};

type BBoxLike = {
  x: number;
  y: number;
};

export type Point2D = {
  x: number;
  y: number;
};

export type AffineMatrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type { Transform2D };

const IDENTITY_AFFINE_MATRIX: AffineMatrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

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
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new FatalError(
        options.code,
        `${describeTransformOwner(options.ownerName)} transform "${key}" must be a finite number`,
        {
          stage: options.stage,
          nodeId: options.nodeId,
          key,
          value,
        },
      );
    }
  }
}

export function transformToSvg(transform: Transform2D): string {
  const commands: string[] = [];
  if ((transform.translateX ?? 0) !== 0 || (transform.translateY ?? 0) !== 0) {
    commands.push(
      `translate(${formatSvgNumber(transform.translateX ?? 0)} ${formatSvgNumber(transform.translateY ?? 0)})`,
    );
  }

  const originX = transform.originX ?? 0;
  const originY = transform.originY ?? 0;
  if (transform.rotateDeg !== undefined) {
    commands.push(
      `rotate(${formatSvgNumber(transform.rotateDeg)} ${formatSvgNumber(originX)} ${formatSvgNumber(originY)})`,
    );
  }
  if (transform.scaleX !== undefined || transform.scaleY !== undefined) {
    const scaleX = transform.scaleX ?? 1;
    const scaleY = transform.scaleY ?? 1;
    if (originX !== 0 || originY !== 0) {
      commands.push(`translate(${formatSvgNumber(originX)} ${formatSvgNumber(originY)})`);
      commands.push(`scale(${formatSvgNumber(scaleX)} ${formatSvgNumber(scaleY)})`);
      commands.push(`translate(${formatSvgNumber(-originX)} ${formatSvgNumber(-originY)})`);
    } else {
      commands.push(`scale(${formatSvgNumber(scaleX)} ${formatSvgNumber(scaleY)})`);
    }
  }
  return commands.join(" ");
}

function resolveNodeLocalTransform(transform: Transform2D, bbox: BBoxLike): Transform2D {
  return {
    ...transform,
    originX: bbox.x + (transform.originX ?? 0),
    originY: bbox.y + (transform.originY ?? 0),
  };
}

export function hasTransform(transform: Transform2D | undefined): boolean {
  if (!transform) {
    return false;
  }
  return transformToSvg(transform).length > 0;
}

export function createIdentityAffineMatrix(): AffineMatrix {
  return { ...IDENTITY_AFFINE_MATRIX };
}

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

export function applyAffineMatrixToPoint(matrix: AffineMatrix, point: Point2D): Point2D {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function createResolvedTransformMatrix(
  transform: Transform2D | undefined,
  bbox: BBoxLike,
): AffineMatrix {
  if (!transform || !hasTransform(transform)) {
    return createIdentityAffineMatrix();
  }

  const resolvedTransform = resolveNodeLocalTransform(transform, bbox);
  let matrix = createIdentityAffineMatrix();

  if ((resolvedTransform.translateX ?? 0) !== 0 || (resolvedTransform.translateY ?? 0) !== 0) {
    matrix = multiplyAffineMatrices(
      matrix,
      createTranslateMatrix(resolvedTransform.translateX ?? 0, resolvedTransform.translateY ?? 0),
    );
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

function describeTransformOwner(ownerName: string | undefined): string {
  return ownerName ? `${ownerName} node` : "Node";
}

function formatSvgNumber(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  const stringValue = normalized.toString();
  return stringValue.endsWith(".0") ? stringValue.slice(0, -2) : stringValue;
}
