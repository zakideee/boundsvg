import { describe, expect, it } from "vitest";
import { Engine } from "../../src/engine.js";
import type { TextFlowWithExclusionsResult } from "../../src/wasm/index.js";
import {
  assertTextFlowMeasurementOutput,
  decodeShrinkwrapFlowResult,
  decodeTextFlowWithExclusionsResult,
} from "../../src/wasm/protocol-decoders.js";

/** Independent measurement facts containing every changed numeric leaf. */
function createFlowFacts() {
  return {
    lines: [
      {
        fragments: [
          {
            text: "行",
            charStart: 0,
            charEnd: 1,
            x: -20,
            y: 10,
            inlineAdvancePx: -10,
            availableInlineSizePx: 100,
            regionIndex: 0,
            baselineOffset: 64,
            style: {
              fontFamily: "Fixture",
              fontWeight: 800,
              fontStyle: "normal",
              fontSizePx: 80,
              letterSpacingPx: -200,
            },
          },
        ],
        lineIndex: 0,
        crossSize: 96,
      },
    ],
    exhausted: true,
    usedLineCount: 1,
    chosenFontSizePx: 80,
  };
}

/** Minimal authored request shared by direct and injected flow-output rejection tests. */
const commonInput = {
  text: "行",
  fontFamily: "Fixture",
  fontSizePx: 80,
  flowBox: { x: 0, y: 0, width: 100, height: 200 },
  exclusions: [],
};

describe("measurement-only flow output", () => {
  it.each([
    undefined,
    null,
    0,
    { text: "おこな" },
  ])("rejects removed own fields with value %s at direct and nested boundaries", (removedValue) => {
    for (const removedKey of ["topRubyOverflowPx", "bottomRubyOverflowPx", "ruby"]) {
      const flow = createFlowFacts();
      const target = removedKey === "ruby" ? flow.lines[0]!.fragments[0]! : flow;
      Object.defineProperty(target, removedKey, { value: removedValue, enumerable: true });
      const fieldPath = removedKey === "ruby" ? "lines[0].fragments[0].ruby" : removedKey;
      for (const operation of ["layoutTextFlowWithExclusions", "shrinkwrapFlow"] as const) {
        const output =
          operation === "shrinkwrapFlow"
            ? {
                status: "satisfied",
                chosenWidthPx: 100,
                usedLineCount: 1,
                usedHeight: 96,
                layout: flow,
              }
            : flow;
        const protocolPath =
          operation === "shrinkwrapFlow" ? `$.layout.${fieldPath}` : `$.${fieldPath}`;
        expect(() => assertTextFlowMeasurementOutput(output, operation)).toThrowError(
          expect.objectContaining({
            code: "TEXT_LAYOUT_OUTPUT_INVALID",
            stage: "engine",
            context: { operation, phase: "decode", protocolPath, received: "removed field" },
          }),
        );
        if (removedValue !== undefined) {
          const decode =
            operation === "shrinkwrapFlow"
              ? decodeShrinkwrapFlowResult
              : decodeTextFlowWithExclusionsResult;
          expect(() => decode(JSON.stringify(output))).toThrowError(
            expect.objectContaining({
              code: "TEXT_LAYOUT_OUTPUT_INVALID",
              stage: "wasm",
              context: { operation, phase: "decode", protocolPath, received: "removed field" },
            }),
          );
        }
      }
    }
  });

  it("does not read a removed getter or close unrelated unknown fields", () => {
    const flow = createFlowFacts();
    let getterCalls = 0;
    Object.defineProperty(flow, "topRubyOverflowPx", {
      get() {
        getterCalls += 1;
        throw new TypeError("private payload");
      },
    });
    expect(() =>
      assertTextFlowMeasurementOutput(flow, "layoutTextFlowWithExclusions"),
    ).toThrowError(
      expect.objectContaining({ context: expect.objectContaining({ received: "removed field" }) }),
    );
    expect(getterCalls).toBe(0);
    const futureFlow = Object.assign(createFlowFacts(), { futureField: { untouched: true } });
    Object.setPrototypeOf(futureFlow, { topRubyOverflowPx: 0 });
    expect(() =>
      assertTextFlowMeasurementOutput(futureFlow, "layoutTextFlowWithExclusions"),
    ).not.toThrow();
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects nonfinite measured numbers %s while retaining signed advances", (invalidNumber) => {
    const flow = createFlowFacts();
    expect(() =>
      assertTextFlowMeasurementOutput(flow, "layoutTextFlowWithExclusions"),
    ).not.toThrow();
    for (const key of [
      "x",
      "y",
      "inlineAdvancePx",
      "availableInlineSizePx",
      "baselineOffset",
    ] as const) {
      const invalidFlow = createFlowFacts();
      invalidFlow.lines[0]!.fragments[0]![key] = invalidNumber;
      expect(() =>
        assertTextFlowMeasurementOutput(invalidFlow, "layoutTextFlowWithExclusions"),
      ).toThrowError(
        expect.objectContaining({
          context: expect.objectContaining({
            protocolPath: `$.lines[0].fragments[0].${key}`,
            received: "number",
          }),
        }),
      );
    }
  });

  it("rejects legacy successful injected Core producers instead of returning their metadata", () => {
    const legacyFlow = Object.assign(createFlowFacts(), { topRubyOverflowPx: undefined });
    const engine = new Engine({
      computeLayoutFn: () => "{}",
      layoutTextFlowWithExclusionsFn: () => legacyFlow as TextFlowWithExclusionsResult,
      shrinkwrapFlowFn: () => ({
        status: "satisfied",
        chosenWidthPx: 100,
        usedLineCount: 1,
        usedHeight: 96,
        layout: legacyFlow,
      }),
    });
    expect(() => engine.layoutTextFlowWithExclusions(commonInput)).toThrowError(
      expect.objectContaining({
        code: "TEXT_LAYOUT_OUTPUT_INVALID",
        stage: "engine",
        context: expect.objectContaining({
          operation: "layoutTextFlowWithExclusions",
          protocolPath: "$.topRubyOverflowPx",
        }),
      }),
    );
    expect(() => engine.shrinkwrapFlow(commonInput)).toThrowError(
      expect.objectContaining({
        code: "TEXT_LAYOUT_OUTPUT_INVALID",
        stage: "engine",
        context: expect.objectContaining({
          operation: "shrinkwrapFlow",
          protocolPath: "$.layout.topRubyOverflowPx",
        }),
      }),
    );
    engine.dispose();
  });
});
