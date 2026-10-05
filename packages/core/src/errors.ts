/** Error severity — enables data-driven branching without instanceof checks. */
export type ErrorSeverity = "fatal" | "recoverable";

/** JSON-safe value accepted in diagnostic context. */
export type DiagnosticContextValue =
  | null
  | boolean
  | number
  | string
  | DiagnosticContextValue[]
  | { [key: string]: DiagnosticContextValue };

/** Detached, mutable JSON object attached to a diagnostic. */
export type DiagnosticContext = Record<string, DiagnosticContextValue>;

/** Explicit metadata accepted by `FatalError`. */
export type FatalErrorOptions = {
  stage?: PipelineStage;
  nodeId?: string;
  context?: DiagnosticContext;
};

/** Explicit fallback and metadata accepted by `RecoverableError`. */
export type RecoverableErrorOptions = {
  fallback: string;
  stage: PipelineStage;
  nodeId?: string;
  context?: DiagnosticContext;
};

/** Serialized fatal diagnostic. */
export type SerializedFatalError = {
  severity: "fatal";
  code: string;
  message: string;
  stage?: PipelineStage;
  nodeId?: string;
  context?: DiagnosticContext;
};

/** Serialized recoverable diagnostic. */
export type SerializedRecoverableError = {
  severity: "recoverable";
  code: string;
  message: string;
  fallback: string;
  stage: PipelineStage;
  nodeId?: string;
  context?: DiagnosticContext;
};

/** Closed pipeline stages for structured diagnostic reporting. */
export type PipelineStage =
  | "validate"
  | "layout"
  | "text"
  | "ir"
  | "emit"
  | "wasm"
  | "font"
  | "engine"
  | "analyzer";

/** Stable constructor for detached diagnostic field lookup tables. */
const CapturedMap = Map;
/** Stable conversion of validated array-index property names. */
const CapturedNumber = Number;
/** Stable constructor for closed diagnostic field and stage sets. */
const CapturedSet = Set;
/** Stable conversion of primitive diagnostics and validated array indices. */
const CapturedString = String;
/** Stable cycle tracking for diagnostic context snapshots. */
const CapturedWeakSet = WeakSet;
/** Expected prototype for ordinary diagnostic context arrays. */
const arrayPrototype = Array.prototype;
/** Captured stack removal used during iterative context cloning. */
const arrayPrototypePop = Array.prototype.pop;
/** Captured stack insertion used during iterative context cloning. */
const arrayPrototypePush = Array.prototype.push;
/** Captured array brand check for diagnostic containers and envelopes. */
const arrayIsArray = Array.isArray;
/** Captured lookup for authenticated envelope fields. */
const mapPrototypeGet = Map.prototype.get;
/** Captured presence check for required diagnostic fields. */
const mapPrototypeHas = Map.prototype.has;
/** Captured insertion into detached envelope field maps. */
const mapPrototypeSet = Map.prototype.set;
/** Captured finite-number check before context values reach JSON. */
const numberIsFinite = Number.isFinite;
/** Captured exact-index check for diagnostic context arrays. */
const numberIsSafeInteger = Number.isSafeInteger;
/** Captured creation of detached null-prototype context records. */
const objectCreate = Object.create;
/** Captured own-data-property construction for context snapshots. */
const objectDefineProperty = Object.defineProperty;
/** Captured prototype inspection that cannot be replaced during validation. */
const objectGetPrototypeOf = Object.getPrototypeOf;
/** Captured equality predicate for normalizing negative-zero context values. */
const objectIs = Object.is;
/** Expected prototype for ordinary diagnostic envelope and context records. */
const objectPrototype = Object.prototype;
/** Captured invocation of stored built-ins without caller-controlled methods. */
const reflectApply = Reflect.apply;
/** Captured descriptor inspection without invoking user accessors. */
const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
/** Captured complete own-key inspection, including non-enumerable and symbol keys. */
const reflectOwnKeys = Reflect.ownKeys;
/** Captured matching for diagnostic code grammar. */
const regexpPrototypeTest = RegExp.prototype.test;
/** Captured membership check for closed diagnostic vocabularies. */
const setPrototypeHas = Set.prototype.has;
/** Captured whitespace check for required non-empty diagnostic strings. */
const stringPrototypeTrim = String.prototype.trim;
/** Captured cycle-tracking insertion when entering a context container. */
const weakSetPrototypeAdd = WeakSet.prototype.add;
/** Captured cycle-tracking removal when leaving a context container. */
const weakSetPrototypeDelete = WeakSet.prototype.delete;
/** Captured check that rejects a currently active context container cycle. */
const weakSetPrototypeHas = WeakSet.prototype.has;

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

