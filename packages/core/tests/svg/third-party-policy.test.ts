import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fluentFixtureDir = resolve(__dirname, "../../../../fixtures/third-party-svg/fluentui-emoji");
const expectedSvgFiles = [
  "chart_decreasing_color.svg",
  "desktop_computer_color.svg",
  "laptop_color.svg",
  "sun_with_face_color.svg",
  "sunset_color.svg",
];

function parseIntrinsicSize(svg: string): { width: number; height: number } {
  const svgTag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const widthAttr = svgTag.match(/\bwidth="([^"]+)"/i)?.[1];
  const heightAttr = svgTag.match(/\bheight="([^"]+)"/i)?.[1];

  const parseNum = (value?: string): number | undefined => {
    if (!value) {
      return undefined;
    }
    const parsed = Number.parseFloat(value.replace(/px$/i, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const width = parseNum(widthAttr);
  const height = parseNum(heightAttr);
  if (width !== undefined && height !== undefined) {
    return { width, height };
  }

  const viewBoxAttr = svgTag.match(/\bviewBox="([^"]+)"/i)?.[1];
  if (!viewBoxAttr) {
    throw new Error("SVG width/height and viewBox are both missing");
  }
  const parts = viewBoxAttr
    .trim()
    .split(/[,\s]+/)
    .map((p) => Number.parseFloat(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) {
    throw new Error(`Invalid viewBox: ${viewBoxAttr}`);
  }
  return { width: parts[2]!, height: parts[3]! };
}

function countShapeElements(svg: string): number {
  const matches = svg.match(
    /<(path|circle|rect|ellipse|polygon|polyline|line|text|g|defs|linearGradient|radialGradient|clipPath|mask)\b/g,
  );
  return matches?.length ?? 0;
}

type AssetRecord = {
  fileName: string;
  sourceRepo: string;
  sourceCommit: string;
  sourcePath: string;
  license: string;
  sizeBytes: number;
  elementCount?: number;
  sha256: string;
};

type AssetManifest = {
  profile: string;
  sourceRepo: string;
  sourceCommit: string;
  license: string;
  assets: AssetRecord[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, manifestPath: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${manifestPath}: ${key} must be a non-empty string`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string, manifestPath: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${manifestPath}: ${key} must be a finite non-negative number`);
  }
  return value;
}

function loadManifest(fixtureDir: string): AssetManifest {
  const manifestPath = resolve(fixtureDir, "manifest.json");
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.assets)) {
    throw new Error(`${manifestPath}: invalid manifest object`);
  }
  const assets = parsed.assets.map((asset, index): AssetRecord => {
    const assetPath = `${manifestPath}#assets[${index}]`;
    if (!isRecord(asset)) {
      throw new Error(`${assetPath}: asset must be an object`);
    }
    const elementCount = asset.elementCount;
    if (
      elementCount !== undefined &&
      (typeof elementCount !== "number" || !Number.isInteger(elementCount) || elementCount < 0)
    ) {
      throw new Error(`${assetPath}: elementCount must be a non-negative integer`);
    }
    return {
      fileName: requireString(asset, "fileName", assetPath),
      sourceRepo: requireString(asset, "sourceRepo", assetPath),
      sourceCommit: requireString(asset, "sourceCommit", assetPath),
      sourcePath: requireString(asset, "sourcePath", assetPath),
      license: requireString(asset, "license", assetPath),
      sizeBytes: requireNumber(asset, "sizeBytes", assetPath),
      ...(elementCount === undefined ? {} : { elementCount }),
      sha256: requireString(asset, "sha256", assetPath),
    };
  });
  return {
    profile: requireString(parsed, "profile", manifestPath),
    sourceRepo: requireString(parsed, "sourceRepo", manifestPath),
    sourceCommit: requireString(parsed, "sourceCommit", manifestPath),
    license: requireString(parsed, "license", manifestPath),
    assets,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertManifestIntegrity(options: {
  fixtureDir: string;
  expectedRepo: string;
  expectedLicense: string;
  licenseFile: string;
}): void {
  const manifest = loadManifest(options.fixtureDir);
  expect(manifest.profile).toBe("MIT/CC0");
  expect(manifest.sourceRepo).toBe(options.expectedRepo);
  expect(manifest.license).toBe(options.expectedLicense);
  expect(manifest.sourceCommit).toMatch(/^[0-9a-f]{40}$/);

  const fileNames = manifest.assets.map((asset) => asset.fileName);
  expect(new Set(fileNames).size, "manifest fileName values must be unique").toBe(fileNames.length);
  const committedAssetFiles = readdirSync(options.fixtureDir)
    .filter((fileName) => /\.(?:svg|png)$/i.test(fileName))
    .sort();
  expect(committedAssetFiles).toEqual([...fileNames].sort());

  const notice = readFileSync(resolve(options.fixtureDir, "NOTICE.md"), "utf8");
  const licenseText = readFileSync(resolve(options.fixtureDir, options.licenseFile), "utf8");
  expect(notice).toContain(manifest.sourceRepo);
  expect(notice).toContain(manifest.sourceCommit);
  expect(notice).toContain(manifest.license);
  expect(licenseText.trim().length).toBeGreaterThan(100);

  for (const asset of manifest.assets) {
    expect(asset.sourceRepo).toBe(manifest.sourceRepo);
    expect(asset.sourceCommit).toBe(manifest.sourceCommit);
    expect(asset.license).toBe(manifest.license);
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(notice).toContain(asset.fileName);
    expect(notice).toContain(asset.sourcePath);

    const fullPath = resolve(options.fixtureDir, asset.fileName);
    const bytes = readFileSync(fullPath);
    expect(bytes.byteLength, `${asset.fileName}: sizeBytes`).toBe(asset.sizeBytes);
    expect(sha256(bytes), `${asset.fileName}: sha256`).toBe(asset.sha256);
    if (asset.fileName.endsWith(".svg")) {
      expect(asset.elementCount, `${asset.fileName}: elementCount must be recorded`).toBeTypeOf(
        "number",
      );
      expect(countShapeElements(bytes.toString("utf8")), `${asset.fileName}: elementCount`).toBe(
        asset.elementCount,
      );
    } else {
      expect(
        asset.elementCount,
        `${asset.fileName}: non-SVG must omit elementCount`,
      ).toBeUndefined();
    }
  }
}

describe("third-party svg policy guard — fluentui-emoji", () => {
  it("verifies manifest provenance, hashes, sizes, and notices", () => {
    assertManifestIntegrity({
      fixtureDir: fluentFixtureDir,
      expectedRepo: "https://github.com/microsoft/fluentui-emoji",
      expectedLicense: "MIT",
      licenseFile: "LICENSE-MIT.txt",
    });
  });

  it("contains exactly the expected Fluent fixture set", () => {
    const svgFiles = readdirSync(fluentFixtureDir)
      .filter((file) => file.endsWith(".svg"))
      .sort();
    expect(svgFiles).toEqual(expectedSvgFiles);
  });

  it("small-and-simple ban matches no committed fixture", () => {
    for (const fileName of expectedSvgFiles) {
      const fullPath = resolve(fluentFixtureDir, fileName);
      const svg = readFileSync(fullPath, "utf-8");
      const sizeBytes = statSync(fullPath).size;
      const elementCount = countShapeElements(svg);
      const dims = parseIntrinsicSize(svg);

      const isSmallIntrinsic = dims.width <= 64 && dims.height <= 64;
      const isSmallFile = sizeBytes < 32 * 1024;
      const isLowComplexity = elementCount < 120;
      const isRejectedByGate = isSmallIntrinsic && isSmallFile && isLowComplexity;

      expect(
        isRejectedByGate,
        `${fileName} should not match the banned 'small + simple icon' criteria`,
      ).toBe(false);
    }
  });
});

const naturalEarthFixtureDir = resolve(
  __dirname,
  "../../../../fixtures/third-party-svg/natural-earth",
);
const expectedNaturalEarthSvgFiles = ["world-terrain-borders-50m.svg"];

describe("third-party svg policy guard — natural-earth", () => {
  it("verifies manifest provenance, hashes, sizes, and notices", () => {
    assertManifestIntegrity({
      fixtureDir: naturalEarthFixtureDir,
      expectedRepo: "https://github.com/zakideee/natural-earth-svg",
      expectedLicense: "Public Domain",
      licenseFile: "LICENSE-PUBLIC-DOMAIN.txt",
    });
  });

  it("contains exactly the expected Natural Earth fixture set", () => {
    const svgFiles = readdirSync(naturalEarthFixtureDir)
      .filter((file) => file.endsWith(".svg"))
      .sort();
    expect(svgFiles).toEqual(expectedNaturalEarthSvgFiles);
  });

  it("small-and-simple ban matches no committed fixture", () => {
    for (const fileName of expectedNaturalEarthSvgFiles) {
      const fullPath = resolve(naturalEarthFixtureDir, fileName);
      const svg = readFileSync(fullPath, "utf-8");
      const sizeBytes = statSync(fullPath).size;
      const elementCount = countShapeElements(svg);
      const dims = parseIntrinsicSize(svg);

      const isSmallIntrinsic = dims.width <= 64 && dims.height <= 64;
      const isSmallFile = sizeBytes < 32 * 1024;
      const isLowComplexity = elementCount < 120;
      const isRejectedByGate = isSmallIntrinsic && isSmallFile && isLowComplexity;

      expect(
        isRejectedByGate,
        `${fileName} should not match the banned 'small + simple icon' criteria`,
      ).toBe(false);
    }
  });
});
