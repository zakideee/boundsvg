import { describe, expect, it } from "vitest";
import { createFontRegistry } from "../../src/font/registry.js";
import type { FontFaceInput } from "../../src/font/types.js";

function mockFont(alias: string, weight?: number, style?: "normal" | "italic"): FontFaceInput {
  return {
    alias,
    data: new Uint8Array([0x00, 0x01, 0x00, 0x00]), // minimal header
    weight,
    style,
  };
}

describe("FontRegistry", () => {
  it("registers and resolves a font", () => {
    const reg = createFontRegistry();
    reg.register([mockFont("NotoSansJP")]);

    const entry = reg.resolve("NotoSansJP");
    expect(entry).not.toBeNull();
    expect(entry!.alias).toBe("NotoSansJP");
    expect(entry!.weight).toBe(400);
    expect(entry!.style).toBe("normal");
  });

  it("defaults weight=400 and style=normal", () => {
    const reg = createFontRegistry();
    reg.register([mockFont("Arial")]);

    expect(reg.resolve("Arial", 400, "normal")).not.toBeNull();
    // Documented contract: closest weight wins, so an unregistered weight
    // resolves to the nearest registered face.
    expect(reg.resolve("Arial", 700)?.weight).toBe(400);
  });

  it("registers fonts with different weights", () => {
    const reg = createFontRegistry();
    reg.register([mockFont("Arial", 400), mockFont("Arial", 700)]);

    expect(reg.resolve("Arial", 400)).not.toBeNull();
    expect(reg.resolve("Arial", 700)).not.toBeNull();
    expect(reg.size).toBe(2);
  });

  it("throws on duplicate registration by default", () => {
    const reg = createFontRegistry();
    reg.register([mockFont("Arial")]);

    expect(() => reg.register([mockFont("Arial")])).toThrow("Font already registered");
  });

  it("skips duplicate with onDuplicate=skip", () => {
    const reg = createFontRegistry();
    const original = mockFont("Arial");
    reg.register([original]);

    const duplicate = mockFont("Arial");
    reg.register([duplicate], { onDuplicate: "skip" });

    expect(reg.size).toBe(1);
  });

  it("replaces duplicate with onDuplicate=replace", () => {
    const reg = createFontRegistry();
    const original = mockFont("Arial");
    reg.register([original]);

    const replacement = {
      ...mockFont("Arial"),
      data: new Uint8Array([0xff]),
    };
    reg.register([replacement], { onDuplicate: "replace" });

    const entry = reg.resolve("Arial");
    expect(entry!.data).toEqual(new Uint8Array([0xff]));
  });

  it("returns null for unregistered font", () => {
    const reg = createFontRegistry();
    expect(reg.resolve("NonExistent")).toBeNull();
  });

  it("resolves fallback chain", () => {
    const reg = createFontRegistry();
    reg.register([mockFont("Primary"), mockFont("Fallback1"), mockFont("Fallback2")]);

    const chain = reg.resolveFallbackChain(["Primary", "MissingFont", "Fallback1"]);
    expect(chain).toHaveLength(2);
    expect(chain[0]!.alias).toBe("Primary");
    expect(chain[1]!.alias).toBe("Fallback1");
  });

  it("resolves fallback chain without method binding", () => {
    const reg = createFontRegistry();
    reg.register([mockFont("Primary"), mockFont("Fallback1")]);

    const { resolveFallbackChain } = reg;
    const chain = resolveFallbackChain(["Primary", "Fallback1"]);

    expect(chain).toHaveLength(2);
    expect(chain[0]!.alias).toBe("Primary");
    expect(chain[1]!.alias).toBe("Fallback1");
  });

  it("disposes all entries", () => {
    const reg = createFontRegistry();
    reg.register([mockFont("Arial"), mockFont("Helvetica")]);
    expect(reg.size).toBe(2);

    reg.dispose();
    expect(reg.size).toBe(0);
    expect(reg.resolve("Arial")).toBeNull();
  });
});

describe("closest-match resolution", () => {
  it("resolves the closest weight by simple distance", () => {
    const registry = createFontRegistry();
    registry.register([
      { alias: "Noto", weight: 400, style: "normal", data: new Uint8Array([1]) },
      { alias: "Noto", weight: 700, style: "normal", data: new Uint8Array([2]) },
    ]);

    expect(registry.resolve("Noto", 500, "normal")?.weight).toBe(400);
    expect(registry.resolve("Noto", 600, "normal")?.weight).toBe(700);
    expect(registry.resolve("Noto", 900, "normal")?.weight).toBe(700);
    // Equidistant tie goes to the lower weight.
    expect(registry.resolve("Noto", 550, "normal")?.weight).toBe(400);
  });

  it("falls back across style when the requested style has no face", () => {
    const registry = createFontRegistry();
    registry.register([{ alias: "Noto", weight: 400, style: "normal", data: new Uint8Array([1]) }]);

    expect(registry.resolve("Noto", 400, "italic")?.weight).toBe(400);
    expect(registry.resolve("Missing", 400, "normal")).toBeNull();
  });

  it("prefers a matching style over a closer weight", () => {
    const registry = createFontRegistry();
    registry.register([
      { alias: "Noto", weight: 400, style: "italic", data: new Uint8Array([1]) },
      { alias: "Noto", weight: 900, style: "normal", data: new Uint8Array([2]) },
    ]);

    // normal requested at 400: the style match (900 normal) wins over the
    // weight match (400 italic).
    expect(registry.resolve("Noto", 400, "normal")?.weight).toBe(900);
  });
});
