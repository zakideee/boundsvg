import type { GeometryDoc, GeometryNode } from "@boundsvg/core";
import {
  type BooleanOp,
  booleanGeometry,
  geometryDoc,
  pathGeometry,
  transformGeometry,
} from "@boundsvg/shape";
import { CALLOUT_GEOMETRY, NOTCH_CARD_GEOMETRY, PILL_GEOMETRY } from "../shapes/defs";
import type { EditorShapeLayer } from "./editor-model";

const CIRCLE_KAPPA = 27.614237;
const EDITOR_CIRCLE_GEOMETRY: GeometryDoc = geometryDoc(
  { width: 100, height: 100 },
  pathGeometry(
    `M50 0C${50 + CIRCLE_KAPPA} 0 100 ${50 - CIRCLE_KAPPA} 100 50` +
      `C100 ${50 + CIRCLE_KAPPA} ${50 + CIRCLE_KAPPA} 100 50 100` +
      `C${50 - CIRCLE_KAPPA} 100 0 ${50 + CIRCLE_KAPPA} 0 50` +
      `C0 ${50 - CIRCLE_KAPPA} ${50 - CIRCLE_KAPPA} 0 50 0Z`,
  ),
);

type EditorGeometryBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function resolveEditorShapeGeometry(layer: EditorShapeLayer): GeometryDoc {
  if (layer.customGeometry) {
    return layer.customGeometry;
  }
  switch (layer.shapeKind) {
    case "pill":
      return PILL_GEOMETRY;
    case "notch":
      return NOTCH_CARD_GEOMETRY;
    case "callout":
      return CALLOUT_GEOMETRY;
    case "circle":
      return EDITOR_CIRCLE_GEOMETRY;
  }
}

export function createEditorBooleanGeometry(
  operation: BooleanOp,
  layers: EditorShapeLayer[],
  bounds: EditorGeometryBounds,
): GeometryDoc {
  return geometryDoc(
    {
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    },
    booleanGeometry(
      operation,
      layers.map((layer) => normalizeShapeToResult(layer, bounds)),
    ),
  );
}

function normalizeShapeToResult(
  layer: EditorShapeLayer,
  bounds: EditorGeometryBounds,
): GeometryNode {
  const geometry = resolveEditorShapeGeometry(layer);
  const viewBoxX = geometry.viewBox.x ?? 0;
  const viewBoxY = geometry.viewBox.y ?? 0;
  let root = geometry.root;
  if (viewBoxX !== 0 || viewBoxY !== 0) {
    root = transformGeometry({ translateX: -viewBoxX, translateY: -viewBoxY }, root);
  }
  root = transformGeometry(
    {
      scaleX: layer.width / geometry.viewBox.width,
      scaleY: layer.height / geometry.viewBox.height,
    },
    root,
  );
  if (layer.rotateDeg !== 0) {
    root = transformGeometry(
      {
        rotateDeg: layer.rotateDeg,
        originX: layer.width / 2,
        originY: layer.height / 2,
      },
      root,
    );
  }
  return transformGeometry(
    {
      translateX: layer.x - bounds.left,
      translateY: layer.y - bounds.top,
    },
    root,
  );
}
