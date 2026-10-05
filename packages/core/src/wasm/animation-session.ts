/** Native animation transport validates fixed settings, scalar samples and terminal session state. */
import {
  type AnimatedRasterFormat,
  type AnimatedRasterOperation,
  animatedRasterFailure,
  decodeAnimatedRasterFatal,
} from "../animation-errors.js";
import type { AnimatedRasterWriteResult } from "../animation-output.js";
import type { OutputGenerator } from "../engine.js";
import { type FatalError, wrapWasmRenderError } from "../errors.js";
import type { DebugOverlayConfig } from "../svg/types.js";
import type { PngRenderOptions, WasmRasterSceneHandle } from "./index.js";
import type { WasmAnimatedRasterSessionInstance } from "./types.js";

/** Fresh, validated transport options for opening one animated raster session. */
export type AnimationSessionOpenInput = {
  format: AnimatedRasterFormat;
  frameCount: number;
  iterations: number | "infinite";
  options: PngRenderOptions;
  /** Fixed emission settings snapshotted once before native open. */
  renderOptions: AnimationRenderOptions;
};

/** Container metadata and an optional WebP size patch, before sink completion. */
export type AnimationSessionFinishOutput = AnimatedRasterWriteResult & {
  patch?: { offset: 4; bytes: Uint8Array };
};

/** Fixed settings consumed by the existing native SVG emitter for the whole session. */
export type AnimationRenderOptions = {
  /** Emit a static authored sample rather than declarative animation markup. */
  animation: "static";
  /** Effective scale from the shared raster preflight. */
  scale?: number;
  /** Existing SVG debug overlay policy. */
  debug?: boolean | DebugOverlayConfig;
  /** Sanitized resource identifier prefix captured at preparation. */
  resourceIdPrefix?: string;
  /** Existing emitted node identity policy. */
  nodeIdMetadata?: "include" | "omit";
  /** Existing parity flag with unchanged emitter semantics. */
  rasterizerCompat?: boolean;
  /** Existing validated output package/service identity. */
  generator?: OutputGenerator;
};

/** Single-frame WASM session with explicit ownership and idempotent disposal. */
export type AnimatedRasterSessionHandle = {
  /** Sample an owned raster scene and encode its exact integer display duration. */
  push(scene: WasmRasterSceneHandle, timeMs: number, durationMs: number): void;
  /** Copy at most 64 KiB, or return null when the current operation is drained. */
  readChunk(): Uint8Array | null;
  /** Complete the container and return metadata without completing the external sink. */
  finish(): AnimationSessionFinishOutput;
  /** Release resources without generating additional output. */
  abort(): void;
  /** Free the generated session once; all later operations reject locally. */
  dispose(): void;
};

/** Closed field identities used by open and scalar input diagnostics. */
type AnimationInputField =
  | "format"
  | "frameCount"
  | "iterations"
  | "options"
  | "renderOptions"
  | "timeMs"
  | "durationMs";

/** Snapshot closed own data properties without invoking accessors or coercion. */
function readAnimationObject(
  input: unknown,
  keys: readonly string[],
  boundary: {
    format: AnimatedRasterFormat;
    operation: "open";
    field?: AnimationInputField;
  },
): Record<string, unknown> {
  const { operation, field } = boundary;
  const format =
    field === undefined &&
    typeof input === "object" &&
    input !== null &&
    Object.getOwnPropertyDescriptor(input, "format")?.value === "gif"
      ? "gif"
      : boundary.format;
  const fail = (reason: string): never => {
    throw animatedRasterFailure(format, operation, {
      family: "SESSION_INVALID_INPUT",
      reason,
      field,
    });
  };
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("wrongType");
  }
  const names = Reflect.ownKeys(input);
  if (names.some((name) => typeof name !== "string" || !keys.includes(name))) {
    return fail("unknownField");
  }
  const record = Object.create(null) as Record<string, unknown>;
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
      return fail("wrongType");
    }
    record[name as string] = descriptor.value as unknown;
  }
  return record;
}

