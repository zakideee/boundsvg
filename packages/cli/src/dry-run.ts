// ---------------------------------------------------------------------------
// dry-run diff reporting utilities
// ---------------------------------------------------------------------------

import type { CliIo } from "./types.js";

/**
 * Report dry-run result for a text file.
 * Shows [new], [unchanged], or [overwrite] with unified diff.
 */
export function reportDryRun(io: CliIo, outputPath: string, newContent: string): void {
  if (!io.fileExists(outputPath)) {
    io.writeStderr(`[new] ${outputPath}\n`);
    const lines = newContent.split("\n");
    const preview = lines.slice(0, 10);
    for (const line of preview) {
      io.writeStderr(`  + ${line}\n`);
    }
    if (lines.length > 10) {
      io.writeStderr(`  ... (${lines.length - 10} more lines)\n`);
    }
    return;
  }

  let existingContent: string;
  try {
    existingContent = io.readTextFile(outputPath);
  } catch {
    io.writeStderr(`[new] ${outputPath}\n`);
    return;
  }

  if (existingContent === newContent) {
    io.writeStderr(`[unchanged] ${outputPath}\n`);
    return;
  }

  io.writeStderr(`[overwrite] ${outputPath}\n`);
  const diff = unifiedDiff(existingContent.split("\n"), newContent.split("\n"));
  for (const line of diff) {
    io.writeStderr(`  ${line}\n`);
  }
}

/**
 * Report dry-run result for a binary file (e.g., PNG).
 */
export function reportDryRunBinary(io: CliIo, outputPath: string, newData: Uint8Array): void {
  const newSizeKB = (newData.byteLength / 1024).toFixed(1);

  if (!io.fileExists(outputPath)) {
    io.writeStderr(`[new] ${outputPath} (${newSizeKB}KB)\n`);
    return;
  }

  let existingData: Uint8Array;
  try {
    existingData = io.readBinaryFile(outputPath);
  } catch {
    io.writeStderr(`[new] ${outputPath} (${newSizeKB}KB)\n`);
    return;
  }

  const oldSizeKB = (existingData.byteLength / 1024).toFixed(1);
  io.writeStderr(`[overwrite] ${outputPath} (${oldSizeKB}KB → ${newSizeKB}KB)\n`);
}

export function reportDryRunDirectory(io: CliIo, outputPath: string): void {
  io.writeStderr(`[directory] ${outputPath}\n`);
}

// ---------------------------------------------------------------------------
// Simple LCS-based unified diff
// ---------------------------------------------------------------------------

type DiffLine = {
  type: "context" | "add" | "remove";
  text: string;
};

function buildLcsTable(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;

  // O(m·n) is fine for generated code (< 500 lines)
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array<number>(n + 1).fill(0);
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const dpRow = dp[i];
      const dpPrevRow = dp[i - 1];
      if (!dpRow || !dpPrevRow) {
        continue;
      }
      if (oldLines[i - 1] === newLines[j - 1]) {
        dpRow[j] = (dpPrevRow[j - 1] ?? 0) + 1;
      } else {
        dpRow[j] = Math.max(dpPrevRow[j] ?? 0, dpRow[j - 1] ?? 0);
      }
    }
  }
  return dp;
}

function backtrackLcs(dp: number[][], oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  let i = oldLines.length;
  let j = newLines.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: "context", text: oldLines[i - 1] ?? "" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))) {
      result.push({ type: "add", text: newLines[j - 1] ?? "" });
      j--;
    } else {
      result.push({ type: "remove", text: oldLines[i - 1] ?? "" });
      i--;
    }
  }
  return result.reverse();
}

function computeLcsDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const dp = buildLcsTable(oldLines, newLines);
  return backtrackLcs(dp, oldLines, newLines);
}

function collectChangeIndices(diff: DiffLine[]): number[] {
  const indices: number[] = [];
  for (const [i, line] of diff.entries()) {
    if (line.type !== "context") {
      indices.push(i);
    }
  }
  return indices;
}

function groupChangesIntoHunks(
  changeIndices: number[],
  diffLength: number,
  contextLines: number,
): Array<{ start: number; end: number }> {
  const hunks: Array<{ start: number; end: number }> = [];
  const firstIdx = changeIndices[0] ?? 0;
  let hunkStart = Math.max(0, firstIdx - contextLines);
  let hunkEnd = Math.min(diffLength - 1, firstIdx + contextLines);

  for (let k = 1; k < changeIndices.length; k++) {
    const changeIdx = changeIndices[k] ?? 0;
    const expandedStart = Math.max(0, changeIdx - contextLines);
    if (expandedStart <= hunkEnd + 1) {
      hunkEnd = Math.min(diffLength - 1, changeIdx + contextLines);
    } else {
      hunks.push({ start: hunkStart, end: hunkEnd });
      hunkStart = expandedStart;
      hunkEnd = Math.min(diffLength - 1, changeIdx + contextLines);
    }
  }
  hunks.push({ start: hunkStart, end: hunkEnd });

  return hunks;
}

function countDiffLines(
  diff: DiffLine[],
  start: number,
  end: number,
): { oldLines: number; newLines: number } {
  let oldLines = 0;
  let newLines = 0;
  for (let idx = start; idx <= end; idx++) {
    const line = diff[idx];
    if (!line) {
      continue;
    }
    if (line.type === "context" || line.type === "remove") {
      oldLines++;
    }
    if (line.type === "context" || line.type === "add") {
      newLines++;
    }
  }
  return { oldLines, newLines };
}

function formatHunk(diff: DiffLine[], hunk: { start: number; end: number }): string[] {
  const before = countDiffLines(diff, 0, hunk.start - 1);
  const oldLineNo = before.oldLines + 1;
  const newLineNo = before.newLines + 1;

  const { oldLines: oldCount, newLines: newCount } = countDiffLines(diff, hunk.start, hunk.end);

  const lines: string[] = [];
  lines.push(`@@ -${oldLineNo},${oldCount} +${newLineNo},${newCount} @@`);

  for (let idx = hunk.start; idx <= hunk.end; idx++) {
    const line = diff[idx];
    if (!line) {
      continue;
    }
    switch (line.type) {
      case "context":
        lines.push(` ${line.text}`);
        break;
      case "add":
        lines.push(`+${line.text}`);
        break;
      case "remove":
        lines.push(`-${line.text}`);
        break;
    }
  }

  return lines;
}

function unifiedDiff(oldLines: string[], newLines: string[], contextLines = 3): string[] {
  const diff = computeLcsDiff(oldLines, newLines);

  const changeIndices = collectChangeIndices(diff);
  if (changeIndices.length === 0) {
    return [];
  }

  const hunks = groupChangesIntoHunks(changeIndices, diff.length, contextLines);

  const output: string[] = [];
  for (const hunk of hunks) {
    output.push(...formatHunk(diff, hunk));
  }

  return output;
}
