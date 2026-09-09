import { FatalError } from "@boundsvg/core";
import { describe, expect, it } from "vitest";
import {
  createVideoError,
  decodeMp4Failure,
  type VideoDiagnosticCode,
  type VideoOperation,
} from "../src/diagnostics.js";

type WireCase = {
  reason: string;
  code: VideoDiagnosticCode;
  operation: VideoOperation;
  details?: Record<string, string | number>;
};
const cases: WireCase[] = [
  {
    reason: "invalidDimension",
    code: "VIDEO_MUXER_INVALID_INPUT",
    operation: "createMuxer",
    details: { field: "width", width: 65 },
  },
  {
    reason: "invalidFrameRate",
    code: "VIDEO_MUXER_INVALID_INPUT",
    operation: "createMuxer",
    details: { field: "fpsNumerator" },
  },
  {
    reason: "invalidFrameCountHint",
    code: "VIDEO_MUXER_INVALID_INPUT",
    operation: "createMuxer",
    details: { field: "frameCountHint" },
  },
  {
    reason: "invalidGeneratorName",
    code: "VIDEO_MUXER_INVALID_INPUT",
    operation: "createMuxer",
    details: { field: "generatorName" },
  },
  {
    reason: "invalidGeneratorVersion",
    code: "VIDEO_MUXER_INVALID_INPUT",
    operation: "createMuxer",
    details: { field: "generatorVersion" },
  },
  {
    reason: "incompleteGenerator",
    code: "VIDEO_MUXER_INVALID_INPUT",
    operation: "createMuxer",
    details: { field: "generatorVersion" },
  },
  {
    reason: "invalidCodecDescription",
    code: "VIDEO_MUXER_INVALID_INPUT",
    operation: "setDescription",
    details: { field: "codecDescription" },
  },
  {
    reason: "missingCodecDescription",
    code: "VIDEO_MUXER_MISSING_INPUT",
    operation: "appendSample",
    details: { field: "codecDescription", sampleCount: 0 },
  },
  {
    reason: "emptySamples",
    code: "VIDEO_MUXER_MISSING_INPUT",
    operation: "finishMuxer",
    details: { sampleCount: 0 },
  },
  {
    reason: "alreadyFinished",
    code: "VIDEO_MUXER_INVALID_STATE",
    operation: "finishMuxer",
    details: { sampleCount: 2 },
  },
  {
    reason: "descriptionAfterSamples",
    code: "VIDEO_MUXER_INVALID_STATE",
    operation: "setDescription",
    details: { sampleCount: 1 },
  },
  {
    reason: "outputByteLimit",
    code: "VIDEO_MUXER_RESOURCE_LIMIT",
    operation: "appendSample",
    details: { limitBytes: 268435456, requestedBytes: 268435457 },
  },
  {
    reason: "outputAllocation",
    code: "VIDEO_MUXER_ALLOCATION_FAILED",
    operation: "appendSample",
    details: { requestedBytes: 16 },
  },
  {
    reason: "metadataReservationLimit",
    code: "VIDEO_MUXER_RESOURCE_LIMIT",
    operation: "createMuxer",
  },
  { reason: "writerRejected", code: "VIDEO_MUXER_WRITE_FAILED", operation: "createMuxer" },
  {
    reason: "insufficientIndexSpace",
    code: "VIDEO_MUXER_WRITE_FAILED",
    operation: "finishMuxer",
    details: { sampleCount: 600 },
  },
  {
    reason: "invalidContainerStructure",
    code: "VIDEO_MUXER_WRITE_FAILED",
    operation: "finishMuxer",
    details: { sampleCount: 2 },
  },
];

function wire(fixture: WireCase) {
  const envelope = createVideoError(fixture.code, fixture.operation).toJSON();
  return {
    ...envelope,
    context: { ...envelope.context, reason: fixture.reason, ...fixture.details },
  };
}

function expectProtocol(input: unknown, operation: VideoOperation): void {
  expect(decodeMp4Failure(input, operation).toJSON()).toEqual({
    severity: "fatal",
    code: "VIDEO_MUXER_PROTOCOL_ERROR",
    message: "MP4 muxer returned an invalid failure",
    stage: "wasm",
    context: { domain: "video", category: "protocol", operation },
  });
}