/** Check open-field absence/null/type before fixed-setting domains. */
function assertOpenField(
  record: Record<string, unknown>,
  key: string,
  rule: {
    accepts(entry: unknown): boolean;
    format: AnimatedRasterFormat;
    field?: AnimationInputField;
    optional?: boolean;
  },
): void {
  const { accepts, format, field = "renderOptions", optional = false } = rule;
  const entry = record[key];
  if (optional && entry === undefined) {
    return;
  }
  const reason =
    entry === undefined
      ? "missingField"
      : entry === null
        ? "nullField"
        : !accepts(entry)
          ? "wrongType"
          : undefined;
  if (reason !== undefined) {
    throw animatedRasterFailure(format, "open", { family: "SESSION_INVALID_INPUT", reason, field });
  }
}

/** Copy own debug array entries without invoking accessors or custom iterators. */
function snapshotAnimationDebug(
  input: object,
  format: AnimatedRasterFormat,
): Record<string, unknown> {
  const debug = readAnimationObject(input, ["parts"], {
    format,
    operation: "open",
    field: "renderOptions",
  });
  assertOpenField(debug, "parts", {
    accepts: Array.isArray,
    format,
    field: "renderOptions",
    optional: true,
  });
  if (Array.isArray(debug.parts)) {
    const parts: string[] = [];
    for (let index = 0; index < debug.parts.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(debug.parts, index);
      const part: unknown =
        descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
      if (typeof part !== "string") {
        throw animatedRasterFailure(format, "open", {
          family: "SESSION_INVALID_INPUT",
          reason: "wrongType",
          field: "renderOptions",
        });
      }
      parts.push(part);
    }
    debug.parts = parts;
  }
  return debug;
}

/** Authenticate and snapshot the fixed open configuration once, before JSON conversion. */
export function snapshotAnimationOpenInput(
  input: AnimationSessionOpenInput,
): AnimationSessionOpenInput {
  const root = readAnimationObject(
    input,
    ["format", "frameCount", "iterations", "options", "renderOptions"],
    { format: "webp", operation: "open" },
  );
  const format = root.format === "gif" ? "gif" : "webp";
  const isPrimitiveNumber = (entry: unknown): boolean => typeof entry === "number";
  const isPrimitiveString = (entry: unknown): boolean => typeof entry === "string";
  const isConfigurationObject = (entry: unknown): boolean =>
    typeof entry === "object" && !Array.isArray(entry);
  assertOpenField(root, "format", { accepts: isPrimitiveString, format, field: "format" });
  assertOpenField(root, "frameCount", { accepts: isPrimitiveNumber, format, field: "frameCount" });
  assertOpenField(root, "iterations", {
    accepts: (entry) => isPrimitiveNumber(entry) || isPrimitiveString(entry),
    format,
    field: "iterations",
  });
  assertOpenField(root, "options", {
    accepts: isConfigurationObject,
    format,
    field: "options",
    optional: true,
  });
  assertOpenField(root, "renderOptions", { accepts: isConfigurationObject, format });
  if (root.format !== "gif" && root.format !== "webp") {
    throw animatedRasterFailure(format, "open", {
      family: "SESSION_INVALID_INPUT",
      reason: "outOfDomain",
      field: "format",
    });
  }
  const options = readAnimationObject(
    root.renderOptions,
    [
      "animation",
      "scale",
      "debug",
      "resourceIdPrefix",
      "nodeIdMetadata",
      "rasterizerCompat",
      "generator",
    ],
    { format, operation: "open", field: "renderOptions" },
  );
  assertOpenField(options, "animation", { accepts: isPrimitiveString, format });
  assertOpenField(options, "scale", {
    accepts: isPrimitiveNumber,
    format,
    field: "renderOptions",
    optional: true,
  });
  assertOpenField(options, "debug", {
    accepts: (entry) => typeof entry === "boolean" || isConfigurationObject(entry),
    format,
    field: "renderOptions",
    optional: true,
  });
  if (typeof options.debug === "object" && options.debug !== null) {
    options.debug = snapshotAnimationDebug(options.debug, format);
  }
  assertOpenField(options, "resourceIdPrefix", {
    accepts: isPrimitiveString,
    format,
    field: "renderOptions",
    optional: true,
  });
  assertOpenField(options, "nodeIdMetadata", {
    accepts: isPrimitiveString,
    format,
    field: "renderOptions",
    optional: true,
  });
  assertOpenField(options, "rasterizerCompat", {
    accepts: (entry) => typeof entry === "boolean",
    format,
    field: "renderOptions",
    optional: true,
  });
  assertOpenField(options, "generator", {
    accepts: isConfigurationObject,
    format,
    field: "renderOptions",
    optional: true,
  });
  if (options.generator !== undefined) {
    const generator = readAnimationObject(options.generator, ["name", "version"], {
      format,
      operation: "open",
      field: "renderOptions",
    });
    assertOpenField(generator, "name", { accepts: isPrimitiveString, format });
    assertOpenField(generator, "version", { accepts: isPrimitiveString, format });
    assertAnimationUnicode(generator.name as string, format);
    assertAnimationUnicode(generator.version as string, format);
    options.generator = generator;
  }
  if (typeof options.resourceIdPrefix === "string") {
    assertAnimationUnicode(options.resourceIdPrefix, format);
  }
  if (
    options.animation !== "static" ||
    (options.scale !== undefined &&
      (!Number.isFinite(options.scale) || (options.scale as number) <= 0)) ||
    (options.nodeIdMetadata !== undefined &&
      options.nodeIdMetadata !== "include" &&
      options.nodeIdMetadata !== "omit")
  ) {
    throw animatedRasterFailure(format, "open", {
      family: "SESSION_INVALID_INPUT",
      reason: "outOfDomain",
      field: "renderOptions",
    });
  }
  root.renderOptions = options;
  return root as unknown as AnimationSessionOpenInput;
}

