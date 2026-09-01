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
  invoke: (handle: WasmEngineHandle) => unknown;
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

describe("C2b six-route text-layout failure contract", () => {
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

  it("preserves a custom FatalError and normalizes only an unknown custom throw", () => {
    const preserved = new FatalError("CUSTOM_TEXT_FAILURE", "custom failure", {
      stage: "text",
      context: { owned: true },
    });
    const fatalEngine = new Engine({
      computeLayoutFn: () => "{}",
      layoutTextFlowFn: () => {
        throw preserved;
      },
    });
    expect(
      captureFatal(() => fatalEngine.layoutTextFlow({ ...commonInput, lineWidths: [100] })),
    ).toBe(preserved);

    const unknownTransport = vi.fn((): never => {
      throw Symbol("private-custom-value");
    });
    const unknownEngine = new Engine({
      computeLayoutFn: () => "{}",
      layoutTextFlowFn: unknownTransport,
    });
    const normalized = captureFatal(() =>
      unknownEngine.layoutTextFlow({ ...commonInput, lineWidths: [100] }),
    );
    expect(normalized).toMatchObject({
      code: "TEXT_LAYOUT_TRANSPORT_FAILED",
      message: "Text layout transport failed.",
      stage: "engine",
      context: { operation: "layoutTextFlow" },
    });
    expect(normalized.message).not.toContain("private-custom-value");
  });
});
