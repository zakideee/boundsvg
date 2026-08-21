import { Box } from "@boundsvg/core";
import { describe, expect, it } from "vitest";
import {
  Center,
  FitText,
  Frame,
  HStack,
  ImageCover,
  Inset,
  Spacer,
  TextBox,
  VStack,
} from "../src/index.js";

describe("@boundsvg/extras", () => {
  it("creates unstyled layout helper VNodes", () => {
    expect(HStack({ gap: 8 }).props.direction).toBe("row");
    expect(VStack({ gap: 8 }).props.direction).toBe("column");
    expect(Center({ width: 100 }).props.alignItems).toBe("center");
  });

  it("creates text and image helper VNodes", () => {
    expect(FitText({ font: "Test", fontSizePx: 16 }, "hello").props.fit).toBe("shrink");
    expect(
      ImageCover({ src: "data:image/png;base64,", width: 10, height: 10 }).props.objectFit,
    ).toBe("cover");
  });

  it("forwards text fit convergence controls through both text helpers", () => {
    const controls = {
      shrinkEpsilonPx: 0.1,
      shrinkMaxIterations: 7,
      growEpsilonPx: 0.2,
      growMaxIterations: 9,
    } as const;

    const fitText = FitText({ font: "Test", fontSizePx: 16, ...controls }, "fit");
    expect(fitText.props).toMatchObject({ fit: "shrink", ...controls });

    const textBox = TextBox(
      { font: "Test", fontSizePx: 16, width: 120, height: 40, ...controls },
      "box",
    );
    expect(textBox.props).toMatchObject({ preferredFrame: { w: 120, h: 40 }, ...controls });
  });

  it("creates Spacer with authored Box props and no children", () => {
    const spacer = Spacer({ width: 13, height: 17, backgroundColor: "#123456" });

    expect(spacer.type).toBe("Box");
    expect(spacer.props).toEqual({ width: 13, height: 17, backgroundColor: "#123456" });
    expect(spacer.children).toEqual([]);
  });

  it("maps Inset inset to padding while preserving props and children", () => {
    const child = Box({ id: "inset-child", width: 5 });
    const inset = Inset({ id: "inset", inset: [1, 2, 3, 4], height: 20 }, child);

    expect(inset.type).toBe("Box");
    expect(inset.props).toEqual({ id: "inset", padding: [1, 2, 3, 4], height: 20 });
    expect(inset.children).toEqual([child]);
  });

  it("passes Frame props and children through to Box", () => {
    const child = Box({ id: "frame-child", height: 7 });
    const frame = Frame({ id: "frame", width: 30, borderWidth: 2 }, child);

    expect(frame.type).toBe("Box");
    expect(frame.props).toEqual({ id: "frame", width: 30, borderWidth: 2 });
    expect(frame.children).toEqual([child]);
  });
});
