import assert from "node:assert/strict";
import test from "node:test";
import type { AnimatedRasterSink, Engine, EngineInput } from "@boundsvg/core";
import { downloadAnimatedArtifact } from "../src/pages/animation/render-artifacts.js";

/** Defer the mock Engine result while the caller owns one collector. */
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

for (const format of ["gif", "animated-webp"] as const) {
  test(`${format} awaits sink completion, closes download URLs and suppresses a cancelled stale result`, async (context) => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    let clicks = 0;
    let removals = 0;
    const link = {
      href: "",
      download: "",
      click: () => {
        clicks += 1;
      },
      remove: () => {
        removals += 1;
      },
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: () => link, body: { appendChild: () => undefined } },
    });
    context.after(() => {
      if (originalDocument) {
        Object.defineProperty(globalThis, "document", originalDocument);
      } else {
        Reflect.deleteProperty(globalThis, "document");
      }
    });
    const created: Blob[] = [];
    const revoked: string[] = [];
    context.mock.method(URL, "createObjectURL", (blob: Blob) => {
      created.push(blob);
      return "blob:owned-download";
    });
    context.mock.method(URL, "revokeObjectURL", (url: string) => {
      revoked.push(url);
    });
    const source = { type: "Canvas", props: {}, children: [] } as unknown as EngineInput;
    for (const outcome of ["success", "failure", "stale"] as const) {
      const pending = deferred();
      const controller = new AbortController();
      const injected = new Error("fixed animated render failure");
      let ownedSink: AnimatedRasterSink | undefined;
      const render = async (
        _input: EngineInput,
        _options: unknown,
        sink: AnimatedRasterSink,
      ): Promise<{
        format: "gif" | "webp";
        frameCount: number;
        bytesWritten: number;
      }> => {
        ownedSink = sink;
        await pending.promise;
        await sink.write(Uint8Array.of(71, 73, 70, 1));
        await sink.finish();
        return { format: format === "gif" ? "gif" : "webp", frameCount: 1, bytesWritten: 4 };
      };
      const engine = {
        renderToAnimatedGif: render,
        renderToAnimatedWebp: render,
      } as unknown as Pick<Engine, "renderToAnimatedGif" | "renderToAnimatedWebp">;
      const before = created.length;
      const result = downloadAnimatedArtifact({
        engine,
        input: source,
        renderOptions: {},
        durationMs: 50,
        format,
        fileName: "animation",
        signal: controller.signal,
      });
      assert.ok(ownedSink);
      assert.equal(created.length, before);
      if (outcome === "failure") {
        pending.reject(injected);
      } else {
        if (outcome === "stale") {
          controller.abort();
        }
        pending.resolve();
      }
      const settled = await result;
      if (outcome === "success") {
        assert.equal(settled.error, null);
        assert.equal(created.length, before + 1);
        assert.equal(clicks, 1);
        assert.equal(removals, 1);
        assert.deepEqual(revoked, ["blob:owned-download"]);
      } else {
        assert.ok(settled.error);
        if (outcome === "failure") {
          assert.equal(settled.error, injected);
        }
        assert.equal(created.length, before);
        assert.equal(clicks, 1);
        assert.throws(() => ownedSink?.write(Uint8Array.of(9)), {
          code: "ANIMATED_RASTER_SESSION_INVALID_STATE",
        });
      }
    }
  });
}
