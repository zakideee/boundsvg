import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RenderSvgOptions } from "../../src/engine.js";
import type { IRNode } from "../../src/ir/types.js";
import { createElement } from "../../src/vnode/create-element.js";
import type { VNode } from "../../src/vnode/types.js";
import { FONT_MONO, FONT_SANS_JP } from "../conformance/scenes/assets.js";
import { CONFORMANCE_SCENES } from "../conformance/scenes/index.js";
import { createEngineFromHandle, createFontedWasmHandle } from "../helpers/wasm-render-engine.js";

type OracleResult = {
  svgSha256: string;
  rootSha256: string;
  outlinesSha256: string;
  glyphPathCount: number;
  unitSampleCount: number;
};

/** Frozen SVG, IR, outline hashes and structural counts for the current font stack. */
const expectedOracle: Record<string, OracleResult> = {
  "vertical-ruby-merged": {
    svgSha256: "7b953e81b092c533462fc7772dc751482c77b3fd5f79aec8024972dda65cb577",
    rootSha256: "279c602103c04106414b51ab3988931f91712f138af0448c7e95b4a104e1077f",
    outlinesSha256: "3f5873cb647d9fbcb283e81f779f95a5b2d4f8142b66fe379a0c078fc322f2f2",
    glyphPathCount: 2,
    unitSampleCount: 0,
  },
  "vertical-ruby-glyphs": {
    svgSha256: "eadaa57a5e5b0ac1a381a634d19b90561e35008463aa32aa886a908f6b28c6bb",
    rootSha256: "5534c11f509299820a1c48e03220c06fa5e30c52f5014657ead64032e8313866",
    outlinesSha256: "24d921ad4987e7be6e5744df81db5243f0c66379e89d9004d4fc7334b2ac2c99",
    glyphPathCount: 53,
    unitSampleCount: 0,
  },
  "text-on-path-merged": {
    svgSha256: "2140fffa2f90e43215d81faa188a74f5b1627afdfafd77db070d64a59ca1c928",
    rootSha256: "cc2578ef8f4d4cd8332978a00699b64a10972046adcdcc54b293bf696996c86e",
    outlinesSha256: "2a00aaafd4e2c443807e1f37d777f8850470647cfdfd968a4e614bcd91c3accf",
    glyphPathCount: 28,
    unitSampleCount: 35,
  },
  "unit-animation-glyphs": {
    svgSha256: "a7db1665916213c8cf1bb9f0b22710885f94551eb4d31b0cec8e2f0d21973fff",
    rootSha256: "dc08a896908248b88f2d7fb86114a0d7c954e3a922140c514f1d1b3a9ebfad2d",
    outlinesSha256: "cfec93479736ceca286dc9b68f3e415b7a4efd98b5a70fd5ba32cbe35ff59474",
    glyphPathCount: 48,
    unitSampleCount: 12,
  },
  "fallback-missing-transform-glyphs": {
    svgSha256: "d6aab1f36181e3549956a299a53c7e582e3a2fbcf9c406a29244cefd127874ad",
    rootSha256: "354f7299ac7d200d9c744391b3ebd6a3c21ad6c4cb8ef62938b0677304c5781c",
    outlinesSha256: "aa5e825e4e5f7b7fa7123c4ae54fd6632bfdef8a96bfa4c7d29e0d0b2b680f85",
    glyphPathCount: 3,
    unitSampleCount: 0,
  },
};

function scene(id: string): VNode {
  const selectedScene = CONFORMANCE_SCENES.find((candidate) => candidate.id === id);
  if (!selectedScene) {
    throw new TypeError(`Missing conformance scene: ${id}`);
  }
  return selectedScene.build();
}

function fallbackMissingTransformScene(): VNode {
  return createElement(
    "Canvas",
    { id: "oracle-canvas", width: 240, height: 120, background: "#fff" },
    createElement(
      "Flex",
      {
        id: "oracle-transform",
        width: 220,
        height: 100,
        transform: { translateX: 7, translateY: 5, rotateDeg: 9, scaleX: 1.1, scaleY: 0.9 },
      },
      createElement(
        "Text",
        {
          id: "oracle-fallback-missing",
          font: FONT_MONO,
          fallback: [FONT_SANS_JP],
          fontSizePx: 28,
          color: "#123456",
        },
        "A漢\u{10ffff}",
      ),
    ),
  );
}

/** Vertical ruby, text paths, animation units, and transformed fallback cases. */
const oracleCases: ReadonlyArray<{
  id: string;
  build: () => VNode;
  options: RenderSvgOptions;
}> = [
  {
    id: "vertical-ruby-merged",
    build: () => scene("native-vertical-ruby"),
    options: { textPathMode: "merged" },
  },
  {
    id: "vertical-ruby-glyphs",
    build: () => scene("native-vertical-ruby"),
    options: { textPathMode: "glyphs" },
  },
  {
    id: "text-on-path-merged",
    build: () => scene("native-text-on-path"),
    options: { textPathMode: "merged", timeMs: 350 },
  },
  {
    id: "unit-animation-glyphs",
    build: () => scene("native-text-unit-animation"),
    options: { textPathMode: "glyphs", timeMs: 480 },
  },
  {
    id: "fallback-missing-transform-glyphs",
    build: fallbackMissingTransformScene,
    options: { textPathMode: "glyphs", showMissingGlyphs: true },
  },
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function countResolvedTextMetadata(root: IRNode): {
  glyphPathCount: number;
  unitSampleCount: number;
} {
  let glyphPathCount = 0;
  let unitSampleCount = 0;
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node.type === "text") {
      glyphPathCount += node.glyphPaths?.length ?? 0;
      unitSampleCount += node.unitAnimationSamples?.length ?? 0;
    }
    if (node.type === "group") {
      pending.push(...(node.children ?? []));
    }
  }
  return { glyphPathCount, unitSampleCount };
}

describe("outline ownership frozen oracle", () => {
  let handle: Awaited<ReturnType<typeof createFontedWasmHandle>>;

  beforeAll(async () => {
    handle = await createFontedWasmHandle();
  });

  afterAll(() => {
    handle.dispose();
  });

  for (const oracleCase of oracleCases) {
    it(oracleCase.id, () => {
      const engine = createEngineFromHandle(handle);
      const vnode = oracleCase.build();
      const rendered = engine.renderToSvgAndIR(vnode, oracleCase.options);
      const outlines = engine.renderToTextOutlines(vnode, {
        textPathMode: oracleCase.options.textPathMode,
        showMissingGlyphs: oracleCase.options.showMissingGlyphs,
      });
      const actual: OracleResult = {
        svgSha256: sha256(rendered.svg),
        rootSha256: sha256(rendered.ir.root),
        outlinesSha256: sha256(outlines),
        ...countResolvedTextMetadata(rendered.ir.root),
      };
      expect(actual).toEqual(expectedOracle[oracleCase.id]);
    });
  }
});
