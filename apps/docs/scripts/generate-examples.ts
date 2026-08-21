/**
 * Generate SVG example images and markdown snippets for the docs site.
 *
 * Usage:
 *   npx tsx scripts/generate-examples.ts
 *   npx tsx scripts/generate-examples.ts vertical-ruby-ja
 *   npx tsx scripts/generate-examples.ts --id vertical-ruby-ja
 *
 * Prerequisites:
 *   pnpm build:wasm  (core build is NOT required — this script imports source directly)
 *
 * Output:
 *   public/generated/<component>-<name>.svg  — path-mode SVG (self-contained image)
 *   fixtures/generated/<component>-<name>.png — README fixture PNG (selected examples)
 *   _generated/<component>-<name>.md               — markdown snippet with code + image + text SVG
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { format as formatWithPrettier } from "prettier";

// biome-ignore lint/style/useNamingConvention: Node.js __dirname convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const DOCS = path.resolve(__dirname, "..");
const OUT_SVG = path.resolve(DOCS, "public/generated");
const OUT_MD = path.resolve(DOCS, "_generated");
const OUT_FIXTURE_SVG = path.resolve(ROOT, "fixtures/generated");
const OUT_FIXTURE_PNG = OUT_FIXTURE_SVG;
const README_FIXTURE_IDS = new Set([
  "figure-flow",
  "terminal-code",
  "terminal-code-bounds",
  "terminal-typing",
  "vertical-ruby-ja",
]);
const VERTICAL_RUBY_MAIN_FILL = "#f8fafc";
const VERTICAL_RUBY_RT_FILL = "#bae6fd";
const VERTICAL_RUBY_OUTLINE = "#172033";
const FONT_PATH = path.resolve(ROOT, "fixtures/fonts/NotoSansJP-Regular.subset.ttf");
const FONT_JETBRAINS = path.resolve(ROOT, "fixtures/fonts/JetBrainsMono-Regular.woff2");
const FONT_MONASPACE = path.resolve(ROOT, "fixtures/fonts/MonaspaceNeon-Regular.woff2");

const CORE_SRC = path.resolve(ROOT, "packages/core/src/index.ts");
const CORE_NODE_SRC = path.resolve(ROOT, "packages/core/src/node.ts");
const CORE_WASM_SRC = path.resolve(ROOT, "packages/core/src/wasm/index.ts");

// ---------------------------------------------------------------------------
// Dynamic import of @boundsvg/core source (avoids dist path issues)
// ---------------------------------------------------------------------------

async function loadCore() {
  const core = await import(CORE_SRC);
  return core;
}

async function initNodeWasm() {
  const node = await import(CORE_NODE_SRC);
  await node.initNodeWasm();
}

async function loadCoreWasm() {
  const wasm = await import(CORE_WASM_SRC);
  return wasm;
}

// ---------------------------------------------------------------------------
// Example definitions
// ---------------------------------------------------------------------------

type Example = {
  id: string;
  code: string;
  build: (core: typeof import("@boundsvg/core")) => import("@boundsvg/core").VNode;
  prepare?: (ctx: {
    core: typeof import("@boundsvg/core");
    engine: import("@boundsvg/core").Engine;
  }) => void;
  renderOptions?: import("@boundsvg/core").RenderOptions;
};

// Fragments computed by the figure-flow prepare step and consumed by its build.
type FlowFragmentBox = { x: number; y: number; availableInlineSizePx: number; text: string };
let figureFlowFragments: FlowFragmentBox[] = [];

const EXAMPLES: Example[] = [
  // --- Canvas ---
  {
    id: "canvas-basic",
    code: `<Canvas width={400} height={120} background="#1e293b">
  <Flex
    direction="column"
    justifyContent="center"
    alignItems="center"
    width={400}
    height={120}
  >
    <Text font="NotoSansJP" fontSizePx={24} color="#f8fafc">
      Hello, Canvas!
    </Text>
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 400, height: 120, background: "#1e293b" },
        core.Flex(
          {
            direction: "column",
            justifyContent: "center",
            alignItems: "center",
            width: 400,
            height: 120,
          },
          core.Text({ font: "NotoSansJP", fontSizePx: 24, color: "#f8fafc" }, "Hello, Canvas!"),
        ),
      ),
  },

  // --- Shape ---
  {
    id: "shape-basic",
    code: `import { Canvas, Shape, type GeometryDoc } from "@boundsvg/core";

const badge: GeometryDoc = {
  viewBox: { width: 140, height: 64 },
  root: {
    kind: "path",
    d: "M12 0H128C134.627 0 140 5.373 140 12V52C140 58.627 134.627 64 128 64H12C5.373 64 0 58.627 0 52V12C0 5.373 5.373 0 12 0Z",
  },
};

<Canvas width={220} height={120} background="#0f172a">
  <Shape geometry={badge} width={180} height={82} fill="#38bdf8" />
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 220, height: 120, background: "#0f172a" },
        core.Shape({
          geometry: {
            viewBox: { width: 140, height: 64 },
            root: {
              kind: "path",
              d: "M12 0H128C134.627 0 140 5.373 140 12V52C140 58.627 134.627 64 128 64H12C5.373 64 0 58.627 0 52V12C0 5.373 5.373 0 12 0Z",
            },
          },
          width: 180,
          height: 82,
          fill: "#38bdf8",
        }),
      ),
  },

  // --- Symbol ---
  {
    id: "symbol-registered",
    code: `import { Canvas, Symbol, createEngineAsync, type SymbolDefinition } from "@boundsvg/core";

const arrow: SymbolDefinition = {
  geometry: {
    viewBox: { width: 100, height: 20 },
    root: {
      kind: "group",
      children: [
        { kind: "path", nodeId: "tail", d: "M0 8H10V12H0Z" },
        { kind: "path", nodeId: "shaft", d: "M10 8H70V12H10Z" },
        { kind: "path", nodeId: "head", d: "M70 4L100 10L70 16Z" },
      ],
    },
  },
  elasticSegments: [
    { nodeId: "tail", axis: "x", role: "fixed-start", frame: { x: 0, y: 0, width: 10, height: 20 } },
    { nodeId: "shaft", axis: "x", role: "stretch", frame: { x: 10, y: 0, width: 60, height: 20 } },
    { nodeId: "head", axis: "x", role: "fixed-end", frame: { x: 70, y: 0, width: 30, height: 20 } },
  ],
};

const engine = await createEngineAsync({});
engine.registerSymbol("arrow", arrow);

<Canvas width={280} height={120} background="#111827">
  <Symbol symbolId="arrow" width={220} height={24} fill="#f8fafc" />
</Canvas>`,
    prepare: ({ engine }) => {
      engine.registerSymbol("arrow", {
        geometry: {
          viewBox: { width: 100, height: 20 },
          root: {
            kind: "group",
            children: [
              { kind: "path", nodeId: "tail", d: "M0 8H10V12H0Z" },
              { kind: "path", nodeId: "shaft", d: "M10 8H70V12H10Z" },
              { kind: "path", nodeId: "head", d: "M70 4L100 10L70 16Z" },
            ],
          },
        },
        elasticSegments: [
          {
            nodeId: "tail",
            axis: "x",
            role: "fixed-start",
            frame: { x: 0, y: 0, width: 10, height: 20 },
          },
          {
            nodeId: "shaft",
            axis: "x",
            role: "stretch",
            frame: { x: 10, y: 0, width: 60, height: 20 },
          },
          {
            nodeId: "head",
            axis: "x",
            role: "fixed-end",
            frame: { x: 70, y: 0, width: 30, height: 20 },
          },
        ],
      });
    },
    build: (core) =>
      core.Canvas(
        { width: 280, height: 120, background: "#111827" },
        core.Symbol({ symbolId: "arrow", width: 220, height: 24, fill: "#f8fafc" }),
      ),
  },

  // --- Box ---
  {
    id: "box-styled",
    code: `<Canvas width={300} height={140} background="#f8fafc">
  <Flex
    direction="column"
    justifyContent="center"
    alignItems="center"
    width={300}
    height={140}
  >
    <Box
      width={200}
      height={80}
      padding={16}
      background="#e2e8f0"
      borderWidth={2}
      borderColor="#64748b"
      borderRadius={8}
    >
      <Text font="NotoSansJP" fontSizePx={16} color="#334155">
        Styled Box
      </Text>
    </Box>
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 300, height: 140, background: "#f8fafc" },
        core.Flex(
          {
            direction: "column",
            justifyContent: "center",
            alignItems: "center",
            width: 300,
            height: 140,
          },
          core.Box(
            {
              width: 200,
              height: 80,
              padding: 16,
              background: "#e2e8f0",
              borderWidth: 2,
              borderColor: "#64748b",
              borderRadius: 8,
            },
            core.Text({ font: "NotoSansJP", fontSizePx: 16, color: "#334155" }, "Styled Box"),
          ),
        ),
      ),
  },

  // --- Grid ---
  {
    id: "grid-3col",
    code: `<Canvas width={400} height={200} background="#0f172a">
  <Grid
    templateColumns="1fr 1fr 1fr"
    gap={12}
    width={400}
    height={200}
    padding={16}
  >
    <Box background="#3b82f6" borderRadius={8}>
      <Text font="NotoSansJP" fontSizePx={16} color="#fff">1</Text>
    </Box>
    <Box background="#8b5cf6" borderRadius={8}>
      <Text font="NotoSansJP" fontSizePx={16} color="#fff">2</Text>
    </Box>
    <Box background="#ec4899" borderRadius={8}>
      <Text font="NotoSansJP" fontSizePx={16} color="#fff">3</Text>
    </Box>
  </Grid>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 400, height: 200, background: "#0f172a" },
        core.Grid(
          {
            templateColumns: "1fr 1fr 1fr",
            gap: 12,
            width: 400,
            height: 200,
            padding: 16,
          },
          core.Box(
            { background: "#3b82f6", borderRadius: 8 },
            core.Text({ font: "NotoSansJP", fontSizePx: 16, color: "#fff" }, "1"),
          ),
          core.Box(
            { background: "#8b5cf6", borderRadius: 8 },
            core.Text({ font: "NotoSansJP", fontSizePx: 16, color: "#fff" }, "2"),
          ),
          core.Box(
            { background: "#ec4899", borderRadius: 8 },
            core.Text({ font: "NotoSansJP", fontSizePx: 16, color: "#fff" }, "3"),
          ),
        ),
      ),
  },

  // --- Flex row ---
  {
    id: "flex-row",
    code: `<Canvas width={400} height={120} background="#0f172a">
  <Flex
    direction="row"
    gap={16}
    alignItems="center"
    width={400}
    height={120}
    padding={16}
  >
    <Box width={80} height={80} background="#3b82f6" borderRadius={8} />
    <Box width={80} height={80} background="#8b5cf6" borderRadius={8} />
    <Box width={80} height={80} background="#ec4899" borderRadius={8} />
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 400, height: 120, background: "#0f172a" },
        core.Flex(
          {
            direction: "row",
            gap: 16,
            alignItems: "center",
            width: 400,
            height: 120,
            padding: 16,
          },
          core.Box({ width: 80, height: 80, background: "#3b82f6", borderRadius: 8 }),
          core.Box({ width: 80, height: 80, background: "#8b5cf6", borderRadius: 8 }),
          core.Box({ width: 80, height: 80, background: "#ec4899", borderRadius: 8 }),
        ),
      ),
  },

  // --- Flex space-between ---
  {
    id: "flex-space-between",
    code: `<Canvas width={400} height={100} background="#0f172a">
  <Flex
    direction="row"
    justifyContent="space-between"
    alignItems="center"
    width={400}
    height={100}
    padding={16}
  >
    <Box width={60} height={60} background="#3b82f6" borderRadius={8} />
    <Box width={60} height={60} background="#8b5cf6" borderRadius={8} />
    <Box width={60} height={60} background="#ec4899" borderRadius={8} />
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 400, height: 100, background: "#0f172a" },
        core.Flex(
          {
            direction: "row",
            justifyContent: "space-between",
            alignItems: "center",
            width: 400,
            height: 100,
            padding: 16,
          },
          core.Box({ width: 60, height: 60, background: "#3b82f6", borderRadius: 8 }),
          core.Box({ width: 60, height: 60, background: "#8b5cf6", borderRadius: 8 }),
          core.Box({ width: 60, height: 60, background: "#ec4899", borderRadius: 8 }),
        ),
      ),
  },

  // --- Text basic ---
  {
    id: "text-basic",
    code: `<Canvas width={400} height={80} background="#ffffff">
  <Flex
    direction="column"
    justifyContent="center"
    width={400}
    height={80}
    padding={16}
  >
    <Text font="NotoSansJP" fontSizePx={24} color="#333333">
      Hello, boundsvg!
    </Text>
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 400, height: 80, background: "#ffffff" },
        core.Flex(
          {
            direction: "column",
            justifyContent: "center",
            width: 400,
            height: 80,
            padding: 16,
          },
          core.Text({ font: "NotoSansJP", fontSizePx: 24, color: "#333333" }, "Hello, boundsvg!"),
        ),
      ),
  },

  // --- Text wrap ---
  {
    id: "text-wrap",
    code: `<Canvas width={300} height={120} background="#ffffff">
  <Flex width={300} height={120} padding={16}>
    <Text font="NotoSansJP" fontSizePx={16} color="#333" wrap="word">
      This is a long sentence that will wrap at word boundaries
      when the text exceeds the available width.
    </Text>
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 300, height: 120, background: "#ffffff" },
        core.Flex(
          { width: 300, height: 120, padding: 16 },
          core.Text(
            { font: "NotoSansJP", fontSizePx: 16, color: "#333333", wrap: "word" },
            "This is a long sentence that will wrap at word boundaries when the text exceeds the available width.",
          ),
        ),
      ),
  },

  // --- Text shrink ---
  {
    id: "text-shrink",
    code: `<Canvas width={300} height={80} background="#1e1b4b">
  <Flex width={300} height={80} padding={12}
    justifyContent="center" alignItems="center">
    <Text font="NotoSansJP" fontSizePx={48}
      color="#c4b5fd" fit="shrink" minFontSizePx={12}>
      This text shrinks to fit
    </Text>
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 300, height: 80, background: "#1e1b4b" },
        core.Flex(
          {
            width: 300,
            height: 80,
            padding: 12,
            justifyContent: "center",
            alignItems: "center",
          },
          core.Text(
            {
              font: "NotoSansJP",
              fontSizePx: 48,
              color: "#c4b5fd",
              fit: "shrink",
              minFontSizePx: 12,
            },
            "This text shrinks to fit",
          ),
        ),
      ),
  },

  // --- Text ellipsis ---
  {
    id: "text-ellipsis",
    code: `<Canvas width={300} height={60} background="#ffffff">
  <Flex width={300} height={60} padding={12}>
    <Text font="NotoSansJP" fontSizePx={16} color="#333"
      maxLines={1} ellipsis wrap="char">
      This very long text will be truncated with an ellipsis character at the end
    </Text>
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 300, height: 60, background: "#ffffff" },
        core.Flex(
          { width: 300, height: 60, padding: 12 },
          core.Text(
            {
              font: "NotoSansJP",
              fontSizePx: 16,
              color: "#333333",
              maxLines: 1,
              ellipsis: true,
              wrap: "char",
            },
            "This very long text will be truncated with an ellipsis character at the end",
          ),
        ),
      ),
  },

  // --- Text vertical ---
  {
    id: "text-vertical",
    code: `<Canvas width={200} height={300} background="#0b1020">
  <Flex width={200} height={300} padding={20}
    justifyContent="center" alignItems="center">
    <Text font="NotoSansJP" fontSizePx={24} color="#fef3c7"
      writingMode="vertical-rl" language="ja" wrap="char">
      縦書きの日本語テキスト
    </Text>
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 200, height: 300, background: "#0b1020" },
        core.Flex(
          {
            width: 200,
            height: 300,
            padding: 20,
            justifyContent: "center",
            alignItems: "center",
          },
          core.Text(
            {
              font: "NotoSansJP",
              fontSizePx: 24,
              color: "#fef3c7",
              writingMode: "vertical-rl",
              language: "ja",
              wrap: "char",
            },
            "縦書きの日本語テキスト",
          ),
        ),
      ),
  },

  // --- Text stroke ---
  {
    id: "text-stroke",
    code: `<Canvas width={400} height={80} background="#0f172a">
  <Flex width={400} height={80} padding={16}
    justifyContent="center" alignItems="center">
    <Text font="NotoSansJP" fontSizePx={32}
      color="#ffffff" textStroke="#3b82f6" textStrokeWidth={2}>
      Outlined Text
    </Text>
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 400, height: 80, background: "#0f172a" },
        core.Flex(
          {
            width: 400,
            height: 80,
            padding: 16,
            justifyContent: "center",
            alignItems: "center",
          },
          core.Text(
            {
              font: "NotoSansJP",
              fontSizePx: 32,
              color: "#ffffff",
              textStroke: "#3b82f6",
              textStrokeWidth: 2,
            },
            "Outlined Text",
          ),
        ),
      ),
  },

  // --- Path ---
  {
    id: "path-bezier",
    code: `<Canvas width={240} height={140} background="#ffffff">
  <Flex width={240} height={140} padding={16}
    justifyContent="center" alignItems="center">
    <Path
      d="M10 80 Q 95 10 180 80"
      width={200}
      height={100}
      fill="none"
      stroke="#3b82f6"
      strokeWidth={3}
    />
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 240, height: 140, background: "#ffffff" },
        core.Flex(
          {
            width: 240,
            height: 140,
            padding: 16,
            justifyContent: "center",
            alignItems: "center",
          },
          core.Path({
            d: "M10 80 Q 95 10 180 80",
            width: 200,
            height: 100,
            fill: "none",
            stroke: "#3b82f6",
            strokeWidth: 3,
          }),
        ),
      ),
  },

  // --- Image (data URL) ---
  {
    id: "image-dataurl",
    code: `<Canvas width={300} height={220} background="#0f172a">
  <Flex width={300} height={220} padding={16}
    justifyContent="center" alignItems="center">
    <Image
      src="data:image/svg+xml;utf8,<svg ...>...</svg>"
      width={240}
      height={180}
      objectFit="contain"
    />
  </Flex>
</Canvas>`,
    build: (core) => {
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 240 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2a2a72"/><stop offset="100%" stop-color="#009ffd"/></linearGradient></defs><rect width="240" height="180" fill="url(#g)"/><circle cx="188" cy="42" r="22" fill="#ffd166" opacity="0.85"/><rect x="0" y="120" width="240" height="60" fill="#111827" opacity="0.5"/></svg>`;
      const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;
      return core.Canvas(
        { width: 300, height: 220, background: "#0f172a" },
        core.Flex(
          {
            width: 300,
            height: 220,
            padding: 16,
            justifyContent: "center",
            alignItems: "center",
          },
          core.Image({
            src: dataUrl,
            width: 240,
            height: 180,
            objectFit: "contain",
          }),
        ),
      );
    },
  },

  // --- Terminal-style split-pane code viewer ---
  {
    id: "terminal-code",
    code: `/* Split-pane terminal: source (left) + output (right) */`,
    build: (core) => {
      const canvasWidth = 780;
      const canvasHeight = 400;
      const FRAME_W = 740;
      const FRAME_H = 360;
      const HDR = 40;
      const FTR = 32;
      const GAP = 10;
      const CONTENT_H = FRAME_H - HDR - FTR;
      const PANE_PAD: [number, number, number, number] = [10, 12, 10, 12];
      const SRC_W = 410;
      const OUT_W = FRAME_W - 32 - SRC_W - GAP;
      const PANE_HDR = 30;
      const PANE_BODY = CONTENT_H - 28 - PANE_HDR;

      const srcFont = "JetBrainsMono";
      const outFont = "MonaspaceNeon";
      const srcFb = ["MonaspaceNeon", "NotoSansJP"];
      const outFb = ["JetBrainsMono", "NotoSansJP"];

      // Prism-style token colors
      const keywordColor = "#c084fc"; // keyword
      const punctuationColor = "#8b9fc6"; // punctuation
      const stringColor = "#86efac"; // string
      const functionColor = "#67e8f9"; // function
      const tagColor = "#7dd3fc"; // tag
      const tagPunctuationColor = "#5b8fb8"; // tag punctuation
      const attrNameColor = "#a5b4fc"; // attr-name
      const numberColor = "#fbbf24"; // number
      const tx = "#dbeafe"; // default text

      type Tok = { t: string; c: string };
      const srcLines: { n: string; tokens: Tok[] }[] = [
        // import { createEngineAsync } from "@boundsvg/core";
        {
          n: "01",
          tokens: [
            { t: "import", c: keywordColor },
            { t: " ", c: tx },
            { t: "{", c: punctuationColor },
            { t: " createEngineAsync ", c: tx },
            { t: "}", c: punctuationColor },
            { t: " ", c: tx },
            { t: "from", c: keywordColor },
            { t: " ", c: tx },
            { t: '"@boundsvg/core"', c: stringColor },
            { t: ";", c: punctuationColor },
          ],
        },
        // (blank)
        { n: "02", tokens: [] },
        // const engine = await createEngineAsync({ fonts });
        {
          n: "03",
          tokens: [
            { t: "const", c: keywordColor },
            { t: " engine ", c: tx },
            { t: "=", c: punctuationColor },
            { t: " ", c: tx },
            { t: "await", c: keywordColor },
            { t: " ", c: tx },
            { t: "createEngineAsync", c: functionColor },
            { t: "({", c: punctuationColor },
            { t: " fonts ", c: tx },
            { t: "});", c: punctuationColor },
          ],
        },
        // (blank)
        { n: "04", tokens: [] },
        // const svg = engine.renderToSvg(
        {
          n: "05",
          tokens: [
            { t: "const", c: keywordColor },
            { t: " svg ", c: tx },
            { t: "=", c: punctuationColor },
            { t: " engine.", c: tx },
            { t: "renderToSvg", c: functionColor },
            { t: "(", c: punctuationColor },
          ],
        },
        //   <Canvas width={960} height={540}>
        {
          n: "06",
          tokens: [
            { t: "  ", c: tx },
            { t: "<", c: tagPunctuationColor },
            { t: "Canvas", c: tagColor },
            { t: " ", c: tx },
            { t: "width", c: attrNameColor },
            { t: "=", c: punctuationColor },
            { t: "{", c: punctuationColor },
            { t: "960", c: numberColor },
            { t: "}", c: punctuationColor },
            { t: " ", c: tx },
            { t: "height", c: attrNameColor },
            { t: "=", c: punctuationColor },
            { t: "{", c: punctuationColor },
            { t: "540", c: numberColor },
            { t: "}", c: punctuationColor },
            { t: ">", c: tagPunctuationColor },
          ],
        },
        //     <Text font="Noto" fontSizePx={32}>
        {
          n: "07",
          tokens: [
            { t: "    ", c: tx },
            { t: "<", c: tagPunctuationColor },
            { t: "Text", c: tagColor },
            { t: " ", c: tx },
            { t: "font", c: attrNameColor },
            { t: "=", c: punctuationColor },
            { t: '"Noto"', c: stringColor },
            { t: " ", c: tx },
            { t: "fontSizePx", c: attrNameColor },
            { t: "=", c: punctuationColor },
            { t: "{", c: punctuationColor },
            { t: "32", c: numberColor },
            { t: "}", c: punctuationColor },
            { t: ">", c: tagPunctuationColor },
          ],
        },
        //       Hello, boundsvg!
        { n: "08", tokens: [{ t: "      Hello, boundsvg!", c: tx }] },
        //     </Text>
        {
          n: "09",
          tokens: [
            { t: "    ", c: tx },
            { t: "</", c: tagPunctuationColor },
            { t: "Text", c: tagColor },
            { t: ">", c: tagPunctuationColor },
          ],
        },
        //   </Canvas>,
        {
          n: "10",
          tokens: [
            { t: "  ", c: tx },
            { t: "</", c: tagPunctuationColor },
            { t: "Canvas", c: tagColor },
            { t: ">", c: tagPunctuationColor },
            { t: ",", c: punctuationColor },
          ],
        },
        // );
        {
          n: "11",
          tokens: [
            { t: ")", c: punctuationColor },
            { t: ";", c: punctuationColor },
          ],
        },
      ];

      const outLines = [
        { p: "$", text: "pnpm build && node render.mjs", color: "#dbeafe" },
        { p: ">", text: "building for production...", color: "#93c5fd" },
        { p: ">", text: "SVG: 12.4 kB (path mode)", color: "#86efac" },
        { p: ">", text: "PNG: 48.2 kB (scale=2)", color: "#86efac" },
        { p: "#", text: "rendered in 0.8 ms (p50)", color: "#6b7fa0" },
      ];

      const mkLine = (n: string, tokens: Tok[]) =>
        core.Flex(
          { direction: "row", alignItems: "start", gap: 8 },
          core.Text(
            { font: srcFont, fallback: srcFb, fontSizePx: 12, color: "#475569", wrap: "none" },
            n,
          ),
          tokens.length === 0
            ? core.Text(
                { font: srcFont, fallback: srcFb, fontSizePx: 12, color: tx, wrap: "none" },
                "\u00a0",
              )
            : core.Text(
                {
                  font: srcFont,
                  fallback: srcFb,
                  fontSizePx: 12,
                  color: tx,
                  wrap: "none",
                  // Leading indent is authored as a whitespace-only Inline, so it
                  // has to survive whitespace collapsing. Same reason as the
                  // animated terminal below.
                  whiteSpace: "pre-wrap",
                },
                ...tokens.map((tok) => core.Inline({ color: tok.c }, tok.t)),
              ),
        );

      const mkOut = (prompt: string, text: string, color: string) =>
        core.Flex(
          { direction: "row", alignItems: "start", gap: 8 },
          core.Text(
            { font: outFont, fallback: outFb, fontSizePx: 13, color: "#64748b", wrap: "none" },
            prompt,
          ),
          core.Text({ font: outFont, fallback: outFb, fontSizePx: 13, color, wrap: "none" }, text),
        );

      return core.Canvas(
        { width: canvasWidth, height: canvasHeight, background: "#020617" },
        core.Flex(
          {
            direction: "column",
            justifyContent: "center",
            alignItems: "center",
            width: canvasWidth,
            height: canvasHeight,
          },
          core.Box(
            {
              width: FRAME_W,
              height: FRAME_H,
              background: "#0b1329",
              borderWidth: 1,
              borderColor: "#1f2a4a",
              borderRadius: 14,
              overflow: "clip",
            },
            core.Flex(
              { direction: "column", width: FRAME_W, height: FRAME_H },
              // Header
              core.Flex(
                {
                  direction: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: FRAME_W,
                  height: HDR,
                  padding: [0, 14, 0, 14],
                  background: "#11162b",
                },
                core.Flex(
                  { direction: "row", alignItems: "center", gap: 8 },
                  core.Box({ width: 10, height: 10, background: "#f87171", borderRadius: 10 }),
                  core.Box({ width: 10, height: 10, background: "#fbbf24", borderRadius: 10 }),
                  core.Box({ width: 10, height: 10, background: "#34d399", borderRadius: 10 }),
                ),
                core.Text(
                  {
                    font: srcFont,
                    fallback: srcFb,
                    fontSizePx: 12,
                    color: "#8b9fc6",
                    wrap: "none",
                  },
                  "template://terminal-split",
                ),
              ),
              // Content: source + output panes
              core.Flex(
                {
                  direction: "row",
                  width: FRAME_W,
                  height: CONTENT_H,
                  padding: [14, 16, 14, 16],
                  background: "#0a0f21",
                  gap: GAP,
                  overflow: "clip",
                },
                // Source pane
                core.Flex(
                  {
                    direction: "column",
                    width: SRC_W,
                    background: "#0b1124",
                    borderWidth: 1,
                    borderColor: "#1b2748",
                    borderRadius: 10,
                    overflow: "clip",
                  },
                  core.Flex(
                    {
                      direction: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      height: PANE_HDR,
                      padding: [0, 12, 0, 12],
                      background: "#111935",
                    },
                    core.Text(
                      {
                        font: srcFont,
                        fallback: srcFb,
                        fontSizePx: 11,
                        color: "#93c5fd",
                        wrap: "none",
                      },
                      "source.tsx",
                    ),
                    core.Text(
                      {
                        font: srcFont,
                        fallback: srcFb,
                        fontSizePx: 11,
                        color: "#64748b",
                        wrap: "none",
                      },
                      "JetBrains Mono",
                    ),
                  ),
                  core.Flex(
                    {
                      direction: "column",
                      height: PANE_BODY,
                      padding: PANE_PAD,
                      background: "#0a1124",
                      gap: 3,
                      overflow: "clip",
                    },
                    ...srcLines.map((line) => mkLine(line.n, line.tokens)),
                  ),
                ),
                // Output pane
                core.Flex(
                  {
                    direction: "column",
                    width: OUT_W,
                    background: "#10172a",
                    borderWidth: 1,
                    borderColor: "#24304f",
                    borderRadius: 10,
                    overflow: "clip",
                  },
                  core.Flex(
                    {
                      direction: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      height: PANE_HDR,
                      padding: [0, 12, 0, 12],
                      background: "#172033",
                    },
                    core.Text(
                      {
                        font: outFont,
                        fallback: outFb,
                        fontSizePx: 11,
                        color: "#93c5fd",
                        wrap: "none",
                      },
                      "runtime.log",
                    ),
                    core.Text(
                      {
                        font: outFont,
                        fallback: outFb,
                        fontSizePx: 11,
                        color: "#64748b",
                        wrap: "none",
                      },
                      "Monaspace Neon",
                    ),
                  ),
                  core.Flex(
                    {
                      direction: "column",
                      height: PANE_BODY,
                      padding: PANE_PAD,
                      background: "#0d1426",
                      gap: 6,
                      overflow: "clip",
                    },
                    ...outLines.map((line) => mkOut(line.p, line.text, line.color)),
                  ),
                ),
              ),
              // Footer
              core.Flex(
                {
                  direction: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: FRAME_W,
                  height: FTR,
                  padding: [0, 14, 0, 14],
                  background: "#0d152d",
                },
                core.Text(
                  {
                    font: srcFont,
                    fallback: srcFb,
                    fontSizePx: 11,
                    color: "#86efac",
                    wrap: "none",
                  },
                  "WASM + rustybuzz + Taffy",
                ),
                core.Text(
                  {
                    font: outFont,
                    fallback: outFb,
                    fontSizePx: 11,
                    color: "#8b9fc6",
                    wrap: "none",
                  },
                  "JetBrains Mono | Monaspace Neon",
                ),
              ),
            ),
          ),
        ),
      );
    },
  },

  // --- Terminal scene with debug overlay (measured bounds) ---
  {
    id: "terminal-code-bounds",
    code: `/* Same scene with { debug: true }: cyan = allotted layout box, green = resolved layout,
   red = measured glyph bounds, amber = baselines */
