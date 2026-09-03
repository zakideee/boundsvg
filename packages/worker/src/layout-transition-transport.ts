import type { DiagnosticContext, LayoutTransitionInput, SceneNode, VNode } from "@boundsvg/core";
import {
  decodeSceneDocument,
  FatalError,
  fromSceneDocument,
  toSceneDocument,
} from "@boundsvg/core";

/**
 * Strict UTF-8 safety cap for one two-state Worker transition request.
 *
 * This bounds accidental transport and Worker/WASM memory multiplication. It
 * is not a performance guarantee, a node-count admission policy, or evidence
 * that requests near the limit have acceptable latency.
 */
export const MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES = 16_777_216;

/** Worker wire form: flattened SceneNodes only; VNode callbacks never cross. */
export type WorkerLayoutTransitionInput = Omit<LayoutTransitionInput, "states"> & {
  readonly states: Readonly<Record<string, SceneNode>>;
};

/** Worker-local form after each state has crossed the Core trust boundary. */
export type DecodedWorkerLayoutTransitionInput = Omit<LayoutTransitionInput, "states"> & {
  readonly states: Readonly<Record<string, VNode>>;
};

type TransitionEnvelope = {
  readonly stateEntries: readonly [readonly [string, unknown], readonly [string, unknown]];
  readonly checkpoints: readonly [unknown, unknown, unknown, unknown];
  readonly easingPresent: boolean;
  readonly easing: unknown;
};

type DecodedState<State> = {
  readonly wire: SceneNode;
  readonly output: State;
};

type SafeSnapshotTask =
  | {
      readonly kind: "value";
      readonly source: unknown;
      readonly path: string;
      readonly assign: (value: unknown) => void;
    }
  | { readonly kind: "exit"; readonly source: object };

type SafeSnapshotValueTask = Extract<SafeSnapshotTask, { readonly kind: "value" }>;

type SafeSnapshotState = {
  readonly active: WeakMap<object, string>;
  readonly tasks: SafeSnapshotTask[];
};

const MAX_TRANSITION_ERROR_PATH_BYTES = 512;
const textEncoder = new TextEncoder();
const arrayIsArray = Array.isArray;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectDefineProperty = Object.defineProperty;
const objectPrototype = Object.prototype;
const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const reflectGetPrototypeOf = Reflect.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const jsonStringify = JSON.stringify;

/** Validate, size, and detach one transition before enqueue. */
export function snapshotWorkerLayoutTransitionInput(
  input: WorkerLayoutTransitionInput,
): WorkerLayoutTransitionInput {
  return decodeTransitionEnvelope(input, (state) => {
    const scene = decodeSceneDocument(state);
    return { wire: scene, output: scene };
  });
}

/** Decode a received transition and prepare each state for direct Core use. */
export function decodeWorkerLayoutTransitionInput(
  input: unknown,
): DecodedWorkerLayoutTransitionInput {
  return decodeTransitionEnvelope(input, (state) => {
    const vnode = fromSceneDocument(state);
    return { wire: toSceneDocument(vnode), output: vnode };
  });
}

/** Non-throwing protocol guard for messages received from an untrusted peer. */
export function isWorkerLayoutTransitionInput(
  value: unknown,
): value is WorkerLayoutTransitionInput {
  try {
    snapshotWorkerLayoutTransitionInput(value as WorkerLayoutTransitionInput);
    return true;
  } catch {
    return false;
  }
}

function decodeTransitionEnvelope<State>(
  input: unknown,
  decodeState: (value: unknown) => DecodedState<State>,
): Omit<LayoutTransitionInput, "states"> & { readonly states: Readonly<Record<string, State>> } {
  const envelope = snapshotTransitionEnvelope(input);

  const wireStates: Record<string, SceneNode> = {};
  const outputStates: Record<string, State> = {};
  for (const [stateName, stateValue] of envelope.stateEntries) {
    const decodedState = decodeState(stateValue);
    defineDataProperty(wireStates, stateName, decodedState.wire);
    defineDataProperty(outputStates, stateName, decodedState.output);
  }

  const wireTransition = createTransitionResult({
    states: wireStates,
    checkpoints: envelope.checkpoints,
    easingPresent: envelope.easingPresent,
    easing: envelope.easing,
  });
  enforceTransitionPayloadLimit(wireTransition);

  return createTransitionResult({
    states: outputStates,
    checkpoints: envelope.checkpoints,
    easingPresent: envelope.easingPresent,
    easing: envelope.easing,
  });
}

