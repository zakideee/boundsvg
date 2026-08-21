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
    expect(result.scene.type).toBe("Canvas");
  });

  it("returns invalid JSON error for malformed input", () => {
    expect(parseSceneInput("{")).toEqual({
      ok: false,
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
    expect(result.message).toContain("Invalid SceneDocument:");
  });
});
