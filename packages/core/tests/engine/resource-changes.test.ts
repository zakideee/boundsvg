import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../../src/engine.js";
import { FatalError } from "../../src/errors.js";
import type { GeometryDoc, SymbolDefinition } from "../../src/shape/types.js";

const geometry: GeometryDoc = {
  viewBox: { width: 10, height: 10 },
  root: { kind: "path", nodeId: "rectangle", d: "M0 0H10V10H0Z" },
};
const symbol: SymbolDefinition = { geometry };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Engine resource changes", () => {
  it("observes each registration and replacement, and only existing deletions", () => {
    const engine = new Engine({ computeLayoutFn: () => "" });
    const versions: number[] = [];
    const unsubscribe = engine.subscribeResourceChanges(() => {
      versions.push(engine.resourceVersion);
    });
    expect(engine.resourceVersion).toBe(0);
    engine.registerGeometry("rectangle", geometry);
    engine.registerGeometry("rectangle", geometry);
    engine.registerSymbol("rectangle", symbol);
    engine.registerSymbol("rectangle", symbol);
    engine.unregisterGeometry("rectangle");
    engine.unregisterGeometry("rectangle");
    engine.unregisterSymbol("rectangle");
    engine.unregisterSymbol("rectangle");
    expect(versions).toEqual([1, 2, 3, 4, 5, 6]);
    unsubscribe();
    unsubscribe();
    engine.registerGeometry("rectangle", geometry);
    expect(engine.resourceVersion).toBe(7);
    expect(versions).toHaveLength(6);
  });

  it("invalidates once after a partially successful font batch and preserves its error", () => {
    const registered: string[] = [];
    const failure = new FatalError("FONT_REGISTRATION_FAILED", "Registration failed", {
      stage: "engine",
    });
    const engine = new Engine({
      computeLayoutFn: () => "",
      registerFontFn: (font) => {
        registered.push(font.alias);
        if (font.alias === "second") {
          throw failure;
        }
      },
    });
    const notify = vi.fn();
    engine.subscribeResourceChanges(notify);
    expect(() =>
      engine.registerFonts([
        { alias: "first", data: new Uint8Array([1]) },
        { alias: "second", data: new Uint8Array([2]) },
        { alias: "third", data: new Uint8Array([3]) },
      ]),
    ).toThrow(failure);
    expect(registered).toEqual(["first", "second"]);
    expect(engine.resourceVersion).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    engine.registerFonts([]);
    expect(engine.resourceVersion).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("invalidates a first backend attempt that throws after changing resources", () => {
    const engine = new Engine({
      computeLayoutFn: () => "",
      registerFontFn: () => {
        throw new FatalError("FONT_REGISTRATION_FAILED", "Registration failed");
      },
    });
    const notify = vi.fn();
    engine.subscribeResourceChanges(notify);
    expect(() => engine.registerFonts([{ alias: "font", data: new Uint8Array() }])).toThrow();
    expect(engine.resourceVersion).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does not invalidate failures before the font backend is attempted", () => {
    const engine = new Engine({ computeLayoutFn: () => "" });
    const notify = vi.fn();
    engine.subscribeResourceChanges(notify);
    expect(() => engine.registerFonts([{ alias: "font", data: new Uint8Array() }])).toThrow();
    expect(engine.resourceVersion).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports observer exceptions asynchronously after notifying other observers", () => {
    const deferredReports: VoidFunction[] = [];
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => {
      deferredReports.push(callback);
    });
    const failure = new Error("Observer failed");
    const engine = new Engine({ computeLayoutFn: () => "" });
    engine.subscribeResourceChanges(() => {
      throw failure;
    });
    const notify = vi.fn();
    engine.subscribeResourceChanges(notify);
    expect(() => engine.registerGeometry("rectangle", geometry)).not.toThrow();
    expect(engine.resourceVersion).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(deferredReports).toHaveLength(1);
    expect(deferredReports[0]).toThrow(failure);
  });

  it("refuses mutation before exhausting the version space but still permits disposal", () => {
    const registerFontFn = vi.fn();
    const engine = new Engine({ computeLayoutFn: () => "", registerFontFn });
    engine.registerGeometry("rectangle", geometry);
    engine.registerSymbol("rectangle", symbol);
    Reflect.set(engine, "resourceRevision", Number.MAX_SAFE_INTEGER);
    const notify = vi.fn();
    engine.subscribeResourceChanges(notify);
    const mutations = [
      () => engine.registerGeometry("rectangle", geometry),
      () => engine.registerSymbol("rectangle", symbol),
      () => engine.unregisterGeometry("rectangle"),
      () => engine.unregisterSymbol("rectangle"),
      () => engine.registerFonts([{ alias: "font", data: new Uint8Array() }]),
    ];
    for (const mutate of mutations) {
      expect(mutate).toThrow(
        expect.objectContaining({
          code: "RESOURCE_VERSION_EXHAUSTED",
          stage: "engine",
          context: {},
        }),
      );
    }
    engine.unregisterGeometry("absent");
    engine.unregisterSymbol("absent");
    engine.registerFonts([]);
    expect(engine.resourceVersion).toBe(Number.MAX_SAFE_INTEGER);
    expect(registerFontFn).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    engine.dispose();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies terminal disposal once and releases the backend once", () => {
    const dispose = vi.fn();
    const engine = new Engine({ computeLayoutFn: () => "", wasmHandle: { dispose } });
    const terminalErrors: unknown[] = [];
    const unsubscribe = engine.subscribeResourceChanges(() => {
      try {
        void engine.resourceVersion;
      } catch (error) {
        terminalErrors.push(error);
      }
    });
    engine.dispose();
    engine.dispose();
    unsubscribe();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(terminalErrors).toHaveLength(1);
    expect(terminalErrors[0]).toMatchObject({ code: "ENGINE_DISPOSED", stage: "engine" });
    expect(() => engine.subscribeResourceChanges(() => undefined)).toThrow(
      "Engine has been disposed",
    );
    expect(() => engine.registerGeometry("rectangle", geometry)).toThrow(
      "Engine has been disposed",
    );
  });
});
