import type {
  CompiledShapePathPart,
  DivideRegions,
  GeometryDoc,
  GeometryIntersection,
  GeometryPart,
  GeometryPartHit,
  Region,
} from "../shape/types.js";
import { type StandaloneShapeOperation, shapeOutputDecodeFailure } from "./shape-fatal-decoder.js";

type JsonObject = Record<string, unknown>;
type ProtocolLocation = {
  operation: StandaloneShapeOperation;
  path: string;
};

const GEOMETRY_BOOLEAN_OPERATIONS = new Set(["union", "subtract", "intersect", "xor"]);

function describeReceived(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `array(length=${value.length})`;
  }
  switch (typeof value) {
    case "string":
      return `string(length=${value.length})`;
    case "number":
      return Number.isFinite(value) ? "finite number" : "non-finite number";
    case "boolean":
      return "boolean";
    case "object": {
      try {
        return `object(keys=${Object.keys(value).length})`;
      } catch {
        return "uninspectable object";
      }
    }
    case "undefined":
      return "undefined";
    case "bigint":
      return "bigint";
    case "function":
      return "function";
    case "symbol":
      return "symbol";
  }
  return "unknown";
}

function failProtocol(operation: StandaloneShapeOperation, path: string, value: unknown): never {
  throw shapeOutputDecodeFailure(operation, path, describeReceived(value));
}

function isPlainObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function requireObject(
  value: unknown,
  operation: StandaloneShapeOperation,
  path: string,
): JsonObject {
  if (!isPlainObject(value)) {
    failProtocol(operation, path, value);
  }
  return value;
}

function requireOwn(object: JsonObject, key: string, location: ProtocolLocation): unknown {
  if (!Object.hasOwn(object, key)) {
    failProtocol(location.operation, `${location.path}.${key}`, undefined);
  }
  return object[key];
}

function requireString(value: unknown, operation: StandaloneShapeOperation, path: string): string {
  if (typeof value !== "string") {
    failProtocol(operation, path, value);
  }
  return value;
}

function requireFiniteNumber(
  value: unknown,
  operation: StandaloneShapeOperation,
  path: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    failProtocol(operation, path, value);
  }
  return value;
}

function requireSafeIndex(
  value: unknown,
  operation: StandaloneShapeOperation,
  path: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    failProtocol(operation, path, value);
  }
  return value;
}

function requireArray(
  value: unknown,
  operation: StandaloneShapeOperation,
  path: string,
): unknown[] {
  if (!Array.isArray(value)) {
    failProtocol(operation, path, value);
  }
  return value;
}

function validateOptionalString(object: JsonObject, key: string, location: ProtocolLocation): void {
  if (Object.hasOwn(object, key)) {
    requireString(object[key], location.operation, `${location.path}.${key}`);
  }
}

function validateOptionalFiniteNumber(
  object: JsonObject,
  key: string,
  location: ProtocolLocation,
): void {
  if (Object.hasOwn(object, key)) {
    requireFiniteNumber(object[key], location.operation, `${location.path}.${key}`);
  }
}

function validatePoint(value: unknown, operation: StandaloneShapeOperation, path: string): void {
  const point = requireObject(value, operation, path);
  const location: ProtocolLocation = { operation, path };
  requireFiniteNumber(requireOwn(point, "x", location), operation, `${path}.x`);
  requireFiniteNumber(requireOwn(point, "y", location), operation, `${path}.y`);
}

function validateSegment(value: unknown, operation: StandaloneShapeOperation, path: string): void {
  const segment = requireObject(value, operation, path);
  const location: ProtocolLocation = { operation, path };
  const kind = requireString(requireOwn(segment, "kind", location), operation, `${path}.kind`);
  if (kind !== "line" && kind !== "quad" && kind !== "cubic") {
    failProtocol(operation, `${path}.kind`, kind);
  }
  validatePoint(requireOwn(segment, "p0", location), operation, `${path}.p0`);
  validatePoint(requireOwn(segment, "p1", location), operation, `${path}.p1`);
  if (kind === "line") {
    return;
  }
  validatePoint(requireOwn(segment, "p2", location), operation, `${path}.p2`);
  if (kind === "quad") {
    return;
  }
  validatePoint(requireOwn(segment, "p3", location), operation, `${path}.p3`);
}

function validateRegion(value: unknown, operation: StandaloneShapeOperation, path: string): void {
  const region = requireObject(value, operation, path);
  const contours = requireArray(
    requireOwn(region, "contours", { operation, path }),
    operation,
    `${path}.contours`,
  );
  for (const [contourIndex, contourValue] of contours.entries()) {
    const contourPath = `${path}.contours[${contourIndex}]`;
    const contour = requireObject(contourValue, operation, contourPath);
    const segments = requireArray(
      requireOwn(contour, "segments", { operation, path: contourPath }),
      operation,
      `${contourPath}.segments`,
    );
    if (Object.hasOwn(contour, "closed") && typeof contour.closed !== "boolean") {
      failProtocol(operation, `${contourPath}.closed`, contour.closed);
    }
    for (const [segmentIndex, segment] of segments.entries()) {
      validateSegment(segment, operation, `${contourPath}.segments[${segmentIndex}]`);
    }
  }
}

