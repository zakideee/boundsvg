import type { InspectionBBox, SceneInspection } from "@boundsvg/core/inspect";
import type { IRNodeType, IRSourceInfo } from "@boundsvg/core/scene";
import type { CSSProperties, ReactNode } from "react";

/** Presentation and occurrence selection for the non-interactive debug overlay. */
export type BoundSvgDebugOverlayProps = {
  inspection: SceneInspection | null;
  className?: string;
  style?: CSSProperties;
  /** Controls how much text is drawn next to each bbox. */
  labelMode?: DebugOverlayLabelMode;
  /** @deprecated Use labelMode instead. */
  showLabels?: boolean;
  filter?: (bbox: InspectionBBox) => boolean;
  /** Convenience highlight for one selected inspection bbox. */
  selectedNodeIndex?: number | null;
  /** Highlight inspection bboxes by physical occurrence ordinal while keeping the overlay non-interactive. */
  highlightedNodeIndices?: readonly number[];
  /** Highlight custom px bboxes such as crop, hover, or validation regions. */
  highlightedBBoxes?: readonly DebugOverlayHighlight[];
  highlightColor?: string;
};

/** Label density for the SVG debug overlay. */
export type DebugOverlayLabelMode = "none" | "node-id" | "summary" | "metrics";

/** A custom px bbox that can be drawn above inspection bboxes. */
export type DebugOverlayHighlight = {
  id?: string;
  nodeId?: string;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
};

/** Scene and physical occurrence displayed by the inspector panel. */
export type NodeInspectorPanelProps = {
  inspection: SceneInspection | null;
  selectedNodeIndex?: number | null;
  className?: string;
  empty?: ReactNode;
};

/**
 * Render a non-interactive SVG bbox overlay from a scene inspection.
 */
export function BoundSvgDebugOverlay({
  inspection,
  className,
  style,
  labelMode,
  showLabels,
  filter,
  selectedNodeIndex,
  highlightedNodeIndices = [],
  highlightedBBoxes = [],
  highlightColor = "#06b6d4",
}: BoundSvgDebugOverlayProps) {
  if (!inspection) {
    return null;
  }

  const bboxes = filter ? inspection.bboxes.filter(filter) : inspection.bboxes;
  const resolvedLabelMode = resolveLabelMode(labelMode, showLabels);
  const highlightedNodeIndexSet = new Set(highlightedNodeIndices);
  if (selectedNodeIndex != null) {
    highlightedNodeIndexSet.add(selectedNodeIndex);
  }
  const highlightedNodeBBoxes: DebugOverlayHighlight[] = bboxes
    .filter((bbox) => highlightedNodeIndexSet.has(bbox.nodeIndex))
    .map((bbox) => ({
      id: `node:${bbox.nodeIndex}`,
      nodeId: bbox.nodeId,
      x: bbox.layoutBBox.x,
      y: bbox.layoutBBox.y,
      w: bbox.layoutBBox.w,
      h: bbox.layoutBBox.h,
      color: highlightColor,
    }));
  const highlights = [...highlightedNodeBBoxes, ...highlightedBBoxes];

  return (
    <svg
      className={className}
      viewBox={`0 0 ${inspection.stats.width} ${inspection.stats.height}`}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
        ...style,
      }}
    >
      <g data-layer="base-bboxes">
        {bboxes.map((bbox) => (
          <DebugBBox
            key={bbox.nodeIndex}
            bbox={bbox}
            source={inspection.sourceIndex.sources.get(bbox.source.sourceIndex)}
            labelMode={resolvedLabelMode}
          />
        ))}
      </g>
      <g data-layer="highlight-bboxes">
        {highlights.map((highlight, index) => (
          <DebugHighlight
            key={highlight.id ?? `${highlight.nodeId ?? "bbox"}:${index}`}
            highlight={highlight}
            fallbackColor={highlightColor}
          />
        ))}
      </g>
    </svg>
  );
}

function resolveLabelMode(
  labelMode: DebugOverlayLabelMode | undefined,
  showLabels: boolean | undefined,
): DebugOverlayLabelMode {
  if (labelMode) {
    return labelMode;
  }
  if (showLabels === false) {
    return "none";
  }
  return "summary";
}

function DebugBBox({
  bbox,
  source,
  labelMode,
}: {
  bbox: InspectionBBox;
  source: IRSourceInfo | undefined;
  labelMode: DebugOverlayLabelMode;
}) {
  const color = getBBoxColor(bbox, source);
  const labelLines = getBBoxLabelLines(bbox, labelMode, source);
  return (
    <g>
      <rect
        x={bbox.layoutBBox.x}
        y={bbox.layoutBBox.y}
        width={bbox.layoutBBox.w}
        height={bbox.layoutBBox.h}
        fill="none"
        stroke={color}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        opacity={0.72}
      />
      {labelLines.length > 0 && (
        <DebugLabel
          x={bbox.layoutBBox.x + 3}
          y={bbox.layoutBBox.y + 3}
          color={color}
          lines={labelLines}
        />
      )}
    </g>
  );
}

