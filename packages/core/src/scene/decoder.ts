import type { DiagnosticContext, DiagnosticContextValue } from "../errors.js";
import { FatalError } from "../errors.js";
import {
  childExpected,
  childRecordName,
  DISCRIMINATED_SCHEMAS,
  isSceneNodeType,
  RECORD_SCHEMAS,
  type RecordSchemaName,
  SCENE_NODE_SCHEMA,
  type SceneDecodeExpected,
  type SceneRecordSchema,
  type SceneSchema,
} from "./schema.js";
import type { SceneNode } from "./types.js";

export const MAX_SCENE_DECODE_DEPTH = 256;
export const MAX_SCENE_DECODE_NODES = 65_536;
export const MAX_SCENE_DECODE_VALUES = 262_144;
export const MAX_SCENE_DECODE_COLLECTION_LENGTH = 65_536;
export const MAX_SCENE_DECODE_JSON_BYTES = 16_777_216;

const MAX_PATH_BYTES = 512;
const MAX_SNIPPET_BYTES = 96;
const MAX_ARRAY_INDEX = 0xffff_fffe;

const arrayIsArray = Array.isArray;
const CapturedArray = Array;
const CapturedMap = Map;
const CapturedNumber = Number;
const CapturedString = String;
const CapturedWeakMap = WeakMap;
const arrayPrototype = Array.prototype;
const arrayPrototypePop = Array.prototype.pop;
const arrayPrototypePush = Array.prototype.push;
const mapPrototypeGet = Map.prototype.get;
const mapPrototypeHas = Map.prototype.has;
const mapPrototypeSet = Map.prototype.set;
const objectPrototype = Object.prototype;
const objectHasOwn = Object.hasOwn;
const objectIs = Object.is;
const reflectGetPrototypeOf = Reflect.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const reflectApply = Reflect.apply;
const defineProperty = Object.defineProperty;
const mathMax = Math.max;
const numberIsFinite = Number.isFinite;
const numberIsInteger = Number.isInteger;
const setPrototypeHas = Set.prototype.has;
const stringPrototypeCharCodeAt = String.prototype.charCodeAt;
const stringPrototypeSlice = String.prototype.slice;
const stringifyPrimitive = JSON.stringify;
const weakMapPrototypeDelete = WeakMap.prototype.delete;
const weakMapPrototypeGet = WeakMap.prototype.get;
const weakMapPrototypeSet = WeakMap.prototype.set;

function arrayPop<Value>(target: Value[]): Value | undefined {
  return reflectApply(arrayPrototypePop, target, []) as Value | undefined;
}

function arrayPush<Value>(target: Value[], value: Value): void {
  reflectApply(arrayPrototypePush, target, [value]);
}

function mapGet<Key, Value>(target: ReadonlyMap<Key, Value>, key: Key): Value | undefined {
  return reflectApply(mapPrototypeGet, target, [key]) as Value | undefined;
}

function mapHas<Key>(target: ReadonlyMap<Key, unknown>, key: Key): boolean {
  return reflectApply(mapPrototypeHas, target, [key]) as boolean;
}

function mapSet<Key, Value>(target: Map<Key, Value>, key: Key, value: Value): void {
  reflectApply(mapPrototypeSet, target, [key, value]);
}

function setHas<Value>(target: ReadonlySet<Value>, value: Value): boolean {
  return reflectApply(setPrototypeHas, target, [value]) as boolean;
}

function stringCharCodeAt(value: string, index: number): number {
  return reflectApply(stringPrototypeCharCodeAt, value, [index]) as number;
}

function stringSlice(value: string, start: number, end: number): string {
  return reflectApply(stringPrototypeSlice, value, [start, end]) as string;
}

function weakMapDelete<Key extends object>(target: WeakMap<Key, unknown>, key: Key): void {
  reflectApply(weakMapPrototypeDelete, target, [key]);
}

function weakMapGet<Key extends object, Value>(
  target: WeakMap<Key, Value>,
  key: Key,
): Value | undefined {
  return reflectApply(weakMapPrototypeGet, target, [key]) as Value | undefined;
}

function weakMapSet<Key extends object, Value>(
  target: WeakMap<Key, Value>,
  key: Key,
  value: Value,
): void {
  reflectApply(weakMapPrototypeSet, target, [key, value]);
}

type DecodePath = {
  readonly value: string;
  readonly truncated: boolean;
};

type CachedProperty = {
  readonly key: string | symbol;
  readonly descriptor: PropertyDescriptor | undefined;
  readonly descriptorFailed: boolean;
};

type ReflectedContainer = {
  readonly source: object;
  readonly isArray: boolean;
  readonly properties: readonly CachedProperty[];
  readonly stringProperties: ReadonlyMap<string, PropertyDescriptor>;
  readonly arrayLength: number | undefined;
};

type AssignValue = (value: unknown) => void;

type DecodeWork = {
  readonly action: "decode";
  readonly value: unknown;
  readonly schema: SceneSchema;
  readonly path: DecodePath;
  readonly depth: number;
  readonly assign: AssignValue;
};

type LeaveWork = {
  readonly action: "leave";
  readonly source: object;
};

