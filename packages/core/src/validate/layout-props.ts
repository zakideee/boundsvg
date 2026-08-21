import { FatalError } from "../errors.js";
import type { VNode, VNodeFor } from "../vnode/types.js";

// ---------------------------------------------------------------------------
// Layout prop contracts
//
// Out-of-contract layout values do not fail loudly downstream: NaN/Infinity
// become null at the JSON boundary (read as "unspecified"), strings like
// "50%" collapse to 0, and unknown enum values fall back to defaults — all
// reported as success. The contract is enforced here instead.
// ---------------------------------------------------------------------------

/** Finite and >= 0. */
const NON_NEGATIVE_NUMBER_PROPS = [
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "gap",
  "rowGap",
  "columnGap",
  "flexGrow",
  "flexShrink",
] as const;

/** Finite; negative values are meaningful (offsets). */
const FINITE_NUMBER_PROPS = ["top", "right", "bottom", "left"] as const;

/** Enum props shared by every layout node. */
const COMMON_LAYOUT_ENUM_PROPS: Record<string, ReadonlySet<string>> = {
  position: new Set(["relative", "absolute"]),
  overflow: new Set(["visible", "clip"]),
  alignSelf: new Set(["auto", "start", "center", "end", "stretch"]),
};

/** Flex-container enum props (`wrap` here is flex wrapping — Text has its own `wrap`). */
const FLEX_ENUM_PROPS: Record<string, ReadonlySet<string>> = {
  direction: new Set(["row", "column"]),
  wrap: new Set(["nowrap", "wrap"]),
  alignItems: new Set(["start", "center", "end", "stretch"]),
  justifyContent: new Set(["start", "center", "end", "space-between", "space-around"]),
};

const GRID_ENUM_PROPS: Record<string, ReadonlySet<string>> = {
  alignItems: new Set(["start", "center", "end", "stretch"]),
  justifyItems: new Set(["start", "center", "end", "stretch"]),
};

/** `start[ / end]` where a line is an integer and end may be `span <n>`. */
const GRID_PLACEMENT_PATTERN = /^\s*-?\d+\s*(?:\/\s*(?:-?\d+|span\s+\d+)\s*)?$/i;

/** Track sizes the engine supports: `auto`, `<n>px`, `<n>fr`, bare number. */
const GRID_TRACK_PATTERN = /^(?:auto|\d+(?:\.\d+)?(?:px|fr)?)$/i;

export function layoutContractError(nid: string, message: string): FatalError {
  return new FatalError("VALIDATION", `Validation error: ${message} (${nid})`, {
    stage: "validate",
    nodeId: nid,
  });
}

export function validateFiniteNumberProp(
  props: Record<string, unknown>,
  key: string,
  nid: string,
): void {
  const value = props[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw layoutContractError(
      nid,
      `'${key}' must be a finite number in px, got ${JSON.stringify(value)}`,
    );
  }
}

function validateNonNegativeNumberProp(
  props: Record<string, unknown>,
  key: string,
  nid: string,
): void {
  validateFiniteNumberProp(props, key, nid);
  const value = props[key];
  if (typeof value === "number" && value < 0) {
    throw layoutContractError(nid, `'${key}' must not be negative, got ${value}`);
  }
}

function validateSpacingProp(props: Record<string, unknown>, key: string, nid: string): void {
  const value = props[key];
  if (value === undefined) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw layoutContractError(nid, `'${key}' must be finite, got ${String(value)}`);
    }
    return;
  }
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((side) => typeof side !== "number" || !Number.isFinite(side))
  ) {
    throw layoutContractError(
      nid,
      `'${key}' must be a number or a [top, right, bottom, left] tuple of finite numbers, got ${JSON.stringify(value)}`,
    );
  }
}

export function validateLayoutNumberProps(node: VNode, nid: string): void {
  const props = node.props as Record<string, unknown>;
  for (const key of NON_NEGATIVE_NUMBER_PROPS) {
    validateNonNegativeNumberProp(props, key, nid);
  }
  for (const key of FINITE_NUMBER_PROPS) {
    validateFiniteNumberProp(props, key, nid);
  }

  const aspectRatio = props.aspectRatio;
  if (aspectRatio !== undefined) {
    if (typeof aspectRatio !== "number" || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
      throw layoutContractError(
        nid,
        `'aspectRatio' must be a finite number greater than 0, got ${JSON.stringify(aspectRatio)}`,
      );
    }
  }

  const flexBasis = props.flexBasis;
  if (flexBasis !== undefined && flexBasis !== "auto") {
    validateNonNegativeNumberProp(props, "flexBasis", nid);
  }

  validateSpacingProp(props, "padding", nid);
  validateSpacingProp(props, "margin", nid);
}

function validateLayoutEnumProps(node: VNode, props: Record<string, unknown>, nid: string): void {
  const enumTables = [
    COMMON_LAYOUT_ENUM_PROPS,
    ...(node.type === "Flex" ? [FLEX_ENUM_PROPS] : []),
    ...(node.type === "Grid" ? [GRID_ENUM_PROPS] : []),
  ];
  for (const table of enumTables) {
    for (const [key, allowed] of Object.entries(table)) {
      const value = props[key];
      if (value !== undefined && (typeof value !== "string" || !allowed.has(value))) {
        throw layoutContractError(
          nid,
          `'${key}' must be one of ${[...allowed].join(" | ")}, got ${JSON.stringify(value)}`,
        );
      }
    }
  }
}

function validateGridPlacementProps(props: Record<string, unknown>, nid: string): void {
  for (const key of ["gridColumn", "gridRow"] as const) {
    const value = props[key];
    if (value !== undefined) {
      if (typeof value !== "string" || !GRID_PLACEMENT_PATTERN.test(value)) {
        throw layoutContractError(
          nid,
          `'${key}' must be "<line>" or "<line> / <line|span n>", got ${JSON.stringify(value)}`,
        );
      }
    }
  }
}

export function validateLayoutEnumAndGridProps(node: VNode, nid: string): void {
  const props = node.props as Record<string, unknown>;
  validateLayoutEnumProps(node, props, nid);
  validateGridPlacementProps(props, nid);
}

function validateGridTemplateProp(value: string, key: string, nid: string): void {
  const tokens = value.trim().split(/\s+/);
  for (const token of tokens) {
    if (!GRID_TRACK_PATTERN.test(token)) {
      throw layoutContractError(
        nid,
        `Grid '${key}' contains unsupported track "${token}" — supported tracks are auto, <n>px, <n>fr, and bare numbers`,
      );
    }
  }
}

export function validateGridNode(node: VNodeFor<"Grid">, nid: string): void {
  const templateColumns = node.props.templateColumns;
  if (templateColumns !== undefined) {
    if (typeof templateColumns !== "string") {
      throw new FatalError(
        "VALIDATION",
        "Validation error: Grid 'templateColumns' must be a string",
        { stage: "validate", nodeId: nid },
      );
    }
    validateGridTemplateProp(templateColumns, "templateColumns", nid);
  }
  const templateRows = node.props.templateRows;
  if (templateRows !== undefined) {
    if (typeof templateRows !== "string") {
      throw new FatalError("VALIDATION", "Validation error: Grid 'templateRows' must be a string", {
        stage: "validate",
        nodeId: nid,
      });
    }
    validateGridTemplateProp(templateRows, "templateRows", nid);
  }
}