function DebugHighlight({
  highlight,
  fallbackColor,
}: {
  highlight: DebugOverlayHighlight;
  fallbackColor: string;
}) {
  const color = highlight.color ?? fallbackColor;
  const labelLines = getHighlightLabelLines(highlight);
  return (
    <g>
      <rect
        x={highlight.x}
        y={highlight.y}
        width={highlight.w}
        height={highlight.h}
        fill={color}
        fillOpacity={0.1}
        stroke={color}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <DebugLabel x={highlight.x + 4} y={highlight.y + 4} color={color} lines={labelLines} />
    </g>
  );
}

function DebugLabel({
  x,
  y,
  color,
  lines,
}: {
  x: number;
  y: number;
  color: string;
  lines: readonly string[];
}) {
  const fontSize = 10;
  const lineHeight = 12;
  const width = Math.max(...lines.map((line) => line.length)) * 6 + 8;
  const height = lines.length * lineHeight + 6;

  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        width={width}
        height={height}
        fill="#0f172a"
        stroke={color}
        strokeWidth={1}
        opacity={0.92}
      />
      {lines.map((line, index) => (
        <text
          key={`${line}:${index}`}
          x={4}
          y={index * lineHeight + fontSize + 2}
          fill="#f8fafc"
          fontFamily="JetBrains Mono, SFMono-Regular, Consolas, monospace"
          fontSize={fontSize}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function getBBoxColor(bbox: InspectionBBox, source: IRSourceInfo | undefined): string {
  if (
    source?.node.ownership.role === "source" &&
    Object.keys(source.node.ownership.on ?? {}).length > 0
  ) {
    return "#22c55e";
  }
  return NODE_TYPE_COLORS[bbox.type];
}

/** Debug-overlay colors for physical IR node types. */
const NODE_TYPE_COLORS: Record<IRNodeType, string> = {
  group: "#94a3b8",
  rect: "#ef4444",
  text: "#f59e0b",
  image: "#84cc16",
  path: "#14b8a6",
  svg: "#38bdf8",
  shape: "#a855f7",
};

function getBBoxLabelLines(
  bbox: InspectionBBox,
  labelMode: DebugOverlayLabelMode,
  source: IRSourceInfo | undefined,
): readonly string[] {
  if (labelMode === "none") {
    return [];
  }
  if (labelMode === "node-id") {
    return [bbox.nodeId];
  }

  const drawLabel = bbox.paintOrder == null ? "#-" : `#${bbox.paintOrder}`;
  const summary = `${bbox.type} ${formatNumber(bbox.layoutBBox.w)}x${formatNumber(bbox.layoutBBox.h)} @ ${formatNumber(
    bbox.layoutBBox.x,
  )},${formatNumber(bbox.layoutBBox.y)} d${bbox.depth} ${drawLabel}`;
  if (labelMode === "summary") {
    return [bbox.nodeId, summary];
  }

  return [
    bbox.nodeId,
    summary,
    source?.node.ownership.role === "source" &&
    Object.keys(source.node.ownership.on ?? {}).length > 0
      ? "source handlers yes"
      : "source handlers none",
    bbox.paintOrder == null ? "paint order none" : `paint order ${bbox.paintOrder}`,
  ];
}

function getHighlightLabelLines(highlight: DebugOverlayHighlight): readonly string[] {
  const title = highlight.label ?? highlight.nodeId ?? "custom bbox";
  return [
    title,
    `${formatNumber(highlight.w)}x${formatNumber(highlight.h)} @ ${formatNumber(
      highlight.x,
    )},${formatNumber(highlight.y)}`,
  ];
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1).replace(/\.0$/, "");
}

/**
 * Render a minimal details panel for one inspected node.
 */
export function NodeInspectorPanel({
  inspection,
  selectedNodeIndex,
  className,
  empty = null,
}: NodeInspectorPanelProps) {
  if (!inspection) {
    return <>{empty}</>;
  }

  const selected =
    selectedNodeIndex != null
      ? inspection.bboxes.find((bbox) => bbox.nodeIndex === selectedNodeIndex)
      : inspection.bboxes[0];

  if (!selected) {
    return <>{empty}</>;
  }

  const source = inspection.sourceIndex.sources.get(selected.source.sourceIndex);
  const handlers = source?.node.ownership.role === "source" ? source.node.ownership.on : undefined;
  const text = inspection.textMap.nodes.get(selected.source.sourceIndex)?.text ?? null;

  return (
    <section className={className}>
      <dl>
        <dt>nodeId</dt>
        <dd>{selected.nodeId}</dd>
        <dt>type</dt>
        <dd>{selected.type}</dd>
        <dt>position</dt>
        <dd>
          {selected.layoutBBox.x}, {selected.layoutBBox.y}
        </dd>
        <dt>size</dt>
        <dd>
          {selected.layoutBBox.w} x {selected.layoutBBox.h}
        </dd>
        <dt>bbox</dt>
        <dd>
          {selected.layoutBBox.x}, {selected.layoutBBox.y}, {selected.layoutBBox.w} x{" "}
          {selected.layoutBBox.h}
        </dd>
        <dt>depth</dt>
        <dd>{selected.depth}</dd>
        <dt>paintOrder</dt>
        <dd>{selected.paintOrder ?? "none"}</dd>
        <dt>handlers</dt>
        <dd>
          {handlers
            ? Object.entries(handlers)
                .map(([key, value]) => `${key}:${value}`)
                .join(", ")
            : "none"}
        </dd>
        <dt>text</dt>
        <dd>{text ?? "none"}</dd>
      </dl>
    </section>
  );
}
