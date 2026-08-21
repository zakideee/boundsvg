// ---------------------------------------------------------------------------
// Plain SVG JSX Component Generation
//
// Converts SVG strings (from emitSvg) into self-contained React components
// with zero runtime dependency on @boundsvg packages.
// ---------------------------------------------------------------------------

import { FatalError } from "../errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for generating a plain SVG React component */
export type PlainSvgComponentOptions = {
  /** Component name (PascalCase) */
  componentName: string;
};

// ---------------------------------------------------------------------------
// SVG attribute → JSX attribute mapping
// ---------------------------------------------------------------------------

/** Maps kebab-case SVG attributes to camelCase JSX equivalents. */
const SVG_ATTR_TO_JSX: Record<string, string> = {
  class: "className",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "color-interpolation-filters": "colorInterpolationFilters",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "flood-color": "floodColor",
  "flood-opacity": "floodOpacity",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-style": "fontStyle",
  "font-weight": "fontWeight",
  "letter-spacing": "letterSpacing",
  "paint-order": "paintOrder",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "stroke-dasharray": "strokeDasharray",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "stroke-width": "strokeWidth",
  "text-anchor": "textAnchor",
  "text-decoration": "textDecoration",
  "xlink:href": "xlinkHref",
  "xml:lang": "xmlLang",
};

/** Attributes to remove from root <svg> (React handles these automatically) */
const REMOVE_FROM_ROOT_SVG = new Set(["xmlns", "xmlns:xlink"]);

// ---------------------------------------------------------------------------
// Lightweight XML parser types
// ---------------------------------------------------------------------------

type XmlElement = {
  tag: string;
  attrs: Array<[string, string]>;
  children: XmlNode[];
  selfClosing: boolean;
};

type XmlNode = XmlElement | string;

// ---------------------------------------------------------------------------
// XML parsing
// ---------------------------------------------------------------------------

/** End offset of non-element markup at `pos`, or null when there is none. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: XML declaration scanning must track delimiters, quotes, and doctype subset nesting.
function nonElementMarkupEnd(svg: string, pos: number): number | null {
  const delimiters: Array<[string, string]> = [
    ["<!--", "-->"],
    ["<![CDATA[", "]]>"],
    ["<?", "?>"],
  ];
  for (const [open, close] of delimiters) {
    if (svg.startsWith(open, pos)) {
      const end = svg.indexOf(close, pos + open.length);
      if (end === -1) {
        throw invalidSvgError(`unterminated ${open} markup`);
      }
      return end + close.length;
    }
  }
  if (svg.startsWith("<!", pos)) {
    let quote: '"' | "'" | null = null;
    let subsetDepth = 0;
    for (let index = pos + 2; index < svg.length; index += 1) {
      const char = svg[index];
      if (quote) {
        if (char === quote) {
          quote = null;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "[") {
        subsetDepth += 1;
      } else if (char === "]" && subsetDepth > 0) {
        subsetDepth -= 1;
      } else if (char === ">" && subsetDepth === 0) {
        return index + 1;
      }
    }
    throw invalidSvgError("unterminated declaration markup");
  }
  return null;
}

function invalidSvgError(reason: string): FatalError {
  return new FatalError("CODEGEN_INVALID_SVG", `Cannot generate JSX from SVG: ${reason}.`, {
    stage: "emit",
  });
}

/**
 * Parse a well-formed SVG string into an element tree.
 * Designed for emitSvg output, with support for common XML declarations,
 * comments, CDATA and processing instructions around that output.
 */
