/** @jsxImportSource react */
import type { CanvasVNode, StrokeScaling } from "../../dist/index.js";
import {
  BoundSvg,
  Box,
  Canvas,
  Flex,
  Grid,
  Inline,
  Path,
  Shape,
  Symbol as SymbolNode,
  Text,
  TextOnPath,
  toVNode,
} from "../../dist/index.js";
import { toInteractiveVNode } from "../../dist/interactive.js";

type TextComponentProps = Parameters<typeof Text>[0];
type TextOnPathComponentProps = Parameters<typeof TextOnPath>[0];
type BoundSvgComponentProps = Parameters<typeof BoundSvg>[0];

const vnode = toVNode(
  <Canvas width={100} height={100}>
    <Text font="F" fontSizePx={12}>
      ok
    </Text>
  </Canvas>,
);

const canvasVNode: CanvasVNode = vnode;
void canvasVNode;
void (<BoundSvg vnode={vnode} />);

const stableStroke: StrokeScaling = "canvas";
void (
  <Canvas width={100} height={100}>
    <Flex strokeScaling={stableStroke} />
    <Grid strokeScaling="canvas" />
    <Box strokeScaling="transform" />
    <Path d="M0 0L1 1" width={1} height={1} stroke="#000" strokeScaling="canvas" />
  </Canvas>
);

// @ts-expect-error canvas-stable stroke scaling is not a Text outline API
void (<Text font="F" fontSizePx={12} strokeScaling="canvas" />);
// @ts-expect-error reusable Shape paint is outside the canvas-stable stroke API
void (<Shape width={1} height={1} strokeScaling="canvas" />);
// @ts-expect-error reusable Symbol paint is outside the canvas-stable stroke API
void (<SymbolNode width={1} height={1} strokeScaling="canvas" />);

const interactive = toInteractiveVNode(
  <Canvas width={100} height={100}>
    <Text font="F" fontSizePx={12} onClick={() => {}}>
      ok
    </Text>
  </Canvas>,
);
const interactiveCanvasVNode: CanvasVNode = interactive.vnode;
void interactiveCanvasVNode;

void (
  <TextOnPath d="M0 0L100 0" width={100} height={20} font="F" fontSizePx={12}>
    path text
  </TextOnPath>
);

void (
  <TextOnPath d="M0 0L100 0" width={100} height={20} font="F" fontSizePx={12}>
    <Inline>bad</Inline>
  </TextOnPath>
);

const invalidTextOnPathChild: TextOnPathComponentProps = {
  d: "M0 0L100 0",
  width: 100,
  height: 20,
  font: "F",
  fontSizePx: 12,
  // @ts-expect-error TextOnPath only accepts string and Inline children
  children: 42,
};

// @ts-expect-error Text requires font
const invalidMissingFont: TextComponentProps = { fontSizePx: 12 };

// @ts-expect-error unknown props must be rejected on phantom components
const invalidUnknownProp: TextComponentProps = { font: "F", fontSizePx: 12, notAProp: 1 };

const invalidBoundSvgProps: BoundSvgComponentProps = {
  // @ts-expect-error invalid manual VNode must not be accepted by BoundSvg
  vnode: { type: "Text", props: { fontSizePx: 12 }, children: [] },
};

void invalidMissingFont;
void invalidUnknownProp;
void invalidTextOnPathChild;
void invalidBoundSvgProps;
