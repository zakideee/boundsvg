import { describe, expect, it } from "vitest";
import type { VariationSetting } from "../../src/wasm/index.js";
import { parseFontVariationSettings } from "../../src/wasm/index.js";

describe("parseFontVariationSettings", () => {
  it("parses single axis with single quotes", () => {
    const result = parseFontVariationSettings("'wght' 700");
    expect(result).toEqual([{ tag: "wght", value: 700 }]);
  });

  it("parses single axis with double quotes", () => {
    const result = parseFontVariationSettings('"wght" 700');
    expect(result).toEqual([{ tag: "wght", value: 700 }]);
  });

  it("parses multiple axes", () => {
    const result = parseFontVariationSettings("'wght' 700, 'wdth' 125");
    expect(result).toEqual([
      { tag: "wght", value: 700 },
      { tag: "wdth", value: 125 },
    ]);
  });

  it("parses fractional values", () => {
    const result = parseFontVariationSettings("'wght' 450.5");
    expect(result).toEqual([{ tag: "wght", value: 450.5 }]);
  });

  it("parses negative values", () => {
    const result = parseFontVariationSettings("'slnt' -12");
    expect(result).toEqual([{ tag: "slnt", value: -12 }]);
  });

  it("handles extra whitespace", () => {
    const result = parseFontVariationSettings("  'wght'  700 ,  'wdth'  125  ");
    expect(result).toEqual([
      { tag: "wght", value: 700 },
      { tag: "wdth", value: 125 },
    ]);
  });

  it("returns empty array for undefined input", () => {
    expect(parseFontVariationSettings(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseFontVariationSettings("")).toEqual([]);
  });

  it("skips invalid entries", () => {
    const result = parseFontVariationSettings("'wght' 700, invalid, 'wdth' 125");
    expect(result).toEqual([
      { tag: "wght", value: 700 },
      { tag: "wdth", value: 125 },
    ]);
  });

  it("skips entries with non-4-char tags", () => {
    const result = parseFontVariationSettings("'wg' 700, 'wght' 400");
    expect(result).toEqual([{ tag: "wght", value: 400 }]);
  });

  it("parses common variable font axes", () => {
    const result = parseFontVariationSettings(
      "'wght' 700, 'wdth' 100, 'ital' 1, 'slnt' -12, 'opsz' 48",
    );
    expect(result).toEqual([
      { tag: "wght", value: 700 },
      { tag: "wdth", value: 100 },
      { tag: "ital", value: 1 },
      { tag: "slnt", value: -12 },
      { tag: "opsz", value: 48 },
    ]);
  });
});

describe("VariationSetting type", () => {
  it("correctly types a variation setting", () => {
    const setting: VariationSetting = { tag: "wght", value: 700 };
    expect(setting.tag).toBe("wght");
    expect(setting.value).toBe(700);
  });
});
