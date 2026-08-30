/** Error severity — enables data-driven branching without instanceof checks. */
export type ErrorSeverity = "fatal" | "recoverable";

/** JSON-safe representation of a structured error (survives JSON.stringify round-trip). */
export type StructuredError = {
  severity: ErrorSeverity;
  code: string;
  message: string;
  stage?: PipelineStage;
  nodeId?: string;
  fallback?: string;
  context?: Record<string, unknown>;
};

/** Pipeline stages for structured error reporting */
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

function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && PIPELINE_STAGES.has(value);
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

/**
 * Fatal error — thrown immediately, rendering cannot continue.
 * Examples: invalid VNode structure, duplicate IDs, invalid color format.
 *
 * The optional `context` bag may include reserved keys:
 *   - `stage`: pipeline stage where the error occurred
 *   - `nodeId`: VNode id (or `<Type>` fallback) associated with the error
 */
export class FatalError extends Error {
  readonly severity: "fatal" = "fatal";
  readonly code: string;
  readonly stage?: PipelineStage;
  readonly nodeId?: string;
  readonly context?: Record<string, unknown>;

  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "FatalError";
    this.code = code;
    if (context) {
      if (isPipelineStage(context.stage)) {
        this.stage = context.stage;
      }
      if (typeof context.nodeId === "string") {
        this.nodeId = context.nodeId;
      }
    }
    this.context = context;
  }

  toJSON(): StructuredError {
    return {
      severity: this.severity,
      code: this.code,
      message: this.message,
      ...(this.stage != null && { stage: this.stage }),
      ...(this.nodeId != null && { nodeId: this.nodeId }),
      ...(this.context != null && { context: this.context }),
    };
  }
}

/**
 * Recoverable error — rendering continues with a fallback.
 * Examples: missing glyph, image load failure, kinsoku_unresolved.
 *
 * The optional `context` bag may include reserved keys:
 *   - `stage`: pipeline stage where the error occurred
 *   - `nodeId`: VNode id (or `<Type>` fallback) associated with the error
 */
export class RecoverableError extends Error {
  readonly severity: "recoverable" = "recoverable";
  readonly code: string;
  readonly fallback: string;
  readonly stage?: PipelineStage;
  readonly nodeId?: string;
  readonly context?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: { fallback: string; context?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "RecoverableError";
    this.code = code;
    this.fallback = options.fallback;
    const context = options.context;
    if (context) {
      if (isPipelineStage(context.stage)) {
        this.stage = context.stage;
      }
      if (typeof context.nodeId === "string") {
        this.nodeId = context.nodeId;
      }
    }
    this.context = context;
  }

  toJSON(): StructuredError {
    return {
      severity: this.severity,
      code: this.code,
      message: this.message,
      fallback: this.fallback,
      ...(this.stage != null && { stage: this.stage }),
      ...(this.nodeId != null && { nodeId: this.nodeId }),
      ...(this.context != null && { context: this.context }),
    };
  }
}

type InternalRecoverableOptions = {
  fallback: string;
  context?: Record<string, unknown>;
};

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
  if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(code)) {
    throw new TypeError(`Internal recoverable code is not stable SCREAMING_SNAKE_CASE: ${code}`);
  }
  if (message.trim().length === 0) {
    throw new TypeError(`Internal recoverable ${code} requires a non-empty message`);
  }
  if (options.fallback.trim().length === 0) {
    throw new TypeError(`Internal recoverable ${code} requires a non-empty fallback`);
  }
  if (options.context?.stage !== undefined && !isPipelineStage(options.context.stage)) {
    throw new TypeError(`Internal recoverable ${code} has an invalid pipeline stage`);
  }
  if (options.context?.nodeId !== undefined && typeof options.context.nodeId !== "string") {
    throw new TypeError(`Internal recoverable ${code} has a non-string nodeId`);
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
