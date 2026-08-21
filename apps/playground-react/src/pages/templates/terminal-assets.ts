import { buildTerminalBoundsvgInput, type TerminalDesignInput } from "../../lib/terminal";

export const TEMPLATE_IMAGE_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 240 180">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#2a2a72"/>
        <stop offset="100%" stop-color="#009ffd"/>
      </linearGradient>
    </defs>
    <rect width="240" height="180" fill="url(#g)"/>
    <circle cx="188" cy="42" r="22" fill="#ffd166" opacity="0.85"/>
    <rect x="0" y="120" width="240" height="60" fill="#252526" opacity="0.5"/>
    <text x="16" y="156" font-size="20" fill="#ffffff" font-family="sans-serif">SVG Image</text>
  </svg>`,
)}`;

const TERMINAL_CODE_SNIPPET = `import { renderToSvg } from "@boundsvg/core";
import { Canvas, Flex, Text, toVNode } from "@boundsvg/react";

const vnode = toVNode(
  <Canvas width={960} height={420} background="#1e1e1e">
    <Flex direction="column" gap={12} padding={24}>
      <Text font="JetBrainsMono-woff2" fontSizePx={22} color="#e2e8f0" wrap="none">
        pnpm --filter @boundsvg/docs generate
      </Text>
    </Flex>
  </Canvas>,
);

console.log(renderToSvg(vnode));`;

const TERMINAL_TEMPLATE_INPUT: TerminalDesignInput = {
  code: TERMINAL_CODE_SNIPPET,
  language: "tsx",
  lineNumberStart: 1,
  fonts: {
    source: {
      alias: "JetBrainsMono-woff2",
      fallback: ["MonaspaceNeon-woff2", "NotoSansJP-woff2", "monospace"],
      label: "JetBrains Mono",
    },
    output: {
      alias: "MonaspaceNeon-woff2",
      fallback: ["JetBrainsMono-woff2", "NotoSansJP-woff2", "monospace"],
      label: "Monaspace Neon",
    },
  },
  layout: {
    splitDirection: "row",
    sourceWeight: 1.15,
    outputWeight: 0.85,
    gapPx: 14,
    sourceTitle: "source.tsx",
    outputTitle: "runtime.log",
  },
  outputLines: [
    {
      prompt: "$",
      text: "pnpm --filter @boundsvg/playground-react build --mode production --reporter append-only",
      color: "#dbeafe",
      wrap: "char",
    },
    {
      prompt: ">",
      text: "vite building for production...",
      color: "#93c5fd",
      wrap: "none",
    },
    {
      prompt: ">",
      text: "transforming modules and writing a long diagnostics line so narrow terminal panes stay readable with wrap=char.",
      color: "#86efac",
      wrap: "char",
    },
    {
      prompt: "#",
      text: "// Monaspace font relies on fallback rendering for CJK characters",
      color: "#6b7fa0",
      wrap: "char",
    },
    {
      prompt: ">",
      text: "asset index.js 452.45 kB | gzip 128.95 kB | chunk templates/terminal-split-pane.tsx",
      color: "#fbbf24",
      wrap: "char",
    },
    {
      prompt: "$",
      text: "npx boundsvg convert -i terminal.svg --default-font JetBrainsMono --text-path-mode merged",
      color: "#dbeafe",
      wrap: "char",
    },
  ],
  chrome: {
    routeLabel: "template://terminal-prism-split",
    footerLeft: 'left: Prism token color reproduction | right: wrap="char" terminal output',
    footerRight: "JetBrains Mono | Monaspace Neon",
  },
  licenseNotice: "Fonts: JetBrains Mono / Monaspace Neon (SIL OFL 1.1).",
};

export const TERMINAL_TEMPLATE = buildTerminalBoundsvgInput(TERMINAL_TEMPLATE_INPUT);
