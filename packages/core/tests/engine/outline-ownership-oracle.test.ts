import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RenderOptions } from "../../src/engine.js";
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

const expectedOracle: Record<string, OracleResult> = {
  "vertical-ruby-merged": {
    svgSha256: "dfc3551088618aeadfbf10cf0fe2d542a9c9a8f29087f98bece9e110fc17482f",
    rootSha256: "c5f023624b4db7f5ed32ed3cc4dfd2d09e45da7a9bd830395494f69fdc6ac24c",
    outlinesSha256: "d66146c49b76b739e82d892ceda7b3ad786a36dcd982b7400bf60a06afcda803",
    glyphPathCount: 2,
    unitSampleCount: 0,
  },
  "vertical-ruby-glyphs": {
    svgSha256: "be5a71775b4f3add9921fdf16436fbd7c49ff96aa56087d4dee12b5a6fbb7564",
    rootSha256: "e7725040142493b695fd2345acb22417a6e6f2cf480e83a69d8fecb176f5da8d",
    outlinesSha256: "112894497c1337e414a9a75582e05b350c38d5c0079218143b6b6a6b2a6c1246",
    glyphPathCount: 53,
    unitSampleCount: 0,
  },
  "text-on-path-merged": {
    svgSha256: "5731cc5811b3356336d5f052c79d27e713bce397641a899b1ad117632c7e3c58",
    rootSha256: "e0d6e060dab0e47b6ac38c1300703035fedce2a5c3507c3d9161542bf7698561",
    outlinesSha256: "2882bca37a25be5608d8f18e15d2e2220f2297f642530491a4548e4ab1ef12c4",
    glyphPathCount: 28,
    unitSampleCount: 35,
  },
  "unit-animation-glyphs": {
    svgSha256: "4271633ef521e79b97c211d22f60b8ad87fb9b547b54b83a0e01799197f07b3c",
    rootSha256: "c7864d6ce4d37e71c4e6ce370d3a20f3d789a14c24253afdf544cd7604c08a60",
    outlinesSha256: "69798a33170cf984b178b9bb1d6b9310e309f78266215789f13230f3edd5d457",
    glyphPathCount: 48,
    unitSampleCount: 12,
  },
  "fallback-missing-transform-glyphs": {
    svgSha256: "d42f51bbab225c3ccef930a80d19f0bb17878526e302d4235e81a90345195044",
    rootSha256: "99c764cdc6c340aa02c9c005ba32e8a71e4abc7c060593e5015215e223af8f49",
    outlinesSha256: "9f8267c9a4104e4933f43c735145b851413fc8117c2b32dce4e2b6973d40f265",
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

const oracleCases: ReadonlyArray<{
  id: string;
  build: () => VNode;
  options: RenderOptions;
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
    options: { textPathMode: "merged", animation: "static", timeMs: 350 },
  },
  {
    id: "unit-animation-glyphs",
    build: () => scene("native-text-unit-animation"),
    options: { textPathMode: "glyphs", animation: "static", timeMs: 480 },
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
      const outlines = engine.renderToTextOutlines(vnode, oracleCase.options);
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
