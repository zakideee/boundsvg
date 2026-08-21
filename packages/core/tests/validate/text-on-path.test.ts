import { describe, expect, it } from "vitest";
import { FatalError } from "../../src/errors.js";
import {
  MAX_TEXT_PATH_INLINE_CONTAINERS,
  MAX_TEXT_PATH_PAINTED_LAYERS,
  MAX_TEXT_PATH_SOURCE_ITEMS,
} from "../../src/text/types.js";
import { validate } from "../../src/validate/index.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";

const VALID_PROPS = {
  d: "M0 20L200 20",
  width: 200,
  height: 40,
  font: "F",
  fontSizePx: 16,
} as const;

function textOnPath(text = "path text"): VNode {
  return createElement("TextOnPath", VALID_PROPS, text);
}

function withProps(overrides: Record<string, unknown>): VNode {
  const vnode = textOnPath();
  return { ...vnode, props: { ...vnode.props, ...overrides } } as unknown as VNode;
}

function withChildren(children: Array<VNode | string>): VNode {
  return { ...textOnPath(), children } as unknown as VNode;
}

function withPropsAndChildren(
  props: Record<string, unknown>,
  children: Array<VNode | string>,
): VNode {
  const vnode = textOnPath();
  return { ...vnode, props: { ...vnode.props, ...props }, children } as unknown as VNode;
}

function validateTextOnPath(vnode: VNode): void {
  validate(createElement("Canvas", { width: 240, height: 80 }, vnode));
}

function expectCode(run: () => void, code: string): void {
  try {
    run();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    expect((error as FatalError).code).toBe(code);
  }
}

