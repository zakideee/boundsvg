import { describe, expect, it } from "vitest";
import {
  type DiagnosticContext,
  type DiagnosticContextValue,
  FatalError,
  formatUnknownDiagnosticValue,
  RecoverableError,
  type SerializedFatalError,
  type SerializedRecoverableError,
} from "../../src/errors.js";

const pipelineStages = [
  "validate",
  "layout",
  "text",
  "ir",
  "emit",
  "wasm",
  "font",
  "engine",
  "analyzer",
] as const;

const sparseContextArray: DiagnosticContextValue[] = [0, 1];
Reflect.deleteProperty(sparseContextArray, "1");

function asDiagnosticContext(value: unknown): DiagnosticContext {
  return value as DiagnosticContext;
}

function defineDataProperty(
  target: Record<string, DiagnosticContextValue>,
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

describe("diagnostic boundary formatting", () => {
  it("formats primitives and own message data without invoking object hooks", () => {
    let hookCalls = 0;
    const hostile = {
      get payload() {
        hookCalls += 1;
        return "secret";
      },
      toJSON() {
        hookCalls += 1;
        return "serialized";
      },
      toString() {
        hookCalls += 1;
        return "coerced";
      },
      [Symbol.toPrimitive]() {
        hookCalls += 1;
        return "primitive";
      },
    };
    const accessorMessage = Object.defineProperty({}, "message", {
      enumerable: true,
      get() {
        hookCalls += 1;
        return "accessed";
      },
    });

    expect(formatUnknownDiagnosticValue(hostile, "fallback")).toBe("fallback");
    expect(formatUnknownDiagnosticValue(accessorMessage, "fallback")).toBe("fallback");
    expect(formatUnknownDiagnosticValue({ message: "owned" }, "fallback")).toBe("owned");
    expect(formatUnknownDiagnosticValue(Object.create(null), "fallback")).toBe("fallback");
    expect(formatUnknownDiagnosticValue(null, "fallback")).toBe("null");
    expect(formatUnknownDiagnosticValue(Symbol("wire"), "fallback")).toBe("Symbol(wire)");
    expect(formatUnknownDiagnosticValue(7n, "fallback")).toBe("7");
    expect(hookCalls).toBe(0);
  });
});

describe("diagnostic constructor contract", () => {
  it("stores explicit metadata and a detached mutable context", () => {
    const sourceContext: DiagnosticContext = {
      nested: { count: 1 },
      values: [1, -0, null],
    };
    const error = new FatalError("VALIDATION_FAILED", "Validation failed", {
      stage: "validate",
      nodeId: "node-1",
      context: sourceContext,
    });

    expect(error.stage).toBe("validate");
    expect(error.nodeId).toBe("node-1");
    expect(error.context).not.toBe(sourceContext);
    expect(error.context).toEqual({ nested: { count: 1 }, values: [1, 0, null] });

    const sourceNested = sourceContext.nested as Record<string, DiagnosticContextValue>;
    sourceNested.count = 2;
    expect(error.context?.nested).toEqual({ count: 1 });

    const storedNested = error.context?.nested as Record<string, DiagnosticContextValue>;
    storedNested.count = 3;
    const serialized = error.toJSON();
    expect(serialized.context?.nested).toEqual({ count: 3 });
    expect(serialized.context).not.toBe(error.context);
    expect(serialized.context?.nested).not.toBe(error.context?.nested);
  });

  it("requires explicit recoverable fallback and stage", () => {
    const error = new RecoverableError("IMAGE_LOAD_FAILED", "Image loading failed", {
      fallback: "placeholder rectangle",
      stage: "ir",
      nodeId: "image-1",
      context: { href: "https://example.test/image.png" },
    });

    expect(error.fallback).toBe("placeholder rectangle");
    expect(error.stage).toBe("ir");
    expect(error.nodeId).toBe("image-1");
    expect(error.context).toEqual({ href: "https://example.test/image.png" });
  });

  it("accepts every closed pipeline stage", () => {
    for (const stage of pipelineStages) {
      expect(new FatalError("TEST_STAGE", "Stage test", { stage }).stage).toBe(stage);
      expect(
        new RecoverableError("TEST_STAGE", "Stage test", {
          fallback: "continued",
          stage,
        }).stage,
      ).toBe(stage);
    }
  });

  it.each([
    ["empty code", () => new FatalError("", "Message")],
    ["unstable code", () => new FatalError("not_stable", "Message")],
    ["empty message", () => new FatalError("TEST_CODE", "  ")],
    [
      "invalid fatal stage",
      () => Reflect.construct(FatalError, ["TEST_CODE", "Message", { stage: "unknown-stage" }]),
    ],
    [
      "missing recoverable options",
      () => Reflect.construct(RecoverableError, ["TEST_CODE", "Message"]),
    ],
    [
      "missing recoverable fallback",
      () => Reflect.construct(RecoverableError, ["TEST_CODE", "Message", { stage: "text" }]),
    ],
    [
      "empty recoverable fallback",
      () =>
        new RecoverableError("TEST_CODE", "Message", {
          fallback: " ",
          stage: "text",
        }),
    ],
    [
      "missing recoverable stage",
      () =>
        Reflect.construct(RecoverableError, ["TEST_CODE", "Message", { fallback: "continued" }]),
    ],
  ])("rejects %s", (_label, construct) => {
    expect(construct).toThrow(TypeError);
  });

  it("preserves dangerous own data keys without changing prototypes", () => {
    const sourceContext: Record<string, DiagnosticContextValue> = {};
    defineDataProperty(sourceContext, "__proto__", { marker: "prototype-data" });
    defineDataProperty(sourceContext, "constructor", "constructor-data");
    defineDataProperty(sourceContext, "prototype", "prototype-data");

    const error = new FatalError("DANGEROUS_KEYS", "Dangerous keys", {
      context: sourceContext,
    });
    const serialized = error.toJSON();

    expect(Object.getPrototypeOf(error.context)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(serialized.context)).toBe(Object.prototype);
    expect(Object.hasOwn(error.context ?? {}, "__proto__")).toBe(true);
    expect(Object.hasOwn(serialized.context ?? {}, "__proto__")).toBe(true);
    expect(error.context?.__proto__).toEqual({ marker: "prototype-data" });
    expect(error.context?.constructor).toBe("constructor-data");
    expect(error.context?.prototype).toBe("prototype-data");
  });

  it("preserves null-prototype objects as detached plain objects", () => {
    const sourceContext = Object.create(null) as Record<string, DiagnosticContextValue>;
    sourceContext.value = "safe";
    const error = new FatalError("NULL_PROTOTYPE", "Null prototype", {
      context: sourceContext,
    });

    expect(Object.getPrototypeOf(error.context)).toBeNull();
    expect(error.context).not.toBe(sourceContext);
    expect(error.context?.value).toBe("safe");
  });

  it.each([
    ["root array", []],
    ["function", { value: () => undefined }],
    ["bigint", { value: 1n }],
    ["non-finite number", { value: Number.POSITIVE_INFINITY }],
    ["NaN", { value: Number.NaN }],
    ["explicit undefined", { value: undefined }],
    ["class instance", { value: new Date(0) }],
    ["sparse array", { value: sparseContextArray }],
  ])("rejects non-JSON context: %s", (_label, context) => {
    expect(
      () =>
        new FatalError("INVALID_CONTEXT", "Invalid context", {
          context: asDiagnosticContext(context),
        }),
    ).toThrow(TypeError);
  });

  it("rejects cycles", () => {
    const context: Record<string, unknown> = {};
    context.self = context;
    expect(
      () =>
        new FatalError("INVALID_CONTEXT", "Invalid context", {
          context: asDiagnosticContext(context),
        }),
    ).toThrow(TypeError);
  });

  it("rejects symbol keys, accessors, and non-enumerable properties without invoking getters", () => {
    let getterCalls = 0;
    const accessorContext: Record<string, DiagnosticContextValue> = {};
    Object.defineProperty(accessorContext, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("getter must not run");
      },
    });
    expect(
      () => new FatalError("INVALID_CONTEXT", "Invalid context", { context: accessorContext }),
    ).toThrow(TypeError);
    expect(getterCalls).toBe(0);

    const hiddenContext: Record<string, DiagnosticContextValue> = {};
    Object.defineProperty(hiddenContext, "hidden", { enumerable: false, value: "secret" });
    expect(
      () => new FatalError("INVALID_CONTEXT", "Invalid context", { context: hiddenContext }),
    ).toThrow(TypeError);

    const symbolContext: Record<string, DiagnosticContextValue> = {};
    Reflect.defineProperty(symbolContext, Symbol("hidden"), { enumerable: true, value: "secret" });
    expect(
      () => new FatalError("INVALID_CONTEXT", "Invalid context", { context: symbolContext }),
    ).toThrow(TypeError);
  });

  it("normalizes descriptor and proxy failures to TypeError", () => {
    const throwingOwnKeys = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("ownKeys failed");
        },
      },
    );
    const throwingDescriptor = new Proxy(
      { value: 1 },
      {
        getOwnPropertyDescriptor() {
          throw new Error("descriptor failed");
        },
      },
    );

    for (const context of [throwingOwnKeys, throwingDescriptor]) {
      expect(
        () =>
          new FatalError("INVALID_CONTEXT", "Invalid context", {
            context: asDiagnosticContext(context),
          }),
      ).toThrow(TypeError);
    }
  });

  it.each([
    "severity",
    "code",
    "message",
    "fallback",
    "stage",
    "nodeId",
  ])("rejects reserved root context key %s", (key) => {
    expect(
      () =>
        new FatalError("INVALID_CONTEXT", "Invalid context", {
          context: { [key]: "reserved" },
        }),
    ).toThrow(TypeError);
  });

  it("allows reserved names in nested domain objects", () => {
    const error = new RecoverableError("NESTED_KEYS", "Nested keys", {
      fallback: "continued",
      stage: "text",
      context: {
        domain: {
          severity: "domain-severity",
          code: "domain-code",
          message: "domain-message",
          fallback: "domain-fallback",
          stage: "domain-stage",
          nodeId: "domain-node",
        },
      },
    });

    expect(error.toJSON().context?.domain).toEqual({
      severity: "domain-severity",
      code: "domain-code",
      message: "domain-message",
      fallback: "domain-fallback",
      stage: "domain-stage",
      nodeId: "domain-node",
    });
  });

  it("revalidates mutable context on every serialization", () => {
    const error = new FatalError("MUTABLE_CONTEXT", "Mutable context", {
      context: { value: 1 },
    });
    if (!error.context) {
      throw new TypeError("test context is missing");
    }
    error.context.value = 2;
    expect(error.toJSON().context).toEqual({ value: 2 });

    error.context.value = Number.NaN;
    expect(() => error.toJSON()).toThrow(TypeError);
  });
});

