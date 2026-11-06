import { FatalError } from "./errors.js";
import type { Transform2D } from "./shape/types.js";
import type { RelativePosition } from "./vnode/types.js";

/** Smallest positive normal binary64 ratio accepted at the authoring boundary. */
const POSITION_RATIO_MIN = 2 ** -1022;

/** Canonical two-axis ratios for the closed box-position vocabulary. */
const keywordPositions: Readonly<Record<string, RelativePosition>> = {
  "top left": { x: 0, y: 0 },
  top: { x: 0.5, y: 0 },
  "top right": { x: 1, y: 0 },
  left: { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  right: { x: 1, y: 0.5 },
  "bottom left": { x: 0, y: 1 },
  bottom: { x: 0.5, y: 1 },
  "bottom right": { x: 1, y: 1 },
};

function isPositionRatio(ratio: unknown): ratio is number {
  return (
    typeof ratio === "number" &&
    Number.isFinite(ratio) &&
    ratio >= 0 &&
    ratio <= 1 &&
    (ratio === 0 || ratio >= POSITION_RATIO_MIN)
  );
}

/**
 * Validate a node's optional box-relative origin and return detached ratios for transport.
 * Reject mixed pixel origins and malformed positions before JSON can erase invalid numbers.
 */
export function resolveTransformOrigin(
  position: unknown,
  transform: Transform2D | undefined,
  nodeId: string,
): RelativePosition | undefined {
  if (position === undefined) {
    return undefined;
  }
  const invalid = (reason: string): never => {
    throw new FatalError("VALIDATION", `Validation error: transformOrigin ${reason}`, {
      stage: "validate",
      nodeId,
    });
  };
  let relative: RelativePosition;
  if (typeof position === "string") {
    const keywordPosition = keywordPositions[position];
    if (keywordPosition === undefined || !Object.hasOwn(keywordPositions, position)) {
      return invalid("must be one of the nine box-position keywords");
    }
    relative = { ...keywordPosition };
  } else {
    if (typeof position !== "object" || position === null || Array.isArray(position)) {
      return invalid("must be a box-position keyword or an object with x and y ratios");
    }
    const keys = Reflect.ownKeys(position);
    if (keys.length !== 2 || !keys.includes("x") || !keys.includes("y")) {
      return invalid("requires exactly the x and y ratio keys");
    }
    const positionRecord = position as Record<string, unknown>;
    const ratioX = positionRecord.x;
    const ratioY = positionRecord.y;
    if (!isPositionRatio(ratioX) || !isPositionRatio(ratioY)) {
      return invalid("ratios must be zero or finite normal numbers between 0 and 1");
    }
    relative = { x: ratioX, y: ratioY };
  }
  if (transform?.originX !== undefined || transform?.originY !== undefined) {
    return invalid("cannot be combined with transform.originX or transform.originY");
  }
  return { x: relative.x === 0 ? 0 : relative.x, y: relative.y === 0 ? 0 : relative.y };
}
