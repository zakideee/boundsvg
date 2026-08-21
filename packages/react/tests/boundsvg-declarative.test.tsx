/** @jsxImportSource react */

import { describe, expect, it } from "vitest";
import { Box, Canvas, Flex, Inline, Text, TextOnPath } from "../src/components/nodes.js";
import { toInteractiveVNode } from "../src/utils/to-interactive-vnode.js";
import { toVNode, toVNodeFromChildren } from "../src/utils/to-vnode.js";

describe("BoundSvg declarative API — VNode resolution", () => {
  it("converts TextOnPath strings and shaping/paint Inline children", () => {
    const vnode = toVNode(
      <TextOnPath d="M0 0L100 0" width={100} height={30} font="F" fontSizePx={16}>
        path text
      </TextOnPath>,
    );
    expect(vnode).toEqual({
      type: "TextOnPath",
      props: { d: "M0 0L100 0", width: 100, height: 30, font: "F", fontSizePx: 16 },
      children: ["path text"],
    });

    const richVNode = toVNode(
      <TextOnPath d="M0 0L100 0" width={100} height={30} font="F" fontSizePx={16}>
        before
        <Inline
          fontWeight={700}
          color="#dc2626"
          textStrokes={[{ color: "#ffffff", widthPx: 2 }]}
          textShadows={[]}
        >
          bold
        </Inline>
      </TextOnPath>,
    );
    expect(richVNode.children).toEqual([
      "before",
      {
        type: "Inline",
        props: {
          fontWeight: 700,
          color: "#dc2626",
          textStrokes: [{ color: "#ffffff", widthPx: 2 }],
          textShadows: [],
        },
        children: ["bold"],
      },
    ]);
  });

  it("rejects primitive children nested in TextOnPath Inline before React normalization", () => {
    const inline = <Inline>valid</Inline>;
    const invalidInline = {
      ...inline,
      props: { ...inline.props, children: 42 },
    } as typeof inline;
    const textOnPath = (
      <TextOnPath d="M0 0L100 0" width={100} height={30} font="F" fontSizePx={16}>
        {invalidInline}
      </TextOnPath>
    );

    expect(() => toVNode(textOnPath)).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_CHILD_UNSUPPORTED" }),
    );
    expect(() => toInteractiveVNode(textOnPath)).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_CHILD_UNSUPPORTED" }),
    );
  });

  it("uses the stable TextOnPath child error for unsupported React nodes", () => {
    const invalidChild = (<Box width={10} height={10} />) as unknown as string;
    const textOnPath = (
      <TextOnPath d="M0 0L100 0" width={100} height={30} font="F" fontSizePx={16}>
        {invalidChild}
      </TextOnPath>
    );

    expect(() => toVNode(textOnPath)).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_CHILD_UNSUPPORTED" }),
    );
    expect(() => toInteractiveVNode(textOnPath)).toThrow(
      expect.objectContaining({ code: "TEXT_PATH_CHILD_UNSUPPORTED" }),
    );
  });

  it("toVNodeFromChildren builds Canvas-wrapped VNode from declarative children", () => {
    const vnode = toVNodeFromChildren(
      { width: 960, height: 320, background: "#0f172a" },
      <Flex direction="column" padding={40}>
        <Text font="NotoSansJP-woff2" fontSizePx={58}>
          Hello
        </Text>
      </Flex>,
    );

    expect(vnode.type).toBe("Canvas");
    expect(vnode.props).toEqual({ width: 960, height: 320, background: "#0f172a" });
    expect(vnode.children).toHaveLength(1);

    const flex = vnode.children[0] as { type: string; children: unknown[] };
    expect(flex.type).toBe("Flex");

    const text = flex.children[0] as { type: string; children: string[] };
    expect(text.type).toBe("Text");
    expect(text.children).toEqual(["Hello"]);
  });

  it("toVNodeFromChildren with no background omits it from props", () => {
    const vnode = toVNodeFromChildren(
      { width: 400, height: 200 },
      <Text font="F" fontSizePx={12}>
        hi
      </Text>,
    );

    expect(vnode.props).toEqual({ width: 400, height: 200 });
  });

  it("toVNode with Canvas root produces equivalent structure", () => {
    const vnode = toVNode(
      <Canvas width={960} height={320} background="#0f172a">
        <Flex direction="column" justifyContent="center" padding={40} gap={16}>
          <Text font="NotoSansJP-woff2" fontSizePx={58} color="#f8fafc" wrap="char">
            Title
          </Text>
        </Flex>
      </Canvas>,
    );

    expect(vnode).toEqual({
      type: "Canvas",
      props: { width: 960, height: 320, background: "#0f172a" },
      children: [
        {
          type: "Flex",
          props: {
            direction: "column",
            justifyContent: "center",
            padding: 40,
            gap: 16,
          },
          children: [
            {
              type: "Text",
              props: {
                font: "NotoSansJP-woff2",
                fontSizePx: 58,
                color: "#f8fafc",
                wrap: "char",
              },
              children: ["Title"],
            },
          ],
        },
      ],
    });
  });

  it("toVNodeFromChildren matches toVNode with Canvas", () => {
    const declarative = toVNodeFromChildren(
      { width: 400, height: 200, background: "#000" },
      <Flex direction="row">
        <Text font="F" fontSizePx={24}>
          A
        </Text>
        <Text font="F" fontSizePx={24}>
          B
        </Text>
      </Flex>,
    );

    const explicit = toVNode(
      <Canvas width={400} height={200} background="#000">
        <Flex direction="row">
          <Text font="F" fontSizePx={24}>
            A
          </Text>
          <Text font="F" fontSizePx={24}>
            B
          </Text>
        </Flex>
      </Canvas>,
    );

    expect(declarative).toEqual(explicit);
  });

  it("handles complex nested template equivalent to playground hero", () => {
    const vnode = toVNode(
      <Canvas width={960} height={320} background="#0f172a">
        <Flex
          direction="column"
          justifyContent="center"
          alignItems="start"
          width={960}
          height={320}
          padding={40}
          gap={16}
        >
          <Text
            font="NotoSansJP-woff2"
            fontSizePx={58}
            color="#f8fafc"
            wrap="char"
            fit="shrink"
            minFontSizePx={24}
          >
            大型タイトルを即座にレイアウト
          </Text>
          <Text font="NotoSansJP-woff2" fontSizePx={24} color="#94a3b8" wrap="char">
            React adapter + WASM shaping pipeline
          </Text>
        </Flex>
      </Canvas>,
    );

    expect(vnode.type).toBe("Canvas");
    const flex = vnode.children[0] as { type: string; children: unknown[] };
    expect(flex.type).toBe("Flex");
    expect(flex.children).toHaveLength(2);
  });
});
