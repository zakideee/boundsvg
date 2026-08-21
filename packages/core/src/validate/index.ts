import { FatalError } from "../errors.js";
import { assertNodeIdIsWellFormedUnicode } from "../ir/node-id.js";
import { assertLayoutTreeDepth } from "../layout/limits.js";
import { assertUniqueNodeIds } from "../node-ids.js";
import type { VNode, VNodeType } from "../vnode/types.js";
import { validateBoxShadowProp } from "./box-shadow.js";
import {
  validateGridNode,
  validateLayoutEnumAndGridProps,
  validateLayoutNumberProps,
} from "./layout-props.js";
import {
  validateInlineBoxNode,
  validateInlineNode,
  validateInlineRectNode,
  validateRichTextParent,
  validateRtNode,
  validateRubyNode,
  validateTextDecorationProp,
  validateTextNode,
  validateTextOnPathInlineNode,
  validateTextOnPathNode,
  validateTextOnPathNumericProps,
} from "./rich-text.js";
import {
  validateAnimationProp,
  validateColorProp,
  validateImageNode,
  validatePathNode,
  validateShapeNode,
  validateStrokeScalingProp,
  validateSvgNode,
  validateSymbolNode,
  validateTransformProp,
  validateVisualNumberProps,
} from "./visual-props.js";

/**
 * Validate a VNode tree.
 * Throws on structural violations (Fatal errors).
 */
export function validate(node: VNode): void {
  // Root must be Canvas
  if (node.type !== "Canvas") {
    throw new FatalError(
      "VALIDATION",
      `Validation error: root node must be Canvas, got "${node.type}"`,
      { stage: "validate", nodeId: nodeLabel(node) },
    );
  }

  const seenIds = new Set<string>();
  validateNode(node, seenIds, { insideCanvas: false, depth: 0 });
  assertUniqueNodeIds(node);
}

function nodeLabel(node: VNode): string {
  if ("id" in node.props && typeof node.props.id === "string") {
    return node.props.id;
  }
  return `<${node.type}>`;
}

function validateNode(
  node: VNode,
  seenIds: Set<string>,
  options: {
    insideCanvas: boolean;
    insideTextOnPath?: boolean;
    parentType?: VNodeType;
    depth: number;
  },
): void {
  const { insideCanvas, insideTextOnPath = false, parentType, depth } = options;
  assertLayoutTreeDepth(node, depth);
  const nid = nodeLabel(node);
  validateRichTextParent(node.type, parentType, nid);
  if (node.type === "Inline" && (insideTextOnPath || parentType === "TextOnPath")) {
    validateTextOnPathInlineNode(node, nid);
  }

  // Canvas cannot be nested
  if (node.type === "Canvas" && insideCanvas) {
    throw new FatalError("VALIDATION", "Validation error: Canvas cannot be nested", {
      stage: "validate",
      nodeId: nid,
    });
  }

  // Check for duplicate ids
  const id = "id" in node.props ? node.props.id : undefined;
  if (typeof id === "string") {
    assertNodeIdIsWellFormedUnicode(id);
    if (seenIds.has(id)) {
      throw new FatalError("VALIDATION", `Validation error: duplicate id "${id}"`, {
        stage: "validate",
        nodeId: id,
      });
    }
    seenIds.add(id);
  }

  // Validate color props (skip gradient strings for background)
  validateColorProp(node, "background", { allowGradient: true, nodeId: nid });
  validateColorProp(node, "borderColor", { nodeId: nid });
  if (node.type !== "InlineRect") {
    validateColorProp(node, "color", { nodeId: nid });
  }
  validateColorProp(node, "fill", {
    allowNone: node.type === "Path" || node.type === "Shape" || node.type === "Symbol",
    nodeId: nid,
  });
  validateColorProp(node, "stroke", {
    allowNone: node.type === "Path" || node.type === "Shape" || node.type === "Symbol",
    nodeId: nid,
  });
  validateTextDecorationProp(node, nid);
  if (node.type === "TextOnPath") {
    validateTextOnPathNumericProps(node, nid);
  }
  validateTransformProp(node, nid);
  validateAnimationProp(node, nid);
  validateStrokeScalingProp(node, nid);
  validateZIndexProp(node, nid);
  validateMetaProp(node, nid);
  validateLayoutNumberProps(node, nid);
  const props = node.props as Record<string, unknown>;
  validateVisualNumberProps(props, nid);
  validateLayoutEnumAndGridProps(node, nid);
  validateBoxShadowProp(props, nid);

  // Node-type-specific validation
  switch (node.type) {
    case "Text":
      validateTextNode(node, nid);
      break;
    case "TextOnPath":
      validateTextOnPathNode(node, nid);
      break;
    case "Inline":
      validateInlineNode(node, nid);
      break;
    case "InlineBox":
      validateInlineBoxNode(node, nid);
      break;
    case "InlineRect":
      validateInlineRectNode(node, nid);
      break;
    case "Ruby":
      validateRubyNode(node, nid);
      break;
    case "Rt":
      validateRtNode(node, nid);
      break;
    case "Grid":
      validateGridNode(node, nid);
      break;
    case "Image":
      validateImageNode(node, nid);
      break;
    case "Path":
      validatePathNode(node, nid);
      break;
    case "Svg":
      validateSvgNode(node, nid);
      break;
    case "Shape":
      validateShapeNode(node, nid);
      break;
    case "Symbol":
      validateSymbolNode(node, nid);
      break;
  }

  // Recurse into children. Text-bearing nodes (Text/Inline/Ruby/Rt) consume
  // string children; on layout containers a string child has no rendering
  // path — it used to be silently dropped from both the render and the
  // SceneDocument round-trip, so it is rejected instead.
  const isCanvas = node.type === "Canvas";
  for (const child of node.children) {
    if (typeof child === "string") {
      assertStringChildAllowed(node, child, nid);
      continue;
    }
    validateNode(child, seenIds, {
      insideCanvas: insideCanvas || isCanvas,
      insideTextOnPath: insideTextOnPath || node.type === "TextOnPath",
      parentType: node.type,
      depth: depth + 1,
    });
  }
}