function stringTrim(value: string): string {
  return reflectApply(stringPrototypeTrim, value, []) as string;
}

function testRegExp(expression: RegExp, value: string): boolean {
  return reflectApply(regexpPrototypeTest, expression, [value]) as boolean;
}

function weakSetAdd<Value extends object>(target: WeakSet<Value>, value: Value): void {
  reflectApply(weakSetPrototypeAdd, target, [value]);
}

function weakSetDelete<Value extends object>(target: WeakSet<Value>, value: Value): void {
  reflectApply(weakSetPrototypeDelete, target, [value]);
}

function weakSetHas<Value extends object>(target: WeakSet<Value>, value: Value): boolean {
  return reflectApply(weakSetPrototypeHas, target, [value]) as boolean;
}

/** Closed stage identities accepted by fatal and recoverable diagnostics. */
const PIPELINE_STAGES = new CapturedSet<string>([
  "validate",
  "layout",
  "text",
  "ir",
  "emit",
  "wasm",
  "font",
  "engine",
  "analyzer",
]);

/** Uppercase identifier grammar for stable public diagnostic codes. */
const DIAGNOSTIC_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
/** Envelope field names forbidden inside user diagnostic context. */
const RESERVED_CONTEXT_KEYS = new CapturedSet([
  "severity",
  "code",
  "message",
  "fallback",
  "stage",
  "nodeId",
]);

/** Return whether a value belongs to the closed diagnostic pipeline stage set. */
function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && setHas(PIPELINE_STAGES, value);
}

function diagnosticTypeError(description: string): TypeError {
  return new TypeError(`Invalid diagnostic ${description}`);
}

/**
 * Format an arbitrary boundary failure without invoking an unchecked accessor
 * or allowing a hostile value to replace the original failure with a second
 * exception. This helper is internal to Core's boundary adapters.
 */
export function formatUnknownDiagnosticValue(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value.length > 0 ? value : fallback;
  }

  if (value === null) {
    return "null";
  }

  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    try {
      const descriptor = reflectGetOwnPropertyDescriptor(value, "message");
      if (
        descriptor !== undefined &&
        "value" in descriptor &&
        typeof descriptor.value === "string" &&
        descriptor.value.length > 0
      ) {
        return descriptor.value;
      }
    } catch {
      return fallback;
    }
    return fallback;
  }

  try {
    const text = CapturedString(value);
    return text.length > 0 ? text : fallback;
  } catch {
    return fallback;
  }
}

function readObjectPrototype(value: object, description: string): object | null {
  try {
    return objectGetPrototypeOf(value);
  } catch {
    throw diagnosticTypeError(`${description}: prototype is not readable`);
  }
}

function isArrayValue(value: object, description: string): boolean {
  try {
    return arrayIsArray(value);
  } catch {
    throw diagnosticTypeError(`${description}: array identity is not readable`);
  }
}

function readOwnKeys(value: object, description: string): (string | symbol)[] {
  try {
    return reflectOwnKeys(value);
  } catch {
    throw diagnosticTypeError(`${description}: own keys are not readable`);
  }
}

function readOwnDescriptor(
  value: object,
  key: string | symbol,
  description: string,
): PropertyDescriptor {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = reflectGetOwnPropertyDescriptor(value, key);
  } catch {
    throw diagnosticTypeError(`${description}: property descriptor is not readable`);
  }
  if (!descriptor) {
    throw diagnosticTypeError(`${description}: property descriptor is missing`);
  }
  return descriptor;
}

function readEnumerableDataValue(value: object, key: string, description: string): unknown {
  const descriptor = readOwnDescriptor(value, key, description);
  if (!descriptor.enumerable || !("value" in descriptor)) {
    throw diagnosticTypeError(`${description}: ${key} must be an enumerable data property`);
  }
  return descriptor.value;
}

