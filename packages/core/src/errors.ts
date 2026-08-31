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

const PIPELINE_STAGES = new Set<string>([
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

const DIAGNOSTIC_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const RESERVED_CONTEXT_KEYS = new Set([
  "severity",
  "code",
  "message",
  "fallback",
  "stage",
  "nodeId",
]);

/** Return whether a value belongs to the closed diagnostic pipeline stage set. */
export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && PIPELINE_STAGES.has(value);
}

function diagnosticTypeError(description: string): TypeError {
  return new TypeError(`Invalid diagnostic ${description}`);
}

function readObjectPrototype(value: object, description: string): object | null {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    throw diagnosticTypeError(`${description}: prototype is not readable`);
  }
}

function isArrayValue(value: object, description: string): boolean {
  try {
    return Array.isArray(value);
  } catch {
    throw diagnosticTypeError(`${description}: array identity is not readable`);
  }
}

function readOwnKeys(value: object, description: string): (string | symbol)[] {
  try {
    return Reflect.ownKeys(value);
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
    descriptor = Reflect.getOwnPropertyDescriptor(value, key);
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
    if (prototype !== Array.prototype) {
      throw diagnosticTypeError("context: array subclasses are not supported");
    }
    return [];
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw diagnosticTypeError("context: values must be plain objects");
  }
  return Object.create(prototype) as DiagnosticContext;
}

function cloneDiagnosticPrimitive(value: unknown): DiagnosticContextValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw diagnosticTypeError("context: numbers must be finite");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  throw diagnosticTypeError("context: value is not JSON-safe");
}

function defineMutableDataProperty(
  target: DiagnosticContainer,
  key: string,
  value: DiagnosticContextValue,
): void {
  Object.defineProperty(target, key, {
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
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw diagnosticTypeError("context: array length is invalid");
  }
  for (const key of keys) {
    if (typeof key === "symbol") {
      throw diagnosticTypeError("context: symbol keys are not supported");
    }
    if (key === "length") {
      continue;
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key || index >= length) {
      throw diagnosticTypeError("context: arrays cannot have extra properties");
    }
  }
  const entries: DiagnosticEntry[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    entries.push({ key, value: readEnumerableDataValue(source, key, "context array") });
  }
  return entries;
}

function readDiagnosticObjectEntries(
  source: object,
  keys: readonly (string | symbol)[],
  isRoot: boolean,
): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [];
  for (const key of keys) {
    if (typeof key === "symbol") {
      throw diagnosticTypeError("context: symbol keys are not supported");
    }
    if (isRoot && RESERVED_CONTEXT_KEYS.has(key)) {
      throw diagnosticTypeError(`context: reserved root key ${key}`);
    }
    entries.push({ key, value: readEnumerableDataValue(source, key, "context object") });
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
  if (activeContainers.has(task.source)) {
    throw diagnosticTypeError("context: cycles are not supported");
  }
  activeContainers.add(task.source);
  tasks.push({ action: "exit", source: task.source });

  const childTasks: DiagnosticContainerTask[] = [];
  for (const entry of readDiagnosticEntries(task.source, task.isRoot)) {
    if (typeof entry.value === "object" && entry.value !== null) {
      const child = createDiagnosticContainer(entry.value, false);
      defineMutableDataProperty(task.target, entry.key, child);
      childTasks.push({
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
      tasks.push(childTask);
    }
  }
}

function runDiagnosticContainerTask(
  task: DiagnosticContainerTask,
  tasks: DiagnosticContainerTask[],
  activeContainers: WeakSet<object>,
): void {
  if (task.action === "exit") {
    activeContainers.delete(task.source);
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
  const activeContainers = new WeakSet<object>();

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task) {
      runDiagnosticContainerTask(task, tasks, activeContainers);
    }
  }

  return root as DiagnosticContext;
}

type ExactFieldRules = {
  allowedFields: ReadonlySet<string>;
  requiredFields: ReadonlySet<string>;
  description: string;
};

function readExactFields(value: unknown, rules: ExactFieldRules): Map<string, unknown> {
  const { allowedFields, requiredFields, description } = rules;
  if (typeof value !== "object" || value === null || isArrayValue(value, description)) {
    throw diagnosticTypeError(`${description}: expected a plain object`);
  }
  const prototype = readObjectPrototype(value, description);
  if (prototype !== Object.prototype && prototype !== null) {
    throw diagnosticTypeError(`${description}: expected a plain object`);
  }
  const fields = new Map<string, unknown>();
  for (const key of readOwnKeys(value, description)) {
    if (typeof key === "symbol" || !allowedFields.has(key)) {
      throw diagnosticTypeError(`${description}: unexpected field`);
    }
    fields.set(key, readEnumerableDataValue(value, key, description));
  }
  for (const field of requiredFields) {
    if (!fields.has(field)) {
      throw diagnosticTypeError(`${description}: missing ${field}`);
    }
  }
  return fields;
}

function requireNonEmptyDiagnosticString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw diagnosticTypeError(`${field}: expected a non-empty string`);
  }
  return value;
}

function requireDiagnosticCode(value: unknown): string {
  const code = requireNonEmptyDiagnosticString(value, "code");
  if (!DIAGNOSTIC_CODE_PATTERN.test(code)) {
    throw diagnosticTypeError("code: expected SCREAMING_SNAKE_CASE");
  }
  return code;
}

