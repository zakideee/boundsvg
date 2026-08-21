/**
 * Normalize SVG for snapshot comparison:
 * - Sort attributes alphabetically within each element
 * - Round decimal numbers to 2 places
 * - Normalize whitespace
 */
export function normalizeSvg(svg: string): string {
  // Round decimal numbers to 2 places
  let normalized = svg.replace(/(\d+\.\d{3,})/g, (match) => {
    const num = parseFloat(match);
    const rounded = Math.round(num * 100) / 100;
    // Remove trailing zeros after decimal
    return String(rounded);
  });

  // Sort attributes within each element tag
  normalized = normalized.replace(
    /<(\w[\w-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)?>/g,
    (_match, tag, attrStr, close) => {
      if (!attrStr || attrStr.trim() === "") {
        return `<${tag}${close ? ` ${close}` : ""}>`;
      }
      // Extract all attribute pairs
      const attrs: string[] = [];
      const attrRegex = /([\w:.-]+)="([^"]*)"/g;
      for (const m of attrStr.matchAll(attrRegex)) {
        attrs.push(`${m[1]}="${m[2]}"`);
      }
      attrs.sort();
      const sortedAttrs = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
      return `<${tag}${sortedAttrs}${close ? ` ${close}` : ""}>`;
    },
  );

  // Normalize line endings and trim
  normalized = normalized.replace(/\r\n/g, "\n").trim();

  return normalized;
}