type DiagnosticContainer = DiagnosticContext | DiagnosticContextValue[];

type DiagnosticContainerTask =
  | {
      action: "enter";
      source: object;
      target: DiagnosticContainer;
      isRoot: boolean;
    }
  | { action: "exit"; source: object };

function createDiagnosticContainer(source: object, isRoot: boolean): DiagnosticContainer {
  const sourceIsArray = isArrayValue(source, "context value");
  if (isRoot && sourceIsArray) {
    throw diagnosticTypeError("context: root must be a plain object");
  }
  const prototype = readObjectPrototype(source, "context value");
  if (sourceIsArray) {
    if (prototype !== arrayPrototype) {
      throw diagnosticTypeError("context: array subclasses are not supported");
    }
    return [];
  }
  if (prototype !== objectPrototype && prototype !== null) {
    throw diagnosticTypeError("context: values must be plain objects");
  }
  return objectCreate(prototype) as DiagnosticContext;
}

function cloneDiagnosticPrimitive(value: unknown): DiagnosticContextValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!numberIsFinite(value)) {
      throw diagnosticTypeError("context: numbers must be finite");
    }
    return objectIs(value, -0) ? 0 : value;
  }
  throw diagnosticTypeError("context: value is not JSON-safe");
}

function defineMutableDataProperty(
  target: DiagnosticContainer,
  key: string,
  value: DiagnosticContextValue,
): void {
  objectDefineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

type DiagnosticEntry = { key: string; value: unknown };

function readDiagnosticArrayEntries(
  source: object,
  keys: readonly (string | symbol)[],
): DiagnosticEntry[] {
  const lengthDescriptor = readOwnDescriptor(source, "length", "context array");
  const length = "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
  if (typeof length !== "number" || !numberIsSafeInteger(length) || length < 0) {
    throw diagnosticTypeError("context: array length is invalid");
  }
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];
    if (key === undefined) {
      continue;
    }
    if (typeof key === "symbol") {
      throw diagnosticTypeError("context: symbol keys are not supported");
    }
    if (key === "length") {
      continue;
    }
    const index = CapturedNumber(key);
    if (
      !numberIsSafeInteger(index) ||
      index < 0 ||
      CapturedString(index) !== key ||
      index >= length
    ) {
      throw diagnosticTypeError("context: arrays cannot have extra properties");
    }
  }
  const entries: DiagnosticEntry[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = CapturedString(index);
    arrayPush(entries, { key, value: readEnumerableDataValue(source, key, "context array") });
  }
  return entries;
}

function readDiagnosticObjectEntries(
  source: object,
  keys: readonly (string | symbol)[],
  isRoot: boolean,
): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [];
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];
    if (key === undefined) {
      continue;
    }
    if (typeof key === "symbol") {
      throw diagnosticTypeError("context: symbol keys are not supported");
    }
    if (isRoot && setHas(RESERVED_CONTEXT_KEYS, key)) {
      throw diagnosticTypeError(`context: reserved root key ${key}`);
    }
    arrayPush(entries, { key, value: readEnumerableDataValue(source, key, "context object") });
  }
  return entries;
}

function readDiagnosticEntries(source: object, isRoot: boolean): DiagnosticEntry[] {
  const keys = readOwnKeys(source, "context value");
  return isArrayValue(source, "context value")
    ? readDiagnosticArrayEntries(source, keys)
    : readDiagnosticObjectEntries(source, keys, isRoot);
}

function enterDiagnosticContainer(
  task: Extract<DiagnosticContainerTask, { action: "enter" }>,
  tasks: DiagnosticContainerTask[],
  activeContainers: WeakSet<object>,
): void {
  if (weakSetHas(activeContainers, task.source)) {
    throw diagnosticTypeError("context: cycles are not supported");
  }
  weakSetAdd(activeContainers, task.source);
  arrayPush(tasks, { action: "exit", source: task.source });

  const childTasks: DiagnosticContainerTask[] = [];
  const entries = readDiagnosticEntries(task.source, task.isRoot);
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    if (entry === undefined) {
      continue;
    }
    if (typeof entry.value === "object" && entry.value !== null) {
      const child = createDiagnosticContainer(entry.value, false);
      defineMutableDataProperty(task.target, entry.key, child);
      arrayPush(childTasks, {
        action: "enter",
        source: entry.value,
        target: child,
        isRoot: false,
      });
    } else {
      defineMutableDataProperty(task.target, entry.key, cloneDiagnosticPrimitive(entry.value));
    }
  }
  for (let index = childTasks.length - 1; index >= 0; index -= 1) {
    const childTask = childTasks[index];
    if (childTask) {
      arrayPush(tasks, childTask);
    }
  }
}