/** Reject isolated UTF-16 surrogates before JSON or UTF-8 conversion of fixed settings. */
function assertAnimationUnicode(value: string, format: AnimatedRasterFormat): void {
  const fail = (): never => {
    throw animatedRasterFailure(format, "open", {
      family: "SESSION_INVALID_INPUT",
      reason: "invalidUnicode",
      field: "renderOptions",
    });
  };
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail();
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail();
    }
  }
}

/** Authenticate animation envelopes, then apply the common render diagnostic mapping. */
export function normalizeAnimationWasmError(error: unknown): FatalError {
  return decodeAnimatedRasterFatal(error) ?? wrapWasmRenderError(error);
}

/** Require complete, safe metadata and the exact four-byte WebP patch. */
function decodeFinishOutput(
  json: string,
  format: AnimatedRasterFormat,
): AnimationSessionFinishOutput {
  const fail = (): FatalError =>
    animatedRasterFailure(format, "finish", {
      family: "SESSION_INVALID_INPUT",
      reason: "wrongType",
      field: "options",
    });
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw fail();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw fail();
  }
  const record = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(record).some(
      (key) =>
        typeof key !== "string" || !["format", "frameCount", "bytesWritten", "patch"].includes(key),
    ) ||
    record.format !== format ||
    typeof record.frameCount !== "number" ||
    !Number.isSafeInteger(record.frameCount) ||
    record.frameCount < 1 ||
    typeof record.bytesWritten !== "number" ||
    !Number.isSafeInteger(record.bytesWritten) ||
    record.bytesWritten < 1
  ) {
    throw fail();
  }
  const result: AnimationSessionFinishOutput = {
    format,
    frameCount: record.frameCount,
    bytesWritten: record.bytesWritten,
  };
  if (format === "gif") {
    if (Object.hasOwn(record, "patch")) {
      throw fail();
    }
  } else {
    const patch = record.patch;
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw fail();
    }
    const candidate = patch as Record<string, unknown>;
    if (
      Reflect.ownKeys(candidate).length !== 2 ||
      !Object.hasOwn(candidate, "offset") ||
      !Object.hasOwn(candidate, "bytes") ||
      candidate.offset !== 4 ||
      !Array.isArray(candidate.bytes) ||
      candidate.bytes.length !== 4 ||
      candidate.bytes.some(
        (byte) => typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255,
      )
    ) {
      throw fail();
    }
    result.patch = { offset: 4, bytes: Uint8Array.from(candidate.bytes as number[]) };
  }
  return result;
}

/** Wrap the generated capability without exposing numeric session IDs or repeated free calls. */
export class WasmAnimatedRasterSessionHandle implements AnimatedRasterSessionHandle {
  private isDisposed = false;
  private primary: unknown;
  private isFailed = false;
  private phase: "active" | "finishing" | "finished" | "aborted" = "active";

  /** Adopt exactly one generated session and its immutable container identity. */
  constructor(
    private readonly instance: WasmAnimatedRasterSessionInstance,
    private readonly format: AnimatedRasterFormat,
    private readonly pushFrame: (
      scene: WasmRasterSceneHandle,
      timeMs: number,
      durationMs: number,
    ) => void,
  ) {}

