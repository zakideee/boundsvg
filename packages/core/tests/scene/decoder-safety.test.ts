import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import {
  decodeSceneDocument,
  MAX_SCENE_DECODE_COLLECTION_LENGTH,
} from "../../src/scene/decoder.js";

function captureFatal(input: unknown): FatalError {
  try {
    decodeSceneDocument(input);
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    return error as FatalError;
  }
  throw new Error("Expected a FatalError");
}

type IntrinsicOverride = { target: object; key: PropertyKey };

function withPoisonedIntrinsics<Result>(
  overrides: readonly IntrinsicOverride[],
  poisoned: () => never,
  run: () => Result,
): Result {
  const getDescriptor = Reflect.getOwnPropertyDescriptor;
  const setDescriptor = Reflect.defineProperty;
  const originalDescriptors: PropertyDescriptor[] = [];
  for (let index = 0; index < overrides.length; index += 1) {
    const override = overrides[index];
    if (override === undefined) {
      continue;
    }
    const descriptor = getDescriptor(override.target, override.key);
    if (descriptor === undefined) {
      throw new Error("Expected an intrinsic descriptor");
    }
    originalDescriptors[index] = descriptor;
  }

  try {
    for (let index = 0; index < overrides.length; index += 1) {
      const override = overrides[index];
      if (override !== undefined) {
        setDescriptor(override.target, override.key, {
          configurable: true,
          value: poisoned,
          writable: true,
        });
      }
    }
    return run();
  } finally {
    for (let index = overrides.length - 1; index >= 0; index -= 1) {
      const override = overrides[index];
      const descriptor = originalDescriptors[index];
      if (override !== undefined && descriptor !== undefined) {
        setDescriptor(override.target, override.key, descriptor);
      }
    }
  }
}

function boxWithChildren(children: unknown): unknown {
  return { type: "Box", children };
}

