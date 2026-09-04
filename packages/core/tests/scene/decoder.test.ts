import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import { decodeSceneDocument, MAX_SCENE_DECODE_JSON_BYTES } from "../../src/scene/decoder.js";

const minimalNodes = [
  { type: "Canvas", width: 1, height: 1, children: [] },
  { type: "Flex", children: [] },
  { type: "Grid", children: [] },
  { type: "Box", children: [] },
  { type: "Text", font: "F", fontSizePx: 1, children: [] },
  { type: "TextOnPath", d: "M0 0", width: 1, height: 1, font: "F", fontSizePx: 1, children: [] },
  { type: "Inline", children: [] },
  { type: "InlineBox", children: [] },
  { type: "InlineRect", inlineSizePx: 1, color: "#000" },
  { type: "Ruby", children: [] },
  { type: "Rt", children: [] },
  { type: "Image", src: "data:image/png;base64,", width: 1, height: 1 },
  { type: "Path", d: "M0 0", width: 1, height: 1 },
  { type: "Svg", content: "<svg/>", width: 1, height: 1 },
  { type: "Shape", width: 1, height: 1 },
  { type: "Symbol", width: 1, height: 1 },
] as const;

function captureFatal(run: () => unknown): FatalError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    return error as FatalError;
  }
  throw new Error("Expected a FatalError");
}