function runDiagnosticContainerTask(
  task: DiagnosticContainerTask,
  tasks: DiagnosticContainerTask[],
  activeContainers: WeakSet<object>,
): void {
  if (task.action === "exit") {
    weakSetDelete(activeContainers, task.source);
    return;
  }
  enterDiagnosticContainer(task, tasks, activeContainers);
}

function cloneDiagnosticContext(value: unknown): DiagnosticContext {
  if (typeof value !== "object" || value === null) {
    throw diagnosticTypeError("context: root must be a plain object");
  }
  const root = createDiagnosticContainer(value, true);
  const tasks: DiagnosticContainerTask[] = [
    { action: "enter", source: value, target: root, isRoot: true },
  ];
  const activeContainers = new CapturedWeakSet<object>();

  while (tasks.length > 0) {
    const task = arrayPop(tasks);
    if (task) {
      runDiagnosticContainerTask(task, tasks, activeContainers);
    }
  }

  return root as DiagnosticContext;
}

type ExactFieldRules = {
  allowedFields: ReadonlySet<string>;
  requiredFields: readonly string[];
  description: string;
};

function readExactFields(value: unknown, rules: ExactFieldRules): Map<string, unknown> {
  const { allowedFields, requiredFields, description } = rules;
  if (typeof value !== "object" || value === null || isArrayValue(value, description)) {
    throw diagnosticTypeError(`${description}: expected a plain object`);
  }
  const prototype = readObjectPrototype(value, description);
  if (prototype !== objectPrototype && prototype !== null) {
    throw diagnosticTypeError(`${description}: expected a plain object`);
  }
  const fields = new CapturedMap<string, unknown>();
  const keys = readOwnKeys(value, description);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];
    if (key === undefined) {
      continue;
    }
    if (typeof key === "symbol" || !setHas(allowedFields, key)) {
      throw diagnosticTypeError(`${description}: unexpected field`);
    }
    mapSet(fields, key, readEnumerableDataValue(value, key, description));
  }
  for (let fieldIndex = 0; fieldIndex < requiredFields.length; fieldIndex += 1) {
    const field = requiredFields[fieldIndex];
    if (field !== undefined && !mapHas(fields, field)) {
      throw diagnosticTypeError(`${description}: missing ${field}`);
    }
  }
  return fields;
}

function requireNonEmptyDiagnosticString(value: unknown, field: string): string {
  if (typeof value !== "string" || stringTrim(value).length === 0) {
    throw diagnosticTypeError(`${field}: expected a non-empty string`);
  }
  return value;
}

function requireDiagnosticCode(value: unknown): string {
  const code = requireNonEmptyDiagnosticString(value, "code");
  if (!testRegExp(DIAGNOSTIC_CODE_PATTERN, code)) {
    throw diagnosticTypeError("code: expected SCREAMING_SNAKE_CASE");
  }
  return code;
}

function readOptionalNodeId(fields: Map<string, unknown>): string | undefined {
  if (!mapHas(fields, "nodeId")) {
    return undefined;
  }
  const nodeId = mapGet(fields, "nodeId");
  if (typeof nodeId !== "string") {
    throw diagnosticTypeError("nodeId: expected a string");
  }
  return nodeId;
}

function readOptionalStage(fields: Map<string, unknown>): PipelineStage | undefined {
  if (!mapHas(fields, "stage")) {
    return undefined;
  }
  const stage = mapGet(fields, "stage");
  if (!isPipelineStage(stage)) {
    throw diagnosticTypeError("stage: expected a closed pipeline stage");
  }
  return stage;
}

