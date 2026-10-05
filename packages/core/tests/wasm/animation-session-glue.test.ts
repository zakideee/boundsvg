import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AnimationRenderOptions,
  snapshotAnimationOpenInput,
  WasmAnimatedRasterSessionHandle,
} from "../../src/wasm/animation-session.js";
import { WasmEngineHandle } from "../../src/wasm/index.js";
import type { WasmEngineInstance } from "../../src/wasm/types.js";

type RawModule = typeof import("../../wasm-pkg/boundsvg.js");
type RawEngine = InstanceType<RawModule["BoundSvgEngine"]>;
type RawSession = ReturnType<RawEngine["open_animated_raster"]>;
type RawScene = ReturnType<RawEngine["preflight_raster_scene"]>;

/** Self-authored, font-independent content isolates the generated binding boundary. */
const FRAME_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="#e32"/></svg>';
/** Prepare the same structural SVG input used by the ordinary raster scene path. */
function sceneIr(svg: string, width = 8, height = 4): string {
  const bbox = { x: 0, y: 0, w: width, h: height };
  return JSON.stringify({
    width,
    height,
    drawOrder: [],
    root: {
      type: "group",
      nodeId: "root",
      bbox,
      children: [
        { type: "svg", nodeId: "svg", bbox, svgContent: svg, preserveAspectRatio: "xMidYMid meet" },
      ],
    },
  });
}

/** Read a serialized native fatal without treating a glue TypeError as structured proof. */
function fatalFromCall(callback: () => unknown): {
  code: string;
  context: Record<string, unknown>;
} {
  let thrown: unknown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  expect(typeof thrown).toBe("string");
  return JSON.parse(thrown as string) as { code: string; context: Record<string, unknown> };
}

/** Drain one completed native container, applying the ordinary WebP length patch. */
function collectSession(session: RawSession, push: () => void): Uint8Array {
  const chunks: Uint8Array[] = [];
  const drain = (): void => {
    while (true) {
      const chunk = session.read_chunk();
      if (chunk === null) {
        break;
      }
      chunks.push(chunk);
    }
  };
  push();
  drain();
  const metadata = JSON.parse(session.finish()) as {
    bytesWritten: number;
    patch?: { offset: number; bytes: number[] };
  };
  drain();
  const bytes = new Uint8Array(metadata.bytesWritten);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  expect(offset).toBe(bytes.length);
  if (metadata.patch) {
    bytes.set(metadata.patch.bytes, metadata.patch.offset);
  }
  return bytes;
}

