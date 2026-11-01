import { parseColor } from "../color.js";
import { FatalError } from "../errors.js";
import type { Spacing } from "../vnode/types.js";

/** Largest authored border or outline length in px. */
const BOX_LENGTH_MAX = 1_048_576;
/** Stroke fields accepted by the single container outline contract. */
const OUTLINE_FIELDS = new Set([
  "stroke",
  "strokeWidth",
  "strokeScaling",
  "strokeDasharray",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeMiterlimit",
]);

/** Normalize the four layout widths exactly as the native f32 boundary does. */
export function resolveBorderWidths(width: Spacing | undefined): [number, number, number, number] {
  const widths = typeof width === "number" ? [width, width, width, width] : (width ?? [0, 0, 0, 0]);
  return [
    Math.fround(widths[0] ?? 0),
    Math.fround(widths[1] ?? 0),
    Math.fround(widths[2] ?? 0),
    Math.fround(widths[3] ?? 0),
  ];
}

function isBoxLength(value: unknown, minimum = 0): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= BOX_LENGTH_MAX
  );
}

function validateBorderWidths(width: unknown, reject: (message: string) => never): boolean {
  if (width === undefined) {
    return false;
  }
  const widths =
    typeof width === "number"
      ? [width]
      : Array.isArray(width) && width.length === 4
        ? width
        : reject("borderWidth must be a number or four-element tuple.");
  let hasBorder = false;
  for (const edge of widths) {
    if (!isBoxLength(edge)) {
      reject("borderWidth must contain nonnegative finite widths at most 1048576.");
    }
    hasBorder ||= Math.fround(edge) > 0;
  }
  return hasBorder;
}

function validateBorderLayoutLengths(
  fields: Record<string, unknown>,
  reject: (message: string) => never,
): void {
  for (const key of [
    "width",
    "height",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "padding",
    "margin",
    "gap",
    "rowGap",
    "columnGap",
    "top",
    "right",
    "bottom",
    "left",
    "flexBasis",
  ]) {
    const length = fields[key];
    if (length === undefined || (key === "flexBasis" && length === "auto")) {
      continue;
    }
    const lengths = Array.isArray(length) ? length : [length];
    if (
      lengths.some(
        (scalar) =>
          typeof scalar !== "number" ||
          !Number.isFinite(scalar) ||
          Math.abs(scalar) > BOX_LENGTH_MAX,
      )
    ) {
      reject(`Border layout ${key} must contain finite lengths with magnitude at most 1048576.`);
    }
  }
}

function isOutlineFieldValue(key: string, value: unknown): boolean {
  switch (key) {
    case "stroke":
    case "strokeDasharray":
      return typeof value === "string";
    case "strokeWidth":
      return isBoxLength(value);
    case "strokeMiterlimit":
      return isBoxLength(value, 1);
    case "strokeScaling":
      return value === "transform" || value === "canvas";
    case "strokeLinecap":
      return value === "butt" || value === "round" || value === "square";
    case "strokeLinejoin":
      return value === "miter" || value === "round" || value === "bevel";
    default:
      return false;
  }
}

function validateOutline(
  outline: unknown,
  nodeId: string,
  reject: (message: string) => never,
): void {
  if (!outline || typeof outline !== "object" || Array.isArray(outline)) {
    reject("outline must be an object.");
  }
  const line = outline as Record<string, unknown>;
  if (typeof line.stroke !== "string") {
    reject("outline.stroke must be a string.");
  }
  if (typeof line.stroke === "string" && line.stroke.trim().toLowerCase() !== "none") {
    parseColor(line.stroke, { nodeId });
  }
  for (const [key, value] of Object.entries(line)) {
    if (!OUTLINE_FIELDS.has(key)) {
      reject(`Unknown outline field ${key}.`);
    }
    if (value !== undefined && !isOutlineFieldValue(key, value)) {
      reject(`Invalid outline field ${key}.`);
    }
  }
}

function validateBorderRadius(radius: unknown, reject: (message: string) => never): void {
  if (radius === undefined) {
    return;
  }
  const radii =
    typeof radius === "number"
      ? [radius]
      : Array.isArray(radius) && radius.length === 4
        ? radius
        : reject("borderRadius must be a number or four-element tuple.");
  if (
    radii.some((corner) => typeof corner !== "number" || !Number.isFinite(corner) || corner < 0)
  ) {
    reject("Border and outline require nonnegative finite borderRadius.");
  }
}

/**
 * Validate the independent container surface border and outer-contour line.
 * @throws {FatalError} VALIDATION for removed fields, invalid numeric domains, or malformed outlines.
 */
export function validateContainerVisualProps(props: object, nodeId: string): void {
  const fields = props as Record<string, unknown>;
  const reject = (message: string): never => {
    throw new FatalError("VALIDATION", message, { stage: "validate", nodeId });
  };
  for (const key of [
    "strokeScaling",
    "strokeLinecap",
    "strokeLinejoin",
    "strokeDasharray",
    "strokeMiterlimit",
  ]) {
    if (Object.hasOwn(fields, key)) {
      reject(`Container ${key} was removed; use outline or Path stroke styling.`);
    }
  }
  const hasBorder = validateBorderWidths(fields.borderWidth, reject);
  if (hasBorder) {
    validateBorderLayoutLengths(fields, reject);
  }
  if (fields.outline !== undefined) {
    validateOutline(fields.outline, nodeId, reject);
  }
  if (hasBorder || fields.outline !== undefined) {
    validateBorderRadius(fields.borderRadius, reject);
  }
}
