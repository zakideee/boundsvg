import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import {
  decodeSceneDocument,
  MAX_SCENE_DECODE_COLLECTION_LENGTH,
  MAX_SCENE_DECODE_DEPTH,
  MAX_SCENE_DECODE_JSON_BYTES,
  MAX_SCENE_DECODE_NODES,
  MAX_SCENE_DECODE_VALUES,
} from "../../src/scene/decoder.js";

function captureResourceError(input: unknown): FatalError {
  try {
    decodeSceneDocument(input);
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    expect(error).toMatchObject({
      code: "SCENE_DECODE_RESOURCE_LIMIT",
      message: "Scene document exceeds a decode resource limit.",
      stage: "validate",
      nodeId: undefined,
    });
    return error as FatalError;
  }
  throw new Error("Expected a resource limit error");
}

function geometryChain(transformCount: number): unknown {
  let geometry: unknown = { kind: "path", d: "M0 0" };
  for (let index = 0; index < transformCount; index += 1) {
    geometry = { kind: "transform", transform: {}, child: geometry };
  }
  return {
    type: "Shape",
    width: 1,
    height: 1,
    geometry: { viewBox: { width: 1, height: 1 }, root: geometry },
  };
}

function textChildren(length: number): unknown {
  return {
    type: "Text",
    font: "F",
    fontSizePx: 1,
    children: Array.from({ length }, () => ""),
  };
}

function boxNodes(childCount: number): unknown {
  return {
    type: "Box",
    children: Array.from({ length: childCount }, () => ({ type: "Box", children: [] })),
  };
}

function decodedValues(extraFieldCount: number): unknown {
  const partPaint: Record<string, Record<string, string | number>> = {};
  for (let index = 0; index < MAX_SCENE_DECODE_COLLECTION_LENGTH - 2; index += 1) {
    partPaint[`part-${index}`] = {
      fill: "#000",
      stroke: "#fff",
      strokeWidth: 1,
      ...(index < extraFieldCount ? { strokeLinecap: "round" } : {}),
    };
  }
  return { type: "Shape", width: 1, height: 1, partPaint };
}

function sizedSvg(jsonBytes: number): unknown {
  const prefix = '{"type":"Svg","content":"';
  const suffix = '","width":1,"height":1}';
  return {
    type: "Svg",
    content: "a".repeat(jsonBytes - prefix.length - suffix.length),
    width: 1,
    height: 1,
  };
}

describe("Scene decode resource limits", () => {
  it("accepts the depth boundary and rejects the next container edge", () => {
    expect(decodeSceneDocument(geometryChain(MAX_SCENE_DECODE_DEPTH - 3))).toBeDefined();
    expect(decodeSceneDocument(geometryChain(MAX_SCENE_DECODE_DEPTH - 2))).toBeDefined();
    const error = captureResourceError(geometryChain(MAX_SCENE_DECODE_DEPTH - 1));
    expect(error.context).toEqual({
      path: expect.any(String),
      resource: "depth",
      actual: MAX_SCENE_DECODE_DEPTH + 1,
      limit: MAX_SCENE_DECODE_DEPTH,
      pathTruncated: true,
    });
  });

  it("accepts the collection boundary and rejects its first excess entry", () => {
    expect(decodeSceneDocument(textChildren(MAX_SCENE_DECODE_COLLECTION_LENGTH - 1))).toBeDefined();
    expect(decodeSceneDocument(textChildren(MAX_SCENE_DECODE_COLLECTION_LENGTH))).toBeDefined();
    const error = captureResourceError(textChildren(MAX_SCENE_DECODE_COLLECTION_LENGTH + 1));
    expect(error.context).toEqual({
      path: "/children",
      resource: "collection-length",
      actual: MAX_SCENE_DECODE_COLLECTION_LENGTH + 1,
      limit: MAX_SCENE_DECODE_COLLECTION_LENGTH,
    });
  });

  it("counts every expanded scene node occurrence", () => {
    expect(decodeSceneDocument(boxNodes(MAX_SCENE_DECODE_NODES - 2))).toBeDefined();
    expect(decodeSceneDocument(boxNodes(MAX_SCENE_DECODE_NODES - 1))).toBeDefined();
    const error = captureResourceError(boxNodes(MAX_SCENE_DECODE_NODES));
    expect(error.context).toEqual({
      path: `/children/${MAX_SCENE_DECODE_NODES - 1}`,
      resource: "scene-nodes",
      actual: MAX_SCENE_DECODE_NODES + 1,
      limit: MAX_SCENE_DECODE_NODES,
    });
  }, 15_000);

  it("counts every admitted output value occurrence", () => {
    expect(decodeSceneDocument(decodedValues(2))).toBeDefined();
    expect(decodeSceneDocument(decodedValues(3))).toBeDefined();
    const error = captureResourceError(decodedValues(4));
    expect(error.context).toEqual({
      path: expect.stringMatching(/^\/partPaint\/part-/),
      resource: "values",
      actual: MAX_SCENE_DECODE_VALUES + 1,
      limit: MAX_SCENE_DECODE_VALUES,
    });
  });

  it("accepts exact compact JSON bytes and rejects the next byte", () => {
    for (const bytes of [MAX_SCENE_DECODE_JSON_BYTES - 1, MAX_SCENE_DECODE_JSON_BYTES]) {
      const input = sizedSvg(bytes);
      expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBe(bytes);
      expect(decodeSceneDocument(input)).toEqual(input);
    }
    const error = captureResourceError(sizedSvg(MAX_SCENE_DECODE_JSON_BYTES + 1));
    expect(error.context).toEqual({
      path: "/height",
      resource: "json-bytes",
      actual: MAX_SCENE_DECODE_JSON_BYTES + 1,
      limit: MAX_SCENE_DECODE_JSON_BYTES,
    });
  });
});