function readRequiredStage(fields: Map<string, unknown>): PipelineStage {
  const stage = mapGet(fields, "stage");
  if (!isPipelineStage(stage)) {
    throw diagnosticTypeError("stage: expected a closed pipeline stage");
  }
  return stage;
}

function readOptionalContext(fields: Map<string, unknown>): DiagnosticContext | undefined {
  if (!mapHas(fields, "context")) {
    return undefined;
  }
  return cloneDiagnosticContext(mapGet(fields, "context"));
}

type ApprovedRecoverablePolicy = {
  adjudication: "approved";
  mode: "strict-owned" | "normalized-owned" | "delegated-opaque" | "derived-internal";
  normativeFallback: string;
  deterministicOutput: true;
  sameOutputAcrossPublicPaths: true;
  numericApproximation: false;
  userAction: string;
};

type LegacyRecoverableDebtPolicy = {
  adjudication: "legacy-debt";
  debtId: "gif-timing-numeric-approximation" | "png-resolution-numeric-approximation";
  violation: "numeric-approximation";
};

type InternalRecoverablePolicy = ApprovedRecoverablePolicy | LegacyRecoverableDebtPolicy;
type InternalRecoverablePolicyEntry = InternalRecoverablePolicy & { code: string };

/**
 * Closed policy catalog for warnings created by TS-side fallback owners.
 *
 * This is intentionally not re-exported from the package root. Transport
 * rehydration is a separate legacy path: it must preserve the producer's
 * warning fields until its versioned wire migration is performed.
 */
export const INTERNAL_RECOVERABLE_POLICIES = [
  {
    code: "ANIMATED_GIF_TIMING_ADJUSTED",
    adjudication: "legacy-debt",
    debtId: "gif-timing-numeric-approximation",
    violation: "numeric-approximation",
  },
  {
    code: "BBOX_INFERRED_FROM_VIEWBOX",
    adjudication: "approved",
    mode: "normalized-owned",
    normativeFallback: "Use the parsed viewBox when an explicit or enclosing-rect BBOX is absent.",
    deterministicOutput: true,
    sameOutputAcrossPublicPaths: true,
    numericApproximation: false,
    userAction: "Provide an explicit text BBOX to avoid inference.",
  },
  {
    code: "LAYERED_COMPOSITION_MISMATCH",
    adjudication: "approved",
    mode: "derived-internal",
    normativeFallback: "Return the already-emitted layered SVG and attach mismatch metrics.",
    deterministicOutput: true,
    sameOutputAcrossPublicPaths: true,
    numericApproximation: false,
    userAction: "Inspect the mismatch metrics or tighten the layer composition.",
  },
  {
    code: "LAYERED_COMPOSITION_VALIDATION_UNAVAILABLE",
    adjudication: "approved",
    mode: "derived-internal",
    normativeFallback: "Skip optional composition validation and return a skipped result.",
    deterministicOutput: true,
    sameOutputAcrossPublicPaths: true,
    numericApproximation: false,
    userAction: "Provide a composition validator when validation is required.",
  },
  {
    code: "PNG_RESOLUTION_ADJUSTED",
    adjudication: "legacy-debt",
    debtId: "png-resolution-numeric-approximation",
    violation: "numeric-approximation",
  },
  {
    code: "SVG_EXTERNAL_IMAGE_DETECTED",
    adjudication: "approved",
    mode: "delegated-opaque",
    normativeFallback: "Preserve the external reference in delegated SVG content.",
    deterministicOutput: true,
    sameOutputAcrossPublicPaths: true,
    numericApproximation: false,
    userAction: "Inline the external image as a data URI for reliable rendering.",
  },
  {
    code: "SVG_NESTED_SVG_DETECTED",
    adjudication: "approved",
    mode: "delegated-opaque",
    normativeFallback: "Preserve nested SVG as non-text content.",
    deterministicOutput: true,
    sameOutputAcrossPublicPaths: true,
    numericApproximation: false,
    userAction: "Flatten nested SVG when its text must be extracted.",
  },
  {
    code: "SVG_STYLE_BLOCK_DETECTED",
    adjudication: "approved",
    mode: "delegated-opaque",
    normativeFallback: "Ignore the style block for extracted text and use available inline styles.",
    deterministicOutput: true,
    sameOutputAcrossPublicPaths: true,
    numericApproximation: false,
    userAction: "Move required text styles inline.",
  },
  {
    code: "SVG_UNSUPPORTED_PROPERTY",
    adjudication: "approved",
    mode: "delegated-opaque",
    normativeFallback: "Ignore the named unsupported text attribute or style property.",
    deterministicOutput: true,
    sameOutputAcrossPublicPaths: true,
    numericApproximation: false,
    userAction: "Remove the property or express the effect with a supported primitive.",
  },
] as const satisfies readonly InternalRecoverablePolicyEntry[];