const svg = engine.renderToSvg(vnode, { debug: true });`,
    build: (core) => {
      const base = EXAMPLES.find((example) => example.id === "terminal-code");
      if (!base) {
        throw new Error("terminal-code example not found");
      }
      return base.build(core);
    },
    renderOptions: { debug: true },
  },

  // --- Self-animating terminal (declarative SVG, README hero) ---
  {
    id: "terminal-typing",
    code: `/* Self-animating terminal: one declarative SVG, no script, no runtime */`,
    build: (core) => {
      const { Box, Canvas, Inline, Text } = core;
      const MONO = "JetBrainsMono";
      const SANS = "NotoSansJP";
      const CANVAS_W = 720;
      const CANVAS_H = 360;
      const SCREEN = "#0b1220";
      const FONT_PX = 18;
      const LINE_H = 1.45;
      // JetBrains Mono advances every glyph by 0.6 em, which is what lets the
      // wipe below land exactly one character per easing step.
      const ADVANCE = FONT_PX * 0.6;
      const ROW = Math.round(FONT_PX * LINE_H);
      const LEFT = 54;
      const TOP = 94;
      const WIDTH = 612;
      const PROMPT = "$ ";
      const COMMAND = "pnpm test --filter @boundsvg/core";
      const DURATION = 4_000;
      // Roughly 44 ms per keystroke, a beat before the runner starts, then a
      // held PASS so the payoff is on screen for most of a casual glance.
      const TYPING_END = 0.3;
      const RUN_START = 0.34;
      const RUN_END = 0.7;
      const CELLS = 12;
      const SPINNER = ["▖", "▘", "▝", "▗"];
      const INK = {
        prompt: "#4ade80",
        command: "#e2e8f0",
        pass: "#4ade80",
        running: "#fbbf24",
        path: "#93c5fd",
        muted: "#94a3b8",
        dim: "#64748b",
        caret: "#22d3ee",
      };

      /** Step-holds a node hidden until `from`, and hides it again at `to`. */
      const reveal = (from: number, to: number | null) => {
        const closing = to !== null && to < 1;
        const keyframes: Array<{ at: number; opacity: number }> = [];
        if (from > 0) {
          keyframes.push({ at: 0, opacity: 0 });
        }
        keyframes.push({ at: from, opacity: 1 });
        if (closing) {
          keyframes.push({ at: to, opacity: 0 });
        }
        keyframes.push({ at: 1, opacity: closing ? 0 : 1 });
        return {
          keyframes,
          durationMs: DURATION,
          easing: "step-end" as const,
          iterations: "infinite" as const,
          fill: "both" as const,
        };
      };

      const line = (
        row: number,
        segments: Array<{ text: string; color: string }>,
        animate: ReturnType<typeof reveal>,
        left = LEFT,
      ) =>
        Text(
          {
            position: "absolute",
            left,
            top: TOP + row * ROW,
            width: WIDTH,
            font: MONO,
            fallback: [SANS],
            fontSizePx: FONT_PX,
            lineHeight: LINE_H,
            // Each output line is its own node, so the leading indent has to
            // survive whitespace collapsing.
            whiteSpace: "pre-wrap",
            color: INK.command,
            wrap: "none",
            animate,
          },
          ...segments.map((segment) => Inline({ color: segment.color }, segment.text)),
        );

      const runStep = (RUN_END - RUN_START) / CELLS;
      const barLeft = LEFT + 11 * ADVANCE;
      const runRow = 6;

      return Canvas(
        { width: CANVAS_W, height: CANVAS_H, background: "#070b14" },
        Box({
          position: "absolute",
          left: 24,
          top: 22,
          width: 672,
          height: 316,
          borderRadius: 18,
          background: SCREEN,
          borderWidth: 1,
          borderColor: "#164e63",
        }),
        Box({
          position: "absolute",
          left: 24,
          top: 22,
          width: 672,
          height: 46,
          borderRadius: 18,
          background: "#111827",
        }),
        ...["#fb7185", "#fbbf24", "#4ade80"].map((background, index) =>
          Box({
            position: "absolute",
            left: 44 + index * 20,
            top: 39,
            width: 10,
            height: 10,
            borderRadius: 5,
            background,
          }),
        ),
        Text(
          {
            position: "absolute",
            left: 280,
            top: 34,
            width: 240,
            font: MONO,
            fallback: [SANS],
            fontSizePx: 12,
            color: "#64748b",
            textAlign: "center",
            wrap: "none",
          },
          "boundsvg — test runner",
        ),
        Box({
          position: "absolute",
          left: 586,
          top: 34,
          width: 86,
          height: 24,
          borderRadius: 12,
          background: "#0f2733",
        }),
        // The badge label is three stacked stills; only one is ever painted.
        ...(
          [
            ["TYPING", INK.caret, reveal(0, RUN_START)],
            ["RUNNING", INK.running, reveal(RUN_START, RUN_END)],
            ["PASS", INK.pass, reveal(RUN_END, null)],
          ] as const
        ).map(([label, color, animate]) =>
          Text(
            {
              position: "absolute",
              left: 600,
              top: 39,
              width: 58,
              font: MONO,
              fallback: [SANS],
              fontSizePx: 10,
              color,
              textAlign: "center",
              wrap: "none",
              animate,
            },
            label,
          ),
        ),
        // Command line: the full string is laid out once, then a
        // background-colored cover slides off it one glyph advance per step.
        Box(
          {
            position: "absolute",
            left: LEFT,
            top: TOP,
            width: WIDTH,
            height: ROW,
            background: SCREEN,
            overflow: "clip",
          },
          Text(
            {
              position: "absolute",
              left: 0,
              top: 0,
              width: WIDTH,
              font: MONO,
              fallback: [SANS],
              fontSizePx: FONT_PX,
              lineHeight: LINE_H,
              color: INK.command,
              wrap: "none",
            },
            Inline({ color: INK.prompt }, PROMPT),
            COMMAND,
          ),
          Box(
            {
              position: "absolute",
              left: PROMPT.length * ADVANCE,
              top: 0,
              width: COMMAND.length * ADVANCE,
              height: ROW,
              background: SCREEN,
              animate: {
                keyframes: [
                  { at: 0, transform: { translateX: 0 } },
                  { at: TYPING_END, transform: { translateX: COMMAND.length * ADVANCE } },
                  { at: 1, transform: { translateX: COMMAND.length * ADVANCE } },
                ],
                durationMs: DURATION,
                easing: { type: "steps", count: COMMAND.length, position: "jump-end" },
                iterations: "infinite",
                fill: "both",
              },
            },
            // Riding the cover's leading edge keeps the caret with the
            // keystrokes without any per-character layout.
            Box({
              position: "absolute",
              left: 0,
              top: 3,
              width: 2,
              height: 20,
              borderRadius: 1,
              background: INK.caret,
              animate: {
                keyframes: [
                  { at: 0, opacity: 1 },
                  { at: 1, opacity: 0 },
                ],
                durationMs: 560,
                easing: { type: "steps", count: 2, position: "jump-none" },
                iterations: "infinite",
                fill: "both",
              },
            }),
          ),
        ),
        line(
          2,
          [
            { text: " RUNS ", color: INK.running },
            { text: " packages/core", color: INK.muted },
          ],
          reveal(RUN_START, null),
        ),
        line(
          3,
          [
            { text: " ✓ ", color: INK.pass },
            { text: "typing-ime.test.ts", color: INK.path },
            { text: "   312ms", color: INK.dim },
          ],
          reveal(0.45, null),
        ),
        line(
          4,
          [
            { text: " ✓ ", color: INK.pass },
            { text: "text-on-path.test.ts", color: INK.path },
            { text: " 268ms", color: INK.dim },
          ],
          reveal(0.57, null),
        ),
        // Run indicator: the spinner cycles as one stacked still per step, and
        // the bar is plain boxes rather than block glyphs so the file stays
        // small. Both advance on the same step, so they never drift apart.
        ...Array.from({ length: CELLS }, (_unused, step) =>
          line(
            runRow,
            [{ text: SPINNER[step % SPINNER.length] ?? "", color: INK.running }],
            reveal(RUN_START + step * runStep, RUN_START + (step + 1) * runStep),
          ),
        ),
        line(runRow, [{ text: "  running", color: INK.muted }], reveal(RUN_START, RUN_END)),
        Box({
          position: "absolute",
          left: barLeft,
          top: TOP + runRow * ROW + 9,
          width: CELLS * 14,
          height: 10,
          borderRadius: 2,
          background: "#1e293b",
          animate: reveal(RUN_START, RUN_END),
        }),
        ...Array.from({ length: CELLS }, (_unused, cell) =>
          Box({
            position: "absolute",
            left: barLeft + cell * 14,
            top: TOP + runRow * ROW + 9,
            width: 11,
            height: 10,
            borderRadius: 2,
            background: INK.pass,
            animate: reveal(RUN_START + cell * runStep, RUN_END),
          }),
        ),
        line(
          runRow,
          [
            { text: " PASS ", color: INK.pass },
            { text: " 2 suites", color: INK.command },
            { text: "  in 2.4s", color: INK.dim },
          ],
          reveal(RUN_END, null),
        ),
      );
    },
    // Freeze the base pose inside the PASS hold, so a renderer that does not
    // run CSS animations shows a completed run rather than an empty terminal.
    renderOptions: { animation: "declarative", timeMs: 3_200 },
  },

  // --- Vertical Japanese text with Ruby ---
  {
    id: "vertical-ruby-ja",
    code: `<Canvas width={200} height={300} background="#0b1020">
  <Flex direction="row" justifyContent="center" alignItems="center"
    width={200} height={300} padding={[32, 24, 32, 24]}>
    <Text font="NotoSansJP" fontSizePx={22}
      color="#f8fafc" textStroke="#172033" textStrokeWidth={0.8}
      writingMode="vertical-rl" language="ja" wrap="char"
      lineHeight={2.0}>
      <Ruby>境界<Rt color="#bae6fd">きょうかい</Rt></Ruby>
      内に文字を手軽に配置。
      <Ruby>縦組<Rt color="#bae6fd">たてぐみ</Rt></Ruby>
      ・ルビ・
      <Ruby>禁則<Rt color="#bae6fd">きんそく</Rt></Ruby>
      まで自動で組版。
    </Text>
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 200, height: 300, background: "#0b1020" },
        core.Flex(
          {
            direction: "row",
            justifyContent: "center",
            alignItems: "center",
            width: 200,
            height: 300,
            padding: [32, 24, 32, 24],
          },
          core.Text(
            {
              font: "NotoSansJP",
              fontSizePx: 22,
              color: "#f8fafc",
              textStroke: "#172033",
              textStrokeWidth: 0.8,
              writingMode: "vertical-rl",
              language: "ja",
              wrap: "char",
              lineHeight: 2.0,
            },
            core.Ruby({}, "境界", core.Rt({ color: "#bae6fd" }, "きょうかい")),
            "内に文字を手軽に配置。",
            core.Ruby({}, "縦組", core.Rt({ color: "#bae6fd" }, "たてぐみ")),
            "・ルビ・",
            core.Ruby({}, "禁則", core.Rt({ color: "#bae6fd" }, "きんそく")),
            "まで自動で組版。",
          ),
        ),
      ),
  },

  // --- Quick start hello world ---
  {
    id: "quickstart-hello",
    code: `<Canvas width={600} height={200} background="#ffffff">
  <Flex
    direction="column"
    alignItems="center"
    justifyContent="center"
    width={600}
    height={200}
  >
    <Text font="NotoSansJP" fontSizePx={32} color="#333333">
      Hello, boundsvg!
    </Text>
  </Flex>
</Canvas>`,
    build: (core) =>
      core.Canvas(
        { width: 600, height: 200, background: "#ffffff" },
        core.Flex(
          {
            direction: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 600,
            height: 200,
          },
          core.Text({ font: "NotoSansJP", fontSizePx: 32, color: "#333333" }, "Hello, boundsvg!"),
        ),
      ),
  },

  // --- Debug bbox overlay ---
  {
    id: "debug-bbox",
    code: `const vnode = (
  <Canvas width={420} height={180} background="#0f172a">
    <Flex
      id="preview"
      direction="row"
      gap={14}
      width={420}
      height={180}
      padding={18}
      alignItems="center"
    >
      <Box id="thumbnail" width={128} height={120} background="#155e75" borderRadius={8} />
      <Flex id="copy" direction="column" gap={8} width={230}>
        <Text id="title" font="NotoSansJP" fontSizePx={22} color="#f8fafc">
          Inspect a scene
        </Text>
        <Text
          id="body"
          font="NotoSansJP"
          fontSizePx={14}
          color="#cbd5e1"
          preferredFrame={{ w: 220 }}
          wrap="word"
        >
          Check bboxes, draw order, handlers, warnings, and text overflow.
        </Text>
      </Flex>
    </Flex>
  </Canvas>
);

const svg = engine.renderToSvg(vnode, { debug: true });`,
    renderOptions: { debug: true },
    build: (core) =>
      core.Canvas(
        { width: 420, height: 180, background: "#0f172a" },
        core.Flex(
          {
            id: "preview",
            direction: "row",
            gap: 14,
            width: 420,
            height: 180,
            padding: 18,
            alignItems: "center",
          },
          core.Box({
            id: "thumbnail",
            width: 128,
            height: 120,
            background: "#155e75",
            borderRadius: 8,
          }),
          core.Flex(
            {
              id: "copy",
              direction: "column",
              gap: 8,
              width: 230,
            },
            core.Text(
              { id: "title", font: "NotoSansJP", fontSizePx: 22, color: "#f8fafc" },
              "Inspect a scene",
            ),
            core.Text(
              {
                id: "body",
                font: "NotoSansJP",
                fontSizePx: 14,
                color: "#cbd5e1",
                preferredFrame: { w: 220 },
                wrap: "word",
              },
              "Check bboxes, draw order, handlers, warnings, and text overflow.",
            ),
          ),
        ),
      ),
  },

  // --- Utility components layout ---
  {
    id: "extras-layout",
    code: `import { Canvas, Box, Text } from "@boundsvg/core";
import { Center, FitText, HStack, ImageCover, VStack } from "@boundsvg/extras";

const coverSvg =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">' +
      '<rect width="160" height="120" fill="#164e63"/>' +
      '<circle cx="116" cy="36" r="24" fill="#facc15"/>' +
      '<path d="M0 92 44 54 78 82 110 50 160 94v26H0z" fill="#22c55e"/>' +
    '</svg>',
  );

const vnode = (
  <Canvas width={460} height={220} background="#111827">
    {Center({ width: 460, height: 220 },
      HStack({ gap: 16, padding: 18, width: 432, height: 172 },
        Box({ width: 150, height: 132, overflow: "clip", borderRadius: 8 },
          ImageCover({ src: coverSvg, width: 150, height: 132 }),
        ),
        VStack({ gap: 10, width: 230 },
          FitText({
            font: "NotoSansJP",
            fontSizePx: 28,
            color: "#f8fafc",
            preferredFrame: { w: 220, h: 42 },
          }, "Utility layout"),
          Text({
            font: "NotoSansJP",
            fontSizePx: 14,
            color: "#cbd5e1",
            preferredFrame: { w: 220 },
            wrap: "word",
          }, "Compose reusable, unstyled layout helpers without changing the SVG model."),
        ),
      ),
    )}
  </Canvas>
);`,
    build: (core) => {
      const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#164e63"/><circle cx="116" cy="36" r="24" fill="#facc15"/><path d="M0 92 44 54 78 82 110 50 160 94v26H0z" fill="#22c55e"/></svg>`;
      const coverDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(coverSvg)}`;
      return core.Canvas(
        { width: 460, height: 220, background: "#111827" },
        core.Flex(
          {
            width: 460,
            height: 220,
            alignItems: "center",
            justifyContent: "center",
          },
          core.Flex(
            {
              direction: "row",
              gap: 16,
              padding: 18,
              width: 432,
              height: 172,
            },
            core.Box(
              { width: 150, height: 132, overflow: "clip", borderRadius: 8 },
              core.Image({ src: coverDataUrl, width: 150, height: 132, objectFit: "cover" }),
            ),
            core.Flex(
              { direction: "column", gap: 10, width: 230 },
              core.Text(
                {
                  font: "NotoSansJP",
                  fontSizePx: 28,
                  color: "#f8fafc",
                  preferredFrame: { w: 220, h: 42 },
                  fit: "shrink",
                },
                "Utility layout",
              ),
              core.Text(
                {
                  font: "NotoSansJP",
                  fontSizePx: 14,
                  color: "#cbd5e1",
                  preferredFrame: { w: 220 },
                  wrap: "word",
                },
                "Compose reusable, unstyled layout helpers without changing the SVG model.",
              ),
            ),
          ),
        ),
      );
    },
  },

  // --- Text flow around a figure (README demo: wrap + fit + exclusions) ---
  {
    id: "figure-flow",
    code: `// Heading: fit="shrink" scales the font until the line fits its box.
const heading = Text(
  { font: "NotoSansJP", fontSizePx: 44, minFontSizePx: 16,
    fit: "shrink", wrap: "none", color: "#f8fafc" },
  "図版に本文が回り込み、見出しは幅に合わせて縮む",
);

// Body: the paragraph flows around the chart's circular exclusion.
const flow = engine.layoutTextFlowWithExclusions({
  text: "本文は図版の輪郭を避けて自動で流し込まれます。…",
  fontFamily: "NotoSansJP", fontSizePx: 15, lineHeight: 1.8,
  language: "ja", wrap: "char",
  flowBox: { x: 28, y: 104, width: 704, height: 168 },
  exclusions: [{ kind: "circle", cx: 660, cy: 212, r: 58, marginPx: 20 }],
});
// Each returned fragment renders as an absolutely positioned Text box.`,
    prepare: ({ engine }) => {
      const result = engine.layoutTextFlowWithExclusions({
        text:
          "本文は図版の輪郭を避けて自動で流し込まれます。円・四角形・パスを排他領域として渡すだけで、" +
          "折り返し位置は WASM 内のテキスト計測と日本語の禁則処理から決まり、ブラウザや OS フォントには依存しません。" +
          "同じ入力からは常に同じ SVG が生成されるため、スナップショットにも使えます。" +
          "チャートやバッジ、画像の枠のような図版を避けて本文を組む、雑誌風のレイアウトをそのまま宣言できます。" +
          "余白は marginPx、あふれる場合は maxLines と ellipsis で制御します。",
        fontFamily: "NotoSansJP",
        fontSizePx: 15,
        lineHeight: 1.8,
        language: "ja",
        wrap: "char",
        flowBox: { x: 28, y: 104, width: 704, height: 168 },
        exclusions: [{ kind: "circle", cx: 660, cy: 212, r: 58, marginPx: 20 }],
      });
      figureFlowFragments = result.lines.flatMap((line) =>
        line.fragments.map((fragment) => ({
          x: fragment.x,
          y: fragment.y,
          availableInlineSizePx: fragment.availableInlineSizePx,
          text: fragment.text,
        })),
      );
    },
    build: (core) => {
      const cx = 660;
      const cy = 212;
      const outerR = 58;
      const innerR = 36;
      // 62% wedge, clockwise from 12 o'clock (223.2°).
      const wedgeEndX = cx - 39.7;
      const wedgeEndY = cy + 42.3;
      const circlePath = (r: number) =>
        `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
      // A bare Path participates in flex layout; anchor each one to the canvas.
      const figurePath = (d: string, fill: string) =>
        core.Box(
          { position: "absolute", left: 0, top: 0, width: 760, height: 300 },
          core.Path({ d, width: 760, height: 300, fill }),
        );
      const lineHeightPx = 15 * 1.8;
      return core.Canvas(
        { width: 760, height: 300, background: "#0b1020" },
        core.Box(
          { position: "absolute", left: 28, top: 24, width: 704, height: 56 },
          core.Text(
            {
              font: "NotoSansJP",
              fontSizePx: 44,
              minFontSizePx: 16,
              fit: "shrink",
              wrap: "none",
              color: "#f8fafc",
            },
            "図版に本文が回り込み、見出しは幅に合わせて縮む",
          ),
        ),
        figurePath(circlePath(outerR), "#1e3a5f"),
        figurePath(
          `M ${cx} ${cy} L ${cx} ${cy - outerR} A ${outerR} ${outerR} 0 1 1 ${wedgeEndX} ${wedgeEndY} Z`,
          "#38bdf8",
        ),
        figurePath(circlePath(innerR), "#0b1020"),
        core.Box(
          { position: "absolute", left: 620, top: 199, width: 80, height: 26 },
          core.Text(
            { font: "NotoSansJP", fontSizePx: 18, color: "#7dd3fc", textAlign: "center" },
            "62%",
          ),
        ),
        ...figureFlowFragments.map((fragment) =>
          core.Box(
            {
              position: "absolute",
              left: fragment.x,
              top: fragment.y,
              width: fragment.availableInlineSizePx,
              height: lineHeightPx,
              overflow: "clip",
            },
            core.Text(
              {
                font: "NotoSansJP",
                fontSizePx: 15,
                color: "#cbd5e1",
                language: "ja",
                wrap: "none",
                lineHeight: 1,
              },
              fragment.text,
            ),
          ),
        ),
      );
    },
  },
];

// ---------------------------------------------------------------------------
// SVG formatting helper
// ---------------------------------------------------------------------------

function formatSvg(raw: string): string {
  let indent = 0;
  const lines: string[] = [];
  const tokens = raw.replace(/>\s*</g, ">\n<").split("\n");
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("</")) {
      indent = Math.max(0, indent - 1);
    }
    lines.push("  ".repeat(indent) + trimmed);
    if (
      trimmed.startsWith("<") &&
      !trimmed.startsWith("</") &&
      !trimmed.endsWith("/>") &&
      !trimmed.includes("</")
    ) {
      indent++;
    }
  }
  return lines.join("\n");
}

function stripTrailingWhitespace(raw: string): string {
  return raw.replace(/[ \t]+$/gm, "");
}

function stylizeVerticalRubySvg(raw: string): string {
  let svg = raw;

  // Remove inherited stroke on the wrapping text group so we can style per path.
  svg = svg.replace(
    /\sstroke="[^"]*"\sstroke-width="[^"]*"\sstroke-linejoin="[^"]*"\spaint-order="[^"]*"/,
    "",
  );

  svg = svg.replace(/<path\b[^>]*\/>/g, (pathTag) => {
    const fillMatch = pathTag.match(/\sfill="([^"]+)"/);
    if (!fillMatch) {
      return pathTag;
    }
    const [, fillGroup = ""] = fillMatch;
    const fill = fillGroup.toLowerCase();

    let strokeWidth: string | null = null;
    if (fill === VERTICAL_RUBY_MAIN_FILL || fill === VERTICAL_RUBY_RT_FILL) {
      strokeWidth = fill === VERTICAL_RUBY_MAIN_FILL ? "0.8" : "0.55";
    }
    if (!strokeWidth) {
      return pathTag;
    }

    const withoutStroke = pathTag
      .replace(/\sstroke="[^"]*"/g, "")
      .replace(/\sstroke-width="[^"]*"/g, "")
      .replace(/\sstroke-linejoin="[^"]*"/g, "")
      .replace(/\spaint-order="[^"]*"/g, "");

    if (/\/>$/.test(withoutStroke)) {
      return withoutStroke.replace(
        /\s*\/>$/,
        ` stroke="${VERTICAL_RUBY_OUTLINE}" stroke-width="${strokeWidth}" stroke-linejoin="round" paint-order="stroke"/>`,
      );
    }
    return withoutStroke;
  });

  return svg;
}

function parseExampleIdFilter(args: string[]): Set<string> | null {
  const requestedIds: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--id" || arg === "--only") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${arg} requires an example id`);
      }
      requestedIds.push(...splitExampleIds(value));
      index++;
      continue;
    }
    if (arg.startsWith("--id=")) {
      requestedIds.push(...splitExampleIds(arg.slice("--id=".length)));
      continue;
    }
    if (arg.startsWith("--only=")) {
      requestedIds.push(...splitExampleIds(arg.slice("--only=".length)));
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    requestedIds.push(...splitExampleIds(arg));
  }

  const uniqueIds = new Set(requestedIds.filter((id) => id.length > 0));
  return uniqueIds.size > 0 ? uniqueIds : null;
}

