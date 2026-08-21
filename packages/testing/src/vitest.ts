import type { EngineInput, IR } from "@boundsvg/core";
import { assertNoWarnings, assertStableNodeIds } from "./index.js";

type MatcherResult = {
  pass: boolean;
  message: () => string;
};

/**
 * Vitest-compatible matchers for common boundsvg assertions.
 */
export const boundsvgMatchers = {
  toHaveNoBoundsvgWarnings(ir: IR): MatcherResult {
    try {
      assertNoWarnings(ir);
      return {
        pass: true,
        message: () => "expected IR to contain boundsvg warnings",
      };
    } catch (error: unknown) {
      return {
        pass: false,
        message: () => (error instanceof Error ? error.message : String(error)),
      };
    }
  },
  toHaveStableBoundsvgNodeIds(input: EngineInput): MatcherResult {
    try {
      assertStableNodeIds(input);
      return {
        pass: true,
        message: () => "expected input to contain duplicate boundsvg node ids",
      };
    } catch (error: unknown) {
      return {
        pass: false,
        message: () => (error instanceof Error ? error.message : String(error)),
      };
    }
  },
};
