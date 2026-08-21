import {
  type Engine,
  type FlowExclusionShape,
  type GeometryDoc,
  geometryToFlowExclusion,
  type Transform2D,
  type VNode,
} from "@boundsvg/core";
import { Box, Canvas, Inline, Rt, Ruby, Shape, Text, toVNode } from "@boundsvg/react";
import { geometryDoc, pathGeometry } from "@boundsvg/shape";
import type { ReactNode } from "react";
import type { EditorDocument, EditorLayer, EditorTextLayer, EditorTextRun } from "./editor-model";
import { resolveEditorShapeGeometry } from "./editor-shape-geometry";

const EDITOR_BOX_GEOMETRY: GeometryDoc = geometryDoc(
  { width: 100, height: 100 },
  pathGeometry("M0 0H100V100H0Z"),
);

type EditorBuildResult = {
  vnode: VNode;
  warnings: Array<{ code?: string; message?: string; nodeId?: string }>;
};

export function buildEditorVNode(_engine: Engine, document: EditorDocument): EditorBuildResult {
  const warnings: EditorBuildResult["warnings"] = [];
  const visibleLayers = document.layers.filter((layer) => layer.visible);
  for (const layer of visibleLayers) {
    if (
      layer.x < 0 ||
      layer.y < 0 ||
      layer.x + layer.width > document.canvas.width ||
      layer.y + layer.height > document.canvas.height
    ) {
      warnings.push({
        code: "EDITOR_LAYER_OUTSIDE_CANVAS",
        message: `“${layer.name}” extends beyond the Canvas.`,
        nodeId: layer.id,
      });
    }
  }
  const children = visibleLayers.flatMap((layer) => {
    if (layer.type === "text" && layer.flowBindings.length > 0) {
      return buildFlowTextLayer(document, layer);
    }
    return [buildRegularLayer(layer)];
  });

  return {
    vnode: toVNode(
      <Canvas
        width={document.canvas.width}
        height={document.canvas.height}
        background={document.canvas.background}
        meta={{ editor: "controls" }}
      >
        {children}
      </Canvas>,
    ),
    warnings,
  };
}

function buildRegularLayer(layer: EditorLayer): ReactNode {
  const transform = layerTransform(layer);
  if (layer.type === "box") {
    return (
      <Box
        key={layer.id}
        id={layer.id}
        meta={{ "editor-layer-id": layer.id, "editor-type": layer.type }}
        position="absolute"
        left={layer.x}
        top={layer.y}
        width={layer.width}
        height={layer.height}
        opacity={layer.opacity}
        transform={transform}
        background={layer.background}
        borderColor={layer.borderWidth > 0 ? layer.borderColor : undefined}
        borderWidth={layer.borderWidth > 0 ? layer.borderWidth : undefined}
        borderRadius={layer.borderRadius}
        boxShadow={layer.boxShadow || undefined}
      />
    );
  }
  if (layer.type === "shape") {
    return (
      <Shape
        key={layer.id}
        id={layer.id}
        meta={{ "editor-layer-id": layer.id, "editor-type": layer.type }}
        geometry={resolveEditorShapeGeometry(layer)}
        position="absolute"
        left={layer.x}
        top={layer.y}
        width={layer.width}
        height={layer.height}
        opacity={layer.opacity}
        transform={transform}
        fill={layer.fill}
        stroke={layer.strokeWidth > 0 ? layer.stroke : undefined}
        strokeWidth={layer.strokeWidth > 0 ? layer.strokeWidth : undefined}
      />
    );
  }
  return buildTextNode(layer, layer.id, layer.x, layer.y, layer.width, layer.height, layer.runs);
}

