import { parseColor } from "../color.js";
import { layoutContractError } from "./layout-props.js";

/**
 * Parse a `boxShadow` prop string: `"<dx> <dy> [blur] [spread] [color]"`
 * (px implied — the API has no CSS units).
 *
 * Returns undefined for anything the render pipeline would drop (fewer than
 * two numbers, non-finite values, negative blur). The Rust IR builder applies
 * the same grammar when it bakes the shadow; this parser exists so validation
 * can reject a malformed string before layout instead of silently rendering
 * without a shadow.
 */
export function parseBoxShadow(
  value: string,
): { dx: number; dy: number; blur: number; spread: number; color: string } | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  // Extract numbers from the beginning, then the rest is color
  const parts: string[] = [];
  let remaining = trimmed;

  // Parse up to 4 numeric values
  for (let i = 0; i < 4; i++) {
    const match = remaining.match(/^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*/);
    if (!match) {
      break;
    }
    const [, captured = ""] = match;
    parts.push(captured);
    remaining = remaining.slice(match[0].length);
  }

  if (parts.length < 2) {
    return undefined;
  }

  const dx = Number.parseFloat(parts[0] ?? "0");
  const dy = Number.parseFloat(parts[1] ?? "0");
  const blur = parts.length > 2 ? Number.parseFloat(parts[2] ?? "0") : 0;
  const spread = parts.length > 3 ? Number.parseFloat(parts[3] ?? "0") : 0;
  const color = remaining.trim() || "rgba(0,0,0,0.3)";

  if (![dx, dy, blur, spread].every(Number.isFinite) || blur < 0) {
    return undefined;
  }

  return { dx, dy, blur, spread, color };
}

export function validateBoxShadowProp(props: Record<string, unknown>, nid: string): void {
  const boxShadow = props.boxShadow;
  if (boxShadow === undefined) {
    return;
  }
  if (typeof boxShadow !== "string") {
    throw layoutContractError(
      nid,
      `'boxShadow' must be a string, got ${JSON.stringify(boxShadow)}`,
    );
  }
  if (boxShadow.trim() === "") {
    return;
  }
  const parsed = parseBoxShadow(boxShadow);
  if (!parsed) {
    throw layoutContractError(
      nid,
      `'boxShadow' must be "<dx> <dy> [blur] [spread] [color]" with unitless px numbers (e.g. "0 4 8 0 rgba(0,0,0,0.2)"), got ${JSON.stringify(boxShadow)}`,
    );
  }
  // The color half must be a real color; an unparseable one would otherwise
  // reach the SVG as-is.
  parseColor(parsed.color, { nodeId: nid });
}
