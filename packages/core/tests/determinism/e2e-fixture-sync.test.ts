/**
 * Guards the hand-off between the Node golden suite and the browser e2e spec.
 *
 * e2e/fixtures/determinism-scenes.json must carry exactly the trees built by
 * DETERMINISM_SCENES: a stale JSON tree would render differently in the
 * browser and surface as "cross-runtime determinism broken" — the loudest
 * possible misdiagnosis — when the real problem is fixture drift.
 *
 * No WASM required; this is pure structural comparison.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DETERMINISM_SCENES } from "./scenes.js";

const fixturePath = path.resolve(__dirname, "../../../../e2e/fixtures/determinism-scenes.json");
const goldensPath = path.resolve(__dirname, "goldens.json");
const conformanceBaselinePath = path.resolve(
  __dirname,
  "../../../../fixtures/conformance/visual-hashes.sha256",
);

describe("determinism fixture synchronization", () => {
  it("e2e JSON fixture carries exactly the golden suite's scene trees", () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Record<string, unknown>;

    expect(Object.keys(fixture).sort()).toEqual(Object.keys(DETERMINISM_SCENES).sort());
    for (const [name, vnode] of Object.entries(DETERMINISM_SCENES)) {
      // JSON round-trip mirrors what the browser harness will parse.
      expect(fixture[name], `scene "${name}" drifted from scenes.ts`).toEqual(
        JSON.parse(JSON.stringify(vnode)),
      );
    }
  });

  it("promoted conformance scene pins the same PNG hash in goldens and the conformance baseline", () => {
    // The two files are updated by different commands (GOLDEN_UPDATE=1 vs
    // check-conformance-visual.sh --update) and rendered by engines with
    // different font registries; the scenes must not depend on that
    // difference, so their pinned hashes must agree.
    const goldens = JSON.parse(fs.readFileSync(goldensPath, "utf8")) as Record<
      string,
      { pngSha256: string }
    >;
    const baseline = new Map(
      fs
        .readFileSync(conformanceBaselinePath, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          const [hash, name] = line.trim().split(/\s+/);
          return [name ?? "", hash ?? ""] as const;
        }),
    );

    const promoted: Array<[goldenName: string, baselineFile: string]> = [
      ["conformance-rich-inline", "native-rich-inline.png"],
    ];
    for (const [goldenName, baselineFile] of promoted) {
      expect(goldens[goldenName]?.pngSha256, `${goldenName} missing from goldens`).toBeDefined();
      expect(baseline.get(baselineFile), `${baselineFile} missing from baseline`).toBeDefined();
      expect(goldens[goldenName]?.pngSha256, `${goldenName} vs ${baselineFile}`).toBe(
        baseline.get(baselineFile),
      );
    }
  });
});
