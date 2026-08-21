import { describe, expect, it } from "vitest";
import { generateNodeId } from "../../src/ir/node-id.js";
import { assertUniqueNodeIds, validateNodeIds } from "../../src/node-ids.js";
import { createElement } from "../../src/vnode/create-element.js";

describe("generateNodeId", () => {
  it("uses explicit id from props", () => {
    const node = createElement("Box", { id: "header", width: 100, height: 100 });
    expect(generateNodeId(node, { depth: 1, siblingIndex: 0 })).toEqual({
      id: "header",
      authored: true,
    });
  });

  it("generates auto id for root node (no parent)", () => {
    const node = createElement("Box", { width: 100, height: 100 });
    expect(generateNodeId(node, { depth: 0, siblingIndex: 0 })).toEqual({
      id: "auto:0",
      authored: false,
    });
  });

  it("generates path-based id with parent", () => {
    const node = createElement("Box", { width: 100, height: 100 });
    expect(generateNodeId(node, { depth: 1, siblingIndex: 2, parentNodeId: "auto:0" })).toEqual({
      id: "auto:0.2",
      authored: false,
    });
  });

  it("generates nested path-based id", () => {
    const node = createElement("Box", { width: 100, height: 100 });
    expect(generateNodeId(node, { depth: 2, siblingIndex: 1, parentNodeId: "auto:0.2" })).toEqual({
      id: "auto:0.2.1",
      authored: false,
    });
  });

  it("generates auto id with key (no parent)", () => {
    const node = createElement("Box", { key: "item", width: 100, height: 100 });
    expect(generateNodeId(node, { depth: 0, siblingIndex: 0 })).toEqual({
      id: "auto:0:item",
      authored: false,
    });
  });

  it("generates auto id with key and parent", () => {
    const node = createElement("Box", { key: "item", width: 100, height: 100 });
    expect(generateNodeId(node, { depth: 1, siblingIndex: 0, parentNodeId: "auto:0" })).toEqual({
      id: "auto:0.0:item",
      authored: false,
    });
  });

  it("generates auto id with numeric key", () => {
    const node = createElement("Box", { key: 42, width: 100, height: 100 });
    expect(generateNodeId(node, { depth: 1, siblingIndex: 2, parentNodeId: "auto:0" })).toEqual({
      id: "auto:0.2:42",
      authored: false,
    });
  });

  it("prefers explicit id over key", () => {
    const node = createElement("Box", {
      id: "explicit",
      key: "key",
      width: 100,
      height: 100,
    });
    expect(generateNodeId(node, { depth: 0, siblingIndex: 0 })).toEqual({
      id: "explicit",
      authored: true,
    });
  });

  it("preserves an explicitly authored empty string without inferring provenance", () => {
    const node = createElement("Box", { id: "", width: 100, height: 100 });
    expect(generateNodeId(node, { depth: 0, siblingIndex: 0 })).toEqual({
      id: "",
      authored: true,
    });
  });

  it("accepts paired surrogates and rejects lone surrogates in authored or generated ids", () => {
    const emojiIdNode = createElement("Box", { id: "emoji-😀", width: 100, height: 100 });
    expect(generateNodeId(emojiIdNode, { depth: 0, siblingIndex: 0 })).toEqual({
      id: "emoji-😀",
      authored: true,
    });

    for (const invalidId of ["invalid-\uD800-id", "invalid-\uDC00-id"]) {
      const invalidIdNode = createElement("Box", { id: invalidId, width: 100, height: 100 });
      expect(() => generateNodeId(invalidIdNode, { depth: 0, siblingIndex: 0 })).toThrow(
        /well-formed Unicode scalar values/u,
      );
      const invalidKeyNode = createElement("Box", {
        key: invalidId,
        width: 100,
        height: 100,
      });
      expect(() => generateNodeId(invalidKeyNode, { depth: 0, siblingIndex: 0 })).toThrow(
        /well-formed Unicode scalar values/u,
      );
    }
  });

  it("sibling nodes in different parents get unique ids", () => {
    const child = createElement("Box", { width: 50, height: 50 });
    // Same siblingIndex=0 but different parent paths
    const { id: id1 } = generateNodeId(child, {
      depth: 2,
      siblingIndex: 0,
      parentNodeId: "auto:0.0",
    });
    const { id: id2 } = generateNodeId(child, {
      depth: 2,
      siblingIndex: 0,
      parentNodeId: "auto:0.1",
    });
    expect(id1).toBe("auto:0.0.0");
    expect(id2).toBe("auto:0.1.0");
    expect(id1).not.toBe(id2);
  });
});

describe("validateNodeIds", () => {
  it("reports explicit id collisions", () => {
    const tree = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Box", { id: "dup", width: 10, height: 10 }),
      createElement("Box", { id: "dup", width: 10, height: 10 }),
    );

    const result = validateNodeIds(tree);

    expect(result.valid).toBe(false);
    expect(result.duplicates[0]?.id).toBe("dup");
  });

  it("reports explicit id collisions with auto ids", () => {
    const tree = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Box", { id: "auto:0", width: 10, height: 10 }),
    );

    const result = validateNodeIds(tree);

    expect(result.valid).toBe(false);
    expect(result.duplicates[0]?.id).toBe("auto:0");
    expect(result.duplicates[0]?.entries.map((entry) => entry.source)).toEqual([
      "auto",
      "explicit",
    ]);
  });

  it("reports explicit id collisions with generated background ids", () => {
    const tree = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Box", { id: "card", width: 10, height: 10, background: "#ffffff" }),
      createElement("Box", { id: "card:bg", width: 10, height: 10 }),
    );

    const result = validateNodeIds(tree);

    expect(result.valid).toBe(false);
    expect(result.duplicates[0]?.id).toBe("card:bg");
    expect(result.duplicates[0]?.entries.map((entry) => entry.source)).toEqual([
      "background",
      "explicit",
    ]);
  });

  it("reports explicit id collisions with generated border ids", () => {
    const tree = createElement(
      "Canvas",
      { width: 100, height: 100 },
      createElement("Box", {
        id: "card",
        width: 10,
        height: 10,
        borderWidth: 1,
        borderColor: "#000000",
      }),
      createElement("Box", { id: "card:border", width: 10, height: 10 }),
    );

    expect(() => assertUniqueNodeIds(tree)).toThrow('node id "card:border" collides');
  });
});
