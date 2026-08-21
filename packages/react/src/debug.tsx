import type { InspectionBBox, SceneInspection } from "@boundsvg/core/inspect";
import type { IRNodeType } from "@boundsvg/core/scene";
import type { CSSProperties, ReactNode } from "react";

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
  selectedNodeId?: string | null;
  /** Highlight inspection bboxes by node ID while keeping the overlay non-interactive. */
  highlightedNodeIds?: readonly string[];
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

export type NodeInspectorPanelProps = {
  inspection: SceneInspection | null;
  selectedNodeId?: string | null;
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
  selectedNodeId,
  highlightedNodeIds = [],
  highlightedBBoxes = [],
  highlightColor = "#06b6d4",
}: BoundSvgDebugOverlayProps) {
  if (!inspection) {
    return null;
  }

  const bboxes = filter ? inspection.bboxes.filter(filter) : inspection.bboxes;
  const resolvedLabelMode = resolveLabelMode(labelMode, showLabels);
  const highlightedNodeIdSet = new Set(highlightedNodeIds);
  if (selectedNodeId != null) {
    highlightedNodeIdSet.add(selectedNodeId);
  }
  const highlightedNodeBBoxes: DebugOverlayHighlight[] = bboxes
    .filter((bbox) => highlightedNodeIdSet.has(bbox.nodeId))
    .map((bbox) => ({
      id: `node:${bbox.nodeId}`,
      nodeId: bbox.nodeId,
      x: bbox.x,
      y: bbox.y,
      w: bbox.w,
      h: bbox.h,
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
            key={`${bbox.nodeId}:${bbox.depth}`}
            bbox={bbox}
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
  labelMode,
}: {
  bbox: InspectionBBox;
  labelMode: DebugOverlayLabelMode;
}) {
  const color = getBBoxColor(bbox);
  const labelLines = getBBoxLabelLines(bbox, labelMode);
  return (
    <g>
      <rect
        x={bbox.x}
        y={bbox.y}
        width={bbox.w}
        height={bbox.h}
        fill="none"
        stroke={color}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        opacity={0.72}
      />
      {labelLines.length > 0 && (
        <DebugLabel x={bbox.x + 3} y={bbox.y + 3} color={color} lines={labelLines} />
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

function getBBoxColor(bbox: InspectionBBox): string {
  if (bbox.hasHandlers) {
    return "#22c55e";
  }
  return NODE_TYPE_COLORS[bbox.type];
}

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
): readonly string[] {
  if (labelMode === "none") {
    return [];
  }
  if (labelMode === "node-id") {
    return [bbox.nodeId];
  }

  const drawLabel = bbox.drawIndex == null ? "#-" : `#${bbox.drawIndex}`;
  const summary = `${bbox.type} ${formatNumber(bbox.w)}x${formatNumber(bbox.h)} @ ${formatNumber(
    bbox.x,
  )},${formatNumber(bbox.y)} d${bbox.depth} ${drawLabel}`;
  if (labelMode === "summary") {
    return [bbox.nodeId, summary];
  }

  return [
    bbox.nodeId,
    summary,
    bbox.hasHandlers ? "handlers yes" : "handlers none",
    bbox.drawIndex == null ? "draw order none" : `draw order ${bbox.drawIndex}`,
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
  selectedNodeId,
  className,
  empty = null,
}: NodeInspectorPanelProps) {
  if (!inspection) {
    return <>{empty}</>;
  }

  const selected =
    selectedNodeId != null
      ? inspection.bboxes.find((bbox) => bbox.nodeId === selectedNodeId)
      : inspection.bboxes[0];

  if (!selected) {
    return <>{empty}</>;
  }

  const handlers = inspection.handlerMap.get(selected.nodeId);
  const text = inspection.textMap.nodes.get(selected.nodeId)?.text ?? null;

  return (
    <section className={className}>
      <dl>
        <dt>nodeId</dt>
        <dd>{selected.nodeId}</dd>
        <dt>type</dt>
        <dd>{selected.type}</dd>
        <dt>position</dt>
        <dd>
          {selected.x}, {selected.y}
        </dd>
        <dt>size</dt>
        <dd>
          {selected.w} x {selected.h}
        </dd>
        <dt>bbox</dt>
        <dd>
          {selected.x}, {selected.y}, {selected.w} x {selected.h}
        </dd>
        <dt>depth</dt>
        <dd>{selected.depth}</dd>
        <dt>drawIndex</dt>
        <dd>{selected.drawIndex ?? "none"}</dd>
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
