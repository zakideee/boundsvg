import { FatalError } from "../errors.js";
import type { SceneNode } from "./types.js";

// Core accepts at most 48 layout levels and 48 rich-text levels. Counting each
// object and child array separately remains below this transport safety bound.
const MAX_TRANSPORT_DEPTH = 256;

/**
 * Enforce the SceneNode JSON-serializable contract before direct rendering or
 * Worker enqueue, independently of the broader values supported by structured
 * clone. Accessors, sparse arrays, cycles, explicit `undefined`, functions,
 * promises, symbols, non-finite numbers, and non-plain instances are rejected.
 *
 * `frameIndex` is supplied by Worker materialized streams so their existing
 * frame-specific error contract remains intact. Direct Engine calls omit it.
 */
export function assertSerializableSceneTransport(scene: SceneNode, frameIndex?: number): void {
  const ancestors = new WeakSet<object>();
  const validatedDepths = new WeakMap<object, number>();
  try {
    visitSerializableValue(scene, {
      frameIndex,
      path: "scene",
      depth: 0,
      ancestors,
      validatedDepths,
    });
  } catch (error) {
    if (error instanceof FatalError) {
      throw error;
    }
    throw serializabilityError(
      frameIndex,
      "scene",
      `transport inspection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

type VisitContext = {
  frameIndex: number | undefined;
  path: string;
  depth: number;
  ancestors: WeakSet<object>;
  validatedDepths: WeakMap<object, number>;
};

/** Return the maximum descendant depth below `value`. */
function visitSerializableValue(value: unknown, context: VisitContext): number {
  const { frameIndex, path, depth, ancestors, validatedDepths } = context;
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return 0;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw serializabilityError(frameIndex, path, "non-finite numbers are not lossless JSON");
    }
    return 0;
  }
  if (typeof value !== "object") {
    throw serializabilityError(frameIndex, path, `${typeof value} values are not serializable`);
  }
  if (depth > MAX_TRANSPORT_DEPTH) {
    throw serializabilityError(
      frameIndex,
      path,
      `transport nesting exceeds ${MAX_TRANSPORT_DEPTH}`,
    );
  }
  const validatedDepth = validatedDepths.get(value);
  if (validatedDepth !== undefined) {
    if (depth + validatedDepth > MAX_TRANSPORT_DEPTH) {
      throw serializabilityError(
        frameIndex,
        path,
        `transport nesting exceeds ${MAX_TRANSPORT_DEPTH}`,
      );
    }
    return validatedDepth;
  }
  if (ancestors.has(value)) {
    throw serializabilityError(frameIndex, path, "cyclic references are not serializable");
  }

  ancestors.add(value);
  let descendantDepth: number;
  try {
    if (Array.isArray(value)) {
      descendantDepth = visitSerializableArray(value, context);
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw serializabilityError(
          frameIndex,
          path,
          "class instances are not plain transport objects",
        );
      }
      descendantDepth = visitSerializableRecord(value, context);
    }
  } finally {
    ancestors.delete(value);
  }
  validatedDepths.set(value, descendantDepth);
  return descendantDepth;
}

function visitSerializableArray(values: unknown[], context: VisitContext): number {
  const { frameIndex, path, depth, ancestors, validatedDepths } = context;
  for (const key of Reflect.ownKeys(values)) {
    if (key === "length") {
      continue;
    }
    if (typeof key !== "string" || !isCanonicalArrayIndex(key, values.length)) {
      throw serializabilityError(frameIndex, path, "arrays must not have extra own properties");
    }
  }
  let descendantDepth = 0;
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(values, index);
    if (!descriptor) {
      throw serializabilityError(frameIndex, `${path}[${index}]`, "sparse arrays are not lossless");
    }
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw serializabilityError(
        frameIndex,
        `${path}[${index}]`,
        "array entries must be enumerable data properties",
      );
    }
    const childDepth = visitSerializableValue(descriptor.value, {
      frameIndex,
      path: `${path}[${index}]`,
      depth: depth + 1,
      ancestors,
      validatedDepths,
    });
    descendantDepth = Math.max(descendantDepth, childDepth + 1);
  }
  return descendantDepth;
}

function visitSerializableRecord(value: object, context: VisitContext): number {
  const { frameIndex, path, depth, ancestors, validatedDepths } = context;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  let descendantDepth = 0;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      throw serializabilityError(frameIndex, path, "symbol-keyed properties are not serializable");
    }
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable) {
      throw serializabilityError(
        frameIndex,
        `${path}.${key}`,
        "non-enumerable properties would be dropped",
      );
    }
    if (!("value" in descriptor)) {
      throw serializabilityError(frameIndex, `${path}.${key}`, "accessor properties are not plain");
    }
    const childDepth = visitSerializableValue(descriptor.value, {
      frameIndex,
      path: `${path}.${key}`,
      depth: depth + 1,
      ancestors,
      validatedDepths,
    });
    descendantDepth = Math.max(descendantDepth, childDepth + 1);
  }
  return descendantDepth;
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function serializabilityError(
  frameIndex: number | undefined,
  path: string,
  reason: string,
): FatalError {
  if (frameIndex !== undefined) {
    return new FatalError(
      "WORKER_MATERIALIZED_FRAME_NOT_SERIALIZABLE",
      `Materialized frame ${frameIndex} is not serializable at ${path}: ${reason}`,
      { stage: "engine", frameIndex, path },
    );
  }
  return new FatalError(
    "SCENE_NOT_SERIALIZABLE",
    `Scene is not serializable at ${path}: ${reason}`,
    { stage: "engine", path },
  );
}