for (const target of ["node", "web"] as const) {
  describe(`${target} generated animation session glue`, () => {
    let module: RawModule;
    let engine: RawEngine;
    let scene: RawScene;
    let managedOwner: WasmEngineHandle;
    beforeAll(async () => {
      if (target === "node") {
        module = createRequire(import.meta.url)("../../wasm-pkg/boundsvg.js") as RawModule;
      } else {
        const binding = await import("../../../../crates/boundsvg/pkg-web/boundsvg.js");
        const bytes = await readFile(
          new URL("../../../../crates/boundsvg/pkg-web/boundsvg_bg.wasm", import.meta.url),
        );
        await binding.default({ module_or_path: bytes });
        module = binding as unknown as RawModule;
      }
      engine = new module.BoundSvgEngine();
      managedOwner = new WasmEngineHandle(engine as unknown as WasmEngineInstance);
      scene = engine.preflight_raster_scene(sceneIr(FRAME_SVG), "{}");
      engine.resolve_raster_scene(scene);
    });
    afterAll(() => {
      scene?.free();
      managedOwner?.dispose();
    });

    function open(
      format: "gif" | "webp" = "gif",
      frameCount = 1,
      renderOptions: AnimationRenderOptions = { animation: "static" },
    ): RawSession {
      return engine.open_animated_raster(
        JSON.stringify({ format, frameCount, iterations: 1, renderOptions }),
      );
    }
    function push(
      session: RawSession,
      time: unknown = 0,
      duration: unknown = 20,
      rasterScene = scene,
      owner = engine,
    ): void {
      owner.push_animated_raster_frame(session, rasterScene, time, duration);
    }
    function close(session: RawSession): void {
      session.abort();
      session.free();
    }

    it("exports the four-argument scalar ABI and rejects coerced open inputs", () => {
      expect(module.wasm_schema_version()).toBe(33);
      expect(engine.push_animated_raster_frame.length).toBe(4);
      const session = open();
      try {
        expect("push" in session).toBe(false);
      } finally {
        close(session);
      }
      for (const input of [undefined, null, {}, [], 1, Object("{}")]) {
        expect(fatalFromCall(() => engine.open_animated_raster(input))).toMatchObject({
          context: { operation: "open", reason: "wrongType" },
        });
      }
    });

    it("requires fixed settings and keeps root shape before integer and duplicate checks", () => {
      for (const [extra, reason, field] of [
        ["", "missingField", "renderOptions"],
        [',"renderOptions":null', "nullField", "renderOptions"],
        [',"renderOptions":false', "wrongType", "renderOptions"],
        [',"renderOptions":{"animation":"static"},"frameCount":1', "outOfDomain", undefined],
        [
          ',"renderOptions":{"animation":"static"},"frameCount":1,"extra":1',
          "unknownField",
          undefined,
        ],
      ] as const) {
        expect(
          fatalFromCall(() =>
            engine.open_animated_raster(`{"format":"gif","frameCount":1.0,"iterations":1${extra}}`),
          ),
        ).toMatchObject({
          context: { operation: "open", reason, ...(field === undefined ? {} : { field }) },
        });
      }
      for (const token of ["1.0", "1e0", "-0", "-1", "9007199254740992"]) {
        expect(
          fatalFromCall(() =>
            engine.open_animated_raster(
              `{"format":"gif","frameCount":${token},"iterations":1,"renderOptions":{"animation":"static"}}`,
            ),
          ),
        ).toMatchObject({ context: { field: "frameCount", operation: "open" } });
      }
    });

    it("records raw token and managed snapshot stages for compound open failures", () => {
      const managedOpen = managedOwner.createOpenAnimatedRasterSessionFn();
      expect(managedOpen).toBeDefined();
      for (const [frameCount, renderOptions, rawField, rawReason, managedField, managedReason] of [
        [
          1.5,
          { animation: "static", scale: null },
          "frameCount",
          "outOfDomain",
          "renderOptions",
          "nullField",
        ],
        [1.5, { animation: "static" }, "frameCount", "outOfDomain", "frameCount", "outOfDomain"],
        [
          0,
          { animation: "static", scale: null },
          "renderOptions",
          "nullField",
          "renderOptions",
          "nullField",
        ],
        [
          1,
          { animation: "static", scale: null },
          "renderOptions",
          "nullField",
          "renderOptions",
          "nullField",
        ],
      ] as const) {
        const input = {
          format: "gif" as const,
          frameCount,
          iterations: 1,
          options: {},
          renderOptions,
        };
        expect(
          fatalFromCall(() => engine.open_animated_raster(JSON.stringify(input))),
        ).toMatchObject({
          context: { operation: "open", field: rawField, reason: rawReason },
        });
        expect(() =>
          managedOpen?.(input as unknown as Parameters<NonNullable<typeof managedOpen>>[0]),
        ).toThrowError(
          expect.objectContaining({
            code: "ANIMATED_RASTER_SESSION_INVALID_INPUT",
            context: {
              format: "gif",
              operation: "open",
              field: managedField,
              reason: managedReason,
            },
          }),
        );
      }
    });

    it("maps raw raster failures at the managed boundary and keeps the terminal primary", () => {
      const managedOpen = managedOwner.createOpenAnimatedRasterSessionFn();
      const owned = managedOwner.preflightRasterScene(sceneIr(FRAME_SVG), "{}");
      owned.resolve();
      try {
        const session = managedOpen?.({
          format: "gif",
          frameCount: 2,
          iterations: 1,
          options: { background: "not-a-color" },
          renderOptions: { animation: "static" },
        });
        expect(session).toBeDefined();
        if (!session) {
          throw new Error("managed session capability missing");
        }
        try {
          let primary: unknown;
          try {
            session.push(owned, 0, 20);
          } catch (error) {
            primary = error;
          }
          expect(primary).toMatchObject({ code: "WASM_RENDER_FAILED", stage: "engine" });
          let repeated: unknown;
          try {
            session.finish();
          } catch (error) {
            repeated = error;
          }
          expect(repeated).toBe(primary);
        } finally {
          session.dispose();
        }
      } finally {
        owned.dispose();
      }
    });

    it("accepts escaped root keys while retaining exact integer tokens and duplicate rejection", () => {
      const session = engine.open_animated_raster(
        '{"\\u0066ormat":"gif","frame\\u0043ount":1,"iterations":1,"render\\u004fptions":{"animation":"static"}}',
      );
      close(session);
      for (const [input, field] of [
        [
          '{"\\u0066ormat":"gif","frame\\u0043ount":1.0,"iterations":1,"renderOptions":{"animation":"static"}}',
          "frameCount",
        ],
        [
          '{"format":"gif","\\u0066ormat":"gif","frameCount":1,"iterations":1,"renderOptions":{"animation":"static"}}',
          undefined,
        ],
      ] as const) {
        const failure = fatalFromCall(() => engine.open_animated_raster(input));
        expect(failure.context).toMatchObject({ operation: "open", reason: "outOfDomain" });
        expect(failure.context.field).toBe(field);
      }
    });

    it("rejects closed nested setting shapes before their duplicate and domain failures", () => {
      for (const [settings, reason] of [
        ['{"animation":"static","animation":"static"}', "outOfDomain"],
        ['{"animation":"static","debug":{"parts":[],"parts":[]}}', "outOfDomain"],
        [
          '{"animation":"static","generator":{"name":"pkg","name":"pkg","version":"1"}}',
          "outOfDomain",
        ],
        ['{"animation":"wrong","debug":{"parts":null}}', "nullField"],
        ['{"animation":"static","animation":"static","scale":null}', "nullField"],
        ['{"animation":"static","timeMs":0}', "unknownField"],
        ['{"animation":"static","debug":{"unknown":1}}', "unknownField"],
        ['{"animation":"static","generator":{"name":"pkg","version":1}}', "wrongType"],
        ['{"animation":"static","debug":{"parts":["other"]}}', "outOfDomain"],
      ] as const) {
        expect(
          fatalFromCall(() =>
            engine.open_animated_raster(
              `{"format":"gif","frameCount":1,"iterations":1,"renderOptions":${settings}}`,
            ),
          ),
        ).toMatchObject({ context: { operation: "open", field: "renderOptions", reason } });
      }
    });

    it("checks real UTF-16 before conversion and escaped surrogates at the open serde boundary", () => {
      const raw =
        '{"format":"gif","frameCount":1,"iterations":1,"renderOptions":{"animation":"static","resourceIdPrefix":"';
      for (const isolated of ["\ud800", "\udc00"]) {
        expect(
          fatalFromCall(() => engine.open_animated_raster(`${raw}${isolated}"}}`)),
        ).toMatchObject({ context: { operation: "open", reason: "invalidUnicode" } });
        expect(
          fatalFromCall(() =>
            engine.open_animated_raster(`${raw}${JSON.stringify(isolated).slice(1, -1)}"}}`),
          ),
        ).toMatchObject({ context: { reason: "malformedJson" } });
      }
      const session = open("gif", 1, { animation: "static", resourceIdPrefix: "日本語 😀" });
      try {
        collectSession(session, () => push(session));
      } finally {
        close(session);
      }
    });

    it("checks both primitive shapes before duration then time domains without coercion", () => {
      let coerced = 0;
      const trap = {
        valueOf() {
          coerced += 1;
          return 20;
        },
        toString() {
          coerced += 1;
          return "20";
        },
      };
      for (const [time, duration, field, reason] of [
        [0, undefined, "durationMs", "missingField"],
        [undefined, 20, "timeMs", "missingField"],
        [0, null, "durationMs", "nullField"],
        [null, Number.NaN, "timeMs", "nullField"],
        [0, trap, "durationMs", "wrongType"],
        [trap, 20, "timeMs", "wrongType"],
        [0, Object(20), "durationMs", "wrongType"],
        [Object(0), 20, "timeMs", "wrongType"],
        [0, "20", "durationMs", "wrongType"],
        [{}, 20, "timeMs", "wrongType"],
        [0, 20n, "durationMs", "wrongType"],
        [false, 20, "timeMs", "wrongType"],
        [-1, 0, "durationMs", "outOfDomain"],
        [0, 1.5, "durationMs", "outOfDomain"],
        [0, Number.NaN, "durationMs", "outOfDomain"],
        [0, Infinity, "durationMs", "outOfDomain"],
        [Number.NaN, 20, "timeMs", "outOfDomain"],
        [Infinity, 20, "timeMs", "outOfDomain"],
        [-Number.MIN_VALUE, 20, "timeMs", "outOfDomain"],
      ] as const) {
        const session = open();
        try {
          const primary = fatalFromCall(() =>
            engine.push_animated_raster_frame(session, scene, time, duration),
          );
          expect(primary).toMatchObject({ context: { field, reason, operation: "push" } });
          expect(
            fatalFromCall(() => engine.push_animated_raster_frame(session, scene, null, null)),
          ).toEqual(primary);
        } finally {
          close(session);
        }
      }
      expect(coerced).toBe(0);
    });

    it("preserves primitive fractional, subnormal and extreme finite times and duration endpoints", () => {
      for (const format of ["gif", "webp"] as const) {
        for (const time of [
          -0,
          0,
          Number.MIN_VALUE,
          0.1,
          0.5,
          1.0000000000000002,
          2 ** 53,
          Number.MAX_VALUE,
        ]) {
          for (const duration of [1, 60000]) {
            const session = open(format);
            try {
              expect(
                collectSession(session, () => push(session, time, duration)).length,
              ).toBeGreaterThan(0);
            } finally {
              close(session);
            }
          }
        }
      }
    });

    it("authenticates owners and resolved state after primitive shape and domain checks", () => {
      const other = new module.BoundSvgEngine();
      const foreignScene = other.preflight_raster_scene(sceneIr(FRAME_SVG), "{}");
      other.resolve_raster_scene(foreignScene);
      const unresolved = engine.preflight_raster_scene(sceneIr(FRAME_SVG), "{}");
      try {
        for (const [rasterScene, owner, expected] of [
          [
            scene,
            other,
            { code: "ANIMATED_RASTER_SESSION_INVALID_STATE", context: { reason: "wrongEngine" } },
          ],
          [foreignScene, engine, { code: "RASTER_SCENE_WRONG_ENGINE" }],
          [unresolved, engine, { code: "RASTER_SCENE_NOT_RESOLVED" }],
        ] as const) {
          const session = open();
          try {
            expect(fatalFromCall(() => push(session, 0.25, 20, rasterScene, owner))).toMatchObject(
              expected,
            );
          } finally {
            close(session);
          }
        }
        const session = open();
        try {
          expect(fatalFromCall(() => push(session, null, 0, foreignScene, other))).toMatchObject({
            context: { field: "timeMs", reason: "nullField" },
          });
        } finally {
          close(session);
        }
      } finally {
        unresolved.free();
        foreignScene.free();
        other.free();
      }
    });

    it("retains the native primary after a late scalar failure with earlier frames drained", () => {
      for (const format of ["webp", "gif"] as const) {
        const session = open(format, 20);
        try {
          for (let index = 0; index < 9; index += 1) {
            push(session, index, 20);
            while (session.read_chunk() !== null) {
              // Earlier native output is drained so pendingOutput cannot hide the tenth-frame fault.
            }
          }
          const primary = fatalFromCall(() => push(session, -1, 20));
          expect(primary).toMatchObject({
            code: "ANIMATED_RASTER_SESSION_INVALID_INPUT",
            context: { operation: "push", field: "timeMs", reason: "outOfDomain" },
          });
          expect(fatalFromCall(() => push(session, null, null))).toEqual(primary);
          expect(fatalFromCall(() => session.finish())).toEqual(primary);
        } finally {
          close(session);
        }
      }
    });

    it("rejects a forged class before native borrowing and still accepts valid work", () => {
      const session = open();
      try {
        expect(() => push(session, 0, 20, {} as RawScene)).toThrow();
        collectSession(session, () => push(session));
      } finally {
        close(session);
      }
    });

    it("rejects disposed managed scenes before borrow and releases the failed wrapper", () => {
      const disposed = managedOwner.preflightRasterScene(sceneIr(FRAME_SVG), "{}");
      disposed.dispose();
      const native = open();
      const wrapper = new WasmAnimatedRasterSessionHandle(
        native,
        "gif",
        (rasterScene, time, duration) =>
          managedOwner.pushAnimatedRasterFrame(native, rasterScene, time, duration),
      );
      try {
        expect(() => wrapper.push(disposed, 0, 20)).toThrowError(
          expect.objectContaining({ code: "WASM_RASTER_SCENE_DISPOSED" }),
        );
      } finally {
        wrapper.dispose();
      }
      const next = open();
      try {
        collectSession(next, () => push(next));
      } finally {
        close(next);
      }
    });

    it("keeps domain priority before pending output and frame count", () => {
      for (const drained of [false, true]) {
        for (const invalid of [false, true]) {
          const session = open();
          try {
            push(session);
            if (drained) {
              while (session.read_chunk() !== null) {}
            }
            expect(fatalFromCall(() => push(session, invalid ? -1 : 0))).toMatchObject({
              context: {
                reason: invalid ? "outOfDomain" : drained ? "excessFrames" : "pendingOutput",
              },
            });
          } finally {
            close(session);
          }
        }
      }
    });

    it("snapshots fixed settings once, including cross-realm debug arrays and caller mutations", () => {
      const parts = runInNewContext('["layout"]') as string[];
      const input = {
        format: "gif" as const,
        frameCount: 1,
        iterations: 1,
        options: {},
        renderOptions: {
          animation: "static" as const,
          scale: 2,
          debug: { parts },
          generator: { name: "pkg", version: "1" },
        },
      };
      const serialized = JSON.stringify(snapshotAnimationOpenInput(input));
      parts[0] = "other";
      input.renderOptions.scale = 3;
      input.renderOptions.generator.name = "wrong name";
      expect(JSON.parse(serialized)).toMatchObject({
        renderOptions: { scale: 2, debug: { parts: ["layout"] }, generator: { name: "pkg" } },
      });
      const first = engine.open_animated_raster(serialized);
      const control = open("gif", 1, {
        animation: "static",
        scale: 2,
        debug: { parts: ["layout"] },
        generator: { name: "pkg", version: "1" },
      });
      try {
        expect(collectSession(first, () => push(first))).toEqual(
          collectSession(control, () => push(control)),
        );
      } finally {
        close(first);
        close(control);
      }
      for (const debug of [{ parts: new Uint8Array([1]) }, { parts: new Set(["layout"]) }]) {
        expect(() =>
          snapshotAnimationOpenInput({
            ...input,
            renderOptions: { animation: "static", debug: debug as unknown as { parts: string[] } },
          }),
        ).toThrowError(expect.objectContaining({ code: "ANIMATED_RASTER_SESSION_INVALID_INPUT" }));
      }
    });

    it("authenticates primitive controls in presence/type/domain order without coercion", () => {
      const owned = managedOwner.preflightRasterScene(sceneIr(FRAME_SVG), "{}");
      owned.resolve();
      let reads = 0;
      const coercible = {
        [Symbol.toPrimitive]() {
          reads += 1;
          return 0;
        },
      };
      const wrongTypes = ["0", false, 0n, Symbol("time"), [], {}, Object(0), () => 0, coercible];
      const cases: Array<[unknown, unknown, string, string]> = [
        [0, undefined, "missingField", "durationMs"],
        [0, null, "nullField", "durationMs"],
        [undefined, 20, "missingField", "timeMs"],
        [null, 20, "nullField", "timeMs"],
        [null, Number.NaN, "nullField", "timeMs"],
        [null, 20.5, "nullField", "timeMs"],
        [undefined, 0, "missingField", "timeMs"],
        [-1, 0, "outOfDomain", "durationMs"],
      ];
      for (const value of wrongTypes) {
        cases.push([0, value, "wrongType", "durationMs"], [value, 20, "wrongType", "timeMs"]);
      }
      for (const value of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -0,
        -1,
        0.5,
        60001,
      ]) {
        cases.push([0, value, "outOfDomain", "durationMs"]);
      }
      for (const value of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -Number.MIN_VALUE,
      ]) {
        cases.push([value, 20, "outOfDomain", "timeMs"]);
      }
      try {
        for (const [timeMs, durationMs, reason, field] of cases) {
          const native = open();
          let calls = 0;
          const wrapper = new WasmAnimatedRasterSessionHandle(native, "gif", () => {
            calls += 1;
          });
          try {
            let primary: unknown;
            try {
              wrapper.push(owned, timeMs as number, durationMs as number);
            } catch (error) {
              primary = error;
            }
            expect(primary).toMatchObject({
              code: "ANIMATED_RASTER_SESSION_INVALID_INPUT",
              context: { operation: "push", reason, field },
            });
            let repeated: unknown;
            try {
              wrapper.push(owned, 0, 20);
            } catch (error) {
              repeated = error;
            }
            expect(repeated).toBe(primary);
            expect(calls).toBe(0);
          } finally {
            wrapper.dispose();
          }
        }
        expect(reads).toBe(0);
      } finally {
        owned.dispose();
      }
    });

    it("normalizes managed negative zero and forwards other primitive bits without JSON", () => {
      const owned = managedOwner.preflightRasterScene(sceneIr(FRAME_SVG), "{}");
      owned.resolve();
      try {
        for (const time of [-0, Number.MIN_VALUE, 0.1, 1.0000000000000002, Number.MAX_VALUE]) {
          const native = open();
          let captured: number | undefined;
          const wrapper = new WasmAnimatedRasterSessionHandle(
            native,
            "gif",
            (rasterScene, scalar, duration) => {
              captured = scalar;
              managedOwner.pushAnimatedRasterFrame(native, rasterScene, scalar, duration);
            },
          );
          try {
            wrapper.push(owned, time, 20);
            expect(Object.is(captured, time === 0 ? 0 : time)).toBe(true);
            while (wrapper.readChunk() !== null) {}
            wrapper.finish();
            while (wrapper.readChunk() !== null) {}
          } finally {
            wrapper.dispose();
          }
        }
      } finally {
        owned.dispose();
      }
    });

    it("keeps wrapper terminal state ahead of invalid primitive controls", () => {
      const owned = managedOwner.preflightRasterScene(sceneIr(FRAME_SVG), "{}");
      owned.resolve();
      const expectedFailures = {
        aborted: { code: "ANIMATED_RASTER_SESSION_INVALID_STATE", reason: "aborted" },
        freed: { code: "ANIMATED_RASTER_SESSION_INVALID_STATE", reason: "freed" },
        finishing: { code: "ANIMATED_RASTER_SESSION_INVALID_STATE", reason: "alreadyFinished" },
        finished: { code: "ANIMATED_RASTER_SESSION_INVALID_STATE", reason: "alreadyFinished" },
        failed: { code: "ANIMATED_RASTER_SESSION_INVALID_INPUT", reason: "outOfDomain" },
      };
      try {
        for (const state of ["aborted", "freed", "finishing", "finished", "failed"] as const) {
          const native = open();
          const wrapper = new WasmAnimatedRasterSessionHandle(
            native,
            "gif",
            (rasterScene, time, duration) =>
              managedOwner.pushAnimatedRasterFrame(native, rasterScene, time, duration),
          );
          let reads = 0;
          const payload = {
            durationMs: 20,
            get timeMs() {
              reads += 1;
              throw new Error("unexpected getter");
            },
          };
          try {
            if (state === "aborted") {
              wrapper.abort();
            } else if (state === "freed") {
              wrapper.dispose();
            } else if (state === "failed") {
              expect(() => wrapper.push(owned, 0, 0)).toThrow();
            } else {
              wrapper.push(owned, 0, 20);
              while (wrapper.readChunk() !== null) {}
              wrapper.finish();
              if (state === "finished") {
                while (wrapper.readChunk() !== null) {}
              }
            }
            expect(() => wrapper.push(owned, payload as unknown as number, 0)).toThrowError(
              expect.objectContaining({
                code: expectedFailures[state].code,
                context: expect.objectContaining({ reason: expectedFailures[state].reason }),
              }),
            );
            expect(reads).toBe(0);
          } finally {
            wrapper.dispose();
          }
        }
      } finally {
        owned.dispose();
      }
    });

    it("returns bounded copied chunks and immutable successful terminal state", () => {
      for (const format of ["gif", "webp"] as const) {
        const session = open(format, 2);
        try {
          push(session);
          const first = session.read_chunk() as Uint8Array;
          expect(first).toBeInstanceOf(Uint8Array);
          expect(first.length).toBeGreaterThan(0);
          expect(first.length).toBeLessThanOrEqual(65536);
          const saved = first.slice();
          while (session.read_chunk() !== null) {}
          push(session, 0.5, 21);
          while (session.read_chunk() !== null) {}
          expect(JSON.parse(session.finish())).toMatchObject({ format, frameCount: 2 });
          while (session.read_chunk() !== null) {}
          expect(first).toEqual(saved);
          expect(fatalFromCall(() => push(session, null, null))).toMatchObject({
            context: { reason: "alreadyFinished" },
          });
        } finally {
          close(session);
        }
      }
    });
    it.each([
      "gif",
      "webp",
    ] as const)("%s snapshots raster fonts at open across later registration", async (format) => {
      const isolated = new module.BoundSvgEngine();
      const emptyControl = new module.BoundSvgEngine();
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="32"><rect width="80" height="32" fill="white"/><text x="4" y="24" font-family="SnapshotFont" font-size="20" fill="black">Test</text></svg>';
      const isolatedScene = isolated.preflight_raster_scene(sceneIr(svg, 80, 32), "{}");
      const controlScene = emptyControl.preflight_raster_scene(sceneIr(svg, 80, 32), "{}");
      isolated.resolve_raster_scene(isolatedScene);
      emptyControl.resolve_raster_scene(controlScene);
      const openInput = JSON.stringify({
        format,
        frameCount: 1,
        iterations: 1,
        renderOptions: { animation: "static" },
      });
      const beforeRegistration = isolated.open_animated_raster(openInput);
      const control = emptyControl.open_animated_raster(openInput);
      const font = await readFile(
        new URL("../../../../fixtures/fonts/NotoSansJP-Regular.subset.ttf", import.meta.url),
      );
      isolated.register_font(new Uint8Array(font), "SnapshotFont", 400, "normal");
      const afterRegistration = isolated.open_animated_raster(openInput);
      const sessions = [beforeRegistration, control, afterRegistration];
      try {
        const outputs = sessions.map((session, index) =>
          collectSession(session, () => {
            const owner = index === 1 ? emptyControl : isolated;
            const rasterScene = index === 1 ? controlScene : isolatedScene;
            owner.push_animated_raster_frame(session, rasterScene, 0, 20);
          }),
        );
        expect(outputs[0]).toEqual(outputs[1]);
        expect(outputs[2]).not.toEqual(outputs[1]);
      } finally {
        for (const session of sessions) {
          session.abort();
          session.free();
        }
        isolatedScene.free();
        controlScene.free();
        isolated.free();
        emptyControl.free();
      }
    });
  });
}
