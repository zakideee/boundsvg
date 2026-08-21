import { describe, expect, it } from "vitest";
import { mapToLayoutStyle } from "../../src/layout/taffy-style-mapper.js";
import { createElement } from "../../src/vnode/create-element.js";

describe("mapToLayoutStyle", () => {
  describe("Canvas", () => {
    it("maps width and height as fixed size", () => {
      const node = createElement("Canvas", { width: 1280, height: 720 });
      const style = mapToLayoutStyle(node);
      expect(style.size).toEqual({ width: 1280, height: 720 });
    });
  });

  describe("Flex", () => {
    it("maps direction=row", () => {
      const node = createElement("Flex", { direction: "row" });
      const style = mapToLayoutStyle(node);
      expect(style.flexDirection).toBe("row");
    });

    it("defaults direction to column", () => {
      const node = createElement("Flex", {});
      const style = mapToLayoutStyle(node);
      expect(style.flexDirection).toBe("column");
    });

    it("maps alignItems start → flex-start", () => {
      const node = createElement("Flex", { alignItems: "start" });
      const style = mapToLayoutStyle(node);
      expect(style.alignItems).toBe("flex-start");
    });

    it("maps justifyContent space-between", () => {
      const node = createElement("Flex", { justifyContent: "space-between" });
      const style = mapToLayoutStyle(node);
      expect(style.justifyContent).toBe("space-between");
    });

    it("maps gap to row/column gap", () => {
      const node = createElement("Flex", { gap: 10 });
      const style = mapToLayoutStyle(node);
      expect(style.gap).toEqual({
        top: 10,
        right: 10,
        bottom: 10,
        left: 10,
      });
    });

    it("maps rowGap/columnGap overriding gap", () => {
      const node = createElement("Flex", {
        gap: 10,
        rowGap: 20,
        columnGap: 5,
      });
      const style = mapToLayoutStyle(node);
      expect(style.gap.top).toBe(20);
      expect(style.gap.right).toBe(5);
    });

    it("maps flex item props", () => {
      const node = createElement("Flex", {
        flexGrow: 1,
        flexShrink: 0,
        flexBasis: 200,
        alignSelf: "center",
      });
      const style = mapToLayoutStyle(node);
      expect(style.flexGrow).toBe(1);
      expect(style.flexShrink).toBe(0);
      expect(style.flexBasis).toBe(200);
      expect(style.alignSelf).toBe("center");
    });

    it("maps overflow=clip to hidden", () => {
      const node = createElement("Flex", { overflow: "clip" });
      const style = mapToLayoutStyle(node);
      expect(style.overflow).toBe("hidden");
    });
  });

  describe("Box", () => {
    it("defaults to direction=column", () => {
      const node = createElement("Box", { width: 100, height: 100 });
      const style = mapToLayoutStyle(node);
      expect(style.flexDirection).toBe("column");
    });

    it("maps size, min, max", () => {
      const node = createElement("Box", {
        width: 100,
        height: 200,
        minWidth: 50,
        maxHeight: 300,
      });
      const style = mapToLayoutStyle(node);
      expect(style.size).toEqual({ width: 100, height: 200 });
      expect(style.minSize).toEqual({ width: 50, height: null });
      expect(style.maxSize).toEqual({ width: null, height: 300 });
    });
  });

  describe("padding / margin", () => {
    it("maps uniform number padding", () => {
      const node = createElement("Box", { padding: 10 });
      const style = mapToLayoutStyle(node);
      expect(style.padding).toEqual({
        top: 10,
        right: 10,
        bottom: 10,
        left: 10,
      });
    });

    it("maps 4-tuple padding", () => {
      const node = createElement("Box", { padding: [10, 20, 30, 40] });
      const style = mapToLayoutStyle(node);
      expect(style.padding).toEqual({
        top: 10,
        right: 20,
        bottom: 30,
        left: 40,
      });
    });

    it("maps uniform margin on Text", () => {
      const node = createElement("Text", {
        font: "Arial",
        fontSizePx: 16,
        margin: 5,
      });
      const style = mapToLayoutStyle(node);
      expect(style.margin).toEqual({ top: 5, right: 5, bottom: 5, left: 5 });
    });
  });

  describe("Text", () => {
    it("maps size props", () => {
      const node = createElement("Text", {
        font: "Arial",
        fontSizePx: 16,
        width: 300,
        height: 40,
        minWidth: 120,
        maxHeight: 80,
      });
      const style = mapToLayoutStyle(node);
      expect(style.size).toEqual({ width: 300, height: 40 });
      expect(style.minSize).toEqual({ width: 120, height: null });
      expect(style.maxSize).toEqual({ width: null, height: 80 });
    });

    it("maps flex item props", () => {
      const node = createElement("Text", {
        font: "Arial",
        fontSizePx: 16,
        flexGrow: 1,
        alignSelf: "end",
      });
      const style = mapToLayoutStyle(node);
      expect(style.flexGrow).toBe(1);
      expect(style.alignSelf).toBe("flex-end");
    });
  });

  describe("Image", () => {
    it("maps fixed dimensions", () => {
      const node = createElement("Image", {
        src: new Uint8Array([]),
        width: 200,
        height: 150,
      });
      const style = mapToLayoutStyle(node);
      expect(style.size).toEqual({ width: 200, height: 150 });
    });
  });

  describe("Grid", () => {
    it("sets display=grid and templateColumns", () => {
      const node = createElement("Grid", { templateColumns: "1fr 2fr 1fr" });
      const style = mapToLayoutStyle(node);
      expect(style.display).toBe("grid");
      expect(style.gridTemplateColumns).toEqual(["1fr", "2fr", "1fr"]);
    });

    it("maps templateRows", () => {
      const node = createElement("Grid", { templateRows: "100 200" });
      const style = mapToLayoutStyle(node);
      expect(style.gridTemplateRows).toEqual(["100", "200"]);
    });

    it("maps gridColumn shorthand for children", () => {
      const node = createElement("Grid", { gridColumn: "1 / 3" });
      const style = mapToLayoutStyle(node);
      expect(style.gridColumnStart).toBe(1);
      expect(style.gridColumnEnd).toBe(3);
    });

    it("maps gridColumn with span syntax", () => {
      const node = createElement("Grid", { gridColumn: "2 / span 2" });
      const style = mapToLayoutStyle(node);
      expect(style.gridColumnStart).toBe(2);
      expect(style.gridColumnEnd).toBe(4);
    });

    it("maps gridRow shorthand", () => {
      const node = createElement("Grid", { gridRow: "1 / 2" });
      const style = mapToLayoutStyle(node);
      expect(style.gridRowStart).toBe(1);
      expect(style.gridRowEnd).toBe(2);
    });

    it("maps gridColumn start-only (no end)", () => {
      const node = createElement("Grid", { gridColumn: "2" });
      const style = mapToLayoutStyle(node);
      expect(style.gridColumnStart).toBe(2);
      expect(style.gridColumnEnd).toBeUndefined();
    });
  });

  describe("positioning", () => {
    it("maps position=absolute", () => {
      const node = createElement("Box", { position: "absolute", width: 50, height: 50 });
      const style = mapToLayoutStyle(node);
      expect(style.position).toBe("absolute");
    });

    it("maps inset values", () => {
      const node = createElement("Box", { top: 10, right: 20, bottom: 30, left: 40 });
      const style = mapToLayoutStyle(node);
      expect(style.inset).toEqual({ top: 10, right: 20, bottom: 30, left: 40 });
    });

    it("maps aspectRatio", () => {
      const node = createElement("Box", { aspectRatio: 1.5 });
      const style = mapToLayoutStyle(node);
      expect(style.aspectRatio).toBe(1.5);
    });
  });
});
