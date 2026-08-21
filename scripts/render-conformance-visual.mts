/**
 * Renders every conformance scene to PNG through the real WASM engine and writes
 * a sha256 listing next to the images.
 *
 * Usage:
 *   npx tsx scripts/render-conformance-visual.mts --out <dir> [--hashes <file>]
 *
 * Prerequisite: `pnpm build:wasm` (nodejs-target WASM package).
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createConformanceEngine } from "../packages/core/tests/conformance/conformance-engine.js";
import { CONFORMANCE_SCENES } from "../packages/core/tests/conformance/scenes/index.js";

function parseArgs(argv: readonly string[]): { outDir: string; hashesPath: string } {
  let outDir: string | undefined;
  let hashesPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out") {
      outDir = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--hashes") {
      hashesPath = argv[index + 1];
      index += 1;
    }
  }
  if (!outDir) {
    throw new Error("Usage: render-conformance-visual.mts --out <dir> [--hashes <file>]");
  }
  return { outDir, hashesPath: hashesPath ?? path.join(outDir, "hashes.sha256") };
}

async function main(): Promise<void> {
  const { outDir, hashesPath } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(outDir, { recursive: true });

  const engine = await createConformanceEngine();
  const hashLines: string[] = [];
  for (const scene of CONFORMANCE_SCENES) {
    const png = engine.renderToPng(scene.build(), scene.renderOptions);
    fs.writeFileSync(path.join(outDir, `${scene.id}.png`), png);
    const digest = createHash("sha256").update(png).digest("hex");
    hashLines.push(`${digest}  ${scene.id}.png`);
  }

  // Code-unit comparison, not localeCompare — the listing must not depend on
  // the environment's collation locale.
  hashLines.sort((left, right) => {
    const leftName = left.split("  ")[1] ?? "";
    const rightName = right.split("  ")[1] ?? "";
    if (leftName === rightName) {
      return 0;
    }
    return leftName < rightName ? -1 : 1;
  });
  fs.writeFileSync(hashesPath, `${hashLines.join("\n")}\n`);
  console.info(`Rendered ${CONFORMANCE_SCENES.length} scenes to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
