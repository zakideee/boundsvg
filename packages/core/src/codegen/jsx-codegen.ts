// ---------------------------------------------------------------------------
// JSX Code Generation — VNode → JSX string conversion
// ---------------------------------------------------------------------------
// Extracted from apps/playground-react/src/lib/codegen.ts for reuse
// across packages including CLI.
// ---------------------------------------------------------------------------

import type { VNode } from "../vnode/types.js";

/** Options for JSX string formatting. */
export type JsxFormatOptions = {
  /** When true, pack multiple props per line up to maxLineWidth. */
  compact?: boolean;
  /** Maximum characters per line including indent (default: 80). */
  maxLineWidth?: number;
};

const DEFAULT_MAX_LINE_WIDTH = 80;

/**
 * Pack prop strings into lines that fit within maxWidth.
 * Each returned string is a single line of space-separated props
 * (without leading indent — caller adds it).
 */
function packPropLines(propStrings: string[], indentWidth: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  let currentLen = indentWidth;

  for (const propString of propStrings) {
    const sep = current.length > 0 ? 1 : 0; // space between props
    if (current.length > 0 && currentLen + sep + propString.length > maxWidth) {
      lines.push(current);
      current = propString;
      currentLen = indentWidth + propString.length;
    } else {
      current = current.length > 0 ? `${current} ${propString}` : propString;
      currentLen += sep + propString.length;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

/**
 * Convert a VNode tree to a formatted JSX string.
 */
export function vnodeToJsxString(
  vnode: VNode,
  indent: number = 0,
  options?: JsxFormatOptions,
): string {
  const pad = "  ".repeat(indent);
  const tag = vnode.type;
  const compact = options?.compact === true;
  const maxWidth = options?.maxLineWidth ?? DEFAULT_MAX_LINE_WIDTH;

  const propStrings = Object.entries(vnode.props).map(([key, value]) => {
    if (typeof value === "boolean") {
      return value ? key : `${key}={false}`;
    }
    if (typeof value === "number") {
      return `${key}={${value}}`;
    }
    if (typeof value === "string") {
      if (value.startsWith("data:") && value.length > 60) {
        return `${key}={IMAGE_DATA_URL}`;
      }
      // Safe for JSX attribute: no quotes, backslashes, newlines, or angle brackets
      if (!/["\\\n\r<>]/.test(value)) {
        return `${key}="${value}"`;
      }
      return `${key}={${JSON.stringify(value)}}`;
    }
    if (Array.isArray(value)) {
      return `${key}={[${(value as (string | number)[]).join(", ")}]}`;
    }
    return `${key}={${JSON.stringify(value)}}`;
  });

  const hasChildren = vnode.children.length > 0;
  const allString = vnode.children.every((child) => typeof child === "string");

  // Helper: push multi-line props (one-per-line verbose or packed compact)
  const pushMultiLineProps = (lines: string[]): void => {
    if (compact) {
      // indent for props: pad + "  "
      const propIndentWidth = pad.length + 2;
      for (const packed of packPropLines(propStrings, propIndentWidth, maxWidth)) {
        lines.push(`${pad}  ${packed}`);
      }
    } else {
      for (const propString of propStrings) {
        lines.push(`${pad}  ${propString}`);
      }
    }
  };

  if (!hasChildren) {
    if (propStrings.length <= 3) {
      return `${pad}<${tag} ${propStrings.join(" ")} />`;
    }
    const lines = [`${pad}<${tag}`];
    pushMultiLineProps(lines);
    lines.push(`${pad}/>`);
    return lines.join("\n");
  }

  if (allString) {
    const textContent = vnode.children.join("");
    if (propStrings.length > 3 || textContent.length > 40) {
      const lines = [`${pad}<${tag}`];
      pushMultiLineProps(lines);
      lines.push(`${pad}>`);
      lines.push(`${pad}  ${textContent}`);
      lines.push(`${pad}</${tag}>`);
      return lines.join("\n");
    }
    return `${pad}<${tag} ${propStrings.join(" ")}>${textContent}</${tag}>`;
  }

  const lines: string[] = [];
  if (propStrings.length <= 3) {
    lines.push(`${pad}<${tag} ${propStrings.join(" ")}>`);
  } else {
    lines.push(`${pad}<${tag}`);
    pushMultiLineProps(lines);
    lines.push(`${pad}>`);
  }
  for (const child of vnode.children) {
    if (typeof child === "string") {
      lines.push(`${pad}  ${child}`);
    } else {
      lines.push(vnodeToJsxString(child, indent + 1, options));
    }
  }
  lines.push(`${pad}</${tag}>`);
  return lines.join("\n");
}

/**
 * Collect all unique VNode types used in a VNode tree.
 * Returns sorted array of type names (e.g. ["Box", "Canvas", "Text"]).
 */
export function collectUsedTypes(vnode: VNode): string[] {
  const types = new Set<string>();
  const walk = (node: VNode): void => {
    types.add(node.type);
    for (const child of node.children) {
      if (typeof child !== "string") {
        walk(child);
      }
    }
  };
  walk(vnode);
  return [...types].sort();
}

/**
 * Generate a standalone JSX snippet with imports.
 */
export function generateJsxSnippet(vnode: VNode, options?: JsxFormatOptions): string {
  const components = collectUsedTypes(vnode).join(", ");
  const jsxBody = vnodeToJsxString(vnode, 1, options);
  return `import { toVNode, ${components} } from "@boundsvg/react";\n\nconst vnode = toVNode(\n${jsxBody},\n);`;
}