function snapshotTransitionEnvelope(input: unknown): TransitionEnvelope {
  const inputRecord = requirePlainRecord(input, "");
  const statesDescriptor = readKnownDescriptor(inputRecord, "states", "");
  const checkpointsDescriptor = readKnownDescriptor(inputRecord, "checkpoints", "");
  const easingDescriptor = readOptionalKnownDescriptor(inputRecord, "easing", "");

  const stateEntries = snapshotStateEntries(statesDescriptor.value);
  const checkpoints = snapshotCheckpoints(checkpointsDescriptor.value);
  const easing =
    easingDescriptor === undefined
      ? undefined
      : snapshotSafeData(easingDescriptor.value, appendPath("", "easing"));

  return {
    stateEntries,
    checkpoints,
    easingPresent: easingDescriptor !== undefined,
    easing,
  };
}

function snapshotStateEntries(
  value: unknown,
): readonly [readonly [string, unknown], readonly [string, unknown]] {
  const states = requirePlainRecord(value, "/states");
  const keys = readOwnKeys(states, "/states");
  if (keys.length !== 2 || keys.some((key) => typeof key !== "string")) {
    throw transitionInvalidError("/states", "states", "expected-two-state-entries");
  }

  const entries: Array<readonly [string, unknown]> = [];
  for (const key of keys) {
    if (typeof key !== "string") {
      throw transitionInvalidError("/states", "states", "expected-two-state-entries");
    }
    const descriptor = readRequiredDataDescriptor(states, key, appendPath("/states", key));
    entries.push([key, descriptor.value]);
  }
  const firstEntry = entries[0];
  const secondEntry = entries[1];
  if (firstEntry === undefined || secondEntry === undefined) {
    throw transitionInvalidError("/states", "states", "expected-two-state-entries");
  }
  return [firstEntry, secondEntry];
}

function snapshotCheckpoints(value: unknown): readonly [unknown, unknown, unknown, unknown] {
  const checkpoints = requireCanonicalArray(value, "/checkpoints", 4);
  const snapshots: unknown[] = [];
  for (let index = 0; index < 4; index += 1) {
    const checkpointPath = appendPath("/checkpoints", String(index));
    const descriptor = readRequiredDataDescriptor(checkpoints, String(index), checkpointPath);
    snapshots.push(snapshotCheckpoint(descriptor.value, checkpointPath));
  }
  return [snapshots[0], snapshots[1], snapshots[2], snapshots[3]];
}

function snapshotCheckpoint(value: unknown, path: string): unknown {
  if (!isPlainRecord(value)) {
    return snapshotSafeData(value, path);
  }

  const checkpoint: Record<string, unknown> = {};
  for (const field of ["timeMs", "state"] as const) {
    const descriptor = readOptionalKnownDescriptor(value, field, path);
    if (descriptor !== undefined) {
      defineDataProperty(
        checkpoint,
        field,
        snapshotSafeData(descriptor.value, appendPath(path, field)),
      );
    }
  }
  return checkpoint;
}

function snapshotSafeData(source: unknown, rootPath: string): unknown {
  let rootSnapshot: unknown;
  const state: SafeSnapshotState = {
    active: new WeakMap<object, string>(),
    tasks: [
      {
        kind: "value",
        source,
        path: rootPath,
        assign: (value) => {
          rootSnapshot = value;
        },
      },
    ],
  };

  while (state.tasks.length > 0) {
    const task = state.tasks.pop();
    if (task === undefined) {
      break;
    }
    if (task.kind === "exit") {
      state.active.delete(task.source);
      continue;
    }
    snapshotSafeValue(task, state);
  }
  return rootSnapshot;
}

