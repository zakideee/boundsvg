import { Box, Text, type VNode } from "@boundsvg/core";
import { describe, expect, it } from "vitest";
import { Center, HStack } from "../src/index.js";

describe("@boundsvg/extras via JSX", () => {
  it("builds an HStack tree from JSX children", () => {
    const vnode = (
      <HStack gap={8}>
        <Box width={10} height={10} />
        <Box width={20} height={20} />
      </HStack>
    );

    expect(vnode.type).toBe("Flex");
    expect(vnode.props).toEqual({ gap: 8, direction: "row" });
    expect(vnode.children).toHaveLength(2);
    expect((vnode.children[0] as VNode).type).toBe("Box");
    expect((vnode.children[1] as VNode).props).toEqual({ width: 20, height: 20 });
  });

  it("composes extras and core components in one JSX tree", () => {
    const vnode = (
      <Center width={100} height={100}>
        <Text font="Inter" fontSizePx={12}>
          centered
        </Text>
      </Center>
    );

    expect(vnode.type).toBe("Flex");
    expect(vnode.props).toEqual({
      width: 100,
      height: 100,
      alignItems: "center",
      justifyContent: "center",
    });
    expect((vnode.children[0] as VNode).children).toEqual(["centered"]);
  });
});