type Work = DecodeWork | LeaveWork;

type DecoderState = {
  values: number;
  nodes: number;
  jsonBytes: number;
  readonly active: WeakMap<object, DecodePath>;
  readonly work: Work[];
};

type UnsafeReason =
  | "accessor-property"
  | "non-enumerable-property"
  | "symbol-key"
  | "sparse-array"
  | "array-extra-key"
  | "noncanonical-array-index"
  | "invalid-array-length"
  | "unsupported-prototype"
  | "unsupported-value-type"
  | "non-finite-number"
  | "reflection-failed"
  | "descriptor-missing";

type ReflectionOperation =
  | "array-check"
  | "get-prototype"
  | "own-keys"
  | "get-own-property-descriptor";

type ResourceName = "depth" | "scene-nodes" | "values" | "collection-length" | "json-bytes";

type DescriptorFailure = {
  readonly reason: UnsafeReason;
  readonly key: string | undefined;
  readonly operation?: ReflectionOperation;
};

const FAILURE_PRIORITY: Readonly<Record<UnsafeReason, number>> = {
  "reflection-failed": 0,
  "descriptor-missing": 1,
  "accessor-property": 2,
  "non-enumerable-property": 3,
  "symbol-key": 4,
  "sparse-array": 5,
  "noncanonical-array-index": 6,
  "array-extra-key": 7,
  "invalid-array-length": 8,
  "unsupported-prototype": 9,
  "unsupported-value-type": 10,
  "non-finite-number": 11,
};

/** Decode an untrusted Scene document into a detached mutable data tree. */
export function decodeSceneDocument(value: unknown): SceneNode {
  const state: DecoderState = {
    values: 0,
    nodes: 0,
    jsonBytes: 0,
    active: new CapturedWeakMap(),
    work: [],
  };
  let result: unknown;
  arrayPush(state.work, {
    action: "decode",
    value,
    schema: SCENE_NODE_SCHEMA,
    path: { value: "", truncated: false },
    depth: 0,
    assign: (decoded) => {
      result = decoded;
    },
  });

  while (state.work.length > 0) {
    const work = arrayPop(state.work);
    if (work === undefined) {
      break;
    }
    if (work.action === "leave") {
      weakMapDelete(state.active, work.source);
      continue;
    }
    decodeValue(work, state);
  }

  return result as SceneNode;
}

function decodeValue(work: DecodeWork, state: DecoderState): void {
  const { value } = work;
  incrementResource(state, "values", work.path);
  if (
    work.schema.kind === "scene-node" ||
    (work.schema.kind === "scene-child" && typeof value === "object" && value !== null)
  ) {
    incrementResource(state, "scene-nodes", work.path);
  }

  if (value === null) {
    invalidValue(work.path, expectedForSchema(work.schema), "null");
  }

  switch (typeof value) {
    case "undefined":
    case "bigint":
    case "function":
    case "symbol": {
      unsafeValue(work.path, "unsupported-value-type");
      break;
    }
    case "number":
      decodeFiniteNumber(value, work, state);
      return;
    case "string":
      decodeString(value, work, state);
      return;
    case "boolean":
      decodeBoolean(value, work, state);
      return;
    case "object":
      decodeContainer(value, work, state);
      return;
  }
}

function decodeFiniteNumber(value: number, work: DecodeWork, state: DecoderState): void {
  if (!numberIsFinite(value)) {
    unsafeValue(work.path, "non-finite-number");
  }
  const schema = selectPrimitiveSchema(work.schema, value);
  if (schema?.kind !== "finite-number") {
    invalidValue(work.path, expectedForSchema(work.schema), "finite-number");
  }
  const encoded = stringifyPrimitive(value);
  addJsonAscii(state, encoded === undefined ? "0" : encoded, work.path);
  work.assign(value);
}

function decodeString(value: string, work: DecodeWork, state: DecoderState): void {
  if (work.schema.kind === "scene-child" && work.schema.grammar === "scene") {
    invalidValue(work.path, childExpected(work.schema.grammar), "string");
  }
  const schema = selectPrimitiveSchema(work.schema, value);
  if (schema === undefined || (schema.kind !== "string" && schema.kind !== "enum")) {
    invalidValue(work.path, expectedForSchema(work.schema), "string");
  }
  if (schema.kind === "enum" && !setHas(schema.values, value)) {
    invalidValue(work.path, expectedForSchema(work.schema), "string");
  }
  addJsonString(state, value, work.path);
  work.assign(value);
}

function decodeBoolean(value: boolean, work: DecodeWork, state: DecoderState): void {
  const schema = selectPrimitiveSchema(work.schema, value);
  if (schema?.kind !== "boolean") {
    invalidValue(work.path, expectedForSchema(work.schema), "boolean");
  }
  addJsonAscii(state, value ? "true" : "false", work.path);
  work.assign(value);
}

