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