describe("serialized diagnostic contract", () => {
  const fatal: SerializedFatalError = {
    severity: "fatal",
    code: "VALIDATION_FAILED",
    message: "Validation failed",
    stage: "validate",
    nodeId: "node-1",
    context: { reason: "invalid" },
  };
  const recoverable: SerializedRecoverableError = {
    severity: "recoverable",
    code: "MISSING_GLYPH",
    message: "Glyph is missing",
    fallback: "blank glyph",
    stage: "text",
    nodeId: "text-1",
    context: { glyphId: 0 },
  };

  it("accepts exact severity-specific shapes", () => {
    expect(FatalError.isSerialized(fatal)).toBe(true);
    expect(RecoverableError.isSerialized(recoverable)).toBe(true);
    expect(FatalError.isSerialized(recoverable)).toBe(false);
    expect(RecoverableError.isSerialized(fatal)).toBe(false);

    const fatalError = FatalError.fromSerialized(fatal);
    const recoverableError = RecoverableError.fromSerialized(recoverable);
    expect(fatalError).toBeInstanceOf(FatalError);
    expect(recoverableError).toBeInstanceOf(RecoverableError);
    expect(fatalError.toJSON()).toEqual(fatal);
    expect(recoverableError.toJSON()).toEqual(recoverable);
    expect(fatalError.context).not.toBe(fatal.context);
    expect(recoverableError.context).not.toBe(recoverable.context);
  });

  it.each([
    ["null", null],
    ["array", []],
    ["wrong severity", { ...fatal, severity: "recoverable" }],
    ["missing code", { severity: "fatal", message: "Message" }],
    ["null code", { ...fatal, code: null }],
    ["present undefined", { ...fatal, stage: undefined }],
    ["unknown stage", { ...fatal, stage: "unknown" }],
    ["fatal fallback", { ...fatal, fallback: "forbidden" }],
    ["extra key", { ...fatal, extra: true }],
    ["reserved context key", { ...fatal, context: { stage: "validate" } }],
  ])("rejects malformed fatal shape: %s", (_label, value) => {
    expect(FatalError.isSerialized(value)).toBe(false);
    expect(() => FatalError.fromSerialized(value)).toThrow(TypeError);
  });

  it.each([
    ["null", null],
    ["wrong severity", { ...recoverable, severity: "fatal" }],
    ["missing fallback", { ...recoverable, fallback: undefined }],
    ["null fallback", { ...recoverable, fallback: null }],
    ["empty fallback", { ...recoverable, fallback: " " }],
    ["missing stage", { ...recoverable, stage: undefined }],
    ["null stage", { ...recoverable, stage: null }],
    ["extra key", { ...recoverable, extra: true }],
    ["reserved context key", { ...recoverable, context: { nodeId: "text-1" } }],
  ])("rejects malformed recoverable shape: %s", (_label, value) => {
    expect(RecoverableError.isSerialized(value)).toBe(false);
    expect(() => RecoverableError.fromSerialized(value)).toThrow(TypeError);
  });

  it("does not invoke getters while rejecting serialized inputs", () => {
    let getterCalls = 0;
    const value = {
      severity: "fatal",
      code: "TEST_CODE",
      get message() {
        getterCalls += 1;
        throw new Error("getter must not run");
      },
    };

    expect(FatalError.isSerialized(value)).toBe(false);
    expect(() => FatalError.fromSerialized(value)).toThrow(TypeError);
    expect(getterCalls).toBe(0);
  });
});
