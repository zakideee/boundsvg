export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatSvgCode(raw: string): string {
  let indent = 0;
  const lines: string[] = [];
  const tokens = raw.replace(/>\s*</g, ">\n<").split("\n");
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("</")) {
      indent = Math.max(0, indent - 1);
    }
    lines.push("  ".repeat(indent) + trimmed);
    if (
      trimmed.startsWith("<") &&
      !trimmed.startsWith("</") &&
      !trimmed.endsWith("/>") &&
      !trimmed.includes("</")
    ) {
      indent++;
    }
  }
  return lines.join("\n");
}
