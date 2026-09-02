import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine.js";
import { FatalError, type RecoverableError } from "../../src/errors.js";
import * as publicCoreEntry from "../../src/index.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { AnimationSpec } from "../../src/vnode/types.js";
import { EXPECTED_WASM_SCHEMA_VERSION } from "../../src/wasm/index.js";
import { createConformanceEngine } from "../conformance/conformance-engine.js";
import { CONFORMANCE_SCENES } from "../conformance/scenes/index.js";

/**
 * Literal-byte oracle for behavior-preserving refactors. The fixture was
 * captured from REFERENCE_COMMIT before production edits; normal test runs
 * compare Uint8Array contents rather than only comparing hashes.
 *
 * When deliberately selecting a new clean reference commit:
 *   REFACTOR_PARITY_UPDATE=1 pnpm --filter @boundsvg/core exec vitest run \
 *     tests/regression/refactor-output-parity.test.ts
 */
const REFERENCE_COMMIT = "442833c415f049b86ba5fd510e6d253a6a025295";
const REFERENCE_FORMAT_VERSION = 1;
const referenceRoot = path.resolve(__dirname, "fixtures/refactor-output-parity-base");
const referenceManifestPath = path.join(referenceRoot, "manifest.json");
const updateReference = process.env.REFACTOR_PARITY_UPDATE === "1";
const utf8Encoder = new TextEncoder();
// Preserve the literal baseline for pre-existing exports while the direct
// guard below pins each intentional addition independently.
const intentionalRuntimeExportAdditions = new Set(["snapshotCompiledIR"]);

type ReferenceManifest = {
  formatVersion: number;
  referenceCommit: string;
  artifacts: string[];
};

type CapturedCorpus = {
  artifacts: Map<string, Uint8Array>;
  fatalCodes: string[];
  recoverableWarningCodes: string[];
};

function utf8(value: string): Uint8Array {
  return utf8Encoder.encode(value);
}

function jsonBytes(value: unknown): Uint8Array {
  return utf8(JSON.stringify(value));
}

function architectureIntentionalArtifacts(): ReadonlyMap<string, Uint8Array> {
  return new Map([
    ["contracts/wasm-schema-version.txt", utf8("30")],
    [
      "fallback/missing-glyph.warnings.json",
      jsonBytes([
        {
          severity: "recoverable",
          code: "MISSING_GLYPH",
          message: 'Font "NotoSansJP" is missing glyphs for: U+1F389 (🎉)',
          fallback: "blank",
          stage: "text",
          nodeId: "parity-missing-glyph",
        },
      ]),
    ],
    [
      "fallback/png-resolution-adjusted.warnings.json",
      jsonBytes([
        {
          severity: "recoverable",
          code: "PNG_RESOLUTION_ADJUSTED",
          message:
            "PNG resolution exceeded 4K-equivalent cap; auto-adjusted scale from 1 to 0.768 (5000x2 -> 3840x2)",
          fallback: "auto-adjusted scale",
          stage: "emit",
          context: {
            requestedScale: 1,
            appliedScale: 0.768,
            baseWidth: 5000,
            baseHeight: 2,
            requestedWidth: 5000,
            requestedHeight: 2,
            outputWidth: 3840,
            outputHeight: 2,
            maxLongEdge: 3840,
            maxPixels: 8_294_400,
          },
        },
      ]),
    ],
    [
      "fatal/timeline-precision-loss.json",
      jsonBytes({
        severity: "fatal",
        code: "ANIMATED_SVG_TIMELINE_PRECISION_LOSS",
        message: "Animated SVG timeline keyframe precision check failed: separation",
        stage: "emit",
        context: { kind: "separation", leftTimeMs: 0, rightTimeMs: 0 },
      }),
    ],
  ]);
}

function safeArtifactPath(relativePath: string): string {
  if (
    relativePath.startsWith("/") ||
    relativePath.includes("..") ||
    !/^[a-z0-9][a-z0-9./_-]*$/.test(relativePath)
  ) {
    throw new TypeError(`Invalid parity artifact path: ${relativePath}`);
  }
  return path.join(referenceRoot, relativePath);
}

function listReferenceArtifacts(directory: string, relativeDirectory = ""): string[] {
  const entries = readdirSync(directory).sort();
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = relativeDirectory === "" ? entry : `${relativeDirectory}/${entry}`;
    const absolutePath = path.join(directory, entry);
    if (statSync(absolutePath).isDirectory()) {
      files.push(...listReferenceArtifacts(absolutePath, relativePath));
    } else if (relativePath !== "manifest.json") {
      files.push(relativePath);
    }
  }
  return files;
}