function splitExampleIds(value: string): string[] {
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function selectExamples(exampleIdFilter: Set<string> | null): Example[] {
  if (!exampleIdFilter) {
    return EXAMPLES;
  }

  const availableIds = new Set(EXAMPLES.map((example) => example.id));
  const unknownIds = [...exampleIdFilter].filter((id) => !availableIds.has(id));
  if (unknownIds.length > 0) {
    throw new Error(
      `Unknown example id(s): ${unknownIds.join(", ")}. Available ids: ${[...availableIds].join(", ")}`,
    );
  }

  return EXAMPLES.filter((example) => exampleIdFilter.has(example.id));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const selectedExamples = selectExamples(parseExampleIdFilter(process.argv.slice(2)));

  // Ensure output directories exist
  fs.mkdirSync(OUT_SVG, { recursive: true });
  fs.mkdirSync(OUT_MD, { recursive: true });
  fs.mkdirSync(OUT_FIXTURE_SVG, { recursive: true });

  // Load fonts
  for (const fontPath of [FONT_PATH, FONT_JETBRAINS, FONT_MONASPACE]) {
    if (!fs.existsSync(fontPath)) {
      console.error(`Font not found: ${fontPath}`);
      process.exit(1);
    }
  }
  const fontData = new Uint8Array(fs.readFileSync(FONT_PATH));
  const jetbrainsData = new Uint8Array(fs.readFileSync(FONT_JETBRAINS));
  const monaspaceData = new Uint8Array(fs.readFileSync(FONT_MONASPACE));

  // Initialize engine
  const core = await loadCore();
  await initNodeWasm();
  const wasm = await loadCoreWasm();
  const engine = await core.createEngineAsync({
    fonts: [
      { alias: "NotoSansJP", weight: 400, style: "normal", data: fontData },
      { alias: "JetBrainsMono", weight: 400, style: "normal", data: jetbrainsData },
      { alias: "MonaspaceNeon", weight: 400, style: "normal", data: monaspaceData },
    ],
  });
  const rasterHandle = wasm.createWasmEngineInstance();
  const svgToPng = rasterHandle.createSvgToPngFn();

  console.info(`Generating ${selectedExamples.length} example(s)...`);

  for (const example of selectedExamples) {
    example.prepare?.({ core, engine });
    const vnode = example.build(core);

    let svg = engine.renderToSvg(vnode, example.renderOptions);
    if (example.id === "vertical-ruby-ja") {
      svg = stylizeVerticalRubySvg(svg);
    }
    svg = stripTrailingWhitespace(svg);
    const svgPath = path.join(OUT_SVG, `${example.id}.svg`);
    fs.writeFileSync(svgPath, svg);
    if (README_FIXTURE_IDS.has(example.id)) {
      const fixtureSvgPath = path.join(OUT_FIXTURE_SVG, `${example.id}.svg`);
      fs.writeFileSync(fixtureSvgPath, svg);
      // A self-animating scene has no single representative frame, so the
      // still companion is skipped rather than frozen at the loop start.
      if (example.renderOptions?.animation !== "declarative") {
        const fixturePngPath = path.join(OUT_FIXTURE_PNG, `${example.id}.png`);
        const png = svgToPng(svg, { scale: 2 });
        fs.writeFileSync(fixturePngPath, png);
      }
    }

    // Generate markdown snippet
    const markdown = `\`\`\`tsx
${example.code}
\`\`\`

<div class="example-output">
  <img src="/generated/${example.id}.svg" alt="${example.id} example" />
</div>

<details>
<summary>Generated SVG</summary>

\`\`\`xml
${formatSvg(svg)}
\`\`\`

</details>
`;

    const mdPath = path.join(OUT_MD, `${example.id}.md`);
    const formattedMarkdown = await formatWithPrettier(markdown, { parser: "markdown" });
    fs.writeFileSync(mdPath, formattedMarkdown);

    console.info(`  ${example.id}`);
  }

  engine.dispose();
  rasterHandle.dispose();
  console.info("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
