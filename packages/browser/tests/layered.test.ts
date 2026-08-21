import type { LayerEntry, LayeredPngResult, LayeredSvgResult, LayerPngEntry } from "@boundsvg/core";
import { describe, expect, it } from "vitest";
import {
  composeLayeredSvgInline,
  layeredPngToBlobs,
  layeredPngToDataUrls,
  layeredSvgToDataUrls,
} from "../src/layered.js";

function svgLayer(overrides: Partial<LayerEntry>): LayerEntry {
  return {
    id: "default",
    svg: "<svg/>",
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    nodeIds: [],
    mode: "independent",
    paintOrder: 0,
    warnings: [],
    ...overrides,
  };
}

function pngLayer(overrides: Partial<LayerPngEntry>): LayerPngEntry {
  return {
    id: "default",
    png: new Uint8Array([137, 80, 78, 71]),
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    nodeIds: [],
    mode: "independent",
    paintOrder: 0,
    warnings: [],
    ...overrides,
  };
}

function buildSvgResult(layers: LayerEntry[]): LayeredSvgResult {
  return {
    width: 100,
    height: 50,
    layers,
    manifest: {
      width: 100,
      height: 50,
      layers: layers.map(({ svg: _svg, ...entry }) => entry),
    },
  };
}

function buildPngResult(layers: LayerPngEntry[]): LayeredPngResult {
  return {
    width: 100,
    height: 50,
    pixelWidth: 100,
    pixelHeight: 50,
    layers,
    manifest: {
      width: 100,
      height: 50,
      pixelWidth: 100,
      pixelHeight: 50,
      layers: layers.map(({ png: _png, ...entry }) => entry),
    },
  };
}

describe("layeredPngToDataUrls()", () => {
  it("maps each PNG layer to a data URL in array order", () => {
    const result = buildPngResult([
      pngLayer({ id: "a", png: new Uint8Array([137, 80, 78, 71]) }),
      pngLayer({ id: "b", png: new Uint8Array([1, 2, 3]) }),
    ]);

    expect(layeredPngToDataUrls(result)).toEqual([
      "data:image/png;base64,iVBORw==",
      "data:image/png;base64,AQID",
    ]);
  });
});

describe("layeredPngToBlobs()", () => {
  it("wraps each PNG layer in an image/png Blob", async () => {
    const result = buildPngResult([
      pngLayer({ id: "a", png: new Uint8Array([1, 2]) }),
      pngLayer({ id: "b", png: new Uint8Array([3, 4]) }),
    ]);

    const blobs = layeredPngToBlobs(result);
    expect(blobs).toHaveLength(2);
    expect(blobs[0]?.type).toBe("image/png");
    expect(new Uint8Array(await (blobs[0] as Blob).arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    expect(new Uint8Array(await (blobs[1] as Blob).arrayBuffer())).toEqual(new Uint8Array([3, 4]));
  });
});

describe("layeredSvgToDataUrls()", () => {
  it("encodes ASCII SVG as base64 data URLs", () => {
    const result = buildSvgResult([svgLayer({ id: "a", svg: "<svg></svg>" })]);
    const [dataUrl] = layeredSvgToDataUrls(result);

    expect(dataUrl).toBe("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
  });

  it("handles UTF-8 characters via TextEncoder (round-trips cleanly)", () => {
    const svg = "<svg>日本語</svg>";
    const result = buildSvgResult([svgLayer({ svg })]);
    const [dataUrl] = layeredSvgToDataUrls(result);

    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const base64 = dataUrl?.split(",", 2)[1] ?? "";
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
    );
    expect(decoded).toBe(svg);
  });
});

describe("composeLayeredSvgInline()", () => {
  it("emits a stacked fragment sorted by paintOrder by default", () => {
    const result = buildSvgResult([
      svgLayer({ id: "front", svg: "<!--FRONT-->", paintOrder: 2 }),
      svgLayer({ id: "back", svg: "<!--BACK-->", paintOrder: 0 }),
      svgLayer({ id: "mid", svg: "<!--MID-->", paintOrder: 1 }),
    ]);

    const html = composeLayeredSvgInline(result);
    const backIndex = html.indexOf("<!--BACK-->");
    const midIndex = html.indexOf("<!--MID-->");
    const frontIndex = html.indexOf("<!--FRONT-->");
    expect(backIndex).toBeGreaterThanOrEqual(0);
    expect(backIndex).toBeLessThan(midIndex);
    expect(midIndex).toBeLessThan(frontIndex);
    expect(html).toContain(`width:${result.width}px`);
    expect(html).toContain(`height:${result.height}px`);
  });

  it("preserves array order when `order: 'array'` is passed", () => {
    const result = buildSvgResult([
      svgLayer({ id: "z", svg: "<!--ZED-->", paintOrder: 5 }),
      svgLayer({ id: "a", svg: "<!--AYE-->", paintOrder: 0 }),
    ]);

    const html = composeLayeredSvgInline(result, { order: "array" });
    expect(html.indexOf("<!--ZED-->")).toBeLessThan(html.indexOf("<!--AYE-->"));
  });
});