function selectPrimitiveSchema(
  schema: SceneSchema,
  value: string | number | boolean,
): SceneSchema | undefined {
  if (schema.kind === "scene-child") {
    return typeof value === "string" && schema.grammar !== "scene" ? { kind: "string" } : undefined;
  }
  if (schema.kind !== "one-of") {
    return schema;
  }
  let candidate: SceneSchema | undefined;
  for (let index = 0; index < schema.variants.length; index += 1) {
    const variant = schema.variants[index];
    if (variant === undefined) {
      continue;
    }
    const matches =
      (typeof value === "number" && variant.kind === "finite-number") ||
      (typeof value === "string" &&
        (variant.kind === "string" ||
          (variant.kind === "enum" && setHas(variant.values, value)))) ||
      (typeof value === "boolean" && variant.kind === "boolean");
    if (matches) {
      if (candidate !== undefined) {
        return undefined;
      }
      candidate = variant;
    }
  }
  return candidate;
}

function decodeContainer(source: object, work: DecodeWork, state: DecoderState): void {
  if (work.depth > MAX_SCENE_DECODE_DEPTH) {
    resourceLimit({
      path: work.path,
      resource: "depth",
      actual: MAX_SCENE_DECODE_DEPTH + 1,
      limit: MAX_SCENE_DECODE_DEPTH,
    });
  }
  const firstPath = weakMapGet(state.active, source);
  if (firstPath !== undefined) {
    cycleError(work.path, firstPath);
  }

  const reflected = reflectContainer(source, work.path);
  const resolved = resolveContainerSchema(work.schema, reflected, work.path);

  if (reflected.isArray) {
    decodeArray({ reflected, schema: resolved, work, state });
  } else {
    decodeRecord({ reflected, schema: resolved, work, state });
  }
}

function reflectContainer(source: object, path: DecodePath): ReflectedContainer {
  const sourceIsArray = reflectArrayIdentity(source, path);
  validateContainerPrototype(source, sourceIsArray, path);
  const keys = readContainerOwnKeys(source, path);
  validateCollectionLength(keys, sourceIsArray, path);
  const arrayLength = sourceIsArray ? readArrayLength(source, path) : undefined;
  const snapshot = snapshotContainerProperties(source, keys, sourceIsArray);
  const selectedFailure =
    sourceIsArray && arrayLength !== undefined
      ? selectArrayShapeFailure(snapshot, arrayLength)
      : snapshot.selectedFailure;
  if (selectedFailure !== undefined) {
    throwDescriptorFailure(path, selectedFailure);
  }
  return {
    source,
    isArray: sourceIsArray,
    properties: snapshot.properties,
    stringProperties: snapshot.stringProperties,
    arrayLength,
  };
}

function reflectArrayIdentity(source: object, path: DecodePath): boolean {
  try {
    return arrayIsArray(source);
  } catch {
    unsafeValue(path, "reflection-failed", "array-check");
  }
}

function validateContainerPrototype(
  source: object,
  sourceIsArray: boolean,
  path: DecodePath,
): void {
  let prototype: object | null;
  try {
    prototype = reflectGetPrototypeOf(source);
  } catch {
    unsafeValue(path, "reflection-failed", "get-prototype");
  }
  const prototypeIsSupported = sourceIsArray
    ? prototype === arrayPrototype
    : prototype === objectPrototype || prototype === null;
  if (!prototypeIsSupported) {
    unsafeValue(path, "unsupported-prototype");
  }
}

function readContainerOwnKeys(source: object, path: DecodePath): (string | symbol)[] {
  try {
    return reflectOwnKeys(source);
  } catch {
    unsafeValue(path, "reflection-failed", "own-keys");
  }
}

function validateCollectionLength(
  keys: readonly (string | symbol)[],
  sourceIsArray: boolean,
  path: DecodePath,
): void {
  let reflectedCollectionLength = keys.length;
  if (sourceIsArray) {
    reflectedCollectionLength = 0;
    for (let index = 0; index < keys.length; index += 1) {
      if (keys[index] !== "length") {
        reflectedCollectionLength += 1;
      }
    }
  }
  if (reflectedCollectionLength > MAX_SCENE_DECODE_COLLECTION_LENGTH) {
    resourceLimit({
      path,
      resource: "collection-length",
      actual: MAX_SCENE_DECODE_COLLECTION_LENGTH + 1,
      limit: MAX_SCENE_DECODE_COLLECTION_LENGTH,
    });
  }
}

function readArrayLength(source: object, path: DecodePath): number {
  const lengthPath = appendPath(path, "length");
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = reflectGetOwnPropertyDescriptor(source, "length");
  } catch {
    unsafeValue(lengthPath, "reflection-failed", "get-own-property-descriptor");
  }
  if (lengthDescriptor === undefined) {
    unsafeValue(lengthPath, "descriptor-missing");
  }
  if (
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !numberIsInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > 0xffff_ffff ||
    objectIs(lengthDescriptor.value, -0) ||
    lengthDescriptor.enumerable !== false ||
    lengthDescriptor.configurable !== false
  ) {
    unsafeValue(lengthPath, "invalid-array-length");
  }
  const arrayLength = lengthDescriptor.value;
  if (arrayLength > MAX_SCENE_DECODE_COLLECTION_LENGTH) {
    resourceLimit({
      path,
      resource: "collection-length",
      actual: MAX_SCENE_DECODE_COLLECTION_LENGTH + 1,
      limit: MAX_SCENE_DECODE_COLLECTION_LENGTH,
    });
  }
  return arrayLength;
}