async function writeReference(corpus: CapturedCorpus): Promise<void> {
  if (path.basename(referenceRoot) !== "refactor-output-parity-base") {
    throw new TypeError(`Refusing to replace unexpected directory: ${referenceRoot}`);
  }
  rmSync(referenceRoot, { recursive: true, force: true });
  const artifactNames = [...corpus.artifacts.keys()].sort();
  for (const artifactName of artifactNames) {
    const artifactPath = safeArtifactPath(artifactName);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, corpus.artifacts.get(artifactName)!);
  }
  const manifest: ReferenceManifest = {
    formatVersion: REFERENCE_FORMAT_VERSION,
    referenceCommit: REFERENCE_COMMIT,
    artifacts: artifactNames,
  };
  writeFileSync(referenceManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function captureFatal(run: () => unknown): FatalError {
  try {
    run();
  } catch (error) {
    if (error instanceof FatalError) {
      return error;
    }
    throw error;
  }
  throw new TypeError("Expected a FatalError from the parity probe");
}

function p1TimelineScene() {
  const animation: AnimationSpec = {
    keyframes: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
    durationMs: 1,
    delayMs: -(2 ** 32),
    easing: { type: "steps", count: 1, position: "jump-end" },
    iterations: "infinite",
    fill: "both",
  };
  return createElement(
    "Canvas",
    { width: 96, height: 48, background: "#f8fafc" },
    createElement("Box", {
      id: "parity-timeline-box",
      width: 32,
      height: 20,
      background: "#2563eb",
      animate: animation,
    }),
  );
}

function precisionLossScene() {
  return createElement(
    "Canvas",
    { width: 96, height: 48 },
    createElement("Box", {
      id: "parity-precision-box",
      width: 32,
      height: 20,
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 3,
        delayMs: -2.099_999_999_999_999_6,
        easing: { type: "steps", count: 10, position: "jump-end" },
        iterations: 1,
        fill: "both",
      },
    }),
  );
}

function missingGlyphScene() {
  return createElement(
    "Canvas",
    { width: 240, height: 80 },
    createElement(
      "Text",
      {
        id: "parity-missing-glyph",
        font: "NotoSansJP",
        fontSizePx: 24,
        width: 220,
      },
      "絵文字🎉テスト",
    ),
  );
}

async function captureCorpus(engine: Engine): Promise<CapturedCorpus> {
  const artifacts = new Map<string, Uint8Array>();
  artifacts.set("contracts/wasm-schema-version.txt", utf8(String(EXPECTED_WASM_SCHEMA_VERSION)));
  if (typeof publicCoreEntry.snapshotCompiledIR !== "function") {
    throw new TypeError("Missing snapshotCompiledIR runtime export");
  }
  artifacts.set(
    "contracts/root-runtime-exports.json",
    jsonBytes(
      Object.keys(publicCoreEntry)
        .filter((exportName) => !intentionalRuntimeExportAdditions.has(exportName))
        .sort(),
    ),
  );

  const conformanceScene = CONFORMANCE_SCENES.find((scene) => scene.id === "native-layered-parts");
  if (conformanceScene === undefined) {
    throw new TypeError("Missing native-layered-parts conformance scene");
  }
  const conformanceInput = conformanceScene.build();
  const conformanceOutput = engine.renderToSvgAndIR(
    conformanceInput,
    conformanceScene.renderOptions,
  );
  artifacts.set("conformance/native-layered-parts.svg", utf8(conformanceOutput.svg));
  artifacts.set("conformance/native-layered-parts.ir.json", jsonBytes(conformanceOutput.ir));
  const layeredOutput = engine.renderToLayeredSvg(conformanceInput, conformanceScene.renderOptions);
  artifacts.set(
    "conformance/native-layered-parts.layered-manifest.json",
    jsonBytes(layeredOutput.manifest),
  );
  for (const [layerIndex, layer] of layeredOutput.layers.entries()) {
    const safeLayerId = layer.id.replaceAll(/[^a-z0-9_-]/g, "-");
    artifacts.set(
      `conformance/native-layered-parts.layer-${layerIndex}-${safeLayerId}.svg`,
      utf8(layer.svg),
    );
  }

  const timelineInput = p1TimelineScene();
  const timelineOptions = {
    playback: { mode: "timeline", durationMs: 1, iterations: "infinite" },
    timeMs: 0.5,
    resourceIdPrefix: "parity-timeline-",
    nodeIdMetadata: "omit",
  } as const;
  const timelineOutput = engine.renderToAnimatedSvgAndIR(timelineInput, timelineOptions);
  artifacts.set("p1/timeline.svg", utf8(timelineOutput.svg));
  artifacts.set("p1/timeline.ir.json", jsonBytes(timelineOutput.ir));
  artifacts.set(
    "p1/frame.svg",
    utf8(
      engine.renderToSvg(timelineInput, {
        timeMs: timelineOptions.timeMs,
        resourceIdPrefix: timelineOptions.resourceIdPrefix,
        nodeIdMetadata: timelineOptions.nodeIdMetadata,
      }),
    ),
  );
  artifacts.set("p1/frame.png", engine.renderToPng(timelineInput, { timeMs: 0.5 }));
  artifacts.set("p1/frame.webp", engine.renderToWebp(timelineInput, { timeMs: 0.5 }));
  const rasterSchedule = { durationMs: 200, fps: 10, iterations: 1 } as const;
  artifacts.set("p1/animation.webp", engine.renderToAnimatedWebp(timelineInput, rasterSchedule));
  artifacts.set("p1/animation.gif", engine.renderToAnimatedGif(timelineInput, rasterSchedule));

  const missingGlyphWarnings: RecoverableError[] = [];
  const fallbackSvg = engine.renderToSvg(missingGlyphScene(), {
    onWarning: (warning) => missingGlyphWarnings.push(warning),
  });
  artifacts.set("fallback/missing-glyph.svg", utf8(fallbackSvg));
  artifacts.set(
    "fallback/missing-glyph.warnings.json",
    jsonBytes(missingGlyphWarnings.map((warning) => warning.toJSON())),
  );

  const resolutionWarnings: RecoverableError[] = [];
  const adjustedPng = engine.renderToPng(createElement("Canvas", { width: 5000, height: 2 }), {
    onWarning: (warning) => resolutionWarnings.push(warning),
  });
  artifacts.set("fallback/png-resolution-adjusted.png", adjustedPng);
  artifacts.set(
    "fallback/png-resolution-adjusted.warnings.json",
    jsonBytes(resolutionWarnings.map((warning) => warning.toJSON())),
  );

  const precisionFatal = captureFatal(() =>
    engine.renderToAnimatedSvg(precisionLossScene(), {
      playback: { mode: "timeline", durationMs: 1_000, iterations: "infinite" },
    }),
  );
  artifacts.set("fatal/timeline-precision-loss.json", jsonBytes(precisionFatal.toJSON()));

  return {
    artifacts,
    fatalCodes: [precisionFatal.code],
    recoverableWarningCodes: [...missingGlyphWarnings, ...resolutionWarnings].map(
      (warning) => warning.code,
    ),
  };
}