export function parseSvgString(svg: string): XmlElement {
  let pos = 0;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: recursive XML node parsing branches by markup kind and closing state.
  function parseNodes(): XmlNode[] {
    const nodes: XmlNode[] = [];
    while (pos < svg.length) {
      if (svg[pos] !== "<") {
        const text = parseText();
        if (text) {
          nodes.push(text);
        }
        continue;
      }
      if (svg[pos + 1] === "/") {
        break;
      }
      if (svg.startsWith("<![CDATA[", pos)) {
        nodes.push(parseCdata());
        continue;
      }
      // Comments, doctypes and processing instructions have no JSX
      // representation. Parsing them as elements produced syntactically
      // invalid TSX (`<!-- c="" --="">`), so they are skipped.
      if (skipNonElementMarkup()) {
        continue;
      }
      const element = parseElement();
      if (element) {
        nodes.push(element);
      }
    }
    return nodes;
  }

  function parseCdata(): string {
    const contentStart = pos + "<![CDATA[".length;
    const end = svg.indexOf("]]>", contentStart);
    if (end === -1) {
      throw invalidSvgError("unterminated <![CDATA[ markup");
    }
    pos = end + "]]>".length;
    // Mark ampersands so the normal XML text decoder below leaves CDATA
    // entity-looking text literal (CDATA does not resolve entities).
    return svg.slice(contentStart, end).replace(/&/g, "&amp;");
  }

  /** Skip `<!-- ... -->`, `<!DOCTYPE ...>` and `<? ... ?>`. */
  function skipNonElementMarkup(): boolean {
    const next = nonElementMarkupEnd(svg, pos);
    if (next === null) {
      return false;
    }
    pos = next;
    return true;
  }

  function parseText(): string {
    const start = pos;
    while (pos < svg.length && svg[pos] !== "<") {
      pos++;
    }
    return svg.slice(start, pos);
  }

  function parseElement(): XmlElement | null {
    pos++; // skip '<'

    const tagStart = pos;
    while (pos < svg.length && !/[\s/>]/.test(svg[pos] ?? "")) {
      pos++;
    }
    const tag = svg.slice(tagStart, pos);

    const attrs = parseAttributes();
    skipWhitespace();

    if (svg[pos] === "/" && svg[pos + 1] === ">") {
      pos += 2;
      return { tag, attrs, children: [], selfClosing: true };
    }

    if (svg[pos] === ">") {
      pos++;
    }
    const children = parseNodes();

    // Skip closing tag
    if (svg[pos] === "<" && svg[pos + 1] === "/") {
      const closeEnd = svg.indexOf(">", pos);
      if (closeEnd !== -1) {
        pos = closeEnd + 1;
      }
    }

    return { tag, attrs, children, selfClosing: false };
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: SVG attribute parsing is inherently complex.
  function parseAttributes(): Array<[string, string]> {
    const attrs: Array<[string, string]> = [];
    while (pos < svg.length) {
      skipWhitespace();
      if (svg[pos] === ">" || svg[pos] === "/" || pos >= svg.length) {
        break;
      }

      const nameStart = pos;
      while (pos < svg.length && svg[pos] !== "=" && !/[\s>/]/.test(svg[pos] ?? "")) {
        pos++;
      }
      const name = svg.slice(nameStart, pos);

      skipWhitespace();
      if (svg[pos] !== "=") {
        if (name) {
          attrs.push([name, ""]);
        }
        continue;
      }
      pos++; // skip '='
      skipWhitespace();

      const quote = svg[pos];
      if (quote !== '"' && quote !== "'") {
        continue;
      }
      pos++; // skip opening quote
      const valueStart = pos;
      while (pos < svg.length && svg[pos] !== quote) {
        pos++;
      }
      const value = svg.slice(valueStart, pos);
      pos++; // skip closing quote

      attrs.push([name, value]);
    }
    return attrs;
  }

  function skipWhitespace(): void {
    while (pos < svg.length && /\s/.test(svg[pos] ?? "")) {
      pos++;
    }
  }

  skipWhitespace();
  // XML declarations, comments and doctypes may legally precede the root.
  // They are not JSX nodes, but must be consumed before parsing <svg>.
  while (true) {
    const next = nonElementMarkupEnd(svg, pos);
    if (next === null) {
      break;
    }
    pos = next;
    skipWhitespace();
  }
  if (!svg.startsWith("<", pos) || svg.startsWith("</", pos)) {
    throw invalidSvgError("missing root element");
  }
  const result = parseElement();
  if (!result) {
    throw invalidSvgError("failed to parse root element");
  }
  return result;
}

// ---------------------------------------------------------------------------
// SVG string → JSX string conversion
// ---------------------------------------------------------------------------

/**
 * Convert an SVG string (from emitSvg) to JSX-compatible string.
 *
 * - Converts kebab-case attributes to camelCase
 * - Removes xmlns from root <svg>
 * - Spreads {...props} on root <svg>
 */
export function svgStringToJsx(svg: string): string {
  const root = parseSvgString(svg);
  return elementToJsx(root, 0, true);
}

function buildJsxAttributes(node: XmlElement, isRoot: boolean): string[] {
  const jsxAttrs: string[] = [];
  for (const [name, value] of node.attrs) {
    if (isRoot && REMOVE_FROM_ROOT_SVG.has(name)) {
      continue;
    }
    // React's `style` prop is an object, not a CSS string — passing the raw
    // string makes the generated component throw at render time.
    if (name === "style") {
      const styleObject = cssTextToJsxStyleObject(decodeXmlEntities(value));
      if (styleObject) {
        jsxAttrs.push(`style={${styleObject}}`);
      }
      continue;
    }
    jsxAttrs.push(`${convertAttrName(name)}="${escapeJsxAttrValue(value)}"`);
  }
  // Add {...props} spread on root <svg>
  if (isRoot) {
    jsxAttrs.push("{...props}");
  }
  return jsxAttrs;
}

function elementToJsx(node: XmlElement, depth: number, isRoot: boolean): string {
  const indent = `      ${"  ".repeat(depth)}`;
  const parts: string[] = [];

  const jsxAttrs = buildJsxAttributes(node, isRoot);
  const attrStr = jsxAttrs.length > 0 ? ` ${jsxAttrs.join(" ")}` : "";

  if (node.selfClosing || (node.children.length === 0 && !isRoot)) {
    parts.push(`${indent}<${node.tag}${attrStr} />`);
    return parts.join("\n");
  }

  parts.push(`${indent}<${node.tag}${attrStr}>`);
  for (const child of node.children) {
    if (typeof child === "string") {
      const trimmed = child.trim();
      if (trimmed) {
        parts.push(`${indent}  {${JSON.stringify(decodeXmlEntities(trimmed))}}`);
      }
    } else {
      parts.push(elementToJsx(child, depth + 1, false));
    }
  }
  parts.push(`${indent}</${node.tag}>`);

  return parts.join("\n");
}

/**
 * Convert a CSS declaration string into a JSX style-object literal.
 *
 * `style="fill:red;stroke-width:2"` -> `{{ fill: "red", strokeWidth: "2" }}`.
 * Custom properties (`--x`) keep their name and are quoted.
 */
function cssTextToJsxStyleObject(cssText: string): string | null {
  const entries: string[] = [];
  for (const declaration of splitCssDeclarations(cssText)) {
    const separator = findCssSeparator(declaration);
    if (separator === -1) {
      continue;
    }
    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (!property || !value) {
      continue;
    }
    const camelProperty = cssPropertyToJsx(property);
    const key = /^[A-Za-z_$][\w$]*$/.test(camelProperty)
      ? camelProperty
      : JSON.stringify(camelProperty);
    entries.push(`${key}: ${JSON.stringify(value)}`);
  }
  return entries.length > 0 ? `{ ${entries.join(", ")} }` : null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CSS tokenization must track comments, quoted strings, escapes, and parentheses.
function splitCssDeclarations(cssText: string): string[] {
  const declarations: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let parentheses = 0;
  let inComment = false;
  for (let index = 0; index < cssText.length; index += 1) {
    const char = cssText[index];
    const next = cssText[index + 1];
    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      inComment = true;
      index += 1;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      parentheses += 1;
    } else if (char === ")" && parentheses > 0) {
      parentheses -= 1;
    } else if (char === ";" && parentheses === 0) {
      declarations.push(cssText.slice(start, index));
      start = index + 1;
    }
  }
  declarations.push(cssText.slice(start));
  return declarations;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CSS tokenization must ignore colons inside quoted strings and functions.
function findCssSeparator(declaration: string): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let parentheses = 0;
  for (let index = 0; index < declaration.length; index += 1) {
    const char = declaration[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      parentheses += 1;
    } else if (char === ")" && parentheses > 0) {
      parentheses -= 1;
    } else if (char === ":" && parentheses === 0) {
      return index;
    }
  }
  return -1;
}

function cssPropertyToJsx(property: string): string {
  if (property.startsWith("--")) {
    return property;
  }
  const camelCase = property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return camelCase.startsWith("Ms") ? `ms${camelCase.slice(2)}` : camelCase;
}

function convertAttrName(name: string): string {
  if (name.startsWith("data-") || name.startsWith("aria-")) {
    return name;
  }
  const mapped = SVG_ATTR_TO_JSX[name];
  if (mapped !== undefined) {
    return mapped;
  }
  return name.replace(/[-:]([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-fA-F]+)|amp|lt|gt|quot|apos);/g,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal) {
        return String.fromCodePoint(Number.parseInt(decimal, 10));
      }
      if (hexadecimal) {
        return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      }
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      return named[entity] ?? entity;
    },
  );
}

function escapeJsxAttrValue(value: string): string {
  return value.replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Component template generation
// ---------------------------------------------------------------------------

/**
 * Generate a complete plain SVG React component (.tsx) from an SVG string.
 *
 * Output is always:
 * - TypeScript (.tsx)
 * - Default export
 * - Props spread on root <svg> (SVGProps<SVGSVGElement>)
 * - width/height preserved
 */
export function generatePlainSvgComponent(
  svgString: string,
  options: PlainSvgComponentOptions,
): string {
  const { componentName } = options;
  const svgJsx = svgStringToJsx(svgString);

  return `import type { SVGProps } from "react";

export default function ${componentName}(props: SVGProps<SVGSVGElement>) {
  return (
${svgJsx}
  );
}
`;
}
