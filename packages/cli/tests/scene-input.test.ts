import { FatalError } from "@boundsvg/core";
import { describe, expect, it } from "vitest";
import { parseSceneInput } from "../src/scene-input.js";

describe("parseSceneInput", () => {
  it("parses valid SceneDocument JSON", () => {
    const result = parseSceneInput(
      JSON.stringify({
        type: "Canvas",
        width: 320,
        height: 180,
        children: [],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.vnode).toEqual({
      type: "Canvas",
      props: { width: 320, height: 180 },
      children: [],
    });
  });

  it("returns invalid JSON error for malformed input", () => {
    expect(parseSceneInput("{")).toEqual({
      ok: false,
      kind: "syntax",
      message: "Invalid JSON in input",
    });
  });

  it("returns invalid scene error for non-SceneNode JSON", () => {
    const result = parseSceneInput(
      JSON.stringify({
        type: "Canvas",
        width: 320,
        height: 180,
        children: [
          {
            type: "Text",
            font: "NotoSansJP",
            fontSizePx: 24,
            children: [{ type: "Canvas", width: 10, height: 10, children: [] }],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.kind).toBe("scene");
    if (result.kind !== "scene") {
      return;
    }
    expect(result.error).toBeInstanceOf(FatalError);
    expect(result.error).toMatchObject({
      code: "SCENE_DECODE_INVALID_VALUE",
      message: "Scene document contains a value with an invalid structural type.",
      stage: "validate",
      context: {
        path: "/children/0/children/0",
        expected: "text-child",
        actual: "record",
      },
    });
  });
});