describe("TextOnPath validation", () => {
  it("accepts adjacent strings and preserves leading/trailing spaces", () => {
    expect(() =>
      validateTextOnPath(createElement("TextOnPath", VALID_PROPS, " leading", " and trailing ")),
    ).not.toThrow();
  });

  it("accepts every path fitting and overflow mode", () => {
    for (const pathFit of ["none", "spacing", "scale", "shrink"] as const) {
      expect(() => validateTextOnPath(withProps({ pathFit }))).not.toThrow();
    }
    for (const pathOverflow of ["hidden", "error", "ellipsis"] as const) {
      expect(() => validateTextOnPath(withProps({ pathOverflow }))).not.toThrow();
    }
  });

  it.each([
    ["width", 0],
    ["height", Number.POSITIVE_INFINITY],
    ["fontSizePx", Number.NaN],
    ["startOffsetPx", Number.NEGATIVE_INFINITY],
    ["pathOffsetPx", Number.NaN],
    ["pathOffsetPx", -1],
  ])("rejects invalid numeric %s", (key, value) => {
    expectCode(() => validateTextOnPath(withProps({ [key]: value })), "TEXT_PATH_INVALID");
  });

  it.each(["\n", "\r", "\t", "\u2028", "\u2029"])("rejects multiline control %j", (separator) => {
    expectCode(
      () => validateTextOnPath(textOnPath(`before${separator}after`)),
      "TEXT_PATH_MULTILINE_UNSUPPORTED",
    );
  });

  it("accepts recursive shaping and paint Inline content, including explicit effect clears", () => {
    expect(() =>
      validateTextOnPath(
        createElement(
          "TextOnPath",
          VALID_PROPS,
          "plain",
          createElement(
            "Inline",
            {
              font: "Fallback",
              fallback: ["F"],
              fontWeight: 700,
              fontStyle: "italic",
              fontVariationSettings: '"wght" 650',
              fontFeatureSettings: '"liga" 0',
              fontSizePx: 18,
              letterSpacingPx: 1,
              language: "en",
              color: "#f00",
              textStrokes: [{ color: "#fff", widthPx: 2 }],
              textShadows: [{ dx: 1, dy: 2, blurPx: 3, color: "#00000088" }],
            },
            "rich",
            createElement(
              "Inline",
              { fontWeight: 400, textStrokes: [], textShadows: [] },
              "nested",
            ),
          ),
          createElement("Inline", { fontWeight: 900 }, ""),
        ),
      ),
    ).not.toThrow();
  });

  it("rejects empty content and unsupported children while accepting Inline decoration stops", () => {
    expectCode(() => validateTextOnPath(withChildren([])), "TEXT_PATH_EMPTY_TEXT");
    expectCode(
      () => validateTextOnPath(withChildren([createElement("InlineBox", {}, "box")])),
      "TEXT_PATH_CHILD_UNSUPPORTED",
    );
    expect(() =>
      validateTextOnPath(
        withChildren([createElement("Inline", { textDecoration: "none" }, "paint")]),
      ),
    ).not.toThrow();
  });

  it("validates Inline stroke and shadow layers", () => {
    const tooManyStrokes = Array.from({ length: 9 }, () => ({ color: "#000", widthPx: 1 }));
    expectCode(
      () =>
        validateTextOnPath(
          withChildren([createElement("Inline", { textStrokes: tooManyStrokes }, "paint")]),
        ),
      "VALIDATION",
    );
    expectCode(
      () =>
        validateTextOnPath(
          withChildren([
            createElement(
              "Inline",
              { textShadows: [{ dx: 0, dy: 0, blurPx: -1, color: "#000" }] },
              "paint",
            ),
          ]),
        ),
      "VALIDATION",
    );
  });

  it("enforces the aggregate painted layer limit", () => {
    const fullLayerCount = 1 + 8 + 8;
    const fullRangeCount = Math.floor(MAX_TEXT_PATH_PAINTED_LAYERS / fullLayerCount);
    expect(MAX_TEXT_PATH_PAINTED_LAYERS % fullLayerCount).toBe(1);
    const strokes = Array.from({ length: 8 }, () => ({ color: "#0f0", widthPx: 1 }));
    const shadows = Array.from({ length: 8 }, () => ({ dx: 1, dy: 1, color: "#008" }));
    const layeredRanges = Array.from({ length: fullRangeCount }, (_, index) =>
      createElement(
        "Inline",
        {
          color: index % 2 === 0 ? "#000" : "#fff",
          textStrokes: strokes,
          textShadows: shadows,
        },
        "A",
      ),
    );
    layeredRanges.push(createElement("Inline", { color: "#123456" }, "A"));
    expect(() => validateTextOnPath(withChildren(layeredRanges))).not.toThrow();
    layeredRanges.push(createElement("Inline", { color: "#654321" }, "A"));
    expectCode(() => validateTextOnPath(withChildren(layeredRanges)), "TEXT_PATH_PAINT_LIMIT");
  });

  it("rejects authored primitive children before normalization", () => {
    for (const child of [42, true, null, undefined]) {
      expectCode(
        () => createElement("TextOnPath", VALID_PROPS, child as unknown as string),
        "TEXT_PATH_CHILD_UNSUPPORTED",
      );
      expectCode(
        () =>
          createElement(
            "TextOnPath",
            VALID_PROPS,
            createElement("Inline", {}, createElement("Inline", {}, child)),
          ),
        "TEXT_PATH_CHILD_UNSUPPORTED",
      );
    }
  });

  it("enforces rich depth 48/49 and authored source item limits", () => {
    const nestedInline = (depth: number): VNode => {
      let child: VNode | string = "deep";
      for (let index = 0; index < depth; index += 1) {
        child = createElement("Inline", {}, child);
      }
      return child as VNode;
    };
    expect(() => validateTextOnPath(withChildren([nestedInline(48)]))).not.toThrow();
    expectCode(() => validateTextOnPath(withChildren([nestedInline(49)])), "RICH_TEXT_MAX_DEPTH");
    expect(() =>
      validateTextOnPath(
        withChildren([...Array.from({ length: MAX_TEXT_PATH_SOURCE_ITEMS - 1 }, () => ""), "x"]),
      ),
    ).not.toThrow();
    expectCode(
      () =>
        validateTextOnPath(
          withChildren(Array.from({ length: MAX_TEXT_PATH_SOURCE_ITEMS + 1 }, () => "")),
        ),
      "TEXT_PATH_SOURCE_LIMIT",
    );
  });

  it("accepts the Inline container boundary and rejects the next container", () => {
    const inlineContainers = (count: number): VNode[] =>
      Array.from({ length: count }, () => createElement("Inline", {}));

    expect(() =>
      validateTextOnPath(withChildren([...inlineContainers(MAX_TEXT_PATH_INLINE_CONTAINERS), "x"])),
    ).not.toThrow();
    expectCode(
      () =>
        validateTextOnPath(
          withChildren([...inlineContainers(MAX_TEXT_PATH_INLINE_CONTAINERS + 1), "x"]),
        ),
      "TEXT_PATH_INLINE_LIMIT",
    );
  });

  it("rejects writing-mode intersections and accepts curved decoration inputs", () => {
    expectCode(
      () => validateTextOnPath(withProps({ writingMode: "vertical-rl" })),
      "TEXT_PATH_WRITING_MODE_UNSUPPORTED",
    );
    expectCode(
      () => validateTextOnPath(withProps({ textOrientation: "upright" })),
      "TEXT_PATH_WRITING_MODE_UNSUPPORTED",
    );
    expect(() =>
      validateTextOnPath(
        withProps({
          textDecoration: {
            line: ["underline", "line-through"],
            style: "wavy",
            skipInk: "all",
          },
        }),
      ),
    ).not.toThrow();
    expectCode(
      () =>
        validateTextOnPath(
          withProps({
            textDecoration: { line: "underline" },
            animateUnits: {
              by: "cluster",
              animation: {
                keyframes: [
                  { at: 0, opacity: 0 },
                  { at: 1, opacity: 1 },
                ],
              },
            },
          }),
        ),
      "TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED",
    );
  });

  it("allows unit animation when authored decorations have no effective text range", () => {
    const animateUnits = {
      by: "cluster" as const,
      animation: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 100,
      },
    };
    expect(() =>
      validateTextOnPath(
        withPropsAndChildren({ textDecoration: { line: "underline" }, animateUnits }, [
          createElement("Inline", { textDecoration: "none" }, "plain"),
        ]),
      ),
    ).not.toThrow();
    expect(() =>
      validateTextOnPath(
        withPropsAndChildren({ animateUnits }, [
          createElement("Inline", { textDecoration: { line: "underline" } }, ""),
          "plain",
        ]),
      ),
    ).not.toThrow();
    expectCode(
      () =>
        validateTextOnPath(
          withPropsAndChildren({ textDecoration: { line: "underline" }, animateUnits }, [
            "decorated",
            createElement("Inline", { textDecoration: "none" }, "plain"),
          ]),
        ),
      "TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED",
    );
  });

  it("accepts 4,096 authored decoration owners and rejects the next one", () => {
    const decoratedInlines = (count: number): VNode[] =>
      Array.from({ length: count }, (_, index) =>
        createElement(
          "Inline",
          { textDecoration: { line: "underline", color: index % 2 === 0 ? "#000" : "#111" } },
          "x",
        ),
      );
    expect(() =>
      validateTextOnPath(
        withPropsAndChildren({ textDecoration: { line: "underline" } }, decoratedInlines(4_095)),
      ),
    ).not.toThrow();
    expectCode(
      () =>
        validateTextOnPath(
          withPropsAndChildren({ textDecoration: { line: "underline" } }, decoratedInlines(4_096)),
        ),
      "TEXT_DECORATION_RANGE_LIMIT",
    );
  });

  it("rejects unsupported text layout props and invalid enums", () => {
    expectCode(() => validateTextOnPath(withProps({ wrap: "char" })), "TEXT_PATH_INVALID");
    expectCode(() => validateTextOnPath(withProps({ textAnchor: "center" })), "TEXT_PATH_INVALID");
    expectCode(
      () => validateTextOnPath(withProps({ pathDirection: "backward" })),
      "TEXT_PATH_INVALID",
    );
    expectCode(() => validateTextOnPath(withProps({ pathNormal: "up" })), "TEXT_PATH_INVALID");
    expectCode(() => validateTextOnPath(withProps({ pathFit: "stretch" })), "TEXT_PATH_INVALID");
    expectCode(() => validateTextOnPath(withProps({ pathOverflow: "clip" })), "TEXT_PATH_INVALID");
    expectCode(() => validateTextOnPath(withProps({ normalOffsetPx: 0 })), "TEXT_PATH_INVALID");
  });

  it("accepts the offset limit and rejects the next representable value", () => {
    expect(() =>
      validateTextOnPath(withProps({ d: "M0 0L200 0Z", startOffsetPx: 1e12 })),
    ).not.toThrow();
    expectCode(
      () => validateTextOnPath(withProps({ startOffsetPx: 1e12 + 0.000_122_070_312_5 })),
      "TEXT_PATH_OFFSET_LIMIT",
    );
  });

  it("rejects blank and oversized path sources before WASM", () => {
    expectCode(() => validateTextOnPath(withProps({ d: " \t " })), "TEXT_PATH_INVALID_DATA");
    expectCode(
      () => validateTextOnPath(withProps({ d: `M0 0L1 0${" ".repeat(1_048_576)}` })),
      "TEXT_PATH_SOURCE_LIMIT",
    );
  });
});
