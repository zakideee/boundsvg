import assert from "node:assert/strict";
import test from "node:test";
import type { Engine, VNode } from "@boundsvg/core";
import { DEFAULT_TEXT_UNIT_PLAYGROUND_CONTROLS } from "../../playground-shared/animation-playground.js";
import { ANIMATION_PRESETS } from "../src/pages/animation/presets.tsx";
import {
  downloadAnimatedArtifact,
  downloadMp4Artifact,
  isMp4ExportSupported,
  tryRenderAnimationArtifacts,
} from "../src/pages/animation/render-artifacts.js";
import {
  createStaticPlaybackTimes,
  renderStaticPlaybackFrames,
  sampleStaticPlaybackTime,
} from "../src/pages/animation/static-playback.js";

test("static playback uses a finite quantized looping schedule", () => {
  assert.deepEqual(createStaticPlaybackTimes(95, 40), [0, 40, 80]);
  assert.equal(
    sampleStaticPlaybackTime({
      wallTimeMs: 150,
      originWallTimeMs: 100,
      originSceneTimeMs: 20,
      durationMs: 100,
      stepMs: 40,
    }),
    40,
  );
  assert.equal(
    sampleStaticPlaybackTime({
      wallTimeMs: 130,
      originWallTimeMs: 100,
      originSceneTimeMs: 80,
      durationMs: 100,
      stepMs: 40,
    }),
    0,
  );
});

test("fixed static playback prepares its SVG schedule once", () => {
  const renderCalls: Array<Parameters<Engine["renderFrames"]>[1]> = [];
  const engine = {
    renderFrames(_input, options) {
      renderCalls.push(options);
      return options.timesMs.map((timeMs, index) => ({
        index,
        timeMs,
        format: "svg" as const,
        data: `<svg data-time="${timeMs}" />`,
      }));
    },
  } satisfies Pick<Engine, "renderFrames">;
  const preset = ANIMATION_PRESETS["hero-card"];
  const scene = preset.build(preset.defaultControls ?? DEFAULT_TEXT_UNIT_PLAYGROUND_CONTROLS, true);

  const frames = renderStaticPlaybackFrames(
    engine,
    scene,
    {
      animation: "static",
      timeMs: 80,
      resourceIdPrefix: "playback",
      showMissingGlyphs: true,
    },
    95,
    40,
  );

  assert.equal(renderCalls.length, 1);
  assert.deepEqual(renderCalls[0]?.timesMs, [0, 40, 80]);
  assert.equal(renderCalls[0]?.format, "svg");
  assert.equal("animation" in (renderCalls[0] ?? {}), false);
  assert.equal("timeMs" in (renderCalls[0] ?? {}), false);
  assert.deepEqual(
    frames.map((frame) => frame.svg),
    ['<svg data-time="0" />', '<svg data-time="40" />', '<svg data-time="80" />'],
  );
});

test("animated artifact failures are returned instead of thrown", () => {
  const result = downloadAnimatedArtifact({
    engine: {
      renderToAnimatedWebp: () => {
        throw new Error("encoder exploded");
      },
      renderToAnimatedGif: () => {
        throw new Error("unused");
      },
    },
    input: { type: "Canvas", width: 10, height: 10, children: [] } as unknown as VNode,
    renderOptions: {},
    durationMs: 200,
    format: "animated-webp",
    fileName: "boom",
  });

  assert.equal(result.error?.message, "encoder exploded");
});

test("static artifact failures are returned instead of thrown", () => {
  const preset = ANIMATION_PRESETS["cluster-entrance"];
  assert.ok(preset.defaultControls);
  const engine: Pick<Engine, "renderToSvgAndIR"> = {
    renderToSvgAndIR() {
      throw new TypeError("synthetic render failure");
    },
  };

  const result = tryRenderAnimationArtifacts(engine, preset.build(preset.defaultControls, true), {
    animation: "static",
    timeMs: preset.posterTimeMs,
  });

  assert.equal(result.artifacts, null);
  assert.equal(result.error?.message, "synthetic render failure");
});

test("mp4 export reports an unsupported runtime", async () => {
  assert.equal(isMp4ExportSupported(), false);

  const { error } = await downloadMp4Artifact({
    engine: {} as unknown as Engine,
    input: { type: "Canvas", props: {} } as unknown as VNode,
    renderOptions: {},
    durationMs: 200,
    frameRate: 30,
    fileName: "unsupported",
  });

  assert.ok(error);
  assert.match(error.message, /WebCodecs/);
});

test("mp4 support detection follows the runtime VideoEncoder", () => {
  const globals = globalThis as { VideoEncoder?: unknown };
  assert.equal(isMp4ExportSupported(), false);
  globals.VideoEncoder = class {};
  try {
    assert.equal(isMp4ExportSupported(), true);
  } finally {
    globals.VideoEncoder = undefined;
  }
});

test("mp4 export refuses before the engine is ready", async () => {
  const { error } = await downloadMp4Artifact({
    engine: null,
    input: { type: "Canvas", props: {} } as unknown as VNode,
    renderOptions: {},
    durationMs: 200,
    frameRate: 30,
    fileName: "no-engine",
  });

  assert.ok(error);
  assert.match(error.message, /Engine is not ready/);
});

test("mp4 export observes an aborted request before loading the encoder", async () => {
  const globals = globalThis as { VideoEncoder?: unknown };
  globals.VideoEncoder = class {};
  const abortController = new AbortController();
  abortController.abort("superseded");
  try {
    const { error } = await downloadMp4Artifact({
      engine: {} as unknown as Engine,
      input: { type: "Canvas", props: {} } as unknown as VNode,
      renderOptions: {},
      durationMs: 200,
      frameRate: 30,
      fileName: "aborted",
      signal: abortController.signal,
    });

    assert.ok(error);
    assert.match(error.message, /superseded|aborted/iu);
  } finally {
    globals.VideoEncoder = undefined;
  }
});
