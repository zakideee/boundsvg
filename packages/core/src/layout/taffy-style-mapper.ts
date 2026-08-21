import type { FlexProps, GridProps, Spacing, VNode } from "../vnode/types.js";
import type { LayoutRect, LayoutStyle } from "./layout-style.js";

export type { LayoutStyle } from "./layout-style.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveSpacing(value: Spacing | undefined): LayoutRect {
  if (value == null) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (typeof value === "number") {
    return { top: value, right: value, bottom: value, left: value };
  }
  return { top: value[0], right: value[1], bottom: value[2], left: value[3] };
}

function mapAlignItems(value: string | undefined): LayoutStyle["alignItems"] {
  switch (value) {
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "stretch":
      return "stretch";
    default:
      return "stretch";
  }
}

function mapJustifyContent(value: string | undefined): LayoutStyle["justifyContent"] {
  switch (value) {
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "space-between":
      return "space-between";
    case "space-around":
      return "space-around";
    default:
      return "flex-start";
  }
}

function mapAlignSelf(value: string | undefined): LayoutStyle["alignSelf"] {
  switch (value) {
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "stretch":
      return "stretch";
    default:
      return "auto";
  }
}

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function parseGridLine(line: string): number | undefined {
  const value = Number.parseInt(line, 10);
  return Number.isNaN(value) ? undefined : value;
}

function parseGridEnd(start: number, rawEnd: string): number | undefined {
  const spanMatch = /^span\s+(-?\d+)$/i.exec(rawEnd);
  if (spanMatch) {
    const [, rawSpan = "0"] = spanMatch;
    const span = Number.parseInt(rawSpan, 10);
    if (Number.isNaN(span) || span <= 0) {
      return undefined;
    }
    return start + span;
  }

  const end = parseGridLine(rawEnd);
  return end;
}

function applyGridPlacementFromShorthand(shorthand: string): {
  start: number;
  end?: number;
} | null {
  const parts = shorthand.split("/").map((part) => part.trim());
  const start = parseGridLine(parts[0] ?? "");
  if (start == null) {
    return null;
  }

  let end: number | undefined;
  if (parts.length > 1) {
    end = parseGridEnd(start, parts[1] ?? "");
  }
  return { start, end };
}

type GridPlacementProps = {
  gridColumn?: string;
  gridRow?: string;
};

type FlexItemProps = GridPlacementProps & {
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
};

type SizeProps = {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
};

type BoxModelProps = {
  padding?: Spacing;
  margin?: Spacing;
  overflow?: "visible" | "clip";
};

type GapProps = {
  gap?: number;
  rowGap?: number;
  columnGap?: number;
};

type PositioningProps = {
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  aspectRatio?: number;
};

/**
 * Parse gridColumn/gridRow shorthand (e.g. "1 / 3") into start/end line indices.
 * Sets gridColumnStart/End and gridRowStart/End on the style.
 */