function snapshotSafeValue(task: SafeSnapshotValueTask, state: SafeSnapshotState): void {
  const primitive = snapshotSafePrimitive(task.source, task.path);
  if (primitive.handled) {
    task.assign(primitive.value);
    return;
  }

  const sourceObject = task.source as object;
  if (state.active.has(sourceObject)) {
    throw transitionUnsafeError(task.path, "cycle");
  }

  const isArrayValue = readArrayIdentity(sourceObject, task.path);
  validateSafePrototype(sourceObject, isArrayValue, task.path);
  const keys = readOwnKeys(sourceObject, task.path);
  const descriptors = snapshotSafeDescriptors(sourceObject, keys, task.path);
  const output: unknown[] | Record<string, unknown> = isArrayValue ? [] : {};
  task.assign(output);
  state.active.set(sourceObject, task.path);
  state.tasks.push({ kind: "exit", source: sourceObject });

  if (isArrayValue) {
    enqueueSafeArrayEntries({ tasks: state.tasks, output, descriptors, path: task.path });
  } else {
    enqueueSafeRecordEntries({ tasks: state.tasks, output, descriptors, path: task.path });
  }
}

function validateSafePrototype(source: object, isArrayValue: boolean, path: string): void {
  const prototype = readPrototype(source, path);
  const prototypeIsSupported = isArrayValue
    ? prototype === Array.prototype
    : prototype === objectPrototype || prototype === null;
  if (!prototypeIsSupported) {
    throw transitionUnsafeError(path, "unsupported-prototype");
  }
}

function enqueueSafeArrayEntries({
  tasks,
  output,
  descriptors,
  path,
}: {
  tasks: SafeSnapshotTask[];
  output: unknown[] | Record<string, unknown>;
  descriptors: readonly SafeDescriptorEntry[];
  path: string;
}): void {
  const entries = validateSafeArrayDescriptors(descriptors, path);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined) {
      tasks.push({
        kind: "value",
        source: entry.value,
        path: appendPath(path, entry.key),
        assign: (value) => defineDataProperty(output, entry.key, value),
      });
    }
  }
}

function enqueueSafeRecordEntries({
  tasks,
  output,
  descriptors,
  path,
}: {
  tasks: SafeSnapshotTask[];
  output: unknown[] | Record<string, unknown>;
  descriptors: readonly SafeDescriptorEntry[];
  path: string;
}): void {
  for (let index = descriptors.length - 1; index >= 0; index -= 1) {
    const entry = descriptors[index];
    if (entry === undefined) {
      continue;
    }
    if (typeof entry.key !== "string") {
      throw transitionUnsafeError(path, "symbol-key");
    }
    const key = entry.key;
    tasks.push({
      kind: "value",
      source: entry.descriptor.value,
      path: appendPath(path, key),
      assign: (value) => defineDataProperty(output, key, value),
    });
  }
}

function snapshotSafePrimitive(
  value: unknown,
  path: string,
):
  | { readonly handled: true; readonly value: null | boolean | string | number }
  | { readonly handled: false } {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { handled: true, value };
  }
  if (typeof value === "number") {
    if (!numberIsFinite(value)) {
      throw transitionUnsafeError(path, "non-finite-number");
    }
    return { handled: true, value };
  }
  if (typeof value === "object") {
    return { handled: false };
  }
  throw transitionUnsafeError(path, "unsupported-value-type");
}

type SafeDescriptorEntry = {
  readonly key: string | symbol;
  readonly descriptor: PropertyDescriptor & { readonly value: unknown };
};

function snapshotSafeDescriptors(
  source: object,
  keys: readonly (string | symbol)[],
  path: string,
): SafeDescriptorEntry[] {
  const entries: SafeDescriptorEntry[] = [];
  for (const key of keys) {
    const descriptorPath = typeof key === "string" ? appendPath(path, key) : path;
    const descriptor = readSafeDescriptor(source, key, descriptorPath);
    validateSafeDescriptor(key, descriptor, descriptorPath);
    entries.push({ key, descriptor });
  }
  return entries;
}

function readSafeDescriptor(
  source: object,
  key: string | symbol,
  path: string,
): PropertyDescriptor {
  try {
    const descriptor = reflectGetOwnPropertyDescriptor(source, key);
    if (descriptor !== undefined) {
      return descriptor;
    }
  } catch {
    throw transitionUnsafeError(path, "reflection-failed");
  }
  throw transitionUnsafeError(path, "descriptor-missing");
}