describe("Scene decode reflection safety", () => {
  it("accepts null prototypes and frozen data descriptors", () => {
    const input = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(input, {
      type: { value: "Canvas", enumerable: true, writable: false, configurable: false },
      width: { value: -0, enumerable: true, writable: false, configurable: false },
      height: { value: 1, enumerable: true, writable: false, configurable: false },
      children: {
        value: Object.freeze([]),
        enumerable: true,
        writable: false,
        configurable: false,
      },
    });
    const decoded = decodeSceneDocument(input);
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.is(decoded.width, -0)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(decoded, "width")).toEqual({
      value: -0,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(Object.getOwnPropertyDescriptor(decoded.children, "length")?.writable).toBe(true);
  });

  it("preserves dangerous and integer-like open-map keys as own data", () => {
    const meta: Record<string, string> = {};
    for (const [key, value] of [
      ["10", "ten"],
      ["2", "two"],
      ["", "empty"],
      ["constructor", "constructor"],
      ["__proto__", "prototype"],
    ] as const) {
      Object.defineProperty(meta, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    const decoded = decodeSceneDocument({
      type: "Canvas",
      width: 1,
      height: 1,
      meta,
      children: [],
    });
    expect(Object.keys(decoded.meta ?? {})).toEqual(["2", "10", "", "constructor", "__proto__"]);
    expect(Object.hasOwn(decoded.meta ?? {}, "__proto__")).toBe(true);
    expect(decoded.meta?.__proto__).toBe("prototype");
    expect(Object.getPrototypeOf(decoded.meta)).toBe(Object.prototype);
  });

  it("closes every reflection operation into the fixed unsafe contract", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(captureFatal(revoked.proxy).context).toEqual({
      path: "",
      reason: "reflection-failed",
      operation: "array-check",
    });

    const prototypeFailure = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw { message: "prototype secret" };
        },
      },
    );
    expect(captureFatal(prototypeFailure).context).toEqual({
      path: "",
      reason: "reflection-failed",
      operation: "get-prototype",
    });

    const keyFailure = new Proxy(
      {},
      {
        ownKeys() {
          throw { message: "key secret" };
        },
      },
    );
    expect(captureFatal(keyFailure).context).toEqual({
      path: "",
      reason: "reflection-failed",
      operation: "own-keys",
    });

    const descriptorFailure = new Proxy(
      { type: "Box", children: [] },
      {
        getOwnPropertyDescriptor(target, key) {
          if (key === "type") {
            throw { message: "descriptor secret" };
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    expect(captureFatal(descriptorFailure).context).toEqual({
      path: "/type",
      reason: "reflection-failed",
      operation: "get-own-property-descriptor",
    });
  });

  it("does not copy hostile thrown values into diagnostics", () => {
    const secret = "DO_NOT_COPY_THIS_VALUE";
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw {
            get message() {
              throw new Error(secret);
            },
            toString() {
              throw new Error(secret);
            },
          };
        },
      },
    );
    const error = captureFatal(proxy);
    expect(JSON.stringify(error.toJSON())).not.toContain(secret);
  });

  it("reports a descriptor omitted from a finite Proxy view", () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => ["type"],
        getOwnPropertyDescriptor: () => undefined,
      },
    );
    expect(captureFatal(proxy).context).toEqual({ path: "/type", reason: "descriptor-missing" });
  });

  it("uses fixed descriptor failure priority and lexical key order", () => {
    const input = { type: "Box", children: [] } as Record<string, unknown>;
    Object.defineProperty(input, "z", { enumerable: true, get: () => "z" });
    Object.defineProperty(input, "a", { value: "a", enumerable: false });
    expect(captureFatal(input).context).toEqual({ path: "/z", reason: "accessor-property" });

    const accessors = { type: "Box", children: [] } as Record<string, unknown>;
    Object.defineProperty(accessors, "z", { enumerable: true, get: () => "z" });
    Object.defineProperty(accessors, "a", { enumerable: true, get: () => "a" });
    expect(captureFatal(accessors).context).toEqual({ path: "/a", reason: "accessor-property" });
  });

  it("selects symbol, sparse, noncanonical, and extra array reasons deterministically", () => {
    const symbolKey = Symbol("not copied");
    const sparseWithSymbol = new Array(1);
    Object.defineProperty(sparseWithSymbol, symbolKey, { value: true, enumerable: true });
    expect(captureFatal(boxWithChildren(sparseWithSymbol)).context).toEqual({
      path: "/children",
      reason: "symbol-key",
    });

    const noncanonical: unknown[] = [];
    Object.defineProperties(noncanonical, {
      "01": { value: true, enumerable: true, configurable: true },
      extra: { value: true, enumerable: true, configurable: true },
    });
    expect(captureFatal(boxWithChildren(noncanonical)).context).toEqual({
      path: "/children/01",
      reason: "noncanonical-array-index",
    });

    const extra: unknown[] = [];
    Object.defineProperty(extra, "extra", { value: true, enumerable: true, configurable: true });
    expect(captureFatal(boxWithChildren(extra)).context).toEqual({
      path: "/children/extra",
      reason: "array-extra-key",
    });
  });

  it("observes the mandatory array length descriptor once and before entries", () => {
    let lengthReads = 0;
    let entryReads = 0;
    const invalidLength = new Proxy(["unused"], {
      getOwnPropertyDescriptor(_target, key) {
        if (key === "length") {
          lengthReads += 1;
          return {
            value: -0,
            writable: true,
            enumerable: false,
            configurable: false,
          };
        }
        entryReads += 1;
        throw new Error("entry descriptor should not be read");
      },
    });
    expect(captureFatal(boxWithChildren(invalidLength)).context).toEqual({
      path: "/children/length",
      reason: "invalid-array-length",
    });
    expect({ lengthReads, entryReads }).toEqual({ lengthReads: 1, entryReads: 0 });
  });

  it("checks collection size before requesting any property descriptor", () => {
    const keys = Array.from(
      { length: MAX_SCENE_DECODE_COLLECTION_LENGTH + 1 },
      (_, index) => `key-${index}`,
    );
    let descriptorReads = 0;
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => keys,
        getOwnPropertyDescriptor: () => {
          descriptorReads += 1;
          return { value: true, enumerable: true, writable: true, configurable: true };
        },
      },
    );
    const error = captureFatal(proxy);
    expect(error.context).toEqual({
      path: "",
      resource: "collection-length",
      actual: MAX_SCENE_DECODE_COLLECTION_LENGTH + 1,
      limit: MAX_SCENE_DECODE_COLLECTION_LENGTH,
    });
    expect(descriptorReads).toBe(0);
  });

  it("re-observes an acyclic Proxy alias for each output occurrence", () => {
    let childDescriptorReads = 0;
    const alias = new Proxy(
      {},
      {
        ownKeys: () => ["type", "children"],
        getOwnPropertyDescriptor(_target, key) {
          if (key === "type") {
            return { value: "Box", enumerable: true, writable: true, configurable: true };
          }
          childDescriptorReads += 1;
          return {
            value:
              childDescriptorReads === 1
                ? []
                : [{ type: "InlineRect", inlineSizePx: 1, color: "#000" }],
            enumerable: true,
            writable: true,
            configurable: true,
          };
        },
      },
    );
    const decoded = decodeSceneDocument({
      type: "Canvas",
      width: 1,
      height: 1,
      children: [alias, alias],
    });
    expect(decoded.type).toBe("Canvas");
    if (decoded.type !== "Canvas") {
      throw new Error("Expected Canvas");
    }
    expect(decoded.children[0]).toEqual({ type: "Box", children: [] });
    expect(decoded.children[1]).toEqual({
      type: "Box",
      children: [{ type: "InlineRect", inlineSizePx: 1, color: "#000" }],
    });
    expect(childDescriptorReads).toBe(2);
  });

  it("uses the intrinsic references captured when the module was initialized", () => {
    const input = {
      type: "Canvas",
      width: 1,
      height: 1,
      children: [
        {
          type: "Box",
          animate: {
            keyframes: [{ at: 0, opacity: 1 }],
            durationMs: 10,
            easing: { type: "steps", count: 2, position: "jump-end" },
          },
          children: [],
        },
      ],
    };
    const longDiscriminant = "x".repeat(120);
    const poisoned = () => {
      throw new Error("poisoned intrinsic was invoked");
    };
    const overrides: IntrinsicOverride[] = [
      { target: globalThis, key: "Array" },
      { target: globalThis, key: "Map" },
      { target: globalThis, key: "Set" },
      { target: globalThis, key: "WeakMap" },
      { target: globalThis, key: "WeakSet" },
      { target: globalThis, key: "Number" },
      { target: globalThis, key: "String" },
      { target: Array, key: "isArray" },
      { target: Array.prototype, key: Symbol.iterator },
      { target: Array.prototype, key: "pop" },
      { target: Array.prototype, key: "push" },
      { target: Map.prototype, key: "get" },
      { target: Map.prototype, key: "has" },
      { target: Map.prototype, key: "set" },
      { target: Set.prototype, key: "has" },
      { target: Set.prototype, key: Symbol.iterator },
      { target: WeakMap.prototype, key: "delete" },
      { target: WeakMap.prototype, key: "get" },
      { target: WeakMap.prototype, key: "set" },
      { target: WeakSet.prototype, key: "add" },
      { target: WeakSet.prototype, key: "delete" },
      { target: WeakSet.prototype, key: "has" },
      { target: Object, key: "create" },
      { target: Object, key: "defineProperty" },
      { target: Object, key: "getPrototypeOf" },
      { target: Object, key: "hasOwn" },
      { target: Object, key: "is" },
      { target: Reflect, key: "apply" },
      { target: Reflect, key: "getOwnPropertyDescriptor" },
      { target: Reflect, key: "getPrototypeOf" },
      { target: Reflect, key: "ownKeys" },
      { target: Number, key: "isFinite" },
      { target: Number, key: "isInteger" },
      { target: Number, key: "isSafeInteger" },
      { target: Math, key: "max" },
      { target: JSON, key: "stringify" },
      { target: RegExp.prototype, key: "test" },
      { target: String.prototype, key: "charCodeAt" },
      { target: String.prototype, key: "slice" },
      { target: String.prototype, key: "trim" },
    ];
    const { decoded, boundedError } = withPoisonedIntrinsics(overrides, poisoned, () => {
      const decodedValue = decodeSceneDocument(input);
      let errorValue: unknown;
      try {
        decodeSceneDocument({ type: longDiscriminant });
      } catch (error) {
        errorValue = error;
      }
      return { decoded: decodedValue, boundedError: errorValue };
    });

    expect(decoded).toEqual(input);
    expect(boundedError).toMatchObject({
      code: "SCENE_DECODE_UNKNOWN_DISCRIMINANT",
      context: { receivedTruncated: true },
    });
  });
});

