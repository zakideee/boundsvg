import { describe, expect, it } from "vitest";
import { decodeWorkerResponseMessage, isWorkerResponse } from "../src/protocol.js";

/** Independent flow-cell facts, without paint metadata or generated glyphs. */
function createFlowFacts() {
  return {
    lines: [
      {
        fragments: [
          {
            text: "行",
            charStart: 0,
            charEnd: 1,
            x: 0,
            y: 0,
            inlineAdvancePx: 120,
            availableInlineSizePx: 180,
            regionIndex: 0,
            baselineOffset: 64,
          },
        ],
        lineIndex: 0,
        crossSize: 96,
      },
    ],
    exhausted: true,
    usedLineCount: 1,
  };
}

describe("Worker measurement-only flow output", () => {
  it.each([
    undefined,
    null,
    0,
    { text: "おこな" },
  ])("rejects removed own values %s with typed paths", (removedValue) => {
    for (const removedKey of ["ruby", "topRubyOverflowPx", "bottomRubyOverflowPx"]) {
      for (const nested of [false, true]) {
        const flow = createFlowFacts();
        const target = removedKey === "ruby" ? flow.lines[0]!.fragments[0]! : flow;
        Object.defineProperty(target, removedKey, { value: removedValue, enumerable: true });
        const response = {
          id: 7,
          type: nested ? "shrinkwrap-flow-ok" : "layout-text-flow-with-exclusions-ok",
          result: nested
            ? {
                status: "satisfied",
                chosenWidthPx: 180,
                usedLineCount: 1,
                usedHeight: 96,
                layout: flow,
              }
            : flow,
        };
        const fieldPath = removedKey === "ruby" ? "lines[0].fragments[0].ruby" : removedKey;
        const decoded = decodeWorkerResponseMessage(response);
        expect(decoded.id).toBe(7);
        expect(decoded.message).toBeUndefined();
        expect(decoded.error).toMatchObject({
          code: "TEXT_LAYOUT_OUTPUT_INVALID",
          stage: "engine",
          context: {
            operation: nested ? "shrinkwrapFlow" : "layoutTextFlowWithExclusions",
            phase: "decode",
            protocolPath: nested ? `$.layout.${fieldPath}` : `$.${fieldPath}`,
            received: "removed field",
          },
        });
        expect(isWorkerResponse(response)).toBe(false);
      }
    }
  });

  it("rejects nonfinite geometry but preserves unrelated future fields", () => {
    const flow = Object.assign(createFlowFacts(), { futureCellMetadata: { revision: 2 } });
    expect(
      isWorkerResponse({ id: 7, type: "layout-text-flow-with-exclusions-ok", result: flow }),
    ).toBe(true);
    flow.lines[0]!.fragments[0]!.x = Number.NaN;
    expect(
      decodeWorkerResponseMessage({
        id: 7,
        type: "layout-text-flow-with-exclusions-ok",
        result: flow,
      }).error,
    ).toMatchObject({
      code: "TEXT_LAYOUT_OUTPUT_INVALID",
      context: { protocolPath: "$.lines[0].fragments[0].x", received: "number" },
    });
  });
});