function validateSafeDescriptor(
  key: string | symbol,
  descriptor: PropertyDescriptor,
  path: string,
): asserts descriptor is PropertyDescriptor & { readonly value: unknown } {
  if (!("value" in descriptor)) {
    throw transitionUnsafeError(path, "accessor-property");
  }
  if (!descriptor.enumerable && key !== "length") {
    throw transitionUnsafeError(path, "non-enumerable-property");
  }
}

function validateSafeArrayDescriptors(
  descriptors: readonly SafeDescriptorEntry[],
  path: string,
): Array<{ readonly key: string; readonly value: unknown }> {
  const lengthEntry = descriptors.find((entry) => entry.key === "length");
  const length = lengthEntry?.descriptor.value;
  if (
    typeof length !== "number" ||
    !numberIsSafeInteger(length) ||
    length < 0 ||
    length > 4_294_967_295
  ) {
    throw transitionUnsafeError(path, "invalid-array-length");
  }
  const entries: Array<{ readonly key: string; readonly value: unknown }> = [];
  const seen = new Set<number>();
  for (const entry of descriptors) {
    if (entry.key === "length") {
      continue;
    }
    if (typeof entry.key !== "string") {
      throw transitionUnsafeError(path, "symbol-key");
    }
    const index = Number(entry.key);
    if (
      !numberIsSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== entry.key
    ) {
      throw transitionUnsafeError(appendPath(path, entry.key), "array-extra-key");
    }
    seen.add(index);
    entries.push({ key: entry.key, value: entry.descriptor.value });
  }
  if (seen.size !== length) {
    throw transitionUnsafeError(path, "sparse-array");
  }
  entries.sort((left, right) => Number(left.key) - Number(right.key));
  return entries;
}

function requireCanonicalArray(value: unknown, path: string, expectedLength: number): object {
  if (typeof value !== "object" || value === null || !readArrayIdentity(value, path)) {
    throw transitionInvalidError(path, "checkpoints", "expected-array");
  }
  const prototype = readPrototype(value, path);
  if (prototype !== Array.prototype) {
    throw transitionUnsafeError(path, "unsupported-prototype");
  }
  const keys = readOwnKeys(value, path);
  const descriptors = snapshotSafeDescriptors(value, keys, path);
  const entries = validateSafeArrayDescriptors(descriptors, path);
  if (entries.length !== expectedLength) {
    throw transitionInvalidError(path, "checkpoints", "expected-four-checkpoints");
  }
  return value;
}

function requirePlainRecord(value: unknown, path: string): object {
  if (typeof value !== "object" || value === null || readArrayIdentity(value, path)) {
    throw transitionInvalidError(path, path === "" ? "input" : path.slice(1), "expected-record");
  }
  const prototype = readPrototype(value, path);
  if (prototype !== objectPrototype && prototype !== null) {
    throw transitionUnsafeError(path, "unsupported-prototype");
  }
  return value;
}

function isPlainRecord(value: unknown): value is object {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  try {
    if (arrayIsArray(value)) {
      return false;
    }
    const prototype = reflectGetPrototypeOf(value);
    return prototype === objectPrototype || prototype === null;
  } catch {
    return false;
  }
}

function readKnownDescriptor(
  source: object,
  field: string,
  path: string,
): PropertyDescriptor & { readonly value: unknown } {
  const descriptor = readOptionalKnownDescriptor(source, field, path);
  if (descriptor === undefined) {
    throw transitionInvalidError(path, field, "missing-field");
  }
  return descriptor;
}

function readOptionalKnownDescriptor(
  source: object,
  field: string,
  path: string,
): (PropertyDescriptor & { readonly value: unknown }) | undefined {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = reflectGetOwnPropertyDescriptor(source, field);
  } catch {
    throw transitionUnsafeError(appendPath(path, field), "reflection-failed");
  }
  if (descriptor === undefined) {
    return undefined;
  }
  if (!("value" in descriptor)) {
    throw transitionUnsafeError(appendPath(path, field), "accessor-property");
  }
  if (!descriptor.enumerable) {
    throw transitionUnsafeError(appendPath(path, field), "non-enumerable-property");
  }
  return descriptor as PropertyDescriptor & { readonly value: unknown };
}

