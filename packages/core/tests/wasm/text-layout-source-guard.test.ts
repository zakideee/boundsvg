import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_RICH_TEXT_DEPTH } from "../../src/text/rich-text-limits.js";

function repositorySource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

describe("text-layout authority source guard", () => {
  it("keeps the TypeScript and boundtext rich-depth limit at the exact shared value", () => {
    const boundtextTypes = repositorySource("crates/boundtext/src/text/types.rs");
    expect(MAX_RICH_TEXT_DEPTH).toBe(48);
    expect(boundtextTypes).toContain(
      `pub const MAX_RICH_TEXT_DEPTH: usize = ${MAX_RICH_TEXT_DEPTH};`,
    );
  });

  it("removes the six route-specific malformed-success codes", () => {
    const source = repositorySource("packages/core/src/wasm/protocol-decoders.ts");
    for (const staleCode of [
      "WASM_INVALID_FLOW_OUTPUT",
      "WASM_INVALID_EXCLUSION_FLOW_OUTPUT",
      "WASM_INVALID_MEASURE_OUTPUT",
      "WASM_INVALID_SHRINKWRAP_OUTPUT",
      "WASM_INVALID_SHRINKWRAP_FLOW_OUTPUT",
      "WASM_INVALID_INTRINSIC_INLINE_SIZE_OUTPUT",
    ]) {
      expect(source, staleCode).not.toContain(staleCode);
    }
  });

  it("removes render and measurement font prechecks and ambiguous missing-layout code", () => {
    const source = repositorySource("packages/core/src/engine.ts");
    expect(source).not.toContain("assertMeasurementFontAliasesRegistered");
    expect(source).not.toContain("assertVNodeFontAliasesRegistered");
    expect(source).not.toContain('"TEXT_NO_LAYOUT"');
  });

  it("removes the second Rust wrapper authority and preserves known Worker fatals", () => {
    const adapters = repositorySource("crates/boundsvg/src/flow/adapters.rs");
    const worker = repositorySource("packages/worker/src/worker-script.ts");
    expect(adapters).not.toContain("TextFlowLayoutError");
    expect(adapters).not.toContain('"TEXT_LAYOUT_FAILED"');
    expect(adapters).not.toContain('"TEXT_LAYOUT_INVALID"');
    expect(worker).toContain("if (err instanceof FatalError)");
    expect(worker.indexOf("if (err instanceof FatalError)")).toBeLessThan(
      worker.indexOf('code: "WORKER_UNHANDLED_ERROR"'),
    );
  });
});
