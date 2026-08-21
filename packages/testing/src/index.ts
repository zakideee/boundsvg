import type { IR } from "@boundsvg/core";
import {
  createEngine,
  type Engine,
  type EngineInput,
  type EngineOptions,
  type RenderOptions,
  validateNodeIds,
} from "@boundsvg/core";

export type PngSnapshot = {
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
};

export type RenderMatrixCase = {
  name: string;
  input: EngineInput;
  options?: RenderOptions;
};

export type RenderMatrixResult = {
  name: string;
  svg: string;
  normalizedSvg: string;
  warnings: number;
};

/**
 * Normalize SVG strings for snapshots by sorting attributes and rounding noisy decimals.
 */
export function normalizeSvg(svg: string): string {
  let normalized = svg.replace(/(\d+\.\d{3,})/g, (match) => {
    const parsed = Number.parseFloat(match);
    return String(Math.round(parsed * 100) / 100);
  });

  normalized = normalized.replace(/<(\w[\w-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)?>/g, (...match) =>
    sortSvgTagAttributes(match),
  );

  return normalized.replace(/\r\n/g, "\n").trim();
}

function sortSvgTagAttributes(match: readonly unknown[]): string {
  const tag = typeof match[1] === "string" ? match[1] : "";
  const attrStr = typeof match[2] === "string" ? match[2] : "";
  const close = typeof match[3] === "string" ? match[3] : "";
  if (!attrStr || attrStr.trim() === "") {
    return `<${tag}${close ? ` ${close}` : ""}>`;
  }
  const attrs: string[] = [];
  const attrRegex = /([\w:.-]+)="([^"]*)"/g;
  for (const attrMatch of attrStr.matchAll(attrRegex)) {
    attrs.push(`${attrMatch[1]}="${attrMatch[2]}"`);
  }
  attrs.sort();
  return `<${tag}${attrs.length > 0 ? ` ${attrs.join(" ")}` : ""}${close ? ` ${close}` : ""}>`;
}

/**
 * Create a boundsvg Engine for tests that inject deterministic fonts or mocks.
 */
export function createTestEngine(options: EngineOptions): Engine {
  return createEngine(options);
}

/**
 * Render and normalize SVG output for snapshot assertions.
 */
export function renderSvgSnapshot(
  engine: Engine,
  input: EngineInput,
  options?: RenderOptions,
): string {
  return normalizeSvg(engine.renderToSvg(input, options));
}

/**
 * Render PNG output and return bytes plus dimensions read from the PNG header.
 */
export function renderPngSnapshot(
  engine: Engine,
  input: EngineInput,
  options?: RenderOptions,
): PngSnapshot {
  const bytes = engine.renderToPng(input, options);
  const dimensions = readPngDimensions(bytes);
  return {
    bytes,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}

/**
 * Throw when an IR contains recoverable render warnings.
 */
export function assertNoWarnings(ir: IR): void {
  if (ir.warnings.length > 0) {
    const messages = ir.warnings.map((warning) => warning.message).join("; ");
    throw new Error(`Expected no boundsvg warnings, got ${ir.warnings.length}: ${messages}`);
  }
}

/**
 * Throw when a VNode tree contains duplicate explicit node IDs.
 */
export function assertStableNodeIds(input: EngineInput): void {
  const result = validateNodeIds(input);
  if (!result.valid) {
    const duplicateIds = result.duplicates.map((duplicate) => duplicate.id).join(", ");
    throw new Error(`Expected stable unique boundsvg node ids, got duplicates: ${duplicateIds}`);
  }
}

/**
 * Render named cases so tests can snapshot option matrices or fixture variants.
 */
export function renderMatrix(
  engine: Engine,
  cases: readonly RenderMatrixCase[],
): RenderMatrixResult[] {
  return cases.map((entry) => {
    const { svg, ir } = engine.renderToSvgAndIR(entry.input, entry.options);
    return {
      name: entry.name,
      svg,
      normalizedSvg: normalizeSvg(svg),
      warnings: ir.warnings.length,
    };
  });
}

function readPngDimensions(png: Uint8Array): { width: number; height: number } | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
  if (png.byteLength < 24) {
    return null;
  }
  for (let i = 0; i < signature.length; i++) {
    if (png[i] !== signature[i]) {
      return null;
    }
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
}