describe("decodeSceneDocument", () => {
  it("accepts every scene variant as a root", () => {
    for (const input of minimalNodes) {
      const decoded = decodeSceneDocument(input);
      expect(decoded).toEqual(input);
      expect(decoded).not.toBe(input);
    }
  });

  it("decodes nested authoring records, unions, tuples, and open maps", () => {
    const input = {
      type: "Shape",
      width: -0,
      height: 10,
      meta: Object.assign(Object.create(null) as Record<string, string>, {
        "": "empty",
        constructor: "constructor",
      }),
      transform: { translateX: -0, originY: 3 },
      animate: {
        keyframes: [
          { at: 0, transform: { scaleX: 1 } },
          { at: 1, opacity: 1 },
        ],
        durationMs: 120,
        easing: { type: "steps", count: 2, position: "jump-end" },
        iterations: "infinite",
      },
      geometry: {
        viewBox: { width: 10, height: 10 },
        root: {
          kind: "group",
          children: [
            { kind: "path", nodeId: "part", d: "M0 0H10V10Z", fillRule: "evenodd" },
            {
              kind: "transform",
              transform: { translateX: 1 },
              child: { kind: "boolean", op: "union", children: [] },
            },
          ],
        },
      },
      partPaint: {
        part: { fill: "#f00", strokeWidth: 2 },
        ["__proto__"]: { stroke: "#000" },
      },
    };

    const decoded = decodeSceneDocument(input);
    expect(decoded).toEqual(input);
    expect(Object.is(decoded.width, -0)).toBe(true);
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(decoded.meta)).toBe(Object.prototype);
    expect(decoded.meta).not.toBe(input.meta);
    expect(decoded.geometry).not.toBe(input.geometry);
  });

  it("uses the narrow Inline grammar under TextOnPath", () => {
    const valid = {
      type: "TextOnPath",
      d: "M0 0",
      width: 10,
      height: 10,
      font: "F",
      fontSizePx: 10,
      children: [
        "a",
        {
          type: "Inline",
          fontWeight: 700,
          children: [{ type: "Inline", color: "#f00", children: ["b"] }],
        },
      ],
    };
    expect(decodeSceneDocument(valid)).toEqual(valid);

    const error = captureFatal(() =>
      decodeSceneDocument({
        ...valid,
        children: [{ type: "Inline", background: "#000", children: [] }],
      }),
    );
    expect(error.code).toBe("SCENE_DECODE_UNKNOWN_KEY");
    expect(error.context).toEqual({
      key: "background",
      path: "/children/0/background",
    });
  });

  it("preserves source key order while producing writable detached containers", () => {
    const input = Object.freeze({
      height: 20,
      type: "Canvas",
      children: Object.freeze([]),
      width: 10,
    });
    const decoded = decodeSceneDocument(input);
    expect(Object.keys(decoded)).toEqual(["height", "type", "children", "width"]);
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(input));
    expect(Object.isFrozen(decoded)).toBe(false);
    expect(Object.isFrozen(decoded.children)).toBe(false);
    decoded.width = 30;
    expect(decoded.width).toBe(30);
  });

  it("expands shared acyclic occurrences without preserving aliases", () => {
    const shared = { type: "Box", children: [] };
    const input = { type: "Canvas", width: 1, height: 1, children: [shared, shared] };
    const decoded = decodeSceneDocument(input);
    expect(decoded.type).toBe("Canvas");
    if (decoded.type !== "Canvas") {
      throw new Error("Expected Canvas");
    }
    expect(decoded.children[0]).toEqual(decoded.children[1]);
    expect(decoded.children[0]).not.toBe(decoded.children[1]);
  });

  it("does not invoke getters, ordinary gets, or toJSON", () => {
    let getterCalls = 0;
    let getCalls = 0;
    let toJsonCalls = 0;
    const target = {
      type: "Canvas",
      width: 1,
      height: 1,
      children: [],
      toJSON() {
        toJsonCalls += 1;
        return {};
      },
    };
    Object.defineProperty(target, "width", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    const proxy = new Proxy(target, {
      get() {
        getCalls += 1;
        throw new Error("ordinary get must not run");
      },
    });

    const error = captureFatal(() => decodeSceneDocument(proxy));
    expect(error.code).toBe("SCENE_DECODE_UNSAFE_VALUE");
    expect(error.context).toEqual({ path: "/width", reason: "accessor-property" });
    expect(getterCalls).toBe(0);
    expect(getCalls).toBe(0);
    expect(toJsonCalls).toBe(0);
  });

  it("uses descriptor values when a Proxy ordinary get disagrees", () => {
    let getCalls = 0;
    const proxy = new Proxy(
      { type: "Canvas", width: 10, height: 20, children: [] },
      {
        get() {
          getCalls += 1;
          throw new Error("ordinary get must not run");
        },
      },
    );
    expect(decodeSceneDocument(proxy)).toEqual({
      type: "Canvas",
      width: 10,
      height: 20,
      children: [],
    });
    expect(getCalls).toBe(0);
  });

  it("rejects cycles with both bounded occurrence paths", () => {
    const input: { type: "Box"; children: unknown[] } = { type: "Box", children: [] };
    input.children.push(input);
    const error = captureFatal(() => decodeSceneDocument(input));
    expect(error.code).toBe("SCENE_DECODE_CYCLE");
    expect(error.message).toBe("Scene document contains a cycle.");
    expect(error.stage).toBe("validate");
    expect(error.nodeId).toBeUndefined();
    expect(error.context).toEqual({ path: "/children/0", firstPath: "" });
  });

  it("reports stable structural error contracts", () => {
    const cases = [
      {
        input: null,
        code: "SCENE_DECODE_INVALID_VALUE",
        message: "Scene document contains a value with an invalid structural type.",
        context: { path: "", expected: "scene-node", actual: "null" },
      },
      {
        input: { type: "Canvas", width: 1, height: 1 },
        code: "SCENE_DECODE_MISSING_FIELD",
        message: "Scene document is missing a required field.",
        context: { path: "/children", field: "children" },
      },
      {
        input: { type: "Unknown" },
        code: "SCENE_DECODE_UNKNOWN_DISCRIMINANT",
        message: "Scene document contains an unknown discriminant.",
        context: { path: "/type", discriminant: "type", received: "Unknown" },
      },
      {
        input: { type: "Box", children: [], version: 1 },
        code: "SCENE_DECODE_UNKNOWN_KEY",
        message: "Scene document contains an unsupported key.",
        context: { path: "/version", key: "version" },
      },
      {
        input: { type: "Canvas", width: Number.NaN, height: 1, children: [] },
        code: "SCENE_DECODE_UNSAFE_VALUE",
        message: "Scene document contains a value that is not a safe JSON data value.",
        context: { path: "/width", reason: "non-finite-number" },
      },
    ] as const;
    for (const expected of cases) {
      const error = captureFatal(() => decodeSceneDocument(expected.input));
      expect(error.code).toBe(expected.code);
      expect(error.message).toBe(expected.message);
      expect(error.stage).toBe("validate");
      expect(error.nodeId).toBeUndefined();
      expect(error.context).toEqual(expected.context);
    }
  });

  it("uses RFC 6901 paths and bounds copied keys and paths", () => {
    const longKey = `${"😀".repeat(25)}tail`;
    const input = {
      type: "Canvas",
      width: 1,
      height: 1,
      children: [],
      [longKey]: true,
    };
    const error = captureFatal(() => decodeSceneDocument(input));
    expect(error.code).toBe("SCENE_DECODE_UNKNOWN_KEY");
    expect(error.context?.key).toBe("😀".repeat(24));
    expect(error.context?.keyTruncated).toBe(true);

    const escaped = captureFatal(() =>
      decodeSceneDocument({
        type: "Canvas",
        width: 1,
        height: 1,
        children: [],
        "a~/b": true,
      }),
    );
    expect(escaped.context).toEqual({ path: "/a~0~1b", key: "a~/b" });
  });

  it("rejects unsafe record and array shapes without reading values", () => {
    const symbol = Symbol("private");
    const withSymbol = { type: "Box", children: [], [symbol]: "secret" };
    const symbolError = captureFatal(() => decodeSceneDocument(withSymbol));
    expect(symbolError.context).toEqual({ path: "", reason: "symbol-key" });

    const customPrototype = Object.create({ inherited: true }) as Record<string, unknown>;
    Object.assign(customPrototype, { type: "Box", children: [] });
    const prototypeError = captureFatal(() => decodeSceneDocument(customPrototype));
    expect(prototypeError.context).toEqual({ path: "", reason: "unsupported-prototype" });

    const sparse = new Array(1);
    const sparseError = captureFatal(() => decodeSceneDocument({ type: "Box", children: sparse }));
    expect(sparseError.context).toEqual({ path: "/children/0", reason: "sparse-array" });

    const extra: unknown[] = [];
    Object.defineProperty(extra, "extra", { value: true, enumerable: true, configurable: true });
    const extraError = captureFatal(() => decodeSceneDocument({ type: "Box", children: extra }));
    expect(extraError.context).toEqual({ path: "/children/extra", reason: "array-extra-key" });
  });

  it("counts compact JSON bytes exactly at the public ceiling", () => {
    const prefix = '{"type":"Svg","content":"';
    const suffix = '","width":1,"height":1}';
    const content = "a".repeat(MAX_SCENE_DECODE_JSON_BYTES - prefix.length - suffix.length);
    const exact = { type: "Svg", content, width: 1, height: 1 };
    expect(JSON.stringify(exact).length).toBe(MAX_SCENE_DECODE_JSON_BYTES);
    expect(decodeSceneDocument(exact)).toEqual(exact);

    const error = captureFatal(() => decodeSceneDocument({ ...exact, content: `${content}a` }));
    expect(error.code).toBe("SCENE_DECODE_RESOURCE_LIMIT");
    expect(error.message).toBe("Scene document exceeds a decode resource limit.");
    expect(error.context).toEqual({
      path: "/height",
      resource: "json-bytes",
      actual: MAX_SCENE_DECODE_JSON_BYTES + 1,
      limit: MAX_SCENE_DECODE_JSON_BYTES,
    });
  }, 15_000);
});
