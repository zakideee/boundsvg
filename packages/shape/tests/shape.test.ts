import { describe, expect, it } from "vitest";
import {
  booleanGeometry,
  geometryDoc,
  groupGeometry,
  pathGeometry,
  symbolDefinition,
  transformGeometry,
} from "../src/index.js";

describe("@boundsvg/shape", () => {
  it("builds geometry docs from low-level helpers", () => {
    const root = groupGeometry([
      pathGeometry("M0 0H10V10Z", { nodeId: "base" }),
      transformGeometry({ translateX: 10 }, pathGeometry("M0 0H10V10Z"), { nodeId: "shifted" }),
    ]);
    const doc = geometryDoc({ width: 20, height: 10 }, root);
    expect(doc.viewBox.width).toBe(20);
    expect(doc.root.kind).toBe("group");
  });

  it("omits optional keys that were not provided", () => {
    const path = pathGeometry("M0 0H10V10Z");
    expect("nodeId" in path).toBe(false);
    expect("fillRule" in path).toBe(false);
    expect("nodeId" in groupGeometry([path])).toBe(false);
    expect("nodeId" in transformGeometry({ translateX: 1 }, path)).toBe(false);
    expect("nodeId" in booleanGeometry("union", [path, path])).toBe(false);
  });

  it("represents boolean geometry nodes declaratively", () => {
    const doc = geometryDoc(
      { width: 24, height: 24 },
      booleanGeometry("xor", [pathGeometry("M0 0H24V24Z"), pathGeometry("M8 8H16V16Z")]),
    );
    expect(doc.root.kind).toBe("boolean");
    if (doc.root.kind === "boolean") {
      expect(doc.root.op).toBe("xor");
    }
  });

  it("preserves symbol metadata for elastic segments", () => {
    const symbol = symbolDefinition({
      geometry: geometryDoc({ width: 100, height: 20 }, pathGeometry("M0 8H100V12H0Z")),
      elasticSegments: [
        {
          nodeId: "shaft",
          axis: "x",
          role: "stretch",
          frame: { x: 20, y: 0, width: 60, height: 20 },
        },
      ],
    });
    expect(symbol.geometry.viewBox.width).toBe(100);
    expect(symbol.elasticSegments?.[0]?.role).toBe("stretch");
  });
});
