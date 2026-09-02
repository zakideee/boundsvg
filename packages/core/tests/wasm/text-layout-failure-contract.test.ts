import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import { WasmEngineHandle } from "../../src/wasm/index.js";
import type { WasmEngineInstance } from "../../src/wasm/types.js";

const commonInput = { text: "A", fontFamily: "Fixture", fontSizePx: 16 };

type MeasurementInvocation = {
  operation:
    | "layoutTextFlow"
    | "layoutTextFlowWithExclusions"
    | "measureTextBlock"
    | "shrinkwrapText"
    | "shrinkwrapFlow"
    | "measureIntrinsicInlineSize";
  invoke: (handle: WasmEngineHandle | Engine) => unknown;
};

const measurementInvocations: readonly MeasurementInvocation[] = [
  {
    operation: "layoutTextFlow",
    invoke: (handle) => handle.layoutTextFlow({ ...commonInput, lineWidths: [100] }),
  },
  {
    operation: "layoutTextFlowWithExclusions",
    invoke: (handle) =>
      handle.layoutTextFlowWithExclusions({
        ...commonInput,
        flowBox: { x: 0, y: 0, width: 100, height: 40 },
        exclusions: [],
      }),
  },
  {
    operation: "measureTextBlock",
    invoke: (handle) => handle.measureTextBlock({ ...commonInput, maxWidth: 100 }),
  },
  {
    operation: "shrinkwrapText",
    invoke: (handle) => handle.shrinkwrapText({ ...commonInput, maxWidth: 100 }),
  },
  {
    operation: "shrinkwrapFlow",
    invoke: (handle) =>
      handle.shrinkwrapFlow({
        ...commonInput,
        flowBox: { x: 0, y: 0, width: 100, height: 40 },
        exclusions: [],
      }),
  },
  {
    operation: "measureIntrinsicInlineSize",
    invoke: (handle) => handle.measureIntrinsicInlineSize(commonInput),
  },
];

function makeWasmHandle(method: () => string): WasmEngineHandle {
  return new WasmEngineHandle({
    layout_text_flow: method,
    layout_text_flow_with_exclusions: method,
    measure_text_block: method,
    shrinkwrap_text: method,
    shrinkwrap_flow: method,
    measure_intrinsic_inline_size: method,
    free: () => undefined,
  } as unknown as WasmEngineInstance);
}

function captureFatal(invoke: () => unknown): FatalError {
  try {
    invoke();
  } catch (error) {
    expect(error).toBeInstanceOf(FatalError);
    return error as FatalError;
  }
  throw new Error("expected FatalError");
}

