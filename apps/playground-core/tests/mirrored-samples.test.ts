import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createEngineAsync, type Engine, type VNode } from "@boundsvg/core";
import { initNodeWasm } from "@boundsvg/core/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEMPLATE_DEFINITIONS } from "../../playground-react/src/pages/templates/definitions";
import {
  CJK_VARFONT_ALIAS,
  FONT_ALIAS,
  JETBRAINS_ALIAS,
  MONASPACE_ALIAS,
  VARFONT_ALIAS,
} from "../src/config";
import { presets } from "../src/presets/index";

const MIRRORED_SAMPLE_KEYS = [
  "decoration-path-fit",
  "font-fallback",
  "inline-primitives",
  "rich-text-on-path",
  "text-on-path-basics",
  "text-path-motion",
  "typing-ime-timeline",
  "variable-font",
  "vertical-rich-ellipsis",
] as const;

const KEYED_AUTO_NODE_ID_PATTERN = /^(auto:\d+(?:\.\d+)*):(.+)$/u;
const NODE_ID_ATTRIBUTE_PATTERN = /\bdata-boundsvg-node-id="([^"]+)"/gu;
const XML_ATTRIBUTE_PATTERN = /([\w:.-]+)="([^"]*)"/gu;
const XML_TAG_PATTERN = /<[^>]+>/gu;
const STYLE_ELEMENT_PATTERN = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gu;

type NodeIdMapping = ReadonlyMap<string, string>;

function font(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(__dirname, "../../../fixtures/fonts", filename)));
}

function buildReactTemplate(
  templateKey: (typeof MIRRORED_SAMPLE_KEYS)[number],
  engine: Engine,
): VNode {
  const definition = TEMPLATE_DEFINITIONS[templateKey];
  if (!definition) {
    throw new TypeError(`Missing React template: ${templateKey}`);
  }
  return definition.vnode ?? definition.build(engine);
}

function collectVNodeKeys(node: VNode): ReadonlySet<string> {
  const keys = new Set<string>();
  if (node.key !== null && node.key !== undefined) {
    keys.add(String(node.key));
  }
  for (const child of node.children) {
    if (typeof child !== "string") {
      for (const key of collectVNodeKeys(child)) {
        keys.add(key);
      }
    }
  }
  return keys;
}

function collectSvgNodeIds(svg: string): ReadonlySet<string> {
  return new Set(
    [...svg.matchAll(NODE_ID_ATTRIBUTE_PATTERN)]
      .map((match) => match[1])
      .filter((nodeId): nodeId is string => nodeId !== undefined),
  );
}

function collectKeyedAutoNodeIdMappings(
  svg: string,
  counterpartSvg: string,
  authoredKeys: ReadonlySet<string>,
): NodeIdMapping {
  const mapping = new Map<string, string>();
  const keyedIdByStructuralPrefix = new Map<string, string>();
  const counterpartNodeIds = collectSvgNodeIds(counterpartSvg);
  for (const match of svg.matchAll(NODE_ID_ATTRIBUTE_PATTERN)) {
    const nodeId = match[1];
    if (!nodeId) {
      continue;
    }
    const keyedAutoNodeId = KEYED_AUTO_NODE_ID_PATTERN.exec(nodeId);
    const structuralPrefix = keyedAutoNodeId?.[1];
    const keySuffix = keyedAutoNodeId?.[2];
    if (
      !structuralPrefix ||
      !keySuffix ||
      !authoredKeys.has(keySuffix) ||
      counterpartNodeIds.has(nodeId) ||
      !counterpartNodeIds.has(structuralPrefix)
    ) {
      continue;
    }
    const existingNodeId = keyedIdByStructuralPrefix.get(structuralPrefix);
    if (existingNodeId !== undefined && existingNodeId !== nodeId) {
      throw new TypeError(
        `Ambiguous keyed auto node IDs for ${structuralPrefix}: ${existingNodeId}, ${nodeId}`,
      );
    }
    keyedIdByStructuralPrefix.set(structuralPrefix, nodeId);
    mapping.set(nodeId, structuralPrefix);
  }
  return mapping;
}

