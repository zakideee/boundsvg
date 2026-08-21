import type { IRNode, IRTextNode } from "../ir/types.js";
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
export function projectResolvedTextOutlines(root: IRNode): TextOutlineNode[] {
  const outlines: TextOutlineNode[] = [];
  walkTree(root, createIdentityAffineMatrix(), (node, worldMatrix) => {
    if (node.type !== "text" || node.lines.length === 0) {
      return;
    }
    outlines.push(projectTextNode(node, worldMatrix));
  });
  return outlines;
}

function projectTextNode(node: IRTextNode, worldMatrix: AffineMatrix): TextOutlineNode {
  const worldTransform = isIdentityMatrix(worldMatrix) ? undefined : worldMatrix;
  return {
    nodeId: node.nodeId,
    text: node.lines.map((line) => line.text).join("\n"),
    bbox: node.bbox,
    writingMode: node.writingMode,
    paths: node.glyphPaths ?? [],
    ...(worldTransform ? { worldTransform } : {}),
  };
}

function walkTree(
  node: IRNode,
  ancestorMatrix: AffineMatrix,
  visit: (node: IRNode, worldMatrix: AffineMatrix) => void,
): void {
  const worldMatrix = multiplyAffineMatrices(
    ancestorMatrix,
    createResolvedTransformMatrix(node.type === "group" ? node.transform : undefined, node.bbox),
  );
  visit(node, worldMatrix);
  if (node.type !== "group") {
    return;
  }
  for (const child of node.children ?? []) {
    walkTree(child, worldMatrix, visit);
  }
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
