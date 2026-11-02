import { buildIRSourceIndex, type IRNodeOccurrence } from "../ir/source-index.js";
import type { IR, IRTextNode } from "../ir/types.js";
import {
  type AffineMatrix,
  createIdentityAffineMatrix,
  createResolvedTransformMatrix,
  multiplyAffineMatrices,
} from "../transform.js";
import type { TextOutlineNode } from "./types.js";

/**
 * Project Rust-resolved glyph paths into the public canvas-space outline
 * view. This function does not select glyphs, resolve fonts, create paths,
 * group paths, or compute bounds.
 */
export function projectResolvedTextOutlines(ir: IR): TextOutlineNode[] {
  const index = buildIRSourceIndex(ir);
  const outlines: TextOutlineNode[] = [];
  const matrices = new Map<number, AffineMatrix>();
  for (const occurrence of index.nodes.values()) {
    const node = occurrence.node;
    const ancestor =
      occurrence.parentNodeIndex === null ? undefined : matrices.get(occurrence.parentNodeIndex);
    const matrix = multiplyAffineMatrices(
      ancestor ?? createIdentityAffineMatrix(),
      createResolvedTransformMatrix(node.type === "group" ? node.transform : undefined, node.bbox),
    );
    matrices.set(occurrence.nodeIndex, matrix);
    if (node.type === "text") {
      outlines.push(projectTextNode(node, matrix, occurrence));
    }
  }
  return outlines;
}

function projectTextNode(
  node: IRTextNode,
  worldMatrix: AffineMatrix,
  occurrence: IRNodeOccurrence,
): TextOutlineNode {
  const worldTransform = isIdentityMatrix(worldMatrix) ? undefined : worldMatrix;
  return {
    nodeIndex: occurrence.nodeIndex,
    source: occurrence.source,
    ownership: node.ownership,
    nodeId: node.nodeId,
    text: node.lines.map((line) => line.text).join("\n"),
    bbox: node.bbox,
    writingMode: node.writingMode,
    paths: node.glyphPaths ?? [],
    ...(node.gradients ? { gradients: node.gradients } : {}),
    ...(worldTransform ? { worldTransform } : {}),
  };
}

function isIdentityMatrix(matrix: AffineMatrix): boolean {
  return (
    matrix.a === 1 &&
    matrix.b === 0 &&
    matrix.c === 0 &&
    matrix.d === 1 &&
    matrix.e === 0 &&
    matrix.f === 0
  );
}
