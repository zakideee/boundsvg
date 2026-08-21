/** @jsxImportSource react */

import type { InlineVNode, SvgVNode, TextVNode } from "@boundsvg/core";
import type React from "react";
import { describe, expect, it } from "vitest";
import { Canvas, Flex, Image, Inline, Path, Svg, Text } from "../src/components/nodes.js";
import type { PointerEventInfo } from "../src/types.js";
import {
  toInteractiveVNode,
  toInteractiveVNodeFromChildren,
} from "../src/utils/to-interactive-vnode.js";

describe("toInteractiveVNode", () => {
  it("extracts function handlers into handlers map with nodeId#eventName format", () => {
    const onClick = (_info: PointerEventInfo) => {};
    const { vnode, handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Text font="F" fontSizePx={24} id="btn" onClick={onClick}>
          Click me
        </Text>
      </Canvas>,
    );

    const textNode = vnode.children[0]!;
    expect(typeof textNode).not.toBe("string");
    const textVNode = textNode as TextVNode;
    // Handler ID should be "nodeId#eventName"
    expect(textVNode.props.onClick).toBe("btn#onClick");

    expect(handlers.size).toBe(1);
    expect(handlers.get("btn#onClick")).toBe(onClick);
  });

  it("passes string handlers through unchanged", () => {
    const { vnode, handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Text font="F" fontSizePx={24} onClick="my-handler">
          Click me
        </Text>
      </Canvas>,
    );

    const textNode = vnode.children[0] as TextVNode;
    expect(textNode.props.onClick).toBe("my-handler");
    expect(handlers.size).toBe(0);
  });

  it("handles mixed function and string handlers", () => {
    const onEnter = (_info: PointerEventInfo) => {};
    const { vnode, handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Text font="F" fontSizePx={24} id="mixed" onClick="manual-click" onPointerEnter={onEnter}>
          Text
        </Text>
      </Canvas>,
    );

    const textNode = vnode.children[0] as TextVNode;
    expect(textNode.props.onClick).toBe("manual-click");
    expect(textNode.props.onPointerEnter).toBe("mixed#onPointerEnter");
    expect(handlers.size).toBe(1);
    expect(handlers.get("mixed#onPointerEnter")).toBe(onEnter);
  });

  it("generates unique handler IDs for multiple nodes", () => {
    const onClick1 = (_info: PointerEventInfo) => {};
    const onClick2 = (_info: PointerEventInfo) => {};
    const { vnode, handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Text font="F" fontSizePx={24} onClick={onClick1} id="t1">
          One
        </Text>
        <Text font="F" fontSizePx={24} onClick={onClick2} id="t2">
          Two
        </Text>
      </Canvas>,
    );

    expect(handlers.size).toBe(2);
    const text1 = vnode.children[0] as TextVNode;
    const text2 = vnode.children[1] as TextVNode;
    expect(text1.props.onClick).toBe("t1#onClick");
    expect(text2.props.onClick).toBe("t2#onClick");
    expect(handlers.get("t1#onClick")).toBe(onClick1);
    expect(handlers.get("t2#onClick")).toBe(onClick2);
  });

  it("preserves non-event props", () => {
    const onClick = (_info: PointerEventInfo) => {};
    const { vnode } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Text font="F" fontSizePx={24} color="#fff" id="txt" onClick={onClick}>
          Hello
        </Text>
      </Canvas>,
    );

    const textNode = vnode.children[0] as TextVNode;
    expect(textNode.props.font).toBe("F");
    expect(textNode.props.fontSizePx).toBe(24);
    expect(textNode.props.color).toBe("#fff");
    expect(textNode.props.id).toBe("txt");
  });

  it("works with Image and Path nodes", () => {
    const onImageClick = (_info: PointerEventInfo) => {};
    const onPathClick = (_info: PointerEventInfo) => {};
    const { handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Image
          src="data:image/png;base64,..."
          width={100}
          height={100}
          id="img1"
          onClick={onImageClick}
        />
        <Path d="M0 0L10 10" width={50} height={50} id="path1" onClick={onPathClick} />
      </Canvas>,
    );

    expect(handlers.size).toBe(2);
    expect(handlers.get("img1#onClick")).toBe(onImageClick);
    expect(handlers.get("path1#onClick")).toBe(onPathClick);
  });

  it("extracts handlers from Svg nodes", () => {
    const onSvgClick = (_info: PointerEventInfo) => {};
    const { vnode, handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Svg
          id="svg-leaf"
          content={'<svg viewBox="0 0 40 20"><rect width="40" height="20" fill="#22d3ee"/></svg>'}
          width={200}
          height={100}
          onClick={onSvgClick}
        />
      </Canvas>,
    );

    const svgNode = vnode.children[0] as SvgVNode;
    expect(svgNode.props.onClick).toBe("svg-leaf#onClick");
    expect(handlers.get("svg-leaf#onClick")).toBe(onSvgClick);
  });

  it("returns empty handlers map when no handlers", () => {
    const { handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Text font="F" fontSizePx={24}>
          No handlers
        </Text>
      </Canvas>,
    );

    expect(handlers.size).toBe(0);
  });

  it("preserves Inline nodes under Text", () => {
    const { vnode, handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Text font="F" fontSizePx={24}>
          a<Inline color="#f00">b</Inline>
        </Text>
      </Canvas>,
    );
    expect(handlers.size).toBe(0);
    const textNode = vnode.children[0] as TextVNode;
    const inline = textNode.children[1] as InlineVNode;
    expect(inline.type).toBe("Inline");
    expect(inline.props.color).toBe("#f00");
  });

  it("throws on non-boundsvg root", () => {
    expect(() => toInteractiveVNode((<div>not boundsvg</div>) as React.ReactElement)).toThrow(
      "[boundsvg] toInteractiveVNode()",
    );
  });

  it("throws on non-boundsvg child elements", () => {
    expect(() =>
      toInteractiveVNode(
        <Canvas width={800} height={400}>
          <div>not boundsvg</div>
          <Text font="F" fontSizePx={24}>
            Hello
          </Text>
        </Canvas>,
      ),
    ).toThrow("Unsupported React element <div>");
  });

  it("extracts all 20 event handler types", () => {
    const cbs: Record<string, (_info: PointerEventInfo) => void> = {};
    const eventNames = [
      "onClick",
      "onDoubleClick",
      "onContextMenu",
      "onPointerDown",
      "onPointerUp",
      "onPointerMove",
      "onPointerEnter",
      "onPointerLeave",
      "onPointerOver",
      "onPointerOut",
      "onMouseDown",
      "onMouseUp",
      "onMouseMove",
      "onMouseEnter",
      "onMouseLeave",
      "onMouseOver",
      "onMouseOut",
      "onTouchStart",
      "onTouchEnd",
      "onTouchMove",
    ] as const;

    for (const name of eventNames) {
      cbs[name] = (_info: PointerEventInfo) => {};
    }

    const { handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Text
          font="F"
          fontSizePx={24}
          id="all"
          onClick={cbs.onClick}
          onDoubleClick={cbs.onDoubleClick}
          onContextMenu={cbs.onContextMenu}
          onPointerDown={cbs.onPointerDown}
          onPointerUp={cbs.onPointerUp}
          onPointerMove={cbs.onPointerMove}
          onPointerEnter={cbs.onPointerEnter}
          onPointerLeave={cbs.onPointerLeave}
          onPointerOver={cbs.onPointerOver}
          onPointerOut={cbs.onPointerOut}
          onMouseDown={cbs.onMouseDown}
          onMouseUp={cbs.onMouseUp}
          onMouseMove={cbs.onMouseMove}
          onMouseEnter={cbs.onMouseEnter}
          onMouseLeave={cbs.onMouseLeave}
          onMouseOver={cbs.onMouseOver}
          onMouseOut={cbs.onMouseOut}
          onTouchStart={cbs.onTouchStart}
          onTouchEnd={cbs.onTouchEnd}
          onTouchMove={cbs.onTouchMove}
        >
          All events
        </Text>
      </Canvas>,
    );

    expect(handlers.size).toBe(20);
    for (const name of eventNames) {
      expect(handlers.get(`all#${name}`)).toBe(cbs[name]);
    }
  });

  it("extracts onContextMenu handler", () => {
    const onCtx = (_info: PointerEventInfo) => {};
    const { vnode, handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Text font="F" fontSizePx={24} id="ctx-btn" onContextMenu={onCtx}>
          Right click me
        </Text>
      </Canvas>,
    );

    const textNode = vnode.children[0] as TextVNode;
    expect(textNode.props.onContextMenu).toBe("ctx-btn#onContextMenu");
    expect(handlers.size).toBe(1);
    expect(handlers.get("ctx-btn#onContextMenu")).toBe(onCtx);
  });

  it("generates auto IDs for nodes without explicit id", () => {
    const onClick = (_info: PointerEventInfo) => {};
    const { vnode, handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Text font="F" fontSizePx={24} onClick={onClick}>
          No explicit id
        </Text>
      </Canvas>,
    );

    const textNode = vnode.children[0] as TextVNode;
    // Auto-generated handler ID: Canvas root path is "0", first child is "0.0"
    expect(textNode.props.onClick).toBe("auto:0.0#onClick");
    expect(handlers.size).toBe(1);
    expect(handlers.get("auto:0.0#onClick")).toBe(onClick);
  });

  it("generates unique auto IDs for sibling nodes", () => {
    const onClick1 = (_info: PointerEventInfo) => {};
    const onClick2 = (_info: PointerEventInfo) => {};
    const { handlers } = toInteractiveVNode(
      <Canvas width={800} height={400}>
        <Text font="F" fontSizePx={24} onClick={onClick1}>
          First
        </Text>
        <Text font="F" fontSizePx={24} onClick={onClick2}>
          Second
        </Text>
      </Canvas>,
    );

    expect(handlers.size).toBe(2);
    // Canvas root at "0", siblings at "0.0" and "0.1"
    expect(handlers.get("auto:0.0#onClick")).toBe(onClick1);
    expect(handlers.get("auto:0.1#onClick")).toBe(onClick2);
  });
});

describe("toInteractiveVNodeFromChildren", () => {
  it("builds Canvas VNode from children with handler extraction", () => {
    const onClick = (_info: PointerEventInfo) => {};
    const { vnode, handlers } = toInteractiveVNodeFromChildren(
      { width: 960, height: 320, background: "#000" },
      <Flex direction="column" padding={20}>
        <Text font="F" fontSizePx={24} id="txt" onClick={onClick}>
          Hello
        </Text>
      </Flex>,
    );

    expect(vnode.type).toBe("Canvas");
    expect(vnode.props).toEqual({
      width: 960,
      height: 320,
      background: "#000",
    });
    expect(handlers.size).toBe(1);
    expect(handlers.get("txt#onClick")).toBe(onClick);
  });
});
