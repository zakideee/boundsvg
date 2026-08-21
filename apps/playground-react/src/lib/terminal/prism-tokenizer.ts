import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import type { PrismTextSegment, TerminalSyntaxLanguage } from "./types";

type PrismTokenStream = string | Prism.Token | PrismTokenStream[];

function sameTokenTypes(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function appendPrismTextSegment(
  out: PrismTextSegment[],
  text: string,
  tokenTypes: readonly string[],
): void {
  if (text.length === 0) {
    return;
  }
  const prev = out[out.length - 1];
  if (prev && sameTokenTypes(prev.tokenTypes, tokenTypes)) {
    prev.text += text;
    return;
  }
  out.push({ text, tokenTypes: [...tokenTypes] });
}

function flattenPrismTokenStream(
  stream: PrismTokenStream,
  inheritedTypes: readonly string[] = [],
  out: PrismTextSegment[] = [],
): PrismTextSegment[] {
  if (typeof stream === "string") {
    appendPrismTextSegment(out, stream, inheritedTypes);
    return out;
  }
  if (Array.isArray(stream)) {
    for (const part of stream) {
      flattenPrismTokenStream(part, inheritedTypes, out);
    }
    return out;
  }

  const alias = Array.isArray(stream.alias) ? stream.alias : stream.alias ? [stream.alias] : [];
  const nextTypes = [...inheritedTypes, stream.type, ...alias];
  return flattenPrismTokenStream(stream.content as PrismTokenStream, nextTypes, out);
}

function splitSegmentsByLine(segments: readonly PrismTextSegment[]): PrismTextSegment[][] {
  const lines: PrismTextSegment[][] = [[]];

  for (const segment of segments) {
    const parts = segment.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      const text = parts[i] ?? "";
      if (text.length > 0) {
        const lastLine = lines[lines.length - 1];
        if (lastLine) {
          lastLine.push({ text, tokenTypes: [...segment.tokenTypes] });
        }
      }
      if (i < parts.length - 1) {
        lines.push([]);
      }
    }
  }

  return lines;
}

function resolvePrismGrammar(language: TerminalSyntaxLanguage): Prism.Grammar | undefined {
  switch (language) {
    case "tsx":
      return Prism.languages.tsx;
    case "typescript":
      return Prism.languages.typescript;
    case "jsx":
      return Prism.languages.jsx;
    case "javascript":
      return Prism.languages.javascript;
    case "markup":
      return Prism.languages.markup;
    default:
      return Prism.languages.tsx;
  }
}

export function tokenizeTerminalCode(
  code: string,
  language: TerminalSyntaxLanguage = "tsx",
): PrismTextSegment[][] {
  const grammar = resolvePrismGrammar(language);
  if (!grammar) {
    return splitSegmentsByLine([{ text: code, tokenTypes: [] }]);
  }
  const tokenized = Prism.tokenize(code, grammar) as PrismTokenStream;
  const segments = flattenPrismTokenStream(tokenized);
  return splitSegmentsByLine(segments);
}