function buildTextNode(
  layer: EditorTextLayer,
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  runs: EditorTextRun[],
  flowExclusions?: readonly FlowExclusionShape[],
): ReactNode {
  const transform = layerTransform(layer);
  return (
    <Text
      key={id}
      id={id}
      meta={{ "editor-layer-id": layer.id, "editor-type": layer.type, "source-start": "0" }}
      position="absolute"
      left={x}
      top={y}
      width={width}
      height={height}
      opacity={layer.opacity}
      transform={transform}
      font={layer.font}
      fontSizePx={layer.fontSizePx}
      lineHeight={layer.lineHeight}
      letterSpacingPx={layer.letterSpacingPx || undefined}
      color={layer.color}
      writingMode={layer.writingMode === "vertical-rl" ? layer.writingMode : undefined}
      textOrientation={layer.textOrientation !== "mixed" ? layer.textOrientation : undefined}
      textAlign={layer.textAlign}
      wrap={layer.wrap}
      fit={layer.fit}
      minFontSizePx={layer.fit === "shrink" ? layer.minFontSizePx : undefined}
      maxFontSizePx={layer.fit === "grow" ? layer.maxFontSizePx : undefined}
      maxLines={layer.maxLines > 0 ? layer.maxLines : undefined}
      ellipsis={layer.ellipsis || undefined}
      hangingPunctuation={layer.hangingPunctuation || undefined}
      fontVariationSettings={layer.fontVariationSettings || undefined}
      fontFeatureSettings={layer.fontFeatureSettings || undefined}
      textStrokes={layer.strokes.length > 0 ? layer.strokes : undefined}
      textShadows={layer.shadows.length > 0 ? layer.shadows : undefined}
      whiteSpace="pre-wrap"
      tabSize={4}
      flowExclusions={flowExclusions}
      language="ja"
    >
      {runs.map(renderRun)}
    </Text>
  );
}

function renderRun(run: EditorTextRun): ReactNode {
  if (run.kind === "text") {
    return run.text;
  }
  if (run.kind === "inline") {
    return (
      <Inline
        key={run.id}
        color={run.color}
        fontSizePx={run.fontSizePx}
        textOrientation={run.textOrientation}
        textCombineUpright={run.textCombineUpright}
      >
        {run.text}
      </Inline>
    );
  }
  return (
    <Ruby
      key={run.id}
      rubyPosition={run.rubyPosition}
      rubyAlign={run.rubyAlign}
      rubyGapPx={run.rubyGapPx}
      rubyOffsetPx={run.rubyOffsetPx}
      rubyLineSizing={run.rubyLineSizing}
    >
      {run.base}
      <Rt>{run.rubyText}</Rt>
      {run.extraRubyText ? <Rt>{run.extraRubyText}</Rt> : null}
    </Ruby>
  );
}

function buildFlowTextLayer(document: EditorDocument, layer: EditorTextLayer): ReactNode[] {
  const exclusions = layer.flowBindings.flatMap((binding) => {
    const obstacle = document.layers.find(
      (candidate) => candidate.id === binding.layerId && candidate.visible,
    );
    return obstacle ? [layerToExclusion(obstacle, binding.marginPx, layer.x, layer.y)] : [];
  });
  if (exclusions.length === 0) {
    return [buildRegularLayer(layer)];
  }

  return [
    buildTextNode(
      layer,
      layer.id,
      layer.x,
      layer.y,
      layer.width,
      layer.height,
      layer.runs,
      exclusions,
    ),
  ];
}

function layerToExclusion(
  layer: EditorLayer,
  marginPx: number,
  flowOriginX: number,
  flowOriginY: number,
): FlowExclusionShape {
  return geometryToFlowExclusion(
    layer.type === "shape" ? resolveEditorShapeGeometry(layer) : EDITOR_BOX_GEOMETRY,
    {
      x: layer.x - flowOriginX,
      y: layer.y - flowOriginY,
      width: layer.width,
      height: layer.height,
      marginPx,
      transform: layerTransform(layer),
      nodeId: layer.id,
    },
  );
}

function layerTransform(layer: EditorLayer): Transform2D | undefined {
  return layer.rotateDeg === 0
    ? undefined
    : {
        rotateDeg: layer.rotateDeg,
        originX: layer.width / 2,
        originY: layer.height / 2,
      };
}