type InternalRecoverableCode = (typeof INTERNAL_RECOVERABLE_POLICIES)[number]["code"];

/** Closed optional fields accepted by the FatalError constructor. */
const FATAL_OPTION_FIELDS = new CapturedSet(["stage", "nodeId", "context"]);
/** Complete key set accepted by serialized fatal diagnostics. */
const FATAL_SERIALIZED_FIELDS = new CapturedSet([
  "severity",
  "code",
  "message",
  "stage",
  "nodeId",
  "context",
]);
/** Closed fields accepted by the RecoverableError constructor. */
const RECOVERABLE_OPTION_FIELDS = new CapturedSet(["fallback", "stage", "nodeId", "context"]);
/** Complete key set accepted by serialized recoverable diagnostics. */
const RECOVERABLE_SERIALIZED_FIELDS = new CapturedSet([
  "severity",
  "code",
  "message",
  "fallback",
  "stage",
  "nodeId",
  "context",
]);

type ParsedFatalDiagnostic = {
  code: string;
  message: string;
  stage?: PipelineStage;
  nodeId?: string;
  context?: DiagnosticContext;
};

type ParsedRecoverableDiagnostic = {
  code: string;
  message: string;
  fallback: string;
  stage: PipelineStage;
  nodeId?: string;
  context?: DiagnosticContext;
};

function parseFatalOptions(
  options: FatalErrorOptions | undefined,
): Omit<ParsedFatalDiagnostic, "code" | "message"> {
  if (options === undefined) {
    return {};
  }
  const fields = readExactFields(options, {
    allowedFields: FATAL_OPTION_FIELDS,
    requiredFields: [],
    description: "fatal options",
  });
  const stage = readOptionalStage(fields);
  const nodeId = readOptionalNodeId(fields);
  const context = readOptionalContext(fields);
  return {
    ...(stage !== undefined && { stage }),
    ...(nodeId !== undefined && { nodeId }),
    ...(context !== undefined && { context }),
  };
}

function parseRecoverableOptions(
  options: RecoverableErrorOptions,
): Omit<ParsedRecoverableDiagnostic, "code" | "message"> {
  const fields = readExactFields(options, {
    allowedFields: RECOVERABLE_OPTION_FIELDS,
    requiredFields: ["fallback", "stage"],
    description: "recoverable options",
  });
  const fallback = requireNonEmptyDiagnosticString(mapGet(fields, "fallback"), "fallback");
  const stage = readRequiredStage(fields);
  const nodeId = readOptionalNodeId(fields);
  const context = readOptionalContext(fields);
  return {
    fallback,
    stage,
    ...(nodeId !== undefined && { nodeId }),
    ...(context !== undefined && { context }),
  };
}

function parseSerializedFatal(value: unknown): ParsedFatalDiagnostic {
  const fields = readExactFields(value, {
    allowedFields: FATAL_SERIALIZED_FIELDS,
    requiredFields: ["severity", "code", "message"],
    description: "serialized fatal diagnostic",
  });
  if (mapGet(fields, "severity") !== "fatal") {
    throw diagnosticTypeError("severity: expected fatal");
  }
  const stage = readOptionalStage(fields);
  const nodeId = readOptionalNodeId(fields);
  const context = readOptionalContext(fields);
  return {
    code: requireDiagnosticCode(mapGet(fields, "code")),
    message: requireNonEmptyDiagnosticString(mapGet(fields, "message"), "message"),
    ...(stage !== undefined && { stage }),
    ...(nodeId !== undefined && { nodeId }),
    ...(context !== undefined && { context }),
  };
}

