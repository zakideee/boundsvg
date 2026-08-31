import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createInternalRecoverableError, INTERNAL_RECOVERABLE_POLICIES } from "../../src/errors.js";

describe("internal recoverable policy", () => {
  it("records every approval criterion for approved owner policies", () => {
    const approvedPolicies = INTERNAL_RECOVERABLE_POLICIES.filter(
      (policy) => policy.adjudication === "approved",
    );

    expect(approvedPolicies.length).toBeGreaterThan(0);
    for (const policy of approvedPolicies) {
      expect(policy.normativeFallback.trim()).not.toBe("");
      expect(policy.deterministicOutput).toBe(true);
      expect(policy.sameOutputAcrossPublicPaths).toBe(true);
      expect(policy.numericApproximation).toBe(false);
      expect(policy.userAction.trim()).not.toBe("");
    }
  });

  it("keeps numerical approximation warnings explicitly quarantined as legacy debt", () => {
    const debtEntries = INTERNAL_RECOVERABLE_POLICIES.filter(
      (policy) => policy.adjudication === "legacy-debt",
    ).map((policy) => [policy.code, policy.debtId, policy.violation]);

    expect(debtEntries).toEqual([
      ["ANIMATED_GIF_TIMING_ADJUSTED", "gif-timing-numeric-approximation", "numeric-approximation"],
      ["PNG_RESOLUTION_ADJUSTED", "png-resolution-numeric-approximation", "numeric-approximation"],
    ]);
  });

  it("constructs approved and legacy warnings without changing their public shape", () => {
    const approved = createInternalRecoverableError("SVG_STYLE_BLOCK_DETECTED", "style warning", {
      fallback: "style block ignored",
      stage: "analyzer",
    });
    const legacy = createInternalRecoverableError("PNG_RESOLUTION_ADJUSTED", "resolution warning", {
      fallback: "auto-adjusted scale",
      stage: "emit",
    });

    expect(approved.toJSON()).toEqual({
      severity: "recoverable",
      code: "SVG_STYLE_BLOCK_DETECTED",
      message: "style warning",
      fallback: "style block ignored",
      stage: "analyzer",
    });
    expect(legacy.fallback).toBe("auto-adjusted scale");
  });

  it("rejects incomplete owner diagnostics", () => {
    expect(() =>
      createInternalRecoverableError("SVG_STYLE_BLOCK_DETECTED", "message", {
        fallback: "  ",
        stage: "analyzer",
      }),
    ).toThrow("requires a non-empty fallback");
    expect(() =>
      createInternalRecoverableError("SVG_STYLE_BLOCK_DETECTED", " ", {
        fallback: "ignored",
        stage: "analyzer",
      }),
    ).toThrow("requires a non-empty message");
    expect(() =>
      createInternalRecoverableError("SVG_STYLE_BLOCK_DETECTED", "message", {
        fallback: "ignored",
        stage: "unknown",
      }),
    ).toThrow("invalid pipeline stage");
  });

  it("routes core owner sites through the policy factory", () => {
    const engineSource = readFileSync(new URL("../../src/engine.ts", import.meta.url), "utf8");
    const analyzerSource = readFileSync(
      new URL("../../src/svg/analyzer.ts", import.meta.url),
      "utf8",
    );

    expect(engineSource).not.toContain("new RecoverableError(");
    expect(analyzerSource).not.toContain("new RecoverableError(");
  });
});
