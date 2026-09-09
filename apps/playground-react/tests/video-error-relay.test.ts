import assert from "node:assert/strict";
import test from "node:test";
import { type Engine, type EngineInput, FatalError } from "@boundsvg/core";
import { downloadMp4Artifact } from "../src/pages/animation/render-artifacts.js";

test("relays a Video capability diagnostic with its code, stage and context", async (context) => {
  const encoderDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VideoEncoder");
  Object.defineProperty(globalThis, "VideoEncoder", { value: class {}, configurable: true });
  context.after(() => {
    if (encoderDescriptor) {
      Object.defineProperty(globalThis, "VideoEncoder", encoderDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "VideoEncoder");
    }
  });
  const engine = {
    renderFrames: () => [{ format: "png", data: new Uint8Array(), timeMs: 0 }],
  } as unknown as Engine;
  const { error } = await downloadMp4Artifact({
    engine,
    input: { type: "Canvas", props: {} } as unknown as EngineInput,
    renderOptions: {},
    durationMs: 200,
    frameRate: 30,
    fileName: "video",
  });
  assert.ok(error instanceof FatalError);
  assert.equal(error.code, "VIDEO_ENCODER_UNSUPPORTED");
  assert.equal(error.stage, "emit");
  assert.deepEqual(error.context, {
    domain: "video",
    category: "encoderUnsupported",
    operation: "decodeFrame",
  });
});