describe("six-route text-layout failure contract", () => {
  it("preserves one structured domain diagnostic on every WASM route", () => {
    for (const invocation of measurementInvocations) {
      const handle = makeWasmHandle(() => {
        throw JSON.stringify({
          severity: "fatal",
          code: "TEXT_FONT_UNAVAILABLE",
          message: "No requested font is available for text layout.",
          stage: "text",
          context: {
            operation: invocation.operation,
            runIndex: 0,
            requestedAliases: ["Fixture"],
            omittedAliasCount: 0,
            fontWeight: 400,
            fontStyle: "normal",
          },
        });
      });

      const error = captureFatal(() => invocation.invoke(handle));
      expect(error.toJSON()).toEqual({
        severity: "fatal",
        code: "TEXT_FONT_UNAVAILABLE",
        message: "No requested font is available for text layout.",
        stage: "text",
        context: {
          operation: invocation.operation,
          runIndex: 0,
          requestedAliases: ["Fixture"],
          omittedAliasCount: 0,
          fontWeight: 400,
          fontStyle: "normal",
        },
      });
      handle.dispose();
    }
  });

  it("uses one malformed-success code and bounded descriptor on every route", () => {
    for (const invocation of measurementInvocations) {
      const handle = makeWasmHandle(() => JSON.stringify({ invalid: true }));
      const error = captureFatal(() => invocation.invoke(handle));

      expect(error).toMatchObject({
        code: "TEXT_LAYOUT_OUTPUT_INVALID",
        message: "Text layout transport returned an invalid result.",
        stage: "wasm",
        context: {
          operation: invocation.operation,
          phase: "decode",
          protocolPath: "$",
          received: "object",
        },
      });
      handle.dispose();
    }
  });

  it("normalizes every malformed thrown WASM value without exposing it", () => {
    for (const invocation of measurementInvocations) {
      const handle = makeWasmHandle(() => {
        throw Symbol("private-wasm-value");
      });
      const error = captureFatal(() => invocation.invoke(handle));

      expect(error).toMatchObject({
        code: "TEXT_LAYOUT_WASM_FAILED",
        message: "Text layout WASM transport failed.",
        stage: "wasm",
        context: { operation: invocation.operation },
      });
      expect(error.message).not.toContain("private-wasm-value");
      handle.dispose();
    }
  });

  it("accepts every closed WASM text-layout fatal tuple", () => {
    const operation = "layoutTextFlow" as const;
    const fixtures = [
      {
        code: "TEXT_LAYOUT_INPUT_INVALID",
        message: "Text layout request is invalid.",
        stage: "validate",
        context: { operation, reason: "malformedJson" },
      },
      {
        code: "TEXT_FONT_UNAVAILABLE",
        message: "No requested font is available for text layout.",
        stage: "text",
        context: {
          operation,
          runIndex: 0,
          requestedAliases: ["Fixture"],
          omittedAliasCount: 0,
          fontWeight: 400,
          fontStyle: "normal",
        },
      },
      {
        code: "TEXT_LAYOUT_PREPARATION_FAILED",
        message: "Text layout preparation failed.",
        stage: "text",
        context: { operation, phase: "plainShaping" },
      },
      {
        code: "TEXT_FIT_INVALID_STEP",
        message: "Text fit step is invalid.",
        stage: "text",
        context: { operation },
      },
      {
        code: "TEXT_FIT_PROBE_LIMIT",
        message: "Text fit probe limit was exceeded.",
        stage: "text",
        context: { operation, required: 2, limit: 1 },
      },
      {
        code: "TEXT_ELLIPSIS_CANDIDATE_LIMIT",
        message: "Text ellipsis candidate limit was exceeded.",
        stage: "text",
        context: { operation, required: 2, limit: 1 },
      },
      {
        code: "RICH_TEXT_MAX_DEPTH",
        message: "Rich text depth limit was exceeded.",
        stage: "validate",
        context: { operation, actual: 49, limit: 48 },
      },
      {
        code: "INLINE_RECT_COMPLEXITY_LIMIT",
        message: "Inline rectangle limit was exceeded.",
        stage: "text",
        context: { operation, required: 2, limit: 1 },
      },
      {
        code: "TEXT_REGION_QUERY_INVALID",
        message: "Text region query is invalid.",
        stage: "text",
        context: { operation, reason: "nonFiniteBounds", field: "flowWidth" },
      },
      {
        code: "TEXT_REGION_PROVIDER_FAILED",
        message: "Text region provider failed.",
        stage: "text",
        context: { operation, reason: "unavailable" },
      },
      {
        code: "TEXT_FLOW_REGION_INVALID",
        message: "Text flow region is invalid.",
        stage: "text",
        context: {
          operation,
          index: 1,
          reason: "intervalOutsideFrame",
          start: -1,
          end: 2,
          frameStart: 0,
          frameEnd: 10,
        },
      },
      {
        code: "TEXT_REGION_QUERY_LIMIT",
        message: "Text region query limit was exceeded.",
        stage: "text",
        context: { operation, limit: 1 },
      },
      {
        code: "TEXT_REGION_INTERVAL_LIMIT",
        message: "Text region interval limit was exceeded.",
        stage: "text",
        context: { operation, required: 2, limit: 1 },
      },
      {
        code: "TEXT_LAYOUT_INVARIANT",
        message: "Text layout invariant failed.",
        stage: "text",
        context: { operation, invariant: "lineRangeMissing" },
      },
      {
        code: "TEXT_LAYOUT_OUTPUT_INVALID",
        message: "Text layout transport returned an invalid result.",
        stage: "wasm",
        context: { operation, phase: "serialize" },
      },
      {
        code: "TEXT_LAYOUT_PANIC",
        message: "Text layout failed unexpectedly.",
        stage: "wasm",
        context: { operation },
      },
      {
        code: "TEXT_LAYOUT_WASM_FAILED",
        message: "Text layout WASM transport failed.",
        stage: "wasm",
        context: { operation },
      },
    ] as const;

    for (const fixture of fixtures) {
      const wire = { severity: "fatal" as const, ...fixture };
      const handle = makeWasmHandle(() => {
        throw JSON.stringify(wire);
      });
      const error = captureFatal(() =>
        handle.layoutTextFlow({ ...commonInput, lineWidths: [100] }),
      );
      expect(error.toJSON()).toEqual(wire);
      handle.dispose();
    }
  });

  it("preserves the existing u16 font-weight acceptance boundary", () => {
    for (const fontWeight of [0, 65_535]) {
      const wire = {
        severity: "fatal" as const,
        code: "TEXT_FONT_UNAVAILABLE",
        message: "No requested font is available for text layout.",
        stage: "text" as const,
        context: {
          operation: "layoutTextFlow",
          runIndex: 0,
          requestedAliases: ["Fixture"],
          omittedAliasCount: 0,
          fontWeight,
          fontStyle: "normal",
        },
      };
      const handle = makeWasmHandle(() => {
        throw JSON.stringify(wire);
      });
      const error = captureFatal(() =>
        handle.layoutTextFlow({ ...commonInput, fontWeight, lineWidths: [100] }),
      );
      expect(error.toJSON()).toEqual(wire);
      handle.dispose();
    }
  });

  it("closes noncanonical and oversized WASM envelopes on every route", () => {
    const canonical = (operation: MeasurementInvocation["operation"]) => ({
      severity: "fatal" as const,
      code: "TEXT_ELLIPSIS_CANDIDATE_LIMIT",
      message: "Text ellipsis candidate limit was exceeded.",
      stage: "text" as const,
      context: { operation, required: 2, limit: 1 },
    });

    for (const invocation of measurementInvocations) {
      const invalidWires = [
        { ...canonical(invocation.operation), message: "noncanonical" },
        { ...canonical(invocation.operation), stage: "wasm" },
        {
          ...canonical(invocation.operation),
          context: {
            ...canonical(invocation.operation).context,
            operation:
              invocation.operation === "measureTextBlock" ? "layoutTextFlow" : "measureTextBlock",
          },
        },
        { ...canonical(invocation.operation), code: "UNKNOWN_TEXT_LAYOUT_FAILURE" },
        { ...canonical(invocation.operation), nodeId: "unexpected" },
        {
          ...canonical(invocation.operation),
          context: {
            ...canonical(invocation.operation).context,
            details: { code: "nested-reserved" },
          },
        },
        {
          severity: "fatal",
          code: "TEXT_FONT_UNAVAILABLE",
          message: "No requested font is available for text layout.",
          stage: "text",
          context: {
            operation: invocation.operation,
            runIndex: 0,
            requestedAliases: Array.from({ length: 16 }, () => "x".repeat(256)),
            omittedAliasCount: 0,
            fontWeight: 400,
            fontStyle: "normal",
          },
        },
      ];

      for (const invalidWire of invalidWires) {
        const handle = makeWasmHandle(() => {
          throw JSON.stringify(invalidWire);
        });
        const error = captureFatal(() => invocation.invoke(handle));
        expect(error.toJSON()).toEqual({
          severity: "fatal",
          code: "TEXT_LAYOUT_WASM_FAILED",
          message: "Text layout WASM transport failed.",
          stage: "wasm",
          context: { operation: invocation.operation },
        });
        handle.dispose();
      }

      const oversizedHandle = makeWasmHandle(() => {
        throw `${" ".repeat(8_193)}${JSON.stringify(canonical(invocation.operation))}`;
      });
      const oversizedError = captureFatal(() => invocation.invoke(oversizedHandle));
      expect(oversizedError.toJSON()).toEqual({
        severity: "fatal",
        code: "TEXT_LAYOUT_WASM_FAILED",
        message: "Text layout WASM transport failed.",
        stage: "wasm",
        context: { operation: invocation.operation },
      });
      oversizedHandle.dispose();
    }
  });

  it("does not treat an arbitrary FatalError instance as a WASM wire envelope", () => {
    const handle = makeWasmHandle(() => {
      throw new FatalError("CUSTOM_TEXT_FAILURE", "custom failure", { stage: "text" });
    });
    expect(
      captureFatal(() => handle.layoutTextFlow({ ...commonInput, lineWidths: [100] })).toJSON(),
    ).toEqual({
      severity: "fatal",
      code: "TEXT_LAYOUT_WASM_FAILED",
      message: "Text layout WASM transport failed.",
      stage: "wasm",
      context: { operation: "layoutTextFlow" },
    });
    handle.dispose();
  });

  it("preserves a custom FatalError and normalizes only an unknown custom throw", () => {
    const preserved = new FatalError("CUSTOM_TEXT_FAILURE", "custom failure", {
      stage: "text",
      context: { owned: true },
    });
    const throwPreserved = (): never => {
      throw preserved;
    };
    const fatalEngine = new Engine({
      computeLayoutFn: () => "{}",
      layoutTextFlowFn: throwPreserved,
      layoutTextFlowWithExclusionsFn: throwPreserved,
      measureTextBlockFn: throwPreserved,
      shrinkwrapTextFn: throwPreserved,
      shrinkwrapFlowFn: throwPreserved,
      measureIntrinsicInlineSizeFn: throwPreserved,
    });
    for (const invocation of measurementInvocations) {
      expect(captureFatal(() => invocation.invoke(fatalEngine))).toBe(preserved);
    }

    const unknownTransport = vi.fn((): never => {
      throw Symbol("private-custom-value");
    });
    const unknownEngine = new Engine({
      computeLayoutFn: () => "{}",
      layoutTextFlowFn: unknownTransport,
      layoutTextFlowWithExclusionsFn: unknownTransport,
      measureTextBlockFn: unknownTransport,
      shrinkwrapTextFn: unknownTransport,
      shrinkwrapFlowFn: unknownTransport,
      measureIntrinsicInlineSizeFn: unknownTransport,
    });
    for (const invocation of measurementInvocations) {
      const normalized = captureFatal(() => invocation.invoke(unknownEngine));
      expect(normalized).toMatchObject({
        code: "TEXT_LAYOUT_TRANSPORT_FAILED",
        message: "Text layout transport failed.",
        stage: "engine",
        context: { operation: invocation.operation },
      });
      expect(normalized.message).not.toContain("private-custom-value");
    }
  });
});
