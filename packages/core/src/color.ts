import { CSS_COLOR_NAMES } from "./color-names.js";
import { FatalError } from "./errors.js";

/** Parsed color as RGBA 0–255 (alpha 0–1) */
type ParsedColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

const HEX3 = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;
const HEX6 = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;
const HEX8 = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;
const RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/;
const HSL = /^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/;
const HSLA = /^hsla\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)\s*\)$/;

function parseHexColor(s: string): ParsedColor | null {
  let colorMatch: RegExpMatchArray | null;

  colorMatch = s.match(HEX3);
  if (colorMatch) {
    const [, c1 = "", c2 = "", c3 = ""] = colorMatch;
    return {
      r: parseInt(c1 + c1, 16),
      g: parseInt(c2 + c2, 16),
      b: parseInt(c3 + c3, 16),
      a: 1,
    };
  }

  colorMatch = s.match(HEX6);
  if (colorMatch) {
    const [, c1 = "", c2 = "", c3 = ""] = colorMatch;
    return {
      r: parseInt(c1, 16),
      g: parseInt(c2, 16),
      b: parseInt(c3, 16),
      a: 1,
    };
  }

  colorMatch = s.match(HEX8);
  if (colorMatch) {
    const [, c1 = "", c2 = "", c3 = "", c4 = ""] = colorMatch;
    return {
      r: parseInt(c1, 16),
      g: parseInt(c2, 16),
      b: parseInt(c3, 16),
      a: parseInt(c4, 16) / 255,
    };
  }

  return null;
}

function parseRgbColor(s: string, nodeId?: string): ParsedColor | null {
  let colorMatch: RegExpMatchArray | null;

  colorMatch = s.match(RGB);
  if (colorMatch) {
    const r = Number(colorMatch[1]);
    const g = Number(colorMatch[2]);
    const b = Number(colorMatch[3]);
    if (r > 255 || g > 255 || b > 255) {
      throw new FatalError("COLOR_INVALID", `Invalid color: rgb values must be 0-255, got "${s}"`, {
        stage: "validate",
        nodeId,
      });
    }
    return { r, g, b, a: 1 };
  }

  colorMatch = s.match(RGBA);
  if (colorMatch) {
    const r = Number(colorMatch[1]);
    const g = Number(colorMatch[2]);
    const b = Number(colorMatch[3]);
    const a = Number(colorMatch[4]);
    if (r > 255 || g > 255 || b > 255) {
      throw new FatalError("COLOR_INVALID", `Invalid color: rgb values must be 0-255, got "${s}"`, {
        stage: "validate",
        nodeId,
      });
    }
    if (a < 0 || a > 1) {
      throw new FatalError("COLOR_INVALID", `Invalid color: alpha must be 0-1, got "${s}"`, {
        stage: "validate",
        nodeId,
      });
    }
    return { r, g, b, a };
  }

  return null;
}

function parseHslColor(s: string, nodeId?: string): ParsedColor | null {
  let colorMatch: RegExpMatchArray | null;

  colorMatch = s.match(HSL);
  if (colorMatch) {
    const hue = Number(colorMatch[1]);
    const sat = Number(colorMatch[2]);
    const l = Number(colorMatch[3]);
    if (sat < 0 || sat > 100 || l < 0 || l > 100) {
      throw new FatalError("COLOR_INVALID", `Invalid color: hsl s/l must be 0-100%, got "${s}"`, {
        stage: "validate",
        nodeId,
      });
    }
    const { r, g, b } = hslToRgb(hue, sat, l);
    return { r, g, b, a: 1 };
  }

  colorMatch = s.match(HSLA);
  if (colorMatch) {
    const hue = Number(colorMatch[1]);
    const sat = Number(colorMatch[2]);
    const l = Number(colorMatch[3]);
    const a = Number(colorMatch[4]);
    if (sat < 0 || sat > 100 || l < 0 || l > 100) {
      throw new FatalError("COLOR_INVALID", `Invalid color: hsl s/l must be 0-100%, got "${s}"`, {
        stage: "validate",
        nodeId,
      });
    }
    if (a < 0 || a > 1) {
      throw new FatalError("COLOR_INVALID", `Invalid color: alpha must be 0-1, got "${s}"`, {
        stage: "validate",
        nodeId,
      });
    }
    const { r, g, b } = hslToRgb(hue, sat, l);
    return { r, g, b, a };
  }

  return null;
}

/**
 * Parse a color string into RGBA components.
 *
 * Accepted formats:
 *   #RGB, #RRGGBB, #RRGGBBAA, rgb(r,g,b), rgba(r,g,b,a),
 *   hsl(h,s%,l%), hsla(h,s%,l%,a), CSS named colors (148)
 *
 * @throws Error on invalid format
 */
export function parseColor(value: string, context?: { nodeId?: string }): ParsedColor {
  const trimmed = value.trim();
  const nodeId = context?.nodeId;

  const result =
    parseHexColor(trimmed) ?? parseRgbColor(trimmed, nodeId) ?? parseHslColor(trimmed, nodeId);
  if (result) {
    return result;
  }

  // CSS named color (case-insensitive)
  const hex = CSS_COLOR_NAMES[trimmed.toLowerCase()];
  if (hex) {
    return parseColor(hex, context);
  }

  // "transparent" keyword
  if (trimmed.toLowerCase() === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  throw new FatalError(
    "COLOR_INVALID",
    `Invalid color format: "${trimmed}". Accepted: #RGB, #RRGGBB, #RRGGBBAA, rgb(), rgba(), hsl(), hsla(), CSS color names`,
    { stage: "validate", nodeId },
  );
}

/**
 * Convert HSL to RGB.
 * h: 0–360 (wraps), s: 0–100, l: 0–100
 * Returns { r, g, b } each 0–255 (rounded)
 */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  // Normalize hue to 0–360
  const hNorm = ((h % 360) + 360) % 360;
  const sNorm = s / 100;
  const lNorm = l / 100;

  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((hNorm / 60) % 2) - 1));
  const m = lNorm - c / 2;

  let r1: number, g1: number, b1: number;

  if (hNorm < 60) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (hNorm < 120) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (hNorm < 180) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (hNorm < 240) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (hNorm < 300) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}
