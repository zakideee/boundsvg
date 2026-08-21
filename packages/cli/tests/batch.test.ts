import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BatchResult,
  deriveBatchOutputPath,
  detectOutputCollisions,
  expandInputs,
  formatBatchSummary,
} from "../src/batch.js";

function withTempDir(run: (tempDir: string) => void): void {
  const tempDir = mkdtempSync(join(tmpdir(), "boundsvg-batch-"));
  try {
    run(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("expandInputs", () => {
  it("returns plain paths as-is", () => {
    const result = expandInputs(["a.svg", "b.svg"]);
    expect(result).toEqual(["a.svg", "b.svg"]);
  });

  it("expands glob patterns", () => {
    withTempDir((tempDir) => {
      writeFileSync(join(tempDir, "a.svg"), "<svg/>", "utf-8");
      writeFileSync(join(tempDir, "b.svg"), "<svg/>", "utf-8");
      writeFileSync(join(tempDir, "c.txt"), "text", "utf-8");

      const result = expandInputs([join(tempDir, "*.svg")]);
      expect(result).toHaveLength(2);
      expect(result.every((f) => f.endsWith(".svg"))).toBe(true);
    });
  });

  it("returns empty array for non-matching glob", () => {
    withTempDir((tempDir) => {
      const result = expandInputs([join(tempDir, "*.xyz")]);
      expect(result).toHaveLength(0);
    });
  });
});

describe("formatBatchSummary", () => {
  it("formats success summary", () => {
    const result: BatchResult = { total: 3, succeeded: 3, failed: 0, errors: [] };
    const summary = formatBatchSummary(result, "Converted");
    expect(summary).toContain("Converted 3/3 files");
    expect(summary).not.toContain("failed");
  });

  it("formats summary with errors", () => {
    const result: BatchResult = {
      total: 3,
      succeeded: 2,
      failed: 1,
      errors: [{ input: "bad.svg", error: "conversion failed" }],
    };
    const summary = formatBatchSummary(result, "Converted");
    expect(summary).toContain("Converted 2/3 files");
    expect(summary).toContain("1 failed");
    expect(summary).toContain("bad.svg: conversion failed");
  });
});

describe("detectOutputCollisions", () => {
  it("returns null when no collisions", () => {
    const result = detectOutputCollisions(["a/card.svg", "b/banner.svg"], (input) =>
      input.replace(".svg", ".tsx"),
    );
    expect(result).toBeNull();
  });

  it("returns error message when collisions exist", () => {
    const result = detectOutputCollisions(
      ["/a/card.svg", "/b/card.svg"],
      (input) => `/out/${input.split("/").pop()!.replace(".svg", ".tsx")}`,
    );
    expect(result).not.toBeNull();
    expect(result).toContain("Output path collision");
    expect(result).toContain("card.tsx");
  });
});

describe("deriveBatchOutputPath", () => {
  it("places output next to input when no outputDir", () => {
    const result = deriveBatchOutputPath("/a/card.svg", null, ".tsx");
    expect(result).toBe(join(resolve("/a"), "card.tsx"));
  });

  it("places output in outputDir when specified", () => {
    const result = deriveBatchOutputPath("/a/card.svg", "/out", ".tsx");
    expect(result).toBe(join("/out", "card.tsx"));
  });

  it("strips .scene.json extension", () => {
    const result = deriveBatchOutputPath("/a/card.scene.json", null, ".tsx");
    expect(result).toBe(join(resolve("/a"), "card.tsx"));
  });
});