describe("MP4 failure decoder", () => {
  it.each(cases)("decodes and detaches $reason", (fixture) => {
    const envelope = wire(fixture);
    const failure = decodeMp4Failure(envelope, fixture.operation);
    expect(failure).toBeInstanceOf(FatalError);
    expect(failure.toJSON()).toEqual(envelope);
    expect(failure.context).not.toBe(envelope.context);
    expect(FatalError.fromSerialized(failure.toJSON()).toJSON()).toEqual(envelope);
  });

  it.each(cases)("rejects malformed $reason envelopes", (fixture) => {
    const envelope = wire(fixture);
    for (const key of ["severity", "code", "message", "stage", "context"]) {
      const missing: Record<string, unknown> = { ...envelope };
      delete missing[key];
      expectProtocol(missing, fixture.operation);
      for (const replacement of [null, undefined, false, 0, [], {}, "unknown"]) {
        expectProtocol({ ...envelope, [key]: replacement }, fixture.operation);
      }
    }
    for (const key of ["domain", "category", "operation", "reason"]) {
      const context: Record<string, unknown> = { ...envelope.context };
      delete context[key];
      expectProtocol({ ...envelope, context }, fixture.operation);
      for (const replacement of [null, undefined, false, 0, [], {}, "unknown"]) {
        expectProtocol(
          { ...envelope, context: { ...envelope.context, [key]: replacement } },
          fixture.operation,
        );
      }
    }
    expectProtocol({ ...envelope, extra: 1 }, fixture.operation);
    expectProtocol({ ...envelope, context: { ...envelope.context, extra: 1 } }, fixture.operation);
    expectProtocol(envelope, "disposeMuxer");
    expectInvalidDetails(fixture);
  });

  it("rejects primitive, inherited, accessor and hostile payloads without reading messages", () => {
    for (const input of [
      undefined,
      null,
      false,
      0,
      "{}",
      new Error("private cause"),
      [],
      Object.create(null),
      Object.create(wire(cases[0] as WireCase)),
    ]) {
      expectProtocol(input, "createMuxer");
    }
    const envelope = wire(cases[0] as WireCase);
    Object.defineProperty(envelope, "message", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expectProtocol(envelope, "createMuxer");
    expectProtocol(
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("hostile");
          },
        },
      ),
      "createMuxer",
    );
  });

  it("rejects invalid field and numeric combinations", () => {
    const dimension = wire(cases[0] as WireCase);
    expectProtocol({ ...dimension, context: { ...dimension.context, height: 32 } }, "createMuxer");
    const reservation = wire(cases[13] as WireCase);
    expectProtocol(
      { ...reservation, context: { ...reservation.context, field: "frameCountHint" } },
      "createMuxer",
    );
    const empty = wire(cases[8] as WireCase);
    expectProtocol({ ...empty, context: { ...empty.context, sampleCount: 1 } }, "finishMuxer");
  });

  it("omits nonfinite adapter context and never invents a native reason", () => {
    expect(
      createVideoError("VIDEO_SAMPLE_ORDER_INVALID", "writeSample", {
        previousTimestampMicros: Infinity,
        timestampMicros: 0,
      }).context,
    ).toEqual({
      domain: "video",
      category: "sampleOrder",
      operation: "writeSample",
      timestampMicros: 0,
    });
  });
});

function expectInvalidDetails(fixture: WireCase): void {
  const envelope = wire(fixture);
  for (const [key, scalar] of Object.entries(fixture.details ?? {})) {
    if (typeof scalar === "number") {
      for (const invalid of [
        null,
        undefined,
        NaN,
        Infinity,
        -1,
        0.5,
        Number.MAX_SAFE_INTEGER + 1,
        "0",
      ]) {
        expectProtocol(
          { ...envelope, context: { ...envelope.context, [key]: invalid } },
          fixture.operation,
        );
      }
    } else {
      expectProtocol(
        { ...envelope, context: { ...envelope.context, [key]: null } },
        fixture.operation,
      );
    }
  }
}