type PropertySnapshot = {
  readonly properties: CachedProperty[];
  readonly stringProperties: Map<string, PropertyDescriptor>;
  readonly selectedFailure: DescriptorFailure | undefined;
};

function snapshotContainerProperties(
  source: object,
  keys: readonly (string | symbol)[],
  sourceIsArray: boolean,
): PropertySnapshot {
  const properties: CachedProperty[] = [];
  const stringProperties = new CapturedMap<string, PropertyDescriptor>();
  let selectedFailure: DescriptorFailure | undefined;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];
    if (key === undefined) {
      continue;
    }
    if (sourceIsArray && key === "length") {
      continue;
    }
    let descriptor: PropertyDescriptor | undefined;
    let descriptorFailed = false;
    try {
      descriptor = reflectGetOwnPropertyDescriptor(source, key);
    } catch {
      descriptorFailed = true;
    }
    arrayPush(properties, { key, descriptor, descriptorFailed });
    const failure = failureForProperty(key, descriptor, descriptorFailed);
    if (failure !== undefined) {
      selectedFailure = chooseFailure(selectedFailure, failure);
    } else if (typeof key === "string" && descriptor !== undefined) {
      mapSet(stringProperties, key, descriptor);
    }
  }
  return { properties, stringProperties, selectedFailure };
}

function failureForProperty(
  key: string | symbol,
  descriptor: PropertyDescriptor | undefined,
  descriptorFailed: boolean,
): DescriptorFailure | undefined {
  const diagnosticKey = typeof key === "string" ? key : undefined;
  if (descriptorFailed) {
    return {
      reason: "reflection-failed",
      key: diagnosticKey,
      operation: "get-own-property-descriptor",
    };
  }
  if (descriptor === undefined) {
    return { reason: "descriptor-missing", key: diagnosticKey };
  }
  if (!("value" in descriptor)) {
    return { reason: "accessor-property", key: diagnosticKey };
  }
  if (!descriptor.enumerable) {
    return { reason: "non-enumerable-property", key: diagnosticKey };
  }
  return typeof key === "symbol" ? { reason: "symbol-key", key: undefined } : undefined;
}

function selectArrayShapeFailure(
  snapshot: PropertySnapshot,
  arrayLength: number,
): DescriptorFailure | undefined {
  let selectedFailure = snapshot.selectedFailure;
  for (let index = 0; index < arrayLength; index += 1) {
    if (!mapHas(snapshot.stringProperties, CapturedString(index))) {
      selectedFailure = chooseFailure(selectedFailure, {
        reason: "sparse-array",
        key: CapturedString(index),
      });
      break;
    }
  }
  for (let propertyIndex = 0; propertyIndex < snapshot.properties.length; propertyIndex += 1) {
    const key = snapshot.properties[propertyIndex]?.key;
    if (typeof key !== "string") {
      continue;
    }
    const index = canonicalArrayIndex(key);
    if (index !== undefined && index < arrayLength) {
      continue;
    }
    selectedFailure = chooseFailure(selectedFailure, {
      reason: looksLikeArrayIndex(key) ? "noncanonical-array-index" : "array-extra-key",
      key,
    });
  }
  return selectedFailure;
}

function throwDescriptorFailure(path: DecodePath, failure: DescriptorFailure): never {
  unsafeValue(
    failure.key === undefined ? path : appendPath(path, failure.key),
    failure.reason,
    failure.operation,
  );
}

function chooseFailure(
  current: DescriptorFailure | undefined,
  candidate: DescriptorFailure,
): DescriptorFailure {
  if (current === undefined) {
    return candidate;
  }
  const currentPriority = FAILURE_PRIORITY[current.reason];
  const candidatePriority = FAILURE_PRIORITY[candidate.reason];
  if (candidatePriority < currentPriority) {
    return candidate;
  }
  if (candidatePriority > currentPriority) {
    return current;
  }
  if (current.key === undefined || candidate.key === undefined) {
    return current.key === undefined ? current : candidate;
  }
  return candidate.key < current.key ? candidate : current;
}

function resolveContainerSchema(
  schema: SceneSchema,
  reflected: ReflectedContainer,
  path: DecodePath,
): SceneSchema {
  let resolved = schema;
  while (resolved.kind === "one-of") {
    resolved = selectContainerVariant(resolved, reflected, path);
  }
  if (resolved.kind === "scene-node") {
    const recordName = resolveSceneRecord({ reflected, path, expected: "scene-node" });
    return { kind: "record", name: recordName };
  }
  if (resolved.kind === "scene-child") {
    const expected = childExpected(resolved.grammar);
    const recordName = resolveSceneRecord({
      reflected,
      path,
      expected,
      grammar: resolved.grammar,
    });
    return { kind: "record", name: recordName };
  }
  if (resolved.kind === "discriminated") {
    return {
      kind: "record",
      name: resolveDiscriminatedRecord(resolved.name, reflected, path),
    };
  }
  return resolved;
}

