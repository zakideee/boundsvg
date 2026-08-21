import { describe, expect, it } from "vitest";
import { Box, Canvas, Text, TextOnPath } from "../../src/vnode/components.js";
import {
  cloneVNode,
  collectTextNodes,
  findVNodeById,
  replaceTextById,
  walkVNode,
  withNodeIdPrefix,
} from "../../src/vnode-utils.js";

describe("VNode utilities", () => {
  const vnode = Canvas(
    { width: 320, height: 120, id: "root" },
    Box(
      { id: "frame", width: 320, height: 120 },
      Text({ id: "title", font: "TestFont", fontSizePx: 24 }, "Original"),
    ),
  );

  it("walks, finds, and collects nodes", () => {
    const ids: string[] = [];
    walkVNode(vnode, ({ node }) => {
      const id = "id" in node.props ? node.props.id : undefined;
      if (typeof id === "string") {
        ids.push(id);
      }
    });

    expect(ids).toEqual(["root", "frame", "title"]);
    expect(findVNodeById(vnode, "frame")?.type).toBe("Box");
    expect(collectTextNodes(vnode)).toHaveLength(1);
  });

  it("clones and transforms without mutating the original tree", () => {
    const cloned = cloneVNode(vnode);
    const replaced = replaceTextById(cloned, "title", "Next");
    const prefixed = withNodeIdPrefix(replaced, "asset:");

    expect(cloned).not.toBe(vnode);
    expect(collectTextNodes(vnode)[0]?.node.children).toEqual(["Original"]);
    expect(collectTextNodes(replaced)[0]?.node.children).toEqual(["Next"]);
    expect(findVNodeById(prefixed, "asset:title")?.type).toBe("Text");
  });

  it("collects and replaces dedicated TextOnPath leaves", () => {
    const pathScene = Canvas(
      { width: 200, height: 60 },
      TextOnPath(
        { d: "M0 20L200 20", width: 200, height: 60, font: "TestFont", fontSizePx: 18, id: "arc" },
        "Original path",
      ),
    );
    expect(collectTextNodes(pathScene).map(({ node }) => node.type)).toEqual(["TextOnPath"]);
    expect(
      collectTextNodes(replaceTextById(pathScene, "arc", "Next path"))[0]?.node.children,
    ).toEqual(["Next path"]);
  });
});
