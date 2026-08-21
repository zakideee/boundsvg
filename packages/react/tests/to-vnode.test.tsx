/** @jsxImportSource react */

import type {
  FlexVNode,
  InlineRectVNode,
  InlineVNode,
  RtVNode,
  RubyVNode,
  TextVNode,
} from "@boundsvg/core";
import { createElement as createReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  Box,
  Canvas,
  Flex,
  Grid,
  Image,
  Inline,
  InlineRect,
  Path,
  Rt,
  Ruby,
  Text,
} from "../src/components/nodes.js";
import { toVNode, toVNodeFromChildren } from "../src/utils/to-vnode.js";

describe("toVNode", () => {
  it("converts a single Text element", () => {
    const vnode = toVNode(
      <Text font="TestFont" fontSizePx={24}>
        hello
      </Text>,
    );
    expect(vnode).toEqual({
      type: "Text",
      props: { font: "TestFont", fontSizePx: 24 },
      children: ["hello"],
    });
  });

  it("forwards Text fit convergence controls", () => {
    const vnode = toVNode(
      <Text
        font="TestFont"
        fontSizePx={48}
        fit="shrink"
        shrinkEpsilonPx={0.1}
        shrinkMaxIterations={7}
        growEpsilonPx={0.2}
        growMaxIterations={9}
      >
        fit
      </Text>,
    ) as TextVNode;

    expect(vnode.props).toMatchObject({
      fit: "shrink",
      shrinkEpsilonPx: 0.1,
      shrinkMaxIterations: 7,
      growEpsilonPx: 0.2,
      growMaxIterations: 9,
    });
  });

  it("converts nested Canvas > Flex > Text", () => {
    const vnode = toVNode(
      <Canvas width={800} height={400}>
        <Flex direction="column" padding={20}>
          <Text font="F" fontSizePx={32}>
            Title
          </Text>
        </Flex>
      </Canvas>,
    );

    expect(vnode.type).toBe("Canvas");
    expect(vnode.props).toEqual({ width: 800, height: 400 });
    expect(vnode.children).toHaveLength(1);

    const flex = vnode.children[0] as FlexVNode;
    expect(flex.type).toBe("Flex");
    expect(flex.props).toEqual({ direction: "column", padding: 20 });

    const text = flex.children[0] as TextVNode;
    expect(text.type).toBe("Text");
    expect(text.children).toEqual(["Title"]);
  });

  it("handles all node types", () => {
    const vnode = toVNode(
      <Canvas width={100} height={100}>
        <Flex direction="row">
          <Grid templateColumns="1fr 1fr">
            <Box background="#fff">
              <Text font="F" fontSizePx={12}>
                hi
              </Text>
            </Box>
          </Grid>
          <Image src="data:..." width={50} height={50} />
          <Path d="M0 0L10 10" width={10} height={10} />
        </Flex>
      </Canvas>,
    );

    expect(vnode.type).toBe("Canvas");
    const flex = vnode.children[0] as { type: string; children: unknown[] };
    expect(flex.type).toBe("Flex");
    expect(flex.children).toHaveLength(3);

    const grid = flex.children[0] as { type: string };
    expect(grid.type).toBe("Grid");

    const img = flex.children[1] as { type: string };
    expect(img.type).toBe("Image");

    const path = flex.children[2] as { type: string };
    expect(path.type).toBe("Path");
  });

  it("flattens React.Fragment children", () => {
    const vnode = toVNode(
      <Flex direction="row">
        <Text font="F" fontSizePx={12}>
          a
        </Text>
        <Text font="F" fontSizePx={12}>
          b
        </Text>
      </Flex>,
    );

    expect(vnode.children).toHaveLength(2);
    const texts = vnode.children as Array<{ type: string; children: string[] }>;
    expect(texts[0]!.type).toBe("Text");
    expect(texts[0]!.children).toEqual(["a"]);
    expect(texts[1]!.type).toBe("Text");
    expect(texts[1]!.children).toEqual(["b"]);
  });

  it("handles conditional rendering (falsy values)", () => {
    const show = false;
    const vnode = toVNode(
      <Flex direction="row">
        {show && (
          <Text font="F" fontSizePx={12}>
            hidden
          </Text>
        )}
        <Text font="F" fontSizePx={12}>
          visible
        </Text>
      </Flex>,
    );

    expect(vnode.children).toHaveLength(1);
    const text = vnode.children[0] as { children: string[] };
    expect(text.children).toEqual(["visible"]);
  });

  it("handles null and undefined children", () => {
    const vnode = toVNode(
      <Flex direction="row">
        {null}
        {undefined}
        <Text font="F" fontSizePx={12}>
          ok
        </Text>
      </Flex>,
    );

    expect(vnode.children).toHaveLength(1);
  });

  it("handles array children (map)", () => {
    const items = ["a", "b", "c"];
    const vnode = toVNode(
      <Flex direction="column">
        {items.map((item) => (
          <Text key={item} font="F" fontSizePx={12}>
            {item}
          </Text>
        ))}
      </Flex>,
    );

    expect(vnode.children).toHaveLength(3);
    const texts = vnode.children as Array<{ type: string; children: string[] }>;
    expect(texts[0]!.children).toEqual(["a"]);
    expect(texts[1]!.children).toEqual(["b"]);
    expect(texts[2]!.children).toEqual(["c"]);
  });

  it("handles string children in Text", () => {
    const vnode = toVNode(
      <Text font="F" fontSizePx={24}>
        hello world
      </Text>,
    );

    expect(vnode.children).toEqual(["hello world"]);
  });

  it("converts Inline children inside Text", () => {
    const vnode = toVNode(
      <Text font="F" fontSizePx={24}>
        a<Inline color="#f00">b</Inline>
      </Text>,
    );

    expect(vnode.type).toBe("Text");
    expect(vnode.children).toHaveLength(2);
    expect(vnode.children[0]).toBe("a");
    const inline = vnode.children[1] as InlineVNode;
    expect(inline.type).toBe("Inline");
    expect(inline.props).toEqual({ color: "#f00" });
    expect(inline.children).toEqual(["b"]);
  });

  it("converts a childless animated InlineRect inside Text", () => {
    const vnode = toVNode(
      <Text font="F" fontSizePx={24}>
        typing
        <InlineRect
          inlineSizePx={2}
          blockSizePx="line"
          color="#111827"
          animate={{
            keyframes: [
              { at: 0, opacity: 0 },
              { at: 1, opacity: 1 },
            ],
            durationMs: 500,
            easing: { type: "steps", count: 1, position: "jump-end" },
          }}
        />
      </Text>,
    ) as TextVNode;

    const rect = vnode.children[1] as InlineRectVNode;
    expect(rect.type).toBe("InlineRect");
    expect(rect.props).toMatchObject({
      inlineSizePx: 2,
      blockSizePx: "line",
      color: "#111827",
    });
    expect(rect.children).toEqual([]);
  });

  it("rejects runtime children on InlineRect", () => {
    const invalidRect = createReactElement(
      InlineRect,
      { inlineSizePx: 2, color: "#111827" },
      "bad",
    );

    expect(() => toVNode(invalidRect)).toThrow("<InlineRect> does not accept children");
  });

  it("converts Ruby and Rt children inside Text", () => {
    const vnode = toVNode(
      <Text font="F" fontSizePx={24}>
        東
        <Ruby rubyPosition="alternate" rubyAlign="space-between" rubyGapPx={-1} rubyOffsetPx={2}>
          京
          <Rt fontSizePx={12} color="#fca5a5" lineHeight={1}>
            きょう
          </Rt>
          <Rt fontSizePx={12} color="#93c5fd" lineHeight={1}>
            Tokyo
          </Rt>
        </Ruby>
      </Text>,
    );

    expect(vnode.type).toBe("Text");
    expect(vnode.children).toHaveLength(2);
    const ruby = vnode.children[1] as RubyVNode;
    expect(ruby.type).toBe("Ruby");
    expect(ruby.props).toEqual({
      rubyPosition: "alternate",
      rubyAlign: "space-between",
      rubyGapPx: -1,
      rubyOffsetPx: 2,
    });
    expect(ruby.children[0]).toBe("京");
    const rt = ruby.children[1] as RtVNode;
    expect(rt.type).toBe("Rt");
    expect(rt.props).toEqual({ fontSizePx: 12, color: "#fca5a5", lineHeight: 1 });
    expect(rt.children).toEqual(["きょう"]);
    const secondRt = ruby.children[2] as RtVNode;
    expect(secondRt.type).toBe("Rt");
    expect(secondRt.props).toEqual({ fontSizePx: 12, color: "#93c5fd", lineHeight: 1 });
    expect(secondRt.children).toEqual(["Tokyo"]);
  });

  it("handles number children", () => {
    const vnode = toVNode(
      <Text font="F" fontSizePx={24}>
        {42}
      </Text>,
    );

    expect(vnode.children).toEqual(["42"]);
  });

  it("passes through all props correctly", () => {
    const vnode = toVNode(
      <Text
        font="NotoSansJP"
        fontSizePx={24}
        color="#ff0000"
        wrap="char"
        lineHeight={1.5}
        writingMode="vertical-rl"
        language="ja"
        hangingPunctuation
      >
        test
      </Text>,
    );

    expect(vnode.props).toEqual({
      font: "NotoSansJP",
      fontSizePx: 24,
      color: "#ff0000",
      wrap: "char",
      lineHeight: 1.5,
      writingMode: "vertical-rl",
      language: "ja",
      hangingPunctuation: true,
    });
  });

  it("throws on non-boundsvg React child elements", () => {
    expect(() =>
      toVNode(
        <Flex direction="row">
          <div>not a boundsvg element</div>
          <Text font="F" fontSizePx={12}>
            ok
          </Text>
        </Flex>,
      ),
    ).toThrow("Unsupported React element <div>");
  });

  it("throws if root is not a boundsvg element", () => {
    expect(() => toVNode(<div>oops</div>)).toThrow("toVNode() requires a boundsvg element");
  });

  it("preserves key on child elements", () => {
    const vnode = toVNode(
      <Flex direction="row">
        <Text key="first" font="F" fontSizePx={12}>
          a
        </Text>
        <Text key="second" font="F" fontSizePx={12}>
          b
        </Text>
      </Flex>,
    );

    const children = vnode.children as Array<{ key?: string | number }>;
    expect(children[0]!.key).toBe("first");
    expect(children[1]!.key).toBe("second");
  });
});

