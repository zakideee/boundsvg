/** @jsxImportSource ../../dist */
// Compile-only contract: the documented JSX shapes for rich text must
// typecheck for a strict consumer. JSX expressions type as the broad `VNode`
// union, so the rich-text containers accept them at the type level; the
// concrete child kinds are enforced by validate() at runtime.
import type { VNode } from "../../dist/index.js";
import {
  Canvas,
  Flex,
  Inline,
  InlineBox,
  InlineRect,
  Rt,
  Ruby,
  Text,
  TextOnPath,
} from "../../dist/index.js";

const richText: VNode = (
  <Text font="NotoSansJP" fontSizePx={16}>
    prefix
    <Inline color="#ff0000" fontWeight={700}>
      emphasis
    </Inline>
    <InlineBox background="#eeeeee" paddingInline={[2, 2]}>
      boxed
    </InlineBox>
    <InlineRect inlineSizePx={8} color="#123456" />
    <Ruby>
      漢字
      <Rt>かんじ</Rt>
    </Ruby>
    suffix
  </Text>
);

const onPath: VNode = (
  <TextOnPath d="M0 50L200 50" width={200} height={100} font="NotoSansJP" fontSizePx={14}>
    curve
    <Inline color="#00ff00">run</Inline>
  </TextOnPath>
);

const scene: VNode = (
  <Canvas width={400} height={200}>
    <Flex direction="column">
      {richText}
      {onPath}
    </Flex>
  </Canvas>
);

export { scene };
