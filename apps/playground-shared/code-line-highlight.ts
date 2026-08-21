/**
 * Line-level highlighting for Prism-rendered code panels.
 *
 * Wraps Prism HTML output in per-line `<div>` elements and provides
 * a function to add/remove highlight classes for specific line ranges.
 */

import type { NodeLineRange } from "./svg-line-map.js";

/**
 * Wrap Prism-highlighted HTML in line-level `<div>` elements.
 * Each line gets `class="code-line"` and `data-line="N"` (0-based).
 */
export function wrapInLineElements(prismHtml: string): string {
  const lines = prismHtml.split("\n");
  return lines
    .map((line, i) => `<div class="code-line" data-line="${i}">${line || " "}</div>`)
    .join("");
}

/**
 * Highlight lines in a code element that correspond to a node's line range.
 * Pass `null` to clear all highlights.
 */
export function highlightCodeLines(
  codeElement: HTMLElement,
  lineRange: NodeLineRange | null,
): void {
  const highlighted = codeElement.querySelectorAll(".code-line-highlight");
  for (const element of highlighted) {
    element.classList.remove("code-line-highlight");
  }

  if (!lineRange) {
    return;
  }

  for (let i = lineRange.start; i <= lineRange.end; i++) {
    const lineEl = codeElement.querySelector(`[data-line="${i}"]`);
    if (lineEl) {
      lineEl.classList.add("code-line-highlight");
    }
  }

  // Scroll the first highlighted line into view
  const firstLine = codeElement.querySelector(`[data-line="${lineRange.start}"]`);
  if (firstLine) {
    firstLine.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}