  /** Guard terminal wrapper state before any payload inspection or WASM call. */
  private assertActive(operation: AnimatedRasterOperation): void {
    if (this.isDisposed) {
      throw animatedRasterFailure(this.format, operation, {
        family: "SESSION_INVALID_STATE",
        reason: "freed",
      });
    }
    if (this.isFailed) {
      throw this.primary;
    }
    if (this.phase === "aborted") {
      throw animatedRasterFailure(this.format, operation, {
        family: "SESSION_INVALID_STATE",
        reason: "aborted",
      });
    }
    if (this.phase === "finished" || (this.phase === "finishing" && operation !== "drain")) {
      throw animatedRasterFailure(this.format, operation, {
        family: "SESSION_INVALID_STATE",
        reason: "alreadyFinished",
      });
    }
  }

  /** Store the first active-operation failure and suppress further native work. */
  private fail(error: unknown): never {
    this.primary = normalizeAnimationWasmError(error);
    this.isFailed = true;
    try {
      this.instance.abort();
    } catch {
      // Cleanup must preserve the first operation failure.
    }
    throw this.primary;
  }

  /**
   * Authenticate primitive controls after terminal checks without creating a sample record.
   * @throws FatalError for scalar input, terminal state, or native frame failures.
   */
  push(scene: WasmRasterSceneHandle, timeMs: number, durationMs: number): void {
    this.assertActive("push");
    try {
      const durationTypeReason =
        durationMs === undefined
          ? "missingField"
          : durationMs === null
            ? "nullField"
            : typeof durationMs !== "number"
              ? "wrongType"
              : undefined;
      if (durationTypeReason !== undefined) {
        throw animatedRasterFailure(this.format, "push", {
          family: "SESSION_INVALID_INPUT",
          reason: durationTypeReason,
          field: "durationMs",
        });
      }
      const timeTypeReason =
        timeMs === undefined
          ? "missingField"
          : timeMs === null
            ? "nullField"
            : typeof timeMs !== "number"
              ? "wrongType"
              : undefined;
      if (timeTypeReason !== undefined) {
        throw animatedRasterFailure(this.format, "push", {
          family: "SESSION_INVALID_INPUT",
          reason: timeTypeReason,
          field: "timeMs",
        });
      }
      if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 60000) {
        throw animatedRasterFailure(this.format, "push", {
          family: "SESSION_INVALID_INPUT",
          reason: "outOfDomain",
          field: "durationMs",
        });
      }
      if (!Number.isFinite(timeMs) || timeMs < 0) {
        throw animatedRasterFailure(this.format, "push", {
          family: "SESSION_INVALID_INPUT",
          reason: "outOfDomain",
          field: "timeMs",
        });
      }
      this.pushFrame(scene, timeMs === 0 ? 0 : timeMs, durationMs);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Accept only a copied, nonempty byte chunk or the explicit null drain marker. */
  readChunk(): Uint8Array | null {
    this.assertActive("drain");
    try {
      const chunk: unknown = this.instance.read_chunk();
      if (chunk === null) {
        if (this.phase === "finishing") {
          this.phase = "finished";
        }
        return null;
      }
      if (!(chunk instanceof Uint8Array) || chunk.length < 1 || chunk.length > 65536) {
        throw animatedRasterFailure(this.format, "drain", {
          family: "SESSION_INVALID_INPUT",
          reason: "wrongType",
          field: "options",
        });
      }
      return chunk;
    } catch (error) {
      return this.fail(error);
    }
  }

  /** Decode completion metadata before the orchestration applies its patch. */
  finish(): AnimationSessionFinishOutput {
    this.assertActive("finish");
    try {
      const output = decodeFinishOutput(this.instance.finish(), this.format);
      this.phase = "finishing";
      return output;
    } catch (error) {
      return this.fail(error);
    }
  }

  /** Abort the generated capability even when the wrapper holds a primary failure. */
  abort(): void {
    if (!this.isDisposed && this.phase !== "aborted") {
      this.phase = "aborted";
      this.instance.abort();
    }
  }

  /** Release the generated capability once. */
  dispose(): void {
    if (!this.isDisposed) {
      this.isDisposed = true;
      this.instance.free();
    }
  }
}
