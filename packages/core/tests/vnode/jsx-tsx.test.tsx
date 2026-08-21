import { describe, expect, it } from "vitest";
import { Box, Canvas, Flex, Inline, Text, TextOnPath } from "../../src/index.js";
import type { VNode, VNodeChild, VNodeFor } from "../../src/vnode/types.js";

type CardProps = {
  title: string;
  children?: VNodeChild;
};

/** Local function component using the `(props, ...children)` convention */
function Card(props: CardProps, ...children: Array<VNode | string>): VNode {
  return (
    <Box padding={8}>
      <Text font="Inter" fontSizePx={14}>
        {props.title}
      </Text>
      {children}
    </Box>
  );
}

type BadgeProps = {
  label: string;
};

/** Local function component using the props-only convention */
function Badge(props: BadgeProps): VNode {
  return (
    <Text font="Inter" fontSizePx={10}>
      {props.label}
    </Text>
  );
}

function InvalidPrimitiveInline(): VNode {
  const invalidPrimitive = 5 as unknown as string;
  return <Inline>{invalidPrimitive}</Inline>;
}

describe("JSX via @boundsvg/core jsx-runtime", () => {
  it("builds the README quick-start tree (Canvas > Box > Text)", () => {
    const vnode = (
      <Canvas width={600} height={400} background="#fff">
        <Box padding={20}>
          <Text font="Inter" fontSizePx={24} color="#333">
            Hello, boundsvg!
          </Text>
        </Box>
      </Canvas>
    );

    expect(vnode.type).toBe("Canvas");
    expect(vnode.props).toEqual({ width: 600, height: 400, background: "#fff" });
    expect(vnode.children).toHaveLength(1);

    const box = vnode.children[0] as VNodeFor<"Box">;
    expect(box.type).toBe("Box");
    expect(box.props).toEqual({ padding: 20 });
    expect(box.children).toHaveLength(1);

    const text = box.children[0] as VNodeFor<"Text">;
    expect(text.type).toBe("Text");
    expect(text.props).toEqual({ font: "Inter", fontSizePx: 24, color: "#333" });
    expect(text.children).toEqual(["Hello, boundsvg!"]);
  });

  it("builds a Canvas > Flex > Text tree with multiple children", () => {
    const vnode = (
      <Canvas width={800} height={600}>
        <Flex direction="row" gap={8}>
          <Text font="Inter" fontSizePx={16}>
            left
          </Text>
          <Text font="Inter" fontSizePx={16}>
            right
          </Text>
        </Flex>
      </Canvas>
    );

    const flex = vnode.children[0] as VNodeFor<"Flex">;
    expect(flex.type).toBe("Flex");
    expect(flex.props).toEqual({ direction: "row", gap: 8 });
    expect(flex.children).toHaveLength(2);
    expect((flex.children[0] as VNode).children).toEqual(["left"]);
    expect((flex.children[1] as VNode).children).toEqual(["right"]);
  });

  it("flattens fragment children into the parent", () => {
    const vnode = (
      <Flex direction="row">
        {/* biome-ignore lint/complexity/noUselessFragments: fragment flattening is what this test verifies */}
        <>
          <Box width={10} height={10} />
          <Box width={20} height={20} />
        </>
      </Flex>
    );

    expect(vnode.children).toHaveLength(2);
    expect((vnode.children[0] as VNode).type).toBe("Box");
    expect((vnode.children[1] as VNode).props).toEqual({ width: 20, height: 20 });
  });

  it("flattens array children and preserves keys", () => {
    const labels = ["a", "b", "c"];
    const vnode = (
      <Flex direction="column">
        {labels.map((label) => (
          <Box key={label} width={10} height={10} />
        ))}
      </Flex>
    );

    expect(vnode.children).toHaveLength(3);
    expect(vnode.children.map((child) => (child as VNode).key)).toEqual(["a", "b", "c"]);
    expect(vnode.children.map((child) => (child as VNode).type)).toEqual(["Box", "Box", "Box"]);
  });

  it("invokes a (props, ...children) function component", () => {
    const vnode = (
      <Card title="Greeting">
        <Text font="Inter" fontSizePx={12}>
          body
        </Text>
      </Card>
    );

    expect(vnode.type).toBe("Box");
    expect(vnode.props).toEqual({ padding: 8 });
    expect(vnode.children).toHaveLength(2);
    expect((vnode.children[0] as VNode).children).toEqual(["Greeting"]);
    expect((vnode.children[1] as VNode).children).toEqual(["body"]);
  });

  it("invokes a props-only function component", () => {
    const vnode = <Badge label="new" />;

    expect(vnode.type).toBe("Text");
    expect(vnode.children).toEqual(["new"]);
  });

  it("attaches a JSX key to the VNode returned by a function component", () => {
    const vnode = <Card key="k1" title="keyed" />;

    expect(vnode.type).toBe("Box");
    expect(vnode.key).toBe("k1");
  });

  it("drops null/boolean children and stringifies numbers", () => {
    const showOptional = false;
    const vnode = (
      <Flex direction="row">
        {showOptional && <Box width={1} height={1} />}
        {null}
        <Text font="Inter" fontSizePx={10}>
          {42}
        </Text>
      </Flex>
    );

    expect(vnode.children).toHaveLength(1);
    expect((vnode.children[0] as VNode).children).toEqual(["42"]);
  });

  it("preserves primitive rejection metadata across TextOnPath fragments", () => {
    const invalidPrimitive = 42 as unknown as string;
    expect(() => (
      <TextOnPath d="M0 0L100 0" width={100} height={30} font="Inter" fontSizePx={16}>
        {/* biome-ignore lint/complexity/noUselessFragments: fragment normalization is under test */}
        <>{invalidPrimitive}</>
      </TextOnPath>
    )).toThrow(expect.objectContaining({ code: "TEXT_PATH_CHILD_UNSUPPORTED" }));
  });

  it("preserves primitive rejection metadata when keying a function component result", () => {
    expect(() => (
      <TextOnPath d="M0 0L100 0" width={100} height={30} font="Inter" fontSizePx={16}>
        <InvalidPrimitiveInline key="invalid" />
      </TextOnPath>
    )).toThrow(expect.objectContaining({ code: "TEXT_PATH_CHILD_UNSUPPORTED" }));
  });
});
