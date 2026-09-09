import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoError } from "../src/diagnostics.js";

const options = {
  width: 64,
  height: 32,
  frameRate: { numerator: 30, denominator: 1 },
  frameCountHint: 2,
};
const sample = {
  bytes: new Uint8Array([1]),
  timestampMicros: 0,
  keyFrame: true,
  codecDescription: new Uint8Array([1]),
};

afterEach(() => {
  vi.doUnmock("../src/generated-wasm.js");
  vi.resetModules();
});

async function setup(
  failureAt?: "setDescription" | "appendSample" | "finishMuxer",
  hasCleanupFailure = false,
  thrown?: unknown,
) {
  const calls = { create: 0, description: 0, append: 0, finish: 0, free: 0 };
  const failure = thrown ?? {
    ...createVideoError("VIDEO_MUXER_WRITE_FAILED", failureAt ?? "appendSample").toJSON(),
    context: {
      domain: "video",
      category: "container",
      operation: failureAt ?? "appendSample",
      reason: "writerRejected",
      sampleCount: 0,
    },
  };
  class FakeMuxer {
    constructor() {
      calls.create++;
    }
    set_codec_description() {
      calls.description++;
      if (failureAt === "setDescription") {
        throw failure;
      }
    }
    append_sample() {
      calls.append++;
      if (failureAt === "appendSample") {
        throw failure;
      }
    }
    finish() {
      calls.finish++;
      if (failureAt === "finishMuxer") {
        throw failure;
      }
      return new Uint8Array([1]);
    }
    free() {
      calls.free++;
      if (hasCleanupFailure) {
        throw new Error("cleanup failure");
      }
    }
  }
  vi.doMock("../src/generated-wasm.js", () => ({
    initMuxerWasm: vi.fn().mockResolvedValue(undefined),
    Mp4VideoMuxer: FakeMuxer,
  }));
  const { createMp4Writer } = await import("../src/mp4-writer.js");
  return { writer: await createMp4Writer(options), calls, failure };
}

describe("writer terminal state", () => {
  it.each([
    "setDescription",
    "appendSample",
    "finishMuxer",
  ] as const)("preserves %s failure and frees once despite cleanup failure", async (operation) => {
    const { writer, calls } = await setup(operation, true);
    const action =
      operation === "finishMuxer"
        ? () => {
            writer.write(sample);
            writer.finish();
          }
        : () => writer.write(sample);
    expect(action).toThrowError(
      expect.objectContaining({
        code: "VIDEO_MUXER_WRITE_FAILED",
        context: expect.objectContaining({ reason: "writerRejected", operation }),
      }),
    );
    const stoppedCalls = { ...calls };
    expect(() => writer.write(sample)).toThrowError(
      expect.objectContaining({ code: "VIDEO_MUXER_INVALID_STATE" }),
    );
    expect(() => writer.finish()).toThrowError(
      expect.objectContaining({ code: "VIDEO_MUXER_INVALID_STATE" }),
    );
    writer.dispose();
    writer.dispose();
    expect(calls).toEqual(stoppedCalls);
    expect(calls.free).toBe(1);
  });

  it("rejects unstructured native throws and becomes terminal", async () => {
    const { writer, calls } = await setup("appendSample", false, '{"message":"legacy failure"}');
    expect(() => writer.write(sample)).toThrowError(
      expect.objectContaining({ code: "VIDEO_MUXER_PROTOCOL_ERROR" }),
    );
    expect(calls.free).toBe(1);
    expect(() => writer.write(sample)).toThrow();
    expect(calls.append).toBe(1);
  });

  it("finishes once and never reenters native code", async () => {
    const { writer, calls } = await setup();
    writer.write(sample);
    expect(writer.finish()).toEqual(new Uint8Array([1]));
    expect(() => writer.finish()).toThrowError(
      expect.objectContaining({ code: "VIDEO_MUXER_INVALID_STATE" }),
    );
    expect(() => writer.write(sample)).toThrow();
    writer.dispose();
    expect(calls).toEqual({ create: 1, description: 1, append: 1, finish: 1, free: 1 });
  });

  it("reports a standalone free failure and never retries it", async () => {
    const { writer, calls } = await setup(undefined, true);
    expect(() => writer.dispose()).toThrowError(
      expect.objectContaining({
        code: "VIDEO_MUXER_PROTOCOL_ERROR",
        context: expect.objectContaining({ operation: "disposeMuxer" }),
      }),
    );
    writer.dispose();
    expect(calls.free).toBe(1);
  });
});