function readRequiredDataDescriptor(
  source: object,
  key: string,
  path: string,
): PropertyDescriptor & { readonly value: unknown } {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = reflectGetOwnPropertyDescriptor(source, key);
  } catch {
    throw transitionUnsafeError(path, "reflection-failed");
  }
  if (descriptor === undefined) {
    throw transitionUnsafeError(path, "descriptor-missing");
  }
  if (!("value" in descriptor)) {
    throw transitionUnsafeError(path, "accessor-property");
  }
  if (!descriptor.enumerable) {
    throw transitionUnsafeError(path, "non-enumerable-property");
  }
  return descriptor as PropertyDescriptor & { readonly value: unknown };
}

function readArrayIdentity(value: object, path: string): boolean {
  try {
    return arrayIsArray(value);
  } catch {
    throw transitionUnsafeError(path, "reflection-failed");
  }
}

function readPrototype(value: object, path: string): object | null {
  try {
    return reflectGetPrototypeOf(value);
  } catch {
    throw transitionUnsafeError(path, "reflection-failed");
  }
}

function readOwnKeys(value: object, path: string): (string | symbol)[] {
  try {
    return reflectOwnKeys(value);
  } catch {
    throw transitionUnsafeError(path, "reflection-failed");
  }
}

function createTransitionResult<State>(input: {
  readonly states: Readonly<Record<string, State>>;
  readonly checkpoints: readonly [unknown, unknown, unknown, unknown];
  readonly easingPresent: boolean;
  readonly easing: unknown;
}): Omit<LayoutTransitionInput, "states"> & { readonly states: Readonly<Record<string, State>> } {
  const result: Record<string, unknown> = {};
  defineDataProperty(result, "states", input.states);
  defineDataProperty(result, "checkpoints", input.checkpoints);
  if (input.easingPresent) {
    defineDataProperty(result, "easing", input.easing);
  }
  return result as Omit<LayoutTransitionInput, "states"> & {
    readonly states: Readonly<Record<string, State>>;
  };
}

function enforceTransitionPayloadLimit(value: WorkerLayoutTransitionInput): void {
  const serialized = jsonStringify(value);
  const payloadBytes = textEncoder.encode(serialized).byteLength;
  if (payloadBytes > MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES) {
    throw transitionTransportError(
      "WORKER_LAYOUT_TRANSITION_PAYLOAD_LIMIT",
      "Layout transition request exceeds the Worker payload limit.",
      { payloadBytes, payloadBytesMax: MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES },
    );
  }
}

function defineDataProperty(target: object, key: string, value: unknown): void {
  objectDefineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function appendPath(parent: string, key: string): string {
  const segment = key.replaceAll("~", "~0").replaceAll("/", "~1");
  return boundPath(`${parent}/${segment}`);
}

function boundPath(path: string): string {
  if (textEncoder.encode(path).byteLength <= MAX_TRANSITION_ERROR_PATH_BYTES) {
    return path;
  }
  let lower = 0;
  let upper = path.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (textEncoder.encode(path.slice(0, middle)).byteLength <= MAX_TRANSITION_ERROR_PATH_BYTES) {
      lower = middle;
    } else {
      upper = middle - 1;
    }
  }
  const end = lower > 0 && isHighSurrogate(path.charCodeAt(lower - 1)) ? lower - 1 : lower;
  return path.slice(0, end);
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function transitionUnsafeError(path: string, reason: string): FatalError {
  return transitionTransportError(
    "WORKER_LAYOUT_TRANSITION_NOT_SERIALIZABLE",
    "Layout transition request contains an unsafe data value.",
    { path: boundPath(path), reason },
  );
}

function transitionInvalidError(path: string, field: string, reason: string): FatalError {
  return transitionTransportError(
    "WORKER_LAYOUT_TRANSITION_INVALID",
    "Layout transition request has an invalid structural shape.",
    { path: boundPath(path), field, reason },
  );
}

function transitionTransportError(
  code: string,
  message: string,
  context: DiagnosticContext,
): FatalError {
  return new FatalError(code, message, { stage: "engine", context });
}
