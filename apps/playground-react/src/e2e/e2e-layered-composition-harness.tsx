import { loadWasmModule } from "@boundsvg/browser";
import { createEngineAsync, type LayeredSvgResult } from "@boundsvg/core";
import { initWasm } from "@boundsvg/core/wasm";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getElement } from "../../../playground-shared/dom.js";
import { buildLayeredFixtures } from "../pages/layered/fixtures.js";

type FixtureReport = {
  id: string;
  differentPixels: number;
  width: number;
  height: number;
  layerCount: number;
};

const FONT_URL = "/fonts/NotoSansJP-Regular.subset.woff2";

async function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const image = new window.Image();
  image.decoding = "async";
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  if (typeof image.decode === "function") {
    try {
      await image.decode();
      return image;
    } catch {
      // Fall back to onload for browsers that reject decode on SVG data URLs.
    }
  }

  return await new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode SVG image."));
  });
}

async function drawSvgToCanvas(
  canvas: HTMLCanvasElement,
  svg: string,
  width: number,
  height: number,
  clear: boolean,
): Promise<void> {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is not available.");
  }
  if (clear) {
    context.clearRect(0, 0, width, height);
  }
  const image = await loadSvgImage(svg);
  context.drawImage(image, 0, 0, width, height);
}

async function compareSingleAndLayered(
  singleSvg: string,
  layered: LayeredSvgResult,
): Promise<FixtureReport> {
  const width = layered.width;
  const height = layered.height;
  const singleCanvas = document.createElement("canvas");
  singleCanvas.width = width;
  singleCanvas.height = height;
  const layeredCanvas = document.createElement("canvas");
  layeredCanvas.width = width;
  layeredCanvas.height = height;

  await drawSvgToCanvas(singleCanvas, singleSvg, width, height, true);

  const sortedLayers = [...layered.layers].sort(
    (left, right) => left.paintOrder - right.paintOrder,
  );
  for (const [index, layer] of sortedLayers.entries()) {
    await drawSvgToCanvas(layeredCanvas, layer.svg, width, height, index === 0);
  }

  const singleContext = singleCanvas.getContext("2d");
  const layeredContext = layeredCanvas.getContext("2d");
  if (!singleContext || !layeredContext) {
    throw new Error("2D canvas context is not available.");
  }

  const singlePixels = singleContext.getImageData(0, 0, width, height).data;
  const layeredPixels = layeredContext.getImageData(0, 0, width, height).data;
  let differentPixels = 0;
  for (let index = 0; index < singlePixels.length; index += 4) {
    if (
      singlePixels[index] !== layeredPixels[index] ||
      singlePixels[index + 1] !== layeredPixels[index + 1] ||
      singlePixels[index + 2] !== layeredPixels[index + 2] ||
      singlePixels[index + 3] !== layeredPixels[index + 3]
    ) {
      differentPixels += 1;
    }
  }

  return {
    id: "",
    differentPixels,
    width,
    height,
    layerCount: layered.layers.length,
  };
}

async function runFixtureComparison(): Promise<FixtureReport[]> {
  const wasmModule = await loadWasmModule();
  initWasm(wasmModule);

  const fontResponse = await fetch(FONT_URL);
  if (!fontResponse.ok) {
    throw new Error(`Failed to load font: ${fontResponse.status} ${fontResponse.statusText}`);
  }
  const fontData = new Uint8Array(await fontResponse.arrayBuffer());
  const engine = await createEngineAsync({
    fonts: [{ alias: "NotoSansJP-woff2", weight: 400, style: "normal", data: fontData }],
  });

  try {
    const reports: FixtureReport[] = [];
    for (const fixture of buildLayeredFixtures()) {
      const singleSvg = engine.renderToSvg(fixture.vnode);
      const layered = engine.renderToLayeredSvg(fixture.vnode);
      const comparison = await compareSingleAndLayered(singleSvg, layered);
      reports.push({
        ...comparison,
        id: fixture.id,
      });
    }
    return reports;
  } finally {
    engine.dispose();
  }
}

function LayeredCompositionHarness() {
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [reports, setReports] = useState<FixtureReport[]>([]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const nextReports = await runFixtureComparison();
        if (!active) {
          return;
        }
        setReports(nextReports);
        setStatus("ready");
      } catch (reason: unknown) {
        if (!active) {
          return;
        }
        setStatus("error");
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="error">{error}</div>
      <pre data-testid="fixture-results">{JSON.stringify(reports)}</pre>
    </div>
  );
}

createRoot(getElement("root")).render(
  <StrictMode>
    <LayeredCompositionHarness />
  </StrictMode>,
);