function parseSerializedRecoverable(value: unknown): ParsedRecoverableDiagnostic {
  const fields = readExactFields(value, {
    allowedFields: RECOVERABLE_SERIALIZED_FIELDS,
    requiredFields: ["severity", "code", "message", "fallback", "stage"],
    description: "serialized recoverable diagnostic",
  });
  if (mapGet(fields, "severity") !== "recoverable") {
    throw diagnosticTypeError("severity: expected recoverable");
  }
  const nodeId = readOptionalNodeId(fields);
  const context = readOptionalContext(fields);
  return {
    code: requireDiagnosticCode(mapGet(fields, "code")),
    message: requireNonEmptyDiagnosticString(mapGet(fields, "message"), "message"),
    fallback: requireNonEmptyDiagnosticString(mapGet(fields, "fallback"), "fallback"),
    stage: readRequiredStage(fields),
    ...(nodeId !== undefined && { nodeId }),
    ...(context !== undefined && { context }),
  };
}

/** Fatal diagnostic thrown when rendering cannot continue. */
export class FatalError extends Error {
  readonly severity: "fatal" = "fatal";
  readonly code: string;
  readonly stage?: PipelineStage;
  readonly nodeId?: string;
  readonly context?: DiagnosticContext;

  /**
   * Validate the fatal envelope and detach any caller-owned diagnostic context.
   * @throws {TypeError} When the code, message, options or context violate the diagnostic contract.
   */
  constructor(code: string, message: string, options?: FatalErrorOptions) {
    const validatedCode = requireDiagnosticCode(code);
    const validatedMessage = requireNonEmptyDiagnosticString(message, "message");
    const parsedOptions = parseFatalOptions(options);
    super(validatedMessage);
    this.name = "FatalError";
    this.code = validatedCode;
    this.stage = parsedOptions.stage;
    this.nodeId = parsedOptions.nodeId;
    this.context = parsedOptions.context;
  }

