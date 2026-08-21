import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { assertRichTextNodeDepth, MAX_RICH_TEXT_DEPTH } from "../../src/text/rich-text-limits.js";
import type { RichTextNode, RichTextStyle } from "../../src/text/types.js";
import { validate } from "../../src/validate/index.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { InlineVNode } from "../../src/vnode/types.js";

const style: RichTextStyle = {
  font: "NotoSansJP",
  fontWeight: 400,
  fontStyle: "normal",
  color: "#222222",
  fontSizePx: 12,
  letterSpacingPx: 0,
};

function createNestedInlineScene(depth: number) {
  let child: string | InlineVNode = "境界";
  for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
    child = createElement("Inline", { background: "#ffeeaa" }, child);
  }
  return createElement(
    "Canvas",
    { width: 120, height: 60 },
    createElement("Text", { font: "NotoSansJP", fontSizePx: 12 }, child),
  );
}

function createNestedRichText(depth: number): RichTextNode[] {
  let node: RichTextNode = { kind: "span", text: "境界", style };
  for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
    node = {
      kind: "decoratedSpan",
      style,
      children: [node],
      background: "#ffeeaa",
    };
  }
  return [node];
}

function createNestedInlineBoxRichText(depth: number): RichTextNode[] {
  let node: RichTextNode = { kind: "text", text: "境界" };
  for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
    node = { kind: "inlineBox", style, children: [node] };
  }
  return [node];
}

function createNestedRubyLevelRichText(depth: number): RichTextNode[] {
  let node: RichTextNode = { kind: "text", text: "境界" };
  for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
    node = {
      kind: "ruby",
      style,
      base: [],
      rt: [],
      rtLevels: [[node]],
    };
  }
  return [node];
}

function expectRichTextDepthError(callback: () => unknown, nodeId: string): void {
  try {
    callback();
    throw new Error("expected rich-text depth rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    expect((error as FatalError).code).toBe("RICH_TEXT_MAX_DEPTH");
    expect((error as FatalError).stage).toBe("validate");
    expect((error as FatalError).nodeId).toBe(nodeId);
    expect((error as FatalError).context?.maxDepth).toBe(MAX_RICH_TEXT_DEPTH);
    expect((error as FatalError).context?.actualDepth).toBe(MAX_RICH_TEXT_DEPTH + 1);
  }
}

describe("rich-text depth boundary", () => {
  it("accepts depth 48 for JSX and typed rich text", () => {
    expect(() => validate(createNestedInlineScene(MAX_RICH_TEXT_DEPTH))).not.toThrow();
    expect(() => assertRichTextNodeDepth(createNestedRichText(MAX_RICH_TEXT_DEPTH))).not.toThrow();
  });

  it("rejects JSX depth 49 with a structured validation error", () => {
    expectRichTextDepthError(
      () => validate(createNestedInlineScene(MAX_RICH_TEXT_DEPTH + 1)),
      "<Inline>",
    );
  });

  it("rejects skipValidation before invoking the layout transport", () => {
    const computeLayoutFn = vi.fn((): never => {
      throw new Error("unexpected layout transport call");
    });
    const engine = new Engine({ computeLayoutFn });

    expectRichTextDepthError(
      () =>
        engine.renderToLayoutTree(createNestedInlineScene(MAX_RICH_TEXT_DEPTH + 1), {
          skipValidation: true,
        }),
      "<Inline>",
    );
    expect(computeLayoutFn).not.toHaveBeenCalled();
  });

  it("rejects all typed rich-text APIs before invoking their transports", () => {
    const transport = vi.fn((): never => {
      throw new Error("unexpected measurement transport call");
    });
    const engine = new Engine({
      computeLayoutFn: transport,
      layoutTextFlowWithExclusionsFn: transport,
      shrinkwrapTextFn: transport,
      shrinkwrapFlowFn: transport,
      measureIntrinsicInlineSizeFn: transport,
    });
    const richText = createNestedRichText(MAX_RICH_TEXT_DEPTH + 1);
    const common = {
      text: "",
      richText,
      fontFamily: "NotoSansJP",
      fontSizePx: 12,
      language: "ja" as const,
      wrap: "char" as const,
    };
    const calls = [
      () =>
        engine.layoutTextFlowWithExclusions({
          ...common,
          flowBox: { x: 0, y: 0, width: 120, height: 60 },
          exclusions: [],
        }),
      () => engine.shrinkwrapText({ ...common, maxWidth: 120 }),
      () =>
        engine.shrinkwrapFlow({
          ...common,
          flowBox: { x: 0, y: 0, width: 120, height: 60 },
          exclusions: [],
        }),
      () => engine.measureIntrinsicInlineSize(common),
    ];

    for (const call of calls) {
      expect(() => call()).toThrowError(
        expect.objectContaining({
          name: "FatalError",
          code: "RICH_TEXT_MAX_DEPTH",
          stage: "validate",
          context: expect.objectContaining({
            maxDepth: MAX_RICH_TEXT_DEPTH,
            actualDepth: MAX_RICH_TEXT_DEPTH + 1,
          }),
        }),
      );
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("guards InlineBox children and Ruby annotation levels at the same boundary", () => {
    expect(() =>
      assertRichTextNodeDepth(createNestedInlineBoxRichText(MAX_RICH_TEXT_DEPTH)),
    ).not.toThrow();
    expect(() =>
      assertRichTextNodeDepth(createNestedRubyLevelRichText(MAX_RICH_TEXT_DEPTH)),
    ).not.toThrow();
    expectRichTextDepthError(
      () => assertRichTextNodeDepth(createNestedInlineBoxRichText(MAX_RICH_TEXT_DEPTH + 1)),
      "<inlineBox>",
    );
    expectRichTextDepthError(
      () => assertRichTextNodeDepth(createNestedRubyLevelRichText(MAX_RICH_TEXT_DEPTH + 1)),
      "<ruby>",
    );
  });
});
