import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Cross-runtime determinism: the browser (web-target WASM) must produce
 * byte-identical SVG and PNG to the Node.js goldens pinned by
 * packages/core/tests/determinism/goldens.json (nodejs-target WASM).
 *
 * Both targets compile the same crate at the same version; a hash mismatch
 * here means the determinism contract (docs: reference/determinism) is
 * broken across runtimes.
 */
const HARNESS_URL = "/e2e-determinism.html";

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: global augmentation requires interface
  interface Window {
    boundsvgDeterminism?: {
      renderScene: (sceneJson: string) => {
        svg: string;
        pngBase64: string;
        webpBase64: string;
        animatedWebpBase64: string;
        animatedGifBase64: string;
      };
    };
  }
}

const scenes = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/determinism-scenes.json"), "utf8"),
) as Record<string, unknown>;

const goldens = JSON.parse(
  readFileSync(resolve(__dirname, "../packages/core/tests/determinism/goldens.json"), "utf8"),
) as Record<
  string,
  {
    svgSha256: string;
    pngSha256: string;
    webpSha256: string;
    animatedWebpSha256: string;
    animatedGifSha256: string;
  }
>;

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

test.describe("Cross-runtime determinism (browser vs Node goldens)", () => {
  test("fixture and goldens cover the same scenes", () => {
    expect(Object.keys(scenes).sort()).toEqual(Object.keys(goldens).sort());
  });

  test("browser renders byte-identically to the Node goldens", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 30_000 });
    await expect(page.getByTestId("error")).toHaveText("");

    for (const [name, vnode] of Object.entries(scenes)) {
      const rendered = await page.evaluate((sceneJson: string) => {
        const harness = window.boundsvgDeterminism;
        if (!harness) {
          throw new Error("determinism harness not installed");
        }
        return harness.renderScene(sceneJson);
      }, JSON.stringify(vnode));

      expect(sha256(rendered.svg), `svg hash drift in scene "${name}"`).toBe(
        goldens[name].svgSha256,
      );
      expect(
        sha256(Buffer.from(rendered.pngBase64, "base64")),
        `png hash drift in scene "${name}"`,
      ).toBe(goldens[name].pngSha256);
      expect(
        sha256(Buffer.from(rendered.webpBase64, "base64")),
        `webp hash drift in scene "${name}"`,
      ).toBe(goldens[name].webpSha256);
      expect(
        sha256(Buffer.from(rendered.animatedWebpBase64, "base64")),
        `animated webp hash drift in scene "${name}"`,
      ).toBe(goldens[name].animatedWebpSha256);
      expect(
        sha256(Buffer.from(rendered.animatedGifBase64, "base64")),
        `animated gif hash drift in scene "${name}"`,
      ).toBe(goldens[name].animatedGifSha256);
    }
  });
});