  /** Return whether a value exactly matches the serialized fatal contract. */
  static isSerialized(value: unknown): value is SerializedFatalError {
    try {
      parseSerializedFatal(value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rehydrate an exact serialized fatal diagnostic with detached context.
   * @throws {TypeError} When the input is not a valid serialized fatal envelope.
   */
  static fromSerialized(value: unknown): FatalError {
    const parsed = parseSerializedFatal(value);
    return new FatalError(parsed.code, parsed.message, {
      ...(parsed.stage !== undefined && { stage: parsed.stage }),
      ...(parsed.nodeId !== undefined && { nodeId: parsed.nodeId }),
      ...(parsed.context !== undefined && { context: parsed.context }),
    });
  }

  /**
   * Serialize the current mutable context into a fresh detached value.
   * @throws {TypeError} When a later context mutation makes it invalid for serialization.
   */
  toJSON(): SerializedFatalError {
    const context = this.context === undefined ? undefined : cloneDiagnosticContext(this.context);
    return {
      severity: this.severity,
      code: this.code,
      message: this.message,
      ...(this.stage !== undefined && { stage: this.stage }),
      ...(this.nodeId !== undefined && { nodeId: this.nodeId }),
      ...(context !== undefined && { context }),
    };
  }
}

/** Recoverable diagnostic emitted after a deterministic fallback succeeds. */
export class RecoverableError extends Error {
  readonly severity: "recoverable" = "recoverable";
  readonly code: string;
  readonly fallback: string;
  readonly stage: PipelineStage;
  readonly nodeId?: string;
  readonly context?: DiagnosticContext;

  /**
   * Validate the completed fallback description and detach caller-owned diagnostic context.
   * @throws {TypeError} When the envelope, required fallback/stage or context is invalid.
   */
  constructor(code: string, message: string, options: RecoverableErrorOptions) {
    const validatedCode = requireDiagnosticCode(code);
    const validatedMessage = requireNonEmptyDiagnosticString(message, "message");
    const parsedOptions = parseRecoverableOptions(options);
    super(validatedMessage);
    this.name = "RecoverableError";
    this.code = validatedCode;
    this.fallback = parsedOptions.fallback;
    this.stage = parsedOptions.stage;
    this.nodeId = parsedOptions.nodeId;
    this.context = parsedOptions.context;
  }

  /** Return whether a value exactly matches the serialized recoverable contract. */
  static isSerialized(value: unknown): value is SerializedRecoverableError {
    try {
      parseSerializedRecoverable(value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rehydrate a completed fallback diagnostic with detached context.
   * @throws {TypeError} When the input is not a valid serialized recoverable envelope.
   */
  static fromSerialized(value: unknown): RecoverableError {
    const parsed = parseSerializedRecoverable(value);
    return new RecoverableError(parsed.code, parsed.message, {
      fallback: parsed.fallback,
      stage: parsed.stage,
      ...(parsed.nodeId !== undefined && { nodeId: parsed.nodeId }),
      ...(parsed.context !== undefined && { context: parsed.context }),
    });
  }

  /**
   * Serialize the current mutable context into a fresh detached value.
   * @throws {TypeError} When a later context mutation makes it invalid for serialization.
   */
  toJSON(): SerializedRecoverableError {
    const context = this.context === undefined ? undefined : cloneDiagnosticContext(this.context);
    return {
      severity: this.severity,
      code: this.code,
      message: this.message,
      fallback: this.fallback,
      stage: this.stage,
      ...(this.nodeId !== undefined && { nodeId: this.nodeId }),
      ...(context !== undefined && { context }),
    };
  }
}

type InternalRecoverableOptions = RecoverableErrorOptions;

/**
 * Construct a warning at a TS-side fallback-owner site.
 *
 * The closed code type forces every new owner to add an explicit policy
 * adjudication. Runtime checks catch empty diagnostics and malformed reserved
 * context without changing the public RecoverableError constructor contract.
 */
export function createInternalRecoverableError(
  code: InternalRecoverableCode,
  message: string,
  options: InternalRecoverableOptions,
): RecoverableError {
  const policy: InternalRecoverablePolicy | undefined = INTERNAL_RECOVERABLE_POLICIES.find(
    (candidate) => candidate.code === code,
  );
  if (!policy) {
    throw new TypeError(`Internal recoverable ${code} has no policy adjudication`);
  }
  if (!testRegExp(DIAGNOSTIC_CODE_PATTERN, code)) {
    throw new TypeError(`Internal recoverable code is not stable SCREAMING_SNAKE_CASE: ${code}`);
  }
  if (stringTrim(message).length === 0) {
    throw new TypeError(`Internal recoverable ${code} requires a non-empty message`);
  }
  if (stringTrim(options.fallback).length === 0) {
    throw new TypeError(`Internal recoverable ${code} requires a non-empty fallback`);
  }
  if (!isPipelineStage(options.stage)) {
    throw new TypeError(`Internal recoverable ${code} has an invalid pipeline stage`);
  }
  if (policy.adjudication === "approved") {
    if (
      !policy.deterministicOutput ||
      !policy.sameOutputAcrossPublicPaths ||
      policy.numericApproximation ||
      stringTrim(policy.normativeFallback).length === 0 ||
      stringTrim(policy.userAction).length === 0
    ) {
      throw new TypeError(`Internal recoverable ${code} has an incomplete approved policy`);
    }
  } else if (stringTrim(policy.debtId).length === 0) {
    throw new TypeError(`Internal recoverable ${code} has untracked legacy debt`);
  }
  return new RecoverableError(code, message, options);
}

/**
 * Rebuild a FatalError from a WASM render export failure. The exports throw
 * a structured JSON envelope (code / message / stage / nodeId); anything
 * else becomes a generic engine-stage failure.
 */
export function wrapWasmRenderError(error: unknown): FatalError {
  try {
    if (error instanceof FatalError) {
      return error;
    }
  } catch {
    // A hostile proxy may make instanceof itself throw.
  }
  const text = formatUnknownDiagnosticValue(error, "Unknown WASM render failure");
  try {
    const parsed = JSON.parse(text) as unknown;
    if (FatalError.isSerialized(parsed)) {
      return FatalError.fromSerialized(parsed);
    }
  } catch {
    // Non-JSON and malformed structured diagnostics use the stable boundary error.
  }
  return new FatalError("WASM_RENDER_FAILED", text, { stage: "engine" });
}
