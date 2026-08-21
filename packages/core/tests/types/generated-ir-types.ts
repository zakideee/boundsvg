import type {
  IR,
  IRGroupNode,
  IRImageNode,
  IRNode,
  IRPathNode,
  IRRectNode,
  IRShapeNode,
  IRSvgNode,
  IRTextNode,
  RecoverableError,
} from "../../dist/index.js";
import { validateSerializedIR } from "../../dist/index.js";
import type {
  IrNode as GeneratedIrNode,
  GeneratedOutputIr,
} from "../../src/generated/ir/output-ir.js";

type GeneratedGroupNode = Extract<GeneratedIrNode, { type: "group" }>;
type GeneratedRectNode = Extract<GeneratedIrNode, { type: "rect" }>;
type GeneratedTextNode = Extract<GeneratedIrNode, { type: "text" }>;
type GeneratedImageNode = Extract<GeneratedIrNode, { type: "image" }>;
type GeneratedPathNode = Extract<GeneratedIrNode, { type: "path" }>;
type GeneratedSvgNode = Extract<GeneratedIrNode, { type: "svg" }>;
type GeneratedShapeNode = Extract<GeneratedIrNode, { type: "shape" }>;

type CandidatePublicIr = Omit<GeneratedOutputIr, "warnings"> & {
  warnings: RecoverableError[];
};

declare const generatedGroup: GeneratedGroupNode;
declare const generatedRect: GeneratedRectNode;
declare const generatedText: GeneratedTextNode;
declare const generatedImage: GeneratedImageNode;
declare const generatedPath: GeneratedPathNode;
declare const generatedSvg: GeneratedSvgNode;
declare const generatedShape: GeneratedShapeNode;
declare const candidateIr: CandidatePublicIr;
declare const publicGroup: IRGroupNode;
declare const publicRect: IRRectNode;
declare const publicText: IRTextNode;
declare const publicImage: IRImageNode;
declare const publicPath: IRPathNode;
declare const publicSvg: IRSvgNode;
declare const publicShape: IRShapeNode;
declare const publicNode: IRNode;
declare const publicIr: IR;

const currentGroup: IRGroupNode = generatedGroup;
const currentRect: IRRectNode = generatedRect;
const currentText: IRTextNode = generatedText;
const currentImage: IRImageNode = generatedImage;
const currentPath: IRPathNode = generatedPath;
const currentSvg: IRSvgNode = generatedSvg;
const currentShape: IRShapeNode = generatedShape;
const currentNodes: IRNode[] = [
  generatedGroup,
  generatedRect,
  generatedText,
  generatedImage,
  generatedPath,
  generatedSvg,
  generatedShape,
];
const currentIr: IR = candidateIr;
const generatedGroupAgain: GeneratedGroupNode = publicGroup;
const generatedRectAgain: GeneratedRectNode = publicRect;
const generatedTextAgain: GeneratedTextNode = publicText;
const generatedImageAgain: GeneratedImageNode = publicImage;
const generatedPathAgain: GeneratedPathNode = publicPath;
const generatedSvgAgain: GeneratedSvgNode = publicSvg;
const generatedShapeAgain: GeneratedShapeNode = publicShape;
const generatedNodeAgain: GeneratedIrNode = publicNode;
const generatedStructureAgain: Omit<GeneratedOutputIr, "warnings"> = publicIr;
const rehydratedWarning: RecoverableError | undefined = publicIr.warnings[0];
const validSerializedIr: boolean = validateSerializedIR(candidateIr);

void currentGroup;
void currentRect;
void currentText;
void currentImage;
void currentPath;
void currentSvg;
void currentShape;
void currentNodes;
void currentIr;
void generatedGroupAgain;
void generatedRectAgain;
void generatedTextAgain;
void generatedImageAgain;
void generatedPathAgain;
void generatedSvgAgain;
void generatedShapeAgain;
void generatedNodeAgain;
void generatedStructureAgain;
void rehydratedWarning;
void validSerializedIr;

function exhaustGeneratedNode(node: GeneratedIrNode): string {
  switch (node.type) {
    case "group":
      return node.children?.[0]?.nodeId ?? node.nodeId;
    case "rect":
      return node.fill ?? node.nodeId;
    case "text":
      return node.lines[0]?.text ?? node.nodeId;
    case "image":
      return node.src;
    case "path":
      return node.pathData;
    case "svg":
      return node.svgContent;
    case "shape":
      return node.shapeParts[0]?.d ?? node.nodeId;
  }
}

void exhaustGeneratedNode;