const TEXT_BEARING_TYPES = new Set<VNodeType>([
  "Text",
  "TextOnPath",
  "Inline",
  "InlineBox",
  "Ruby",
  "Rt",
]);

function assertStringChildAllowed(node: VNode, child: string, nid: string): void {
  if (TEXT_BEARING_TYPES.has(node.type)) {
    return;
  }
  const preview = child.length > 40 ? `${child.slice(0, 40)}…` : child;
  throw new FatalError(
    "VALIDATION",
    `Validation error: <${node.type}> cannot have a string child (${JSON.stringify(preview)}); wrap it in <Text> (${nid})`,
    { stage: "validate", nodeId: nid },
  );
}

const Z_INDEX_SUPPORTED_TYPES = new Set<VNodeType>([
  "Flex",
  "Grid",
  "Box",
  "Text",
  "TextOnPath",
  "Image",
  "Path",
  "Svg",
  "Shape",
  "Symbol",
]);

const META_KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

const META_MAX_KEYS = 16;

const META_MAX_VALUE_LENGTH = 256;

function validateMetaProp(node: VNode, nid: string): void {
  const meta = Reflect.get(node.props as Record<string, unknown>, "meta");
  if (meta === undefined) {
    return;
  }
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw new FatalError("VALIDATION", `meta must be a string-to-string record (${nid}).`, {
      stage: "validate",
      nodeId: nid,
    });
  }
  const entries = Object.entries(meta as Record<string, unknown>);
  if (entries.length > META_MAX_KEYS) {
    throw new FatalError(
      "VALIDATION",
      `meta supports at most ${META_MAX_KEYS} keys, got ${entries.length} (${nid}).`,
      { stage: "validate", nodeId: nid },
    );
  }
  for (const [key, value] of entries) {
    if (!META_KEY_PATTERN.test(key)) {
      throw new FatalError(
        "VALIDATION",
        `meta key "${key}" must match ${META_KEY_PATTERN} (${nid}).`,
        { stage: "validate", nodeId: nid },
      );
    }
    if (typeof value !== "string" || value.length > META_MAX_VALUE_LENGTH) {
      throw new FatalError(
        "VALIDATION",
        `meta value for "${key}" must be a string of at most ${META_MAX_VALUE_LENGTH} chars (${nid}).`,
        { stage: "validate", nodeId: nid },
      );
    }
  }
}

function validateZIndexProp(node: VNode, nid: string): void {
  const zIndex = Reflect.get(node.props as Record<string, unknown>, "zIndex");
  if (zIndex === undefined) {
    return;
  }
  if (!Z_INDEX_SUPPORTED_TYPES.has(node.type)) {
    throw new FatalError("VALIDATION", `zIndex is not supported on <${node.type}> (${nid}).`, {
      stage: "validate",
      nodeId: nid,
    });
  }
  if (typeof zIndex !== "number" || !Number.isInteger(zIndex)) {
    throw new FatalError(
      "VALIDATION",
      `zIndex must be an integer, got ${String(zIndex)} (${nid}).`,
      { stage: "validate", nodeId: nid },
    );
  }
}