function applyGridPlacement(style: LayoutStyle, props: GridPlacementProps): void {
  const gridColumn = props.gridColumn;
  if (gridColumn) {
    const placement = applyGridPlacementFromShorthand(gridColumn);
    if (placement) {
      style.gridColumnStart = placement.start;
      if (placement.end != null) {
        style.gridColumnEnd = placement.end;
      }
    }
  }
  const gridRow = props.gridRow;
  if (gridRow) {
    const placement = applyGridPlacementFromShorthand(gridRow);
    if (placement) {
      style.gridRowStart = placement.start;
      if (placement.end != null) {
        style.gridRowEnd = placement.end;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shared style application helpers
// ---------------------------------------------------------------------------

function applyFlexItemProps(style: LayoutStyle, props: FlexItemProps): void {
  style.flexGrow = num(props.flexGrow) ?? 0;
  style.flexShrink = num(props.flexShrink) ?? 1;
  style.flexBasis = props.flexBasis === "auto" ? null : (num(props.flexBasis) ?? null);
  style.alignSelf = mapAlignSelf(props.alignSelf);
  applyGridPlacement(style, props);
}

function applySizeProps(style: LayoutStyle, props: SizeProps): void {
  style.size = { width: num(props.width), height: num(props.height) };
  style.minSize = { width: num(props.minWidth), height: num(props.minHeight) };
  style.maxSize = { width: num(props.maxWidth), height: num(props.maxHeight) };
}

function applyBoxModelProps(style: LayoutStyle, props: BoxModelProps): void {
  style.padding = resolveSpacing(props.padding);
  style.margin = resolveSpacing(props.margin);
  style.overflow = props.overflow === "clip" ? "hidden" : "visible";
}

function applyGapProps(style: LayoutStyle, props: GapProps): void {
  const gap = num(props.gap) ?? 0;
  const rowGap = num(props.rowGap) ?? gap;
  const columnGap = num(props.columnGap) ?? gap;
  style.gap = { top: rowGap, right: columnGap, bottom: rowGap, left: columnGap };
}

function applyPositioning(style: LayoutStyle, props: PositioningProps): void {
  if (props.position === "absolute") {
    style.position = "absolute";
  }
  // Unspecified sides stay null (auto): defaulting them to 0 would make a
  // lone `right`/`bottom` inert — the implicit 0 on the opposite side wins.
  const top = num(props.top);
  const right = num(props.right);
  const bottom = num(props.bottom);
  const left = num(props.left);
  if (top !== null || right !== null || bottom !== null || left !== null) {
    style.inset = { top, right, bottom, left };
  }
  const aspectRatio = num(props.aspectRatio);
  if (aspectRatio !== null) {
    style.aspectRatio = aspectRatio;
  }
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

/**
 * Convert a VNode's props to a LayoutStyle object.
 *
 * All style conversion is centralized here.
 * Box defaults to direction=column.
 */
export function mapToLayoutStyle(node: VNode): LayoutStyle {
  const style: LayoutStyle = {
    display: "flex",
    flexDirection: "column",
    flexWrap: "nowrap",
    alignItems: "stretch",
    justifyContent: "flex-start",
    alignSelf: "auto",
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: null,
    gap: { top: 0, right: 0, bottom: 0, left: 0 },
    size: { width: null, height: null },
    minSize: { width: null, height: null },
    maxSize: { width: null, height: null },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    overflow: "visible",
    position: "relative",
    inset: { top: null, right: null, bottom: null, left: null },
    aspectRatio: null,
  };

  switch (node.type) {
    case "Canvas":
      style.size = { width: node.props.width, height: node.props.height };
      break;
    case "Flex":
      mapFlexStyle(style, node.props);
      break;
    case "Grid":
      mapGridStyle(style, node.props);
      break;
    case "Box":
      applyGridPlacement(style, node.props);
      applySizeProps(style, node.props);
      applyBoxModelProps(style, node.props);
      break;
    case "Text":
      applyFlexItemProps(style, node.props);
      applySizeProps(style, node.props);
      style.padding = resolveSpacing(node.props.padding);
      style.margin = resolveSpacing(node.props.margin);
      break;
    case "TextOnPath":
      style.size = { width: node.props.width, height: node.props.height };
      style.margin = resolveSpacing(node.props.margin);
      break;
    case "Inline":
    case "InlineRect":
      break;
    case "Image":
    case "Path":
    case "Svg":
    case "Shape":
    case "Symbol":
      style.size = { width: node.props.width, height: node.props.height };
      applyFlexItemProps(style, node.props);
      style.margin = resolveSpacing(node.props.margin);
      break;
  }

  switch (node.type) {
    case "Flex":
    case "Grid":
    case "Box":
    case "Text":
    case "TextOnPath":
    case "Image":
    case "Path":
    case "Svg":
    case "Shape":
    case "Symbol":
      applyPositioning(style, node.props);
      break;
  }

  return style;
}

function mapFlexStyle(style: LayoutStyle, props: FlexProps): void {
  style.flexDirection = props.direction === "row" ? "row" : "column";
  style.flexWrap = props.wrap === "wrap" ? "wrap" : "nowrap";
  style.alignItems = mapAlignItems(props.alignItems);
  style.justifyContent = mapJustifyContent(props.justifyContent);
  applyGapProps(style, props);
  applyFlexItemProps(style, props);
  applySizeProps(style, props);
  applyBoxModelProps(style, props);
}

function mapGridStyle(style: LayoutStyle, props: GridProps): void {
  style.display = "grid";
  const templateColumns = props.templateColumns;
  if (templateColumns) {
    style.gridTemplateColumns = templateColumns.trim().split(/\s+/);
  }
  const templateRows = props.templateRows;
  if (templateRows) {
    style.gridTemplateRows = templateRows.trim().split(/\s+/);
  }
  applyGapProps(style, props);
  style.alignItems = mapAlignItems(props.alignItems);
  if (props.justifyItems != null) {
    style.justifyItems = props.justifyItems;
  }
  style.alignSelf = mapAlignSelf(props.alignSelf);
  applyGridPlacement(style, props);
  applySizeProps(style, props);
  applyBoxModelProps(style, props);
}