function replaceMappedNodeIds(value: string, mapping: NodeIdMapping): string {
  let normalized = value;
  const longestFirst = [...mapping].sort(
    ([leftNodeId], [rightNodeId]) => rightNodeId.length - leftNodeId.length,
  );
  for (const [keyedNodeId, structuralPrefix] of longestFirst) {
    normalized = normalized.replaceAll(keyedNodeId, structuralPrefix);
  }
  return normalized;
}

function normalizeTagReferences(tag: string, mapping: NodeIdMapping): string {
  return tag.replace(
    XML_ATTRIBUTE_PATTERN,
    (attribute, attributeName: string, attributeValue: string) => {
      const isNodeIdDefinition = attributeName === "data-boundsvg-node-id";
      const isInternalIdDefinition = attributeName === "id";
      const isDirectReference =
        attributeName === "href" ||
        attributeName === "xlink:href" ||
        attributeName === "class" ||
        attributeName === "style";
      const isUrlReference = attributeValue.includes("url(#");
      if (!isNodeIdDefinition && !isInternalIdDefinition && !isDirectReference && !isUrlReference) {
        return attribute;
      }
      return `${attributeName}="${replaceMappedNodeIds(attributeValue, mapping)}"`;
    },
  );
}

function normalizeMirroredSvg(
  svg: string,
  counterpartSvg: string,
  authoredKeys: ReadonlySet<string>,
): { svg: string; normalizedKeyedNodeIds: number } {
  const mapping = collectKeyedAutoNodeIdMappings(svg, counterpartSvg, authoredKeys);
  const normalizedTags = svg.replace(XML_TAG_PATTERN, (tag) =>
    normalizeTagReferences(tag, mapping),
  );
  const normalizedSvg = normalizedTags.replace(
    STYLE_ELEMENT_PATTERN,
    (_style, openingTag: string, css: string, closingTag: string) =>
      `${openingTag}${replaceMappedNodeIds(css, mapping)}${closingTag}`,
  );
  return { svg: normalizedSvg, normalizedKeyedNodeIds: mapping.size };
}

