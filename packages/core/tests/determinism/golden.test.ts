import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createEngineAsync, type Engine } from "../../src/engine.js";
import { initNodeWasm } from "../../src/node.js";
import {
  assertWasmPkgAvailable,
  loadInterVariableFont,
  loadJetBrainsMonoFont,
  loadSubsetFont,
} from "../wasm/test-prerequisites.js";
import { DETERMINISM_SCENES } from "./scenes.js";

/**
 * Determinism golden suite (docs: reference/determinism).
 *
 * Same inputs + same boundsvg version must produce byte-identical SVG, PNG,
 * and WebP. Hashes of every scene are pinned in goldens.json; any diff means
 * an output-affecting change, and re-recording goldens.json makes
 * scripts/check-output-affecting-changeset.sh require a changeset that says so.
 * The WebP
 * hash also pins the `image-webp` encoder, which arrives transitively through
 * resvg — a resvg bump can move it without any direct dependency change.
 *
 * Update after an intentional output change:
 *   GOLDEN_UPDATE=1 pnpm --filter @boundsvg/core exec vitest run tests/determinism
 */
const goldensPath = path.resolve(__dirname, "goldens.json");
const updateMode = process.env.GOLDEN_UPDATE === "1";

type GoldenEntry = {
  svgSha256: string;
  pngSha256: string;
  webpSha256: string;
  animatedWebpSha256: string;
  animatedGifSha256: string;
};

// Must stay in sync with the browser harness
// (apps/playground-react/src/e2e/e2e-determinism-harness.ts).
const ANIMATED_SCHEDULE = { durationMs: 300, fps: 10 } as const;

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function createFonts() {
  return [
    { alias: "NotoSansJP", weight: 400, style: "normal" as const, data: loadSubsetFont() },
    {
      alias: "JetBrainsMono",
      weight: 400,
      style: "normal" as const,
      data: loadJetBrainsMonoFont(),
    },
    {
      alias: "InterVariable",
      weight: 400,
      style: "normal" as const,
      data: loadInterVariableFont(),
    },
  ];
}

describe("determinism goldens", () => {
  let engine: Engine;

  beforeAll(async () => {
    assertWasmPkgAvailable();
    await initNodeWasm();
    engine = await createEngineAsync({ fonts: createFonts() });
  });

  const sceneNames = Object.keys(DETERMINISM_SCENES);

  it("covers every scene in goldens.json (no silent additions/removals)", () => {
    if (updateMode) {
      return;
    }
    const goldens = JSON.parse(fs.readFileSync(goldensPath, "utf8")) as Record<string, GoldenEntry>;
    expect(Object.keys(goldens).sort()).toEqual([...sceneNames].sort());
  });

  it("renders every scene byte-identically to the pinned goldens", () => {
    const rendered: Record<string, GoldenEntry> = {};
    for (const name of sceneNames) {
      const vnode = DETERMINISM_SCENES[name];
      const svg = engine.renderToSvg(vnode);
      const png = engine.renderToPng(vnode);
      const webp = engine.renderToWebp(vnode);
      const animatedWebp = engine.renderToAnimatedWebp(vnode, ANIMATED_SCHEDULE);
      const animatedGif = engine.renderToAnimatedGif(vnode, ANIMATED_SCHEDULE);
      rendered[name] = {
        svgSha256: sha256(svg),
        pngSha256: sha256(png),
        webpSha256: sha256(webp),
        animatedWebpSha256: sha256(animatedWebp),
        animatedGifSha256: sha256(animatedGif),
      };
    }

    if (updateMode) {
      fs.writeFileSync(goldensPath, `${JSON.stringify(rendered, null, 2)}\n`);
      return;
    }

    const goldens = JSON.parse(fs.readFileSync(goldensPath, "utf8")) as Record<string, GoldenEntry>;
    for (const name of sceneNames) {
      expect(rendered[name], `scene "${name}" output hash drifted`).toEqual(goldens[name]);
    }
  });

  it("produces identical bytes from a fresh engine instance", async () => {
    // Guards against hidden per-instance state (cache warmup, registration
    // order, instance counters) leaking into output.
    const fresh = await createEngineAsync({ fonts: createFonts() });
    try {
      for (const name of ["ja-vertical-ruby", "grid-cards", "fit-shrink"]) {
        const vnode = DETERMINISM_SCENES[name];
        expect(sha256(fresh.renderToSvg(vnode)), `svg: ${name}`).toBe(
          sha256(engine.renderToSvg(vnode)),
        );
        expect(sha256(fresh.renderToPng(vnode)), `png: ${name}`).toBe(
          sha256(engine.renderToPng(vnode)),
        );
        expect(sha256(fresh.renderToWebp(vnode)), `webp: ${name}`).toBe(
          sha256(engine.renderToWebp(vnode)),
        );
      }
    } finally {
      fresh.dispose();
    }
  });

  it("pins animated WebP and GIF bytes against encoder and mux drift", () => {
    // Separate from the per-scene goldens: the animated APIs take a schedule,
    // so they cannot ride the same table. The WebP hash covers the frame
    // sampler, the still encoder, and the RIFF mux; the GIF hash also covers
    // the NeuQuant palette, which is the part most at risk from a crate bump.
    const animatedPath = path.resolve(__dirname, "animated-goldens.json");
    const webp = engine.renderToAnimatedWebp(DETERMINISM_SCENES["grid-cards"], {
      durationMs: 400,
      fps: 10,
    });
    const gif = engine.renderToAnimatedGif(DETERMINISM_SCENES["grid-cards"], {
      durationMs: 400,
      fps: 10,
    });
    const rendered = {
      "grid-cards@10fps/400ms": sha256(webp),
      "grid-cards@10fps/400ms.gif": sha256(gif),
    };

    if (updateMode) {
      fs.writeFileSync(animatedPath, `${JSON.stringify(rendered, null, 2)}\n`);
      return;
    }

    expect(rendered).toEqual(JSON.parse(fs.readFileSync(animatedPath, "utf8")));
  });

  it("produces identical bytes on repeated renders of the same engine", () => {
    const vnode = DETERMINISM_SCENES["ja-horizontal-kinsoku"];
    const first = sha256(engine.renderToSvg(vnode));
    const second = sha256(engine.renderToSvg(vnode));
    expect(second).toBe(first);
  });
});