function selectContainerVariant(
  schema: Extract<SceneSchema, { kind: "one-of" }>,
  reflected: ReflectedContainer,
  path: DecodePath,
): SceneSchema {
  let candidate: SceneSchema | undefined;
  for (let index = 0; index < schema.variants.length; index += 1) {
    const variant = schema.variants[index];
    if (variant === undefined || !containerVariantMatches(variant, reflected)) {
      continue;
    }
    if (candidate !== undefined) {
      invalidValue(path, schema.expected, reflected.isArray ? "array" : "record");
    }
    candidate = variant;
  }
  if (candidate === undefined) {
    invalidValue(path, schema.expected, reflected.isArray ? "array" : "record");
  }
  return candidate;
}

function containerVariantMatches(schema: SceneSchema, reflected: ReflectedContainer): boolean {
  switch (schema.kind) {
    case "tuple":
      return reflected.isArray && reflected.arrayLength === schema.items.length;
    case "array":
      return reflected.isArray;
    case "record":
    case "map":
      return !reflected.isArray;
    case "discriminated": {
      if (reflected.isArray) {
        return false;
      }
      const union = DISCRIMINATED_SCHEMAS[schema.name];
      const descriptor = mapGet(reflected.stringProperties, union.discriminant);
      return (
        descriptor !== undefined &&
        typeof descriptor.value === "string" &&
        objectHasOwn(union.variants, descriptor.value)
      );
    }
    default:
      return false;
  }
}

function resolveSceneRecord({
  reflected,
  path,
  expected,
  grammar,
}: {
  reflected: ReflectedContainer;
  path: DecodePath;
  expected: SceneDecodeExpected;
  grammar?: Parameters<typeof childRecordName>[0];
}): RecordSchemaName {
  if (reflected.isArray) {
    invalidValue(path, expected, "array");
  }
  const descriptor = mapGet(reflected.stringProperties, "type");
  if (descriptor === undefined) {
    missingField(path, "type");
  }
  if (typeof descriptor.value !== "string") {
    invalidDiscriminantValue(appendPath(path, "type"), descriptor.value);
  }
  const type = descriptor.value;
  if (!isSceneNodeType(type)) {
    unknownDiscriminant(appendPath(path, "type"), "type", type);
  }
  if (grammar === undefined) {
    return type;
  }
  const recordName = childRecordName(grammar, type);
  if (recordName === undefined) {
    invalidValue(path, expected, "record");
  }
  return recordName;
}

function resolveDiscriminatedRecord(
  name: keyof typeof DISCRIMINATED_SCHEMAS,
  reflected: ReflectedContainer,
  path: DecodePath,
): RecordSchemaName {
  const union = DISCRIMINATED_SCHEMAS[name];
  if (reflected.isArray) {
    invalidValue(path, union.expected, "array");
  }
  const descriptor = mapGet(reflected.stringProperties, union.discriminant);
  if (descriptor === undefined) {
    missingField(path, union.discriminant);
  }
  if (typeof descriptor.value !== "string") {
    invalidDiscriminantValue(appendPath(path, union.discriminant), descriptor.value);
  }
  if (!objectHasOwn(union.variants, descriptor.value)) {
    unknownDiscriminant(appendPath(path, union.discriminant), union.discriminant, descriptor.value);
  }
  const recordName = union.variants[descriptor.value];
  if (recordName === undefined) {
    unknownDiscriminant(appendPath(path, union.discriminant), union.discriminant, descriptor.value);
  }
  return recordName;
}

function invalidDiscriminantValue(path: DecodePath, value: unknown): never {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    unsafeValue(path, "unsupported-value-type");
  }
  if (typeof value === "number" && !numberIsFinite(value)) {
    unsafeValue(path, "non-finite-number");
  }
  if (value === null) {
    invalidValue(path, "enum", "null");
  }
  if (typeof value === "boolean") {
    invalidValue(path, "enum", "boolean");
  }
  if (typeof value === "number") {
    invalidValue(path, "enum", "finite-number");
  }
  if (typeof value === "object") {
    let valueIsArray: boolean;
    try {
      valueIsArray = arrayIsArray(value);
    } catch {
      unsafeValue(path, "reflection-failed", "array-check");
    }
    invalidValue(path, "enum", valueIsArray ? "array" : "record");
  }
  invalidValue(path, "enum", "string");
}

function decodeArray({
  reflected,
  schema,
  work,
  state,
}: {
  reflected: ReflectedContainer;
  schema: SceneSchema;
  work: DecodeWork;
  state: DecoderState;
}): void {
  if (!reflected.isArray) {
    invalidValue(work.path, expectedForSchema(schema), "record");
  }
  if (schema.kind !== "array" && schema.kind !== "tuple") {
    invalidValue(work.path, expectedForSchema(schema), "array");
  }
  const length = reflected.arrayLength;
  if (length === undefined) {
    unsafeValue(appendPath(work.path, "length"), "descriptor-missing");
  }
  if (schema.kind === "tuple" && length !== schema.items.length) {
    invalidValue(work.path, "array", "array");
  }

  const output = new CapturedArray<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    defineOutputProperty(output, CapturedString(index), undefined);
  }
  addJsonBytes(state, 2 + mathMax(0, length - 1), work.path);
  work.assign(output);
  weakMapSet(state.active, reflected.source, work.path);
  arrayPush(state.work, { action: "leave", source: reflected.source });

  for (let index = length - 1; index >= 0; index -= 1) {
    const key = CapturedString(index);
    const descriptor = mapGet(reflected.stringProperties, key);
    if (descriptor === undefined) {
      unsafeValue(appendPath(work.path, key), "sparse-array");
    }
    const childSchema = schema.kind === "tuple" ? schema.items[index] : schema.item;
    if (childSchema === undefined) {
      invalidValue(work.path, "array", "array");
    }
    const childPath = appendPath(work.path, key);
    arrayPush(state.work, {
      action: "decode",
      value: descriptor.value,
      schema: childSchema,
      path: childPath,
      depth: work.depth + 1,
      assign: (decoded) => {
        defineOutputProperty(output, key, decoded);
      },
    });
  }
}