describe("refactor output parity", () => {
  let engine: Engine;

  beforeAll(async () => {
    engine = await createConformanceEngine();
  });

  afterAll(() => {
    engine.dispose();
  });

  it("matches the pre-refactor bytes and exercises non-vacuous failure paths", async () => {
    const corpus = await captureCorpus(engine);

    expect(corpus.fatalCodes).toEqual(["ANIMATED_SVG_TIMELINE_PRECISION_LOSS"]);
    expect(corpus.recoverableWarningCodes).toEqual(["MISSING_GLYPH", "PNG_RESOLUTION_ADJUSTED"]);

    if (updateReference) {
      await writeReference(corpus);
      return;
    }

    const manifest = JSON.parse(readFileSync(referenceManifestPath, "utf8")) as ReferenceManifest;
    expect(manifest).toMatchObject({
      formatVersion: REFERENCE_FORMAT_VERSION,
      referenceCommit: REFERENCE_COMMIT,
    });
    expect(manifest.artifacts).toEqual([...corpus.artifacts.keys()].sort());
    expect(listReferenceArtifacts(referenceRoot)).toEqual(manifest.artifacts);

    const intentionalArtifacts = architectureIntentionalArtifacts();
    let unchangedCount = 0;
    let intentionalCount = 0;
    for (const artifactName of manifest.artifacts) {
      const actualBytes = corpus.artifacts.get(artifactName);
      if (actualBytes === undefined) {
        throw new TypeError(`Missing captured parity artifact: ${artifactName}`);
      }
      const expectedBytes = new Uint8Array(readFileSync(safeArtifactPath(artifactName)));
      const intentionalBytes = intentionalArtifacts.get(artifactName);
      if (intentionalBytes !== undefined) {
        expect(actualBytes, `${artifactName}: intentional architecture byte content`).toEqual(
          intentionalBytes,
        );
        expect(actualBytes, `${artifactName}: differs from the preserved base fixture`).not.toEqual(
          expectedBytes,
        );
        intentionalCount += 1;
        continue;
      }
      expect(actualBytes.byteLength, `${artifactName}: byte length`).toBe(expectedBytes.byteLength);
      expect(actualBytes, `${artifactName}: byte content`).toEqual(expectedBytes);
      unchangedCount += 1;
    }
    expect(unchangedCount).toBe(19);
    expect(intentionalCount).toBe(4);
  });
});