function validateBounds(value: unknown, operation: StandaloneShapeOperation, path: string): void {
  const bounds = requireObject(value, operation, path);
  for (const field of ["x", "y", "width", "height"] as const) {
    requireFiniteNumber(
      requireOwn(bounds, field, { operation, path }),
      operation,
      `${path}.${field}`,
    );
  }
}

function validateTransform(
  value: unknown,
  operation: StandaloneShapeOperation,
  path: string,
): void {
  const transform = requireObject(value, operation, path);
  for (const field of [
    "translateX",
    "translateY",
    "scaleX",
    "scaleY",
    "rotateDeg",
    "originX",
    "originY",
  ] as const) {
    validateOptionalFiniteNumber(transform, field, { operation, path });
  }
}

type PendingGeometryNode = { value: unknown; path: string };

function validateGeometryNode(
  frame: PendingGeometryNode,
  pending: PendingGeometryNode[],
  operation: StandaloneShapeOperation,
): void {
  const node = requireObject(frame.value, operation, frame.path);
  const location: ProtocolLocation = { operation, path: frame.path };
  const kind = requireString(requireOwn(node, "kind", location), operation, `${frame.path}.kind`);
  validateOptionalString(node, "nodeId", location);
  switch (kind) {
    case "path": {
      requireString(requireOwn(node, "d", location), operation, `${frame.path}.d`);
      if (Object.hasOwn(node, "fillRule")) {
        const fillRule = requireString(node.fillRule, operation, `${frame.path}.fillRule`);
        if (fillRule !== "nonzero" && fillRule !== "evenodd") {
          failProtocol(operation, `${frame.path}.fillRule`, fillRule);
        }
      }
      break;
    }
    case "group": {
      const children = requireArray(
        requireOwn(node, "children", location),
        operation,
        `${frame.path}.children`,
      );
      for (const [childIndex, child] of children.entries()) {
        pending.push({ value: child, path: `${frame.path}.children[${childIndex}]` });
      }
      break;
    }
    case "transform":
      validateTransform(
        requireOwn(node, "transform", location),
        operation,
        `${frame.path}.transform`,
      );
      pending.push({
        value: requireOwn(node, "child", location),
        path: `${frame.path}.child`,
      });
      break;
    case "boolean": {
      const booleanOperation = requireString(
        requireOwn(node, "op", location),
        operation,
        `${frame.path}.op`,
      );
      if (!GEOMETRY_BOOLEAN_OPERATIONS.has(booleanOperation)) {
        failProtocol(operation, `${frame.path}.op`, booleanOperation);
      }
      const children = requireArray(
        requireOwn(node, "children", location),
        operation,
        `${frame.path}.children`,
      );
      for (const [childIndex, child] of children.entries()) {
        pending.push({ value: child, path: `${frame.path}.children[${childIndex}]` });
      }
      break;
    }
    default:
      failProtocol(operation, `${frame.path}.kind`, kind);
  }
}

function validateGeometry(value: unknown, operation: StandaloneShapeOperation, path: string): void {
  const geometry = requireObject(value, operation, path);
  const viewBoxPath = `${path}.viewBox`;
  const viewBox = requireObject(
    requireOwn(geometry, "viewBox", { operation, path }),
    operation,
    viewBoxPath,
  );
  for (const field of ["x", "y", "width", "height"] as const) {
    requireFiniteNumber(
      requireOwn(viewBox, field, { operation, path: viewBoxPath }),
      operation,
      `${viewBoxPath}.${field}`,
    );
  }

  const pending: PendingGeometryNode[] = [
    { value: requireOwn(geometry, "root", { operation, path }), path: `${path}.root` },
  ];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame) {
      break;
    }
    validateGeometryNode(frame, pending, operation);
  }
}

function parseJsonResult(raw: unknown, operation: StandaloneShapeOperation): unknown {
  if (typeof raw !== "string") {
    failProtocol(operation, "$", raw);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    failProtocol(operation, "$", raw);
  }
}

export function decodeShapeRawString(
  raw: unknown,
  operation: "compileShapeSvg" | "renderShapeRegionSvg",
): string {
  if (typeof raw !== "string") {
    failProtocol(operation, "$", raw);
  }
  return raw;
}