function decodeRecord({
  reflected,
  schema,
  work,
  state,
}: {
  reflected: ReflectedContainer;
  schema: SceneSchema;
  work: DecodeWork;
  state: DecoderState;
}): void {
  if (reflected.isArray) {
    invalidValue(work.path, expectedForSchema(schema), "array");
  }
  if (schema.kind === "map") {
    decodeOpenMap({ reflected, valueSchema: schema.value, work, state });
    return;
  }
  if (schema.kind !== "record") {
    invalidValue(work.path, expectedForSchema(schema), "record");
  }
  const record = RECORD_SCHEMAS[schema.name] as SceneRecordSchema;
  validateClosedRecord(reflected, record, work.path);

  const output: Record<string, unknown> = {};
  for (let index = 0; index < reflected.properties.length; index += 1) {
    const property = reflected.properties[index];
    if (property === undefined) {
      continue;
    }
    if (typeof property.key === "string") {
      defineOutputProperty(output, property.key, undefined);
    }
  }
  addRecordJsonStructure(state, reflected, work.path);
  work.assign(output);
  weakMapSet(state.active, reflected.source, work.path);
  arrayPush(state.work, { action: "leave", source: reflected.source });

  for (let index = record.fields.length - 1; index >= 0; index -= 1) {
    const field = record.fields[index];
    if (field === undefined) {
      continue;
    }
    const descriptor = mapGet(reflected.stringProperties, field.name);
    if (descriptor === undefined) {
      continue;
    }
    const childPath = appendPath(work.path, field.name);
    arrayPush(state.work, {
      action: "decode",
      value: descriptor.value,
      schema: field.schema,
      path: childPath,
      depth: work.depth + 1,
      assign: (decoded) => {
        defineOutputProperty(output, field.name, decoded);
      },
    });
  }
}

function decodeOpenMap({
  reflected,
  valueSchema,
  work,
  state,
}: {
  reflected: ReflectedContainer;
  valueSchema: SceneSchema;
  work: DecodeWork;
  state: DecoderState;
}): void {
  const output: Record<string, unknown> = {};
  const entries: Array<{ key: string; descriptor: PropertyDescriptor }> = [];
  for (let index = 0; index < reflected.properties.length; index += 1) {
    const property = reflected.properties[index];
    if (property === undefined) {
      continue;
    }
    if (typeof property.key !== "string" || property.descriptor === undefined) {
      continue;
    }
    defineOutputProperty(output, property.key, undefined);
    arrayPush(entries, { key: property.key, descriptor: property.descriptor });
  }
  addRecordJsonStructure(state, reflected, work.path);
  work.assign(output);
  weakMapSet(state.active, reflected.source, work.path);
  arrayPush(state.work, { action: "leave", source: reflected.source });
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined) {
      continue;
    }
    const childPath = appendPath(work.path, entry.key);
    arrayPush(state.work, {
      action: "decode",
      value: entry.descriptor.value,
      schema: valueSchema,
      path: childPath,
      depth: work.depth + 1,
      assign: (decoded) => {
        defineOutputProperty(output, entry.key, decoded);
      },
    });
  }
}

function validateClosedRecord(
  reflected: ReflectedContainer,
  schema: SceneRecordSchema,
  path: DecodePath,
): void {
  let unknownKey: string | undefined;
  for (let index = 0; index < reflected.properties.length; index += 1) {
    const key = reflected.properties[index]?.key;
    if (
      typeof key === "string" &&
      !setHas(schema.fieldNames, key) &&
      (unknownKey === undefined || key < unknownKey)
    ) {
      unknownKey = key;
    }
  }
  if (unknownKey !== undefined) {
    unknownKeyError(path, unknownKey);
  }
  for (let index = 0; index < schema.fields.length; index += 1) {
    const field = schema.fields[index];
    if (field === undefined) {
      continue;
    }
    if (field.required && !mapHas(reflected.stringProperties, field.name)) {
      missingField(path, field.name);
    }
  }
}