describe("Scene decode error precedence and privacy bounds", () => {
  it("checks discriminants, unknown keys, required fields, and known fields in fixed order", () => {
    expect(captureFatal({ type: "Unknown", a: true }).code).toBe(
      "SCENE_DECODE_UNKNOWN_DISCRIMINANT",
    );
    expect(captureFatal({ type: "Box", children: [], z: true, a: true }).context).toEqual({
      path: "/a",
      key: "a",
    });
    expect(captureFatal({ type: "Canvas" }).context).toEqual({ path: "/width", field: "width" });
    expect(
      captureFatal({ type: "Canvas", width: "bad", height: Number.NaN, children: [] }).context,
    ).toEqual({ path: "/width", expected: "finite-number", actual: "string" });
  });

  it("keeps an exact 512-byte pointer and truncates only the next whole segment", () => {
    const exactKey = "a".repeat(511);
    const exact = captureFatal({
      type: "Box",
      children: [],
      [exactKey]: true,
    });
    expect(exact.context?.path).toBe(`/${exactKey}`);
    expect(exact.context?.pathTruncated).toBeUndefined();

    const excessKey = "a".repeat(512);
    const excess = captureFatal({
      type: "Box",
      children: [],
      [excessKey]: true,
    });
    expect(excess.context?.path).toBe("");
    expect(excess.context?.pathTruncated).toBe(true);
  });

  it("bounds unknown discriminants without splitting a surrogate pair", () => {
    const received = `${"😀".repeat(24)}tail`;
    const error = captureFatal({ type: received });
    expect(error.context).toEqual({
      path: "/type",
      discriminant: "type",
      received: "😀".repeat(24),
      receivedTruncated: true,
    });
  });
});