describe("mirrored core and React samples", () => {
  let engine: Engine;

  beforeAll(async () => {
    await initNodeWasm();
    engine = await createEngineAsync({
      fonts: [
        {
          alias: FONT_ALIAS,
          weight: 400,
          style: "normal",
          data: font("NotoSansJP-Regular.subset.woff2"),
        },
        {
          alias: JETBRAINS_ALIAS,
          weight: 400,
          style: "normal",
          data: font("JetBrainsMono-Regular.woff2"),
        },
        {
          alias: MONASPACE_ALIAS,
          weight: 400,
          style: "normal",
          data: font("MonaspaceNeon-Regular.woff2"),
        },
        {
          alias: VARFONT_ALIAS,
          weight: 400,
          style: "normal",
          data: font("Inter-Variable.ttf"),
        },
        {
          alias: CJK_VARFONT_ALIAS,
          weight: 400,
          style: "normal",
          data: font("NotoSansCJKjp-VF.subset.ttf"),
        },
      ],
    });
  });

  afterAll(() => engine.dispose());

  it("renders all nine mirrored samples with semantic SVG equality", () => {
    const byteEqualKeys: string[] = [];
    const normalizedCounts = new Map<string, { core: number; react: number }>();

    for (const sampleKey of MIRRORED_SAMPLE_KEYS) {
      const preset = presets[sampleKey];
      expect(preset, `Missing core preset: ${sampleKey}`).toBeDefined();
      if (!preset) {
        continue;
      }
      const coreVNode = preset.build(engine);
      const reactVNode = buildReactTemplate(sampleKey, engine);
      const coreSvg = engine.renderToSvg(coreVNode);
      const reactSvg = engine.renderToSvg(reactVNode);
      if (coreSvg === reactSvg) {
        byteEqualKeys.push(sampleKey);
      }

      const normalizedCore = normalizeMirroredSvg(coreSvg, reactSvg, collectVNodeKeys(coreVNode));
      const normalizedReact = normalizeMirroredSvg(reactSvg, coreSvg, collectVNodeKeys(reactVNode));
      normalizedCounts.set(sampleKey, {
        core: normalizedCore.normalizedKeyedNodeIds,
        react: normalizedReact.normalizedKeyedNodeIds,
      });
      expect(normalizedReact.svg, `${sampleKey} semantic SVG`).toBe(normalizedCore.svg);
    }

    expect(byteEqualKeys).toEqual(
      MIRRORED_SAMPLE_KEYS.filter((key) => key !== "decoration-path-fit"),
    );
    expect(normalizedCounts.get("decoration-path-fit")).toEqual({ core: 0, react: 8 });
    for (const sampleKey of MIRRORED_SAMPLE_KEYS) {
      if (sampleKey !== "decoration-path-fit") {
        expect(normalizedCounts.get(sampleKey)).toEqual({ core: 0, react: 0 });
      }
    }
  });

  it("normalizes key-derived suffixes in definitions and references with one mapping", () => {
    const keyedSvg =
      '<svg data-boundsvg-node-id="auto:0"><defs><clipPath id="clip-auto:0.27:row-key"><rect/></clipPath></defs><g data-boundsvg-node-id="auto:0.27:row-key" clip-path="url(#clip-auto:0.27:row-key)"><use href="#clip-auto:0.27:row-key"/></g></svg>';
    const structuralSvg =
      '<svg data-boundsvg-node-id="auto:0"><defs><clipPath id="clip-auto:0.27"><rect/></clipPath></defs><g data-boundsvg-node-id="auto:0.27" clip-path="url(#clip-auto:0.27)"><use href="#clip-auto:0.27"/></g></svg>';

    const normalized = normalizeMirroredSvg(keyedSvg, structuralSvg, new Set(["row-key"]));
    expect(normalized.normalizedKeyedNodeIds).toBe(1);
    expect(normalized.svg).toBe(structuralSvg);
    expect(normalized.svg).toContain('data-boundsvg-node-id="auto:0.27"');
    expect(normalized.svg).toContain('clip-path="url(#clip-auto:0.27)"');
    expect(normalized.svg).toContain('href="#clip-auto:0.27"');
  });

  it.each([
    {
      regression: "explicit ID difference",
      expected:
        '<svg data-boundsvg-node-id="auto:0"><g data-boundsvg-node-id="hero" fill="#22d3ee"/></svg>',
      actual:
        '<svg data-boundsvg-node-id="auto:0"><g data-boundsvg-node-id="hero-copy" fill="#22d3ee"/></svg>',
    },
    {
      regression: "node reorder",
      expected:
        '<svg data-boundsvg-node-id="auto:0"><g data-boundsvg-node-id="auto:0.0" fill="#22d3ee"/><g data-boundsvg-node-id="auto:0.1" fill="#facc15"/></svg>',
      actual:
        '<svg data-boundsvg-node-id="auto:0"><g data-boundsvg-node-id="auto:0.0" fill="#facc15"/><g data-boundsvg-node-id="auto:0.1" fill="#22d3ee"/></svg>',
    },
    {
      regression: "broken reference",
      expected:
        '<svg data-boundsvg-node-id="auto:0"><defs><clipPath id="clip-auto:0.0"><rect/></clipPath></defs><g data-boundsvg-node-id="auto:0.0" clip-path="url(#clip-auto:0.0)"/></svg>',
      actual:
        '<svg data-boundsvg-node-id="auto:0"><defs><clipPath id="clip-auto:0.0:row-key"><rect/></clipPath></defs><g data-boundsvg-node-id="auto:0.0:row-key" clip-path="url(#missing)"/></svg>',
      actualKeys: ["row-key"],
    },
    {
      regression: "color difference",
      expected:
        '<svg data-boundsvg-node-id="auto:0"><g data-boundsvg-node-id="auto:0.0" fill="#22d3ee"/></svg>',
      actual:
        '<svg data-boundsvg-node-id="auto:0"><g data-boundsvg-node-id="auto:0.0" fill="#facc15"/></svg>',
    },
  ])("does not hide a $regression", ({ expected, actual, actualKeys = [] }) => {
    expect(normalizeMirroredSvg(actual, expected, new Set(actualKeys)).svg).not.toBe(
      normalizeMirroredSvg(expected, actual, new Set()).svg,
    );
  });
});