function addRecordJsonStructure(
  state: DecoderState,
  reflected: ReflectedContainer,
  path: DecodePath,
): void {
  addJsonBytes(state, 2, path);
  let index = 0;
  for (let propertyIndex = 0; propertyIndex < reflected.properties.length; propertyIndex += 1) {
    const property = reflected.properties[propertyIndex];
    if (property === undefined) {
      continue;
    }
    if (typeof property.key !== "string") {
      continue;
    }
    const keyPath = appendPath(path, property.key);
    if (index > 0) {
      addJsonBytes(state, 1, keyPath);
    }
    addJsonString(state, property.key, keyPath);
    addJsonBytes(state, 1, keyPath);
    index += 1;
  }
}

function incrementResource(state: DecoderState, resource: ResourceName, path: DecodePath): void {
  if (resource === "values") {
    state.values += 1;
    if (state.values > MAX_SCENE_DECODE_VALUES) {
      resourceLimit({
        path,
        resource,
        actual: MAX_SCENE_DECODE_VALUES + 1,
        limit: MAX_SCENE_DECODE_VALUES,
      });
    }
    return;
  }
  if (resource === "scene-nodes") {
    state.nodes += 1;
    if (state.nodes > MAX_SCENE_DECODE_NODES) {
      resourceLimit({
        path,
        resource,
        actual: MAX_SCENE_DECODE_NODES + 1,
        limit: MAX_SCENE_DECODE_NODES,
      });
    }
  }
}

function addJsonAscii(state: DecoderState, value: string, path: DecodePath): void {
  addJsonBytes(state, value.length, path);
}

function addJsonString(state: DecoderState, value: string, path: DecodePath): void {
  addJsonBytes(state, 1, path);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = stringCharCodeAt(value, index);
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      addJsonBytes(state, 2, path);
      continue;
    }
    if (
      codeUnit === 0x08 ||
      codeUnit === 0x09 ||
      codeUnit === 0x0a ||
      codeUnit === 0x0c ||
      codeUnit === 0x0d
    ) {
      addJsonBytes(state, 2, path);
      continue;
    }
    if (codeUnit < 0x20) {
      addJsonBytes(state, 6, path);
      continue;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = stringCharCodeAt(value, index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        addJsonBytes(state, 4, path);
        index += 1;
      } else {
        addJsonBytes(state, 6, path);
      }
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      addJsonBytes(state, 6, path);
      continue;
    }
    addJsonBytes(state, utf8BytesForCodeUnit(codeUnit), path);
  }
  addJsonBytes(state, 1, path);
}

function addJsonBytes(state: DecoderState, bytes: number, path: DecodePath): void {
  if (bytes <= 0) {
    return;
  }
  if (state.jsonBytes > MAX_SCENE_DECODE_JSON_BYTES - bytes) {
    state.jsonBytes = MAX_SCENE_DECODE_JSON_BYTES + 1;
    resourceLimit({
      path,
      resource: "json-bytes",
      actual: MAX_SCENE_DECODE_JSON_BYTES + 1,
      limit: MAX_SCENE_DECODE_JSON_BYTES,
    });
  }
  state.jsonBytes += bytes;
}

function utf8BytesForCodeUnit(codeUnit: number): number {
  if (codeUnit <= 0x7f) {
    return 1;
  }
  return codeUnit <= 0x7ff ? 2 : 3;
}

function canonicalArrayIndex(key: string): number | undefined {
  if (key === "0") {
    return 0;
  }
  if (key.length === 0 || stringCharCodeAt(key, 0) < 0x31 || stringCharCodeAt(key, 0) > 0x39) {
    return undefined;
  }
  let value = 0;
  for (let index = 0; index < key.length; index += 1) {
    const code = stringCharCodeAt(key, index);
    if (code < 0x30 || code > 0x39) {
      return undefined;
    }
    value = value * 10 + code - 0x30;
    if (value > MAX_ARRAY_INDEX) {
      return undefined;
    }
  }
  return CapturedString(value) === key ? value : undefined;
}

function looksLikeArrayIndex(key: string): boolean {
  if (canonicalArrayIndex(key) !== undefined || key.length === 0) {
    return false;
  }
  const numericValue = CapturedNumber(key);
  return (
    numberIsFinite(numericValue) &&
    numberIsInteger(numericValue) &&
    numericValue >= 0 &&
    numericValue <= 0xffff_ffff
  );
}

function defineOutputProperty(target: object, key: string, value: unknown): void {
  defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function expectedForSchema(schema: SceneSchema): SceneDecodeExpected {
  switch (schema.kind) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "finite-number":
      return "finite-number";
    case "enum":
      return "enum";
    case "array":
      return schema.expected ?? "array";
    case "tuple":
      return "array";
    case "record":
      if (schema.name === "geometryDoc") {
        return "geometry-doc";
      }
      if (schema.name === "symbolDefinition") {
        return "symbol-definition";
      }
      if (schema.name === "partPaint") {
        return "part-paint";
      }
      return "record";
    case "map":
      return schema.expected;
    case "one-of":
      return schema.expected;
    case "discriminated":
      return DISCRIMINATED_SCHEMAS[schema.name].expected;
    case "scene-node":
      return "scene-node";
    case "scene-child":
      return childExpected(schema.grammar);
  }
}

