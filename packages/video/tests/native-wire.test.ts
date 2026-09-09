import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { decodeMp4Failure, type VideoOperation } from "../src/diagnostics.js";
import init, {
  Mp4VideoMuxer,
  mp4_wasm_schema_version as mp4SchemaVersion,
} from "../wasm-pkg/boundmp4.js";

const DESCRIPTION = new Uint8Array([
  1, 100, 0, 40, 255, 225, 0, 4, 103, 100, 0, 40, 1, 0, 3, 104, 238, 60,
]);

beforeAll(async () => {
  await init({
    module_or_path: await readFile(new URL("../wasm-pkg/boundmp4_bg.wasm", import.meta.url)),
  });
});

function failureFrom(action: () => unknown, operation: VideoOperation, reason: string) {
  let captured: unknown;
  try {
    action();
  } catch (failure) {
    captured = failure;
  }
  expect(captured).toBeDefined();
  expect(Object.getPrototypeOf(captured)).toBe(Object.prototype);
  expect(Object.keys(captured as object).sort()).toEqual([
    "code",
    "context",
    "message",
    "severity",
    "stage",
  ]);
  const diagnostic = decodeMp4Failure(captured, operation);
  expect(diagnostic.context?.reason).toBe(reason);
  expect(diagnostic.code).not.toBe("VIDEO_MUXER_PROTOCOL_ERROR");
  return diagnostic;
}

it("exposes the independent schema revision from the real module", () => {
  expect(mp4SchemaVersion()).toBe(1);
});

const invalidConstructors = [
  { args: [65, 32, 30, 1, 2], reason: "invalidDimension", field: "width" },
  { args: [64, 33, 30, 1, 2], reason: "invalidDimension", field: "height" },
  { args: [64, 32, 0, 1, 2], reason: "invalidFrameRate", field: "fpsNumerator" },
  { args: [64, 32, 30, 0, 2], reason: "invalidFrameRate", field: "fpsDenominator" },
  { args: [64, 32, 30, 1, 0], reason: "invalidFrameCountHint", field: "frameCountHint" },
] as const;
for (const { args, reason, field } of invalidConstructors) {
  it(`projects real ${reason} for ${field}`, () => {
    const diagnostic = failureFrom(() => new Mp4VideoMuxer(...args), "createMuxer", reason);
    expect(diagnostic.context?.field).toBe(field);
  });
}

for (const { name, version, reason, field } of [
  { name: "!invalid", version: "1.0.0", reason: "invalidGeneratorName", field: "generatorName" },
  {
    name: "video",
    version: "invalid version",
    reason: "invalidGeneratorVersion",
    field: "generatorVersion",
  },
  { name: undefined, version: "1.0.0", reason: "incompleteGenerator", field: "generatorName" },
  { name: "video", version: undefined, reason: "incompleteGenerator", field: "generatorVersion" },
]) {
  it(`projects real ${reason} for ${field}`, () => {
    const diagnostic = failureFrom(
      () => new Mp4VideoMuxer(64, 32, 30, 1, 2, name, version),
      "createMuxer",
      reason,
    );
    expect(diagnostic.context?.field).toBe(field);
  });
}

it("projects codec, missing-input and state failures without an error allocation", () => {
  const muxer = new Mp4VideoMuxer(64, 32, 30, 1, 2);
  try {
    failureFrom(
      () => muxer.append_sample(new Uint8Array([1]), true),
      "appendSample",
      "missingCodecDescription",
    );
    failureFrom(
      () => muxer.set_codec_description(new Uint8Array()),
      "setDescription",
      "invalidCodecDescription",
    );
    failureFrom(() => muxer.finish(), "finishMuxer", "emptySamples");
    muxer.set_codec_description(DESCRIPTION);
    muxer.append_sample(new Uint8Array([1]), true);
    failureFrom(
      () => muxer.set_codec_description(DESCRIPTION),
      "setDescription",
      "descriptionAfterSamples",
    );
    expect(muxer.finish().byteLength).toBeGreaterThan(0);
    for (const [operation, action] of [
      ["setDescription", () => muxer.set_codec_description(DESCRIPTION)],
      ["appendSample", () => muxer.append_sample(new Uint8Array([1]), false)],
      ["finishMuxer", () => muxer.finish()],
    ] as const) {
      const diagnostic = failureFrom(action, operation, "alreadyFinished");
      expect(diagnostic.context?.sampleCount).toBe(1);
    }
  } finally {
    muxer.free();
  }
});

it("projects a real exhausted faststart reservation and keeps native finish terminal", () => {
  const muxer = new Mp4VideoMuxer(64, 32, 30, 1, 1);
  try {
    muxer.set_codec_description(DESCRIPTION);
    for (let index = 0; index < 600; index += 1) {
      muxer.append_sample(new Uint8Array(32), index === 0);
    }
    const diagnostic = failureFrom(() => muxer.finish(), "finishMuxer", "insufficientIndexSpace");
    expect(diagnostic.context?.sampleCount).toBe(600);
    failureFrom(() => muxer.finish(), "finishMuxer", "alreadyFinished");
  } finally {
    muxer.free();
  }
});
