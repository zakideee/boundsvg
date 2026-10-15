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
  "fallback-missing-transform-glyphs": {
    svgSha256: "980cd8296e788ba5db378ced605228109af7a51537597377012f1e418c7e647a",
    rootSha256: "fc6797778f6c99133320522568235212b92b25b7d71307b217e7ba54e192e1b5",
    outlinesSha256: "346887eb4e25b2e97e0fe736dbd9006a018aaeea98a1f9a9a8683a257400e4d5",
    glyphPathCount: 3,
    unitSampleCount: 0,
  },
  "text-on-path-merged": {
    svgSha256: "9549d9372a932fd91ea1ab97a5db412d1004fe4cc7d73bd100a8f191c67452a6",
    rootSha256: "cea5c3e92a4943a079cc6661f45fcdcd137226ee15930fd06e75eb0ebae7dfa4",
    outlinesSha256: "da6e6b4ea901e19e716e1eb3abf381e950d402faeafe1067cbdfafeebd842976",
    glyphPathCount: 28,
    unitSampleCount: 35,
  },
  "unit-animation-glyphs": {
    svgSha256: "e3dd59ea825591782b3566d3685c632e4c01fbc44ef5509ed9063006dd14585a",
    rootSha256: "5c9eafaebc0880dd335cf1f179e690e2e681024417b93efb5fc112009d3583cd",
    outlinesSha256: "757c28bed7ae458c494604fcca6672378b9889faa7d5bdb171915794f9905939",
    glyphPathCount: 48,
    unitSampleCount: 12,
  },
  "vertical-ruby-glyphs": {
    svgSha256: "342cece40606b15d8226a2914a7a152bb73cb5021f29dded16d522ad28e33ab9",
    rootSha256: "77295a74705ae67d6a4d0dd6dbeb0ad13d7216a408e0a559ca9235ebc0fdcc90",
    outlinesSha256: "0c5d56a6910ee90ceecf2157ec9dda4e2e7868d4a97bf93c4e29b48229ac8f56",
    glyphPathCount: 53,
    unitSampleCount: 0,
  },
  "vertical-ruby-merged": {
    svgSha256: "c9d526e9ab58a6a353c930a2e23df240d6c3f2e9068ce09d7f14efe34f441fe3",
    rootSha256: "e692ccbe49a3141a8d794d1eb2e6b815f9a07d2dc1ccf0cdd17dcd35e936dee2",
    outlinesSha256: "e043aa6158835de07e08776f217af1fc93177ad8c02439a6c15f841b6444da54",
    glyphPathCount: 2,
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