function appendPath(parent: DecodePath, segment: string): DecodePath {
  if (parent.truncated) {
    return parent;
  }
  let pathBytes = utf8Length(parent.value) + 1;
  if (pathBytes > MAX_PATH_BYTES) {
    return { value: parent.value, truncated: true };
  }
  let escapedSegment = "";
  for (let index = 0; index < segment.length; index += 1) {
    const first = stringCharCodeAt(segment, index);
    let codeUnits = 1;
    let escapedPart: string;
    let partBytes: number;
    if (first === 0x7e) {
      escapedPart = "~0";
      partBytes = 2;
    } else if (first === 0x2f) {
      escapedPart = "~1";
      partBytes = 2;
    } else {
      const second = stringCharCodeAt(segment, index + 1);
      if (first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff) {
        codeUnits = 2;
        partBytes = 4;
      } else {
        partBytes = utf8BytesForCodeUnit(first);
      }
      escapedPart = stringSlice(segment, index, index + codeUnits);
    }
    if (pathBytes + partBytes > MAX_PATH_BYTES) {
      return { value: parent.value, truncated: true };
    }
    escapedSegment += escapedPart;
    pathBytes += partBytes;
    index += codeUnits - 1;
  }
  return { value: `${parent.value}/${escapedSegment}`, truncated: false };
}

function boundedSnippet(value: string): { value: string; truncated: boolean } {
  let result = "";
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = stringCharCodeAt(value, index);
    let codeUnits = 1;
    let nextBytes = utf8BytesForCodeUnit(first);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = stringCharCodeAt(value, index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        codeUnits = 2;
        nextBytes = 4;
      } else {
        nextBytes = 3;
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      nextBytes = 3;
    }
    if (bytes + nextBytes > MAX_SNIPPET_BYTES) {
      return { value: result, truncated: true };
    }
    result += stringSlice(value, index, index + codeUnits);
    bytes += nextBytes;
    index += codeUnits - 1;
  }
  return { value: result, truncated: false };
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = stringCharCodeAt(value, index);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = stringCharCodeAt(value, index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        bytes += 4;
        index += 1;
        continue;
      }
    }
    bytes += utf8BytesForCodeUnit(first);
  }
  return bytes;
}

function withPath(context: DiagnosticContext, path: DecodePath, name = "path"): void {
  context[name] = path.value;
  if (path.truncated) {
    context[`${name}Truncated`] = true;
  }
}

function invalidValue(
  path: DecodePath,
  expected: SceneDecodeExpected,
  actual: DiagnosticContextValue,
): never {
  const context: DiagnosticContext = { expected, actual };
  withPath(context, path);
  throw new FatalError(
    "SCENE_DECODE_INVALID_VALUE",
    "Scene document contains a value with an invalid structural type.",
    { stage: "validate", context },
  );
}

function missingField(parentPath: DecodePath, field: string): never {
  const path = appendPath(parentPath, field);
  const context: DiagnosticContext = { field };
  withPath(context, path);
  throw new FatalError(
    "SCENE_DECODE_MISSING_FIELD",
    "Scene document is missing a required field.",
    { stage: "validate", context },
  );
}

function unknownDiscriminant(path: DecodePath, discriminant: string, receivedValue: string): never {
  const received = boundedSnippet(receivedValue);
  const context: DiagnosticContext = { discriminant, received: received.value };
  withPath(context, path);
  if (received.truncated) {
    context.receivedTruncated = true;
  }
  throw new FatalError(
    "SCENE_DECODE_UNKNOWN_DISCRIMINANT",
    "Scene document contains an unknown discriminant.",
    { stage: "validate", context },
  );
}

function unknownKeyError(parentPath: DecodePath, rawKey: string): never {
  const path = appendPath(parentPath, rawKey);
  const key = boundedSnippet(rawKey);
  const context: DiagnosticContext = { key: key.value };
  withPath(context, path);
  if (key.truncated) {
    context.keyTruncated = true;
  }
  throw new FatalError("SCENE_DECODE_UNKNOWN_KEY", "Scene document contains an unsupported key.", {
    stage: "validate",
    context,
  });
}

function unsafeValue(
  path: DecodePath,
  reason: UnsafeReason,
  operation?: ReflectionOperation,
): never {
  const context: DiagnosticContext = { reason };
  withPath(context, path);
  if (operation !== undefined) {
    context.operation = operation;
  }
  throw new FatalError(
    "SCENE_DECODE_UNSAFE_VALUE",
    "Scene document contains a value that is not a safe JSON data value.",
    { stage: "validate", context },
  );
}

function cycleError(path: DecodePath, firstPath: DecodePath): never {
  const context: DiagnosticContext = {};
  withPath(context, path);
  withPath(context, firstPath, "firstPath");
  throw new FatalError("SCENE_DECODE_CYCLE", "Scene document contains a cycle.", {
    stage: "validate",
    context,
  });
}

function resourceLimit({
  path,
  resource,
  actual,
  limit,
}: {
  path: DecodePath;
  resource: ResourceName;
  actual: number;
  limit: number;
}): never {
  const context: DiagnosticContext = { resource, actual, limit };
  withPath(context, path);
  throw new FatalError(
    "SCENE_DECODE_RESOURCE_LIMIT",
    "Scene document exceeds a decode resource limit.",
    { stage: "validate", context },
  );
}