export function decodeShapeHits(raw: unknown): GeometryPartHit[] {
  const operation = "hitTestShapeParts";
  const parsed = parseJsonResult(raw, operation);
  const hits = requireArray(parsed, operation, "$");
  for (const [hitIndex, hitValue] of hits.entries()) {
    const hitPath = `$[${hitIndex}]`;
    const hit = requireObject(hitValue, operation, hitPath);
    const location: ProtocolLocation = { operation, path: hitPath };
    requireString(requireOwn(hit, "partId", location), operation, `${hitPath}.partId`);
    const hitKind = requireString(requireOwn(hit, "hit", location), operation, `${hitPath}.hit`);
    if (hitKind !== "fill" && hitKind !== "stroke") {
      failProtocol(operation, `${hitPath}.hit`, hitKind);
    }
  }
  return parsed as unknown as GeometryPartHit[];
}

export function decodeCompiledShapePaths(raw: unknown): CompiledShapePathPart[] {
  const operation = "compileShapePaths";
  const parsed = parseJsonResult(raw, operation);
  const parts = requireArray(parsed, operation, "$");
  for (const [partIndex, partValue] of parts.entries()) {
    const partPath = `$[${partIndex}]`;
    const part = requireObject(partValue, operation, partPath);
    const location: ProtocolLocation = { operation, path: partPath };
    requireString(requireOwn(part, "d", location), operation, `${partPath}.d`);
    validateOptionalString(part, "partId", location);
    validateOptionalString(part, "strokeD", location);
    if (Object.hasOwn(part, "bounds")) {
      validateBounds(part.bounds, operation, `${partPath}.bounds`);
    }
  }
  return parsed as unknown as CompiledShapePathPart[];
}

export function decodeResolvedShapeGeometry(raw: unknown): GeometryDoc {
  const operation = "resolveSymbolGeometry";
  const parsed = parseJsonResult(raw, operation);
  validateGeometry(parsed, operation, "$");
  return parsed as unknown as GeometryDoc;
}

export function decodeEvaluatedShapeParts(raw: unknown): GeometryPart[] {
  const operation = "evaluateShapeParts";
  const parsed = parseJsonResult(raw, operation);
  const parts = requireArray(parsed, operation, "$");
  for (const [partIndex, partValue] of parts.entries()) {
    const partPath = `$[${partIndex}]`;
    const part = requireObject(partValue, operation, partPath);
    const location: ProtocolLocation = { operation, path: partPath };
    requireString(requireOwn(part, "partId", location), operation, `${partPath}.partId`);
    validateRegion(requireOwn(part, "region", location), operation, `${partPath}.region`);
    validateRegion(
      requireOwn(part, "strokeRegion", location),
      operation,
      `${partPath}.strokeRegion`,
    );
    if (Object.hasOwn(part, "bounds")) {
      validateBounds(part.bounds, operation, `${partPath}.bounds`);
    }
  }
  return parsed as unknown as GeometryPart[];
}

export function decodeEvaluatedShapeRegion(raw: unknown): Region {
  const operation = "evaluateShapeRegion";
  const parsed = parseJsonResult(raw, operation);
  validateRegion(parsed, operation, "$");
  return parsed as unknown as Region;
}

export function decodeDividedShapeRegions(raw: unknown): DivideRegions {
  const operation = "divideShapeRegions";
  const parsed = parseJsonResult(raw, operation);
  const dividedRegions = requireObject(parsed, operation, "$");
  const location: ProtocolLocation = { operation, path: "$" };
  validateRegion(requireOwn(dividedRegions, "subtract", location), operation, "$.subtract");
  validateRegion(requireOwn(dividedRegions, "intersect", location), operation, "$.intersect");
  return parsed as unknown as DivideRegions;
}

export function decodeShapeIntersections(raw: unknown): GeometryIntersection[] {
  const operation = "computeShapeIntersections";
  const parsed = parseJsonResult(raw, operation);
  const intersections = requireArray(parsed, operation, "$");
  for (const [intersectionIndex, intersectionValue] of intersections.entries()) {
    const intersectionPath = `$[${intersectionIndex}]`;
    const intersection = requireObject(intersectionValue, operation, intersectionPath);
    const location: ProtocolLocation = { operation, path: intersectionPath };
    validatePoint(
      requireOwn(intersection, "point", location),
      operation,
      `${intersectionPath}.point`,
    );
    requireFiniteNumber(
      requireOwn(intersection, "tA", location),
      operation,
      `${intersectionPath}.tA`,
    );
    requireFiniteNumber(
      requireOwn(intersection, "tB", location),
      operation,
      `${intersectionPath}.tB`,
    );
    for (const field of [
      "contourIndexA",
      "segmentIndexA",
      "contourIndexB",
      "segmentIndexB",
    ] as const) {
      requireSafeIndex(
        requireOwn(intersection, field, location),
        operation,
        `${intersectionPath}.${field}`,
      );
    }
  }
  return parsed as unknown as GeometryIntersection[];
}