function readOptionalNodeId(fields: Map<string, unknown>): string | undefined {
  if (!fields.has("nodeId")) {
    return undefined;
  }
  const nodeId = fields.get("nodeId");
  if (typeof nodeId !== "string") {
    throw diagnosticTypeError("nodeId: expected a string");
  }
  return nodeId;
}

function readOptionalStage(fields: Map<string, unknown>): PipelineStage | undefined {
  if (!fields.has("stage")) {
    return undefined;
  }
  const stage = fields.get("stage");
  if (!isPipelineStage(stage)) {
    throw diagnosticTypeError("stage: expected a closed pipeline stage");
  }
  return stage;
}

function readRequiredStage(fields: Map<string, unknown>): PipelineStage {
  const stage = fields.get("stage");
  if (!isPipelineStage(stage)) {
    throw diagnosticTypeError("stage: expected a closed pipeline stage");
  }
  return stage;
}

function readOptionalContext(fields: Map<string, unknown>): DiagnosticContext | undefined {
  if (!fields.has("context")) {
    return undefined;
  }
  return cloneDiagnosticContext(fields.get("context"));
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

const FATAL_OPTION_FIELDS = new Set(["stage", "nodeId", "context"]);
const FATAL_SERIALIZED_FIELDS = new Set([
  "severity",
  "code",
  "message",
  "stage",
  "nodeId",
  "context",
]);
const RECOVERABLE_OPTION_FIELDS = new Set(["fallback", "stage", "nodeId", "context"]);
const RECOVERABLE_SERIALIZED_FIELDS = new Set([
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
    requiredFields: new Set(),
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
    requiredFields: new Set(["fallback", "stage"]),
    description: "recoverable options",
  });
  const fallback = requireNonEmptyDiagnosticString(fields.get("fallback"), "fallback");
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
    requiredFields: new Set(["severity", "code", "message"]),
    description: "serialized fatal diagnostic",
  });
  if (fields.get("severity") !== "fatal") {
    throw diagnosticTypeError("severity: expected fatal");
  }
  const stage = readOptionalStage(fields);
  const nodeId = readOptionalNodeId(fields);
  const context = readOptionalContext(fields);
  return {
    code: requireDiagnosticCode(fields.get("code")),
    message: requireNonEmptyDiagnosticString(fields.get("message"), "message"),
    ...(stage !== undefined && { stage }),
    ...(nodeId !== undefined && { nodeId }),
    ...(context !== undefined && { context }),
  };
}

function parseSerializedRecoverable(value: unknown): ParsedRecoverableDiagnostic {
  const fields = readExactFields(value, {
    allowedFields: RECOVERABLE_SERIALIZED_FIELDS,
    requiredFields: new Set(["severity", "code", "message", "fallback", "stage"]),
    description: "serialized recoverable diagnostic",
  });
  if (fields.get("severity") !== "recoverable") {
    throw diagnosticTypeError("severity: expected recoverable");
  }
  const nodeId = readOptionalNodeId(fields);
  const context = readOptionalContext(fields);
  return {
    code: requireDiagnosticCode(fields.get("code")),
    message: requireNonEmptyDiagnosticString(fields.get("message"), "message"),
    fallback: requireNonEmptyDiagnosticString(fields.get("fallback"), "fallback"),
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

  /** Rehydrate an exact serialized fatal diagnostic. */
  static fromSerialized(value: unknown): FatalError {
    const parsed = parseSerializedFatal(value);
    return new FatalError(parsed.code, parsed.message, {
      ...(parsed.stage !== undefined && { stage: parsed.stage }),
      ...(parsed.nodeId !== undefined && { nodeId: parsed.nodeId }),
      ...(parsed.context !== undefined && { context: parsed.context }),
    });
  }

  /** Serialize the current mutable context into a fresh detached value. */
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

  /** Rehydrate an exact serialized recoverable diagnostic. */
  static fromSerialized(value: unknown): RecoverableError {
    const parsed = parseSerializedRecoverable(value);
    return new RecoverableError(parsed.code, parsed.message, {
      fallback: parsed.fallback,
      stage: parsed.stage,
      ...(parsed.nodeId !== undefined && { nodeId: parsed.nodeId }),
      ...(parsed.context !== undefined && { context: parsed.context }),
    });
  }

  /** Serialize the current mutable context into a fresh detached value. */
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
  if (!DIAGNOSTIC_CODE_PATTERN.test(code)) {
    throw new TypeError(`Internal recoverable code is not stable SCREAMING_SNAKE_CASE: ${code}`);
  }
  if (message.trim().length === 0) {
    throw new TypeError(`Internal recoverable ${code} requires a non-empty message`);
  }
  if (options.fallback.trim().length === 0) {
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
      policy.normativeFallback.trim().length === 0 ||
      policy.userAction.trim().length === 0
    ) {
      throw new TypeError(`Internal recoverable ${code} has an incomplete approved policy`);
    }
  } else if (policy.debtId.trim().length === 0) {
    throw new TypeError(`Internal recoverable ${code} has untracked legacy debt`);
  }
  return new RecoverableError(code, message, options);
}