describe("toVNodeFromChildren", () => {
  it("wraps children in a Canvas VNode", () => {
    const vnode = toVNodeFromChildren(
      { width: 960, height: 320, background: "#000" },
      <Flex direction="column" padding={20}>
        <Text font="F" fontSizePx={24}>
          Hello
        </Text>
      </Flex>,
    );

    expect(vnode.type).toBe("Canvas");
    expect(vnode.props).toEqual({ width: 960, height: 320, background: "#000" });
    expect(vnode.children).toHaveLength(1);

    const flex = vnode.children[0] as { type: string };
    expect(flex.type).toBe("Flex");
  });

  it("handles multiple children", () => {
    const vnode = toVNodeFromChildren(
      { width: 400, height: 200 },
      <>
        <Text font="F" fontSizePx={12}>
          a
        </Text>
        <Text font="F" fontSizePx={12}>
          b
        </Text>
      </>,
    );

    expect(vnode.type).toBe("Canvas");
    expect(vnode.children).toHaveLength(2);
  });

  it("omits background when not provided", () => {
    const vnode = toVNodeFromChildren(
      { width: 100, height: 100 },
      <Text font="F" fontSizePx={12}>
        hi
      </Text>,
    );

    expect(vnode.props).toEqual({ width: 100, height: 100 });
  });
});
