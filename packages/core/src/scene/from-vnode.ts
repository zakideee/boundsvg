/**
 * Bidirectional conversion between VNode and SceneNode.
 */
import { FatalError } from "../errors.js";
import { assertVNodeRichTextDepth } from "../text/rich-text-limits.js";
import { assertValidTransform2D, type Transform2D } from "../transform.js";
import { createElement } from "../vnode/create-element.js";
import type {
  AnimationSpec,
  BorderRadius,
  CanvasProps,
  Spacing,
  StrokeScaling,
  VNode,
  VNodeFor,
} from "../vnode/types.js";
import { decodeSceneDocument } from "./decoder.js";
import { isSceneNodeType } from "./schema.js";
import type {
  InlineBoxSceneNode,
  InlineRectSceneNode,
  InlineSceneNode,
  RtSceneNode,
  RubySceneNode,
  SceneNode,
  TextOnPathInlineSceneNode,
  TextOnPathSceneChild,
} from "./types.js";

// ---------------------------------------------------------------------------
// VNode → SceneNode
// ---------------------------------------------------------------------------

/**
 * Convert a VNode tree to a SceneNode tree.
 *
 * - Props are spread as typed fields.
 * - Image `src` Uint8Array is converted to a base64 data URI.
 * - String children are preserved as-is.
 */
export function toSceneDocument(vnode: VNode): SceneNode {
  return vnodeToScene(vnode);
}

function vnodeToScene(vnode: VNode): SceneNode {
  switch (vnode.type) {
    case "Canvas": {
      const { props } = vnode;
      return {
        type: "Canvas",
        ...pickDefined(props, "id", "meta", "background", "debug", "language"),
        ...pickHandlers(props),
        width: props.width,
        height: props.height,
        children: convertChildren(vnode.children),
      };
    }

    case "Flex": {
      const { props } = vnode;
      return {
        type: "Flex",
        ...pickDefined(
          props,
          "id",
          "meta",
          "layer",
          "direction",
          "wrap",
          "alignItems",
          "justifyContent",
          "gap",
          "rowGap",
          "columnGap",
        ),
        ...pickPositionProps(props),
        ...pickBoxModelProps(props),
        ...pickVisualBoxProps(props),
        ...pickTransformProps(props, getNodeId(vnode) ?? "<Flex>"),
        ...pickAnimationProps(props),
        ...pickFlexItemProps(props),
        ...pickGridItemProps(props),
        ...pickHandlers(props),
        children: convertChildren(vnode.children),
      };
    }

    case "Grid": {
      const { props } = vnode;
      return {
        type: "Grid",
        ...pickDefined(
          props,
          "id",
          "meta",
          "layer",
          "templateColumns",
          "templateRows",
          "gap",
          "rowGap",
          "columnGap",
          "alignItems",
          "justifyItems",
          "alignSelf",
        ),
        ...pickPositionProps(props),
        ...pickBoxModelProps(props),
        ...pickVisualBoxProps(props),
        ...pickTransformProps(props, getNodeId(vnode) ?? "<Grid>"),
        ...pickAnimationProps(props),
        ...pickGridItemProps(props),
        ...pickHandlers(props),
        children: convertChildren(vnode.children),
      };
    }

    case "Box": {
      const { props } = vnode;
      return {
        type: "Box",
        ...pickDefined(props, "id", "meta", "layer"),
        ...pickPositionProps(props),
        ...pickBoxModelProps(props),
        ...pickVisualBoxProps(props),
        ...pickTransformProps(props, getNodeId(vnode) ?? "<Box>"),
        ...pickAnimationProps(props),
        ...pickGridItemProps(props),
        ...pickHandlers(props),
        children: convertChildren(vnode.children),
      };
    }

    case "Text": {
      const { props } = vnode;
      return {
        type: "Text",
        ...pickDefined(
          props,
          "id",
          "meta",
          "layer",
          "fontWeight",
          "fontStyle",
          "fallback",
          "fontVariationSettings",
          "fontFeatureSettings",
          "writingMode",
          "textOrientation",
          "width",
          "height",
          "minWidth",
          "minHeight",
          "maxWidth",
          "maxHeight",
          "aspectRatio",
          "lineHeight",
          "lineHeightPx",
          "letterSpacingPx",
          "textIndent",
          "color",
          "textDecoration",
          "textStroke",
          "textStrokeWidth",
          "textStrokeLinecap",
          "textStrokeLinejoin",
          "textStrokeDasharray",
          "textStrokeMiterlimit",
          "textStrokes",
          "textShadows",
          "animateUnits",
          "wrap",
          "whiteSpace",
          "tabSize",
          "flowExclusions",
          "flowMinRegionWidthPx",
          "fit",
          "maxLines",
          "ellipsis",
          "textAlign",
          "preferredFrame",
          "language",
          "hangingPunctuation",
          "minFontSizePx",
          "shrinkEpsilonPx",
          "shrinkMaxIterations",
          "maxFontSizePx",
          "growEpsilonPx",
          "growMaxIterations",
          "fitMaxProbes",
          "padding",
          "margin",
          "opacity",
          "zIndex",
        ),
        ...pickPositionProps(props),
        ...pickTransformProps(props, getNodeId(vnode) ?? "<Text>"),
        ...pickAnimationProps(props),
        ...pickFlexItemProps(props),
        ...pickGridItemProps(props),
        ...pickHandlers(props),
        font: props.font,
        fontSizePx: props.fontSizePx,
        children: convertTextOrInlineBoxChildren(vnode.children, {
          code: "SCENE_INVALID_TEXT_CHILD",
          parentTypeName: "Text",
        }),
      };
    }

    case "TextOnPath": {
      const { props } = vnode;
      assertVNodeRichTextDepth(vnode);
      rejectLegacyTextPathNormalOffset(props, getNodeId(vnode) ?? "<TextOnPath>");
      return {
        type: "TextOnPath",
        ...pickDefined(
          props,
          "id",
          "meta",
          "layer",
          "fallback",
          "fontWeight",
          "fontStyle",
          "fontVariationSettings",
          "fontFeatureSettings",
          "letterSpacingPx",
          "language",
          "color",
          "startOffsetPx",
          "textAnchor",
          "pathDirection",
          "pathNormal",
          "pathOffsetPx",
          "pathFit",
          "pathOverflow",
          "textStroke",
          "textStrokeWidth",
          "textStrokeLinecap",
          "textStrokeLinejoin",
          "textStrokeDasharray",
          "textStrokeMiterlimit",
          "textStrokes",
          "textShadows",
          "textDecoration",
          "animateUnits",
          "opacity",
          "zIndex",
          "margin",
        ),
        ...pickPositionProps(props),
        ...pickAnimationProps(props),
        ...pickHandlers(props),
        d: props.d,
        width: props.width,
        height: props.height,
        font: props.font,
        fontSizePx: props.fontSizePx,
        children: convertTextOnPathChildren(vnode.children),
      };
    }

    case "Inline": {
      const { props } = vnode;
      return {
        type: "Inline",
        ...pickDefined(
          props,
          "font",
          "fallback",
          "fontWeight",
          "fontStyle",
          "fontVariationSettings",
          "fontFeatureSettings",
          "textOrientation",
          "textCombineUpright",
          "fontSizePx",
          "letterSpacingPx",
          "color",
          "textDecoration",
          "language",
          "paddingInline",
          "background",
          "borderColor",
          "borderWidth",
          "borderRadius",
          "animate",
        ),
        children: convertInlineChildren(vnode.children),
      };
    }

    case "InlineBox": {
      const { props } = vnode;
      return {
        type: "InlineBox",
        ...pickDefined(
          props,
          "font",
          "fallback",
          "fontWeight",
          "fontStyle",
          "fontSizePx",
          "letterSpacingPx",
          "color",
          "textDecoration",
          "language",
          "paddingInline",
          "background",
          "borderColor",
          "borderWidth",
          "borderRadius",
          "animate",
        ),
        children: convertTextOrInlineBoxChildren(vnode.children, {
          code: "SCENE_INVALID_INLINE_BOX_CHILD",
          parentTypeName: "InlineBox",
        }),
      };
    }

    case "InlineRect": {
      const { props } = vnode;
      return {
        type: "InlineRect",
        ...pickDefined(
          props,
          "blockSizePx",
          "advancePx",
          "blockAlign",
          "borderRadiusPx",
          "opacity",
          "paintOrder",
          "animate",
        ),
        inlineSizePx: props.inlineSizePx,
        color: props.color,
      };
    }

    case "Ruby": {
      const { props } = vnode;
      return {
        type: "Ruby",
        ...pickDefined(
          props,
          "rubyPosition",
          "rubyAlign",
          "rubyGapPx",
          "rubyOffsetPx",
          "rubyLineSizing",
        ),
        children: convertRubyChildren(vnode.children),
      };
    }

    case "Rt": {
      const { props } = vnode;
      return {
        type: "Rt",
        ...pickDefined(
          props,
          "font",
          "fallback",
          "fontWeight",
          "fontStyle",
          "fontVariationSettings",
          "fontFeatureSettings",
          "fontSizePx",
          "lineHeight",
          "lineHeightPx",
          "letterSpacingPx",
          "color",
          "textDecoration",
          "language",
          "textOrientation",
        ),
        children: convertRtChildren(vnode.children),
      };
    }

    case "Image": {
      const { props } = vnode;
      return {
        type: "Image",
        ...pickDefined(
          props,
          "id",
          "meta",
          "layer",
          "mediaType",
          "objectFit",
          "objectPosition",
          "borderRadius",
          "opacity",
          "zIndex",
          "margin",
        ),
        ...pickPositionProps(props),
        ...pickTransformProps(props, getNodeId(vnode) ?? "<Image>"),
        ...pickAnimationProps(props),
        ...pickFlexItemProps(props),
        ...pickGridItemProps(props),
        ...pickHandlers(props),
        src: resolveImageSrc(props.src, props.mediaType),
        width: props.width,
        height: props.height,
      };
    }

    case "Path": {
      const { props } = vnode;
      return {
        type: "Path",
        ...pickDefined(
          props,
          "id",
          "meta",
          "layer",
          "fill",
          "stroke",
          "strokeWidth",
          "strokeScaling",
          "fillRule",
          "strokeLinecap",
          "strokeLinejoin",
          "strokeDasharray",
          "strokeMiterlimit",
          "opacity",
          "zIndex",
          "margin",
        ),
        ...pickPositionProps(props),
        ...pickTransformProps(props, getNodeId(vnode) ?? "<Path>"),
        ...pickAnimationProps(props),
        ...pickFlexItemProps(props),
        ...pickGridItemProps(props),
        ...pickHandlers(props),
        d: props.d,
        width: props.width,
        height: props.height,
      };
    }

    case "Svg": {
      const { props } = vnode;
      return {
        type: "Svg",
        ...pickDefined(
          props,
          "id",
          "meta",
          "layer",
          "preserveAspectRatio",
          "contentIdPrefix",
          "opacity",
          "zIndex",
          "margin",
        ),
        ...pickPositionProps(props),
        ...pickTransformProps(props, getNodeId(vnode) ?? "<Svg>"),
        ...pickAnimationProps(props),
        ...pickFlexItemProps(props),
        ...pickGridItemProps(props),
        ...pickHandlers(props),
        content: props.content,
        width: props.width,
        height: props.height,
      };
    }

    case "Shape": {
      const { props } = vnode;
      return {
        type: "Shape",
        ...pickDefined(
          props,
          "id",
          "meta",
          "fill",
          "stroke",
          "strokeWidth",
          "fillRule",
          "strokeLinecap",
          "strokeLinejoin",
          "strokeDasharray",
          "strokeMiterlimit",
          "preserveAspectRatio",
          "emitPartIds",
          "partPaint",
          "layer",
          "opacity",
          "zIndex",
          "margin",
          "geometry",
          "geometryId",
        ),
        ...pickPositionProps(props),
        ...pickTransformProps(props, getNodeId(vnode) ?? "<Shape>"),
        ...pickAnimationProps(props),
        ...pickFlexItemProps(props),
        ...pickGridItemProps(props),
        ...pickHandlers(props),
        width: props.width,
        height: props.height,
      };
    }

    case "Symbol": {
      const { props } = vnode;
      return {
        type: "Symbol",
        ...pickDefined(
          props,
          "id",
          "meta",
          "fill",
          "stroke",
          "strokeWidth",
          "fillRule",
          "strokeLinecap",
          "strokeLinejoin",
          "strokeDasharray",
          "strokeMiterlimit",
          "preserveAspectRatio",
          "emitPartIds",
          "partPaint",
          "layer",
          "opacity",
          "zIndex",
          "margin",
          "symbol",
          "symbolId",
        ),
        ...pickPositionProps(props),
        ...pickTransformProps(props, getNodeId(vnode) ?? "<Symbol>"),
        ...pickAnimationProps(props),
        ...pickFlexItemProps(props),
        ...pickGridItemProps(props),
        ...pickHandlers(props),
        width: props.width,
        height: props.height,
      };
    }

    default:
      throw new FatalError(
        "SCENE_UNKNOWN_TYPE",
        `Cannot convert VNode of unknown type "${String((vnode as { type: unknown }).type)}" to SceneNode`,
        {
          stage: "validate",
          nodeId: getNodeId(vnode) ?? `<${String((vnode as { type: unknown }).type)}>`,
        },
      );
  }
}

function convertChildren(children: Array<VNode | string>): SceneNode[] {
  return children.filter((child): child is VNode => typeof child !== "string").map(vnodeToScene);
}

const TEXT_PATH_INLINE_SHAPING_PROPS: ReadonlySet<string> = new Set([
  "font",
  "fallback",
  "fontWeight",
  "fontStyle",
  "fontVariationSettings",
  "fontFeatureSettings",
  "fontSizePx",
  "letterSpacingPx",
  "language",
  "color",
  "textStrokes",
  "textShadows",
  "textDecoration",
]);

function convertTextOnPathChildren(
  children: VNodeFor<"TextOnPath">["children"] | VNodeFor<"Inline">["children"],
): TextOnPathSceneChild[] {
  return children.map((child) => {
    if (typeof child === "string") {
      return child;
    }
    if (child.type !== "Inline") {
      throw new FatalError(
        "TEXT_PATH_CHILD_UNSUPPORTED",
        `TextOnPath children must be strings or Inline nodes, got "${child.type}"`,
        { stage: "validate", nodeId: getNodeId(child) ?? `<${child.type}>` },
      );
    }
    for (const propName of Object.keys(child.props)) {
      if (!TEXT_PATH_INLINE_SHAPING_PROPS.has(propName)) {
        throw new FatalError(
          "TEXT_PATH_INLINE_PROP_UNSUPPORTED",
          `TextOnPath Inline does not support prop "${propName}".`,
          { stage: "validate", nodeId: "<Inline>" },
        );
      }
    }
    return {
      type: "Inline",
      ...pickDefined(
        child.props,
        "font",
        "fallback",
        "fontWeight",
        "fontStyle",
        "fontVariationSettings",
        "fontFeatureSettings",
        "fontSizePx",
        "letterSpacingPx",
        "language",
        "color",
        "textStrokes",
        "textShadows",
        "textDecoration",
      ),
      children: convertTextOnPathChildren(child.children),
    } satisfies TextOnPathInlineSceneNode;
  });
}

function rejectLegacyTextPathNormalOffset(value: object, nodeId: string): void {
  if ("normalOffsetPx" in value) {
    throw new FatalError(
      "TEXT_PATH_INVALID",
      "TextOnPath normalOffsetPx was removed; use pathNormal and non-negative pathOffsetPx.",
      { stage: "validate", nodeId },
    );
  }
}

function convertTextOrInlineBoxChildren(
  children: Array<
    string | VNodeFor<"Inline"> | VNodeFor<"InlineBox"> | VNodeFor<"InlineRect"> | VNodeFor<"Ruby">
  >,
  errorContext: { code: string; parentTypeName: string },
): Array<string | InlineSceneNode | InlineBoxSceneNode | InlineRectSceneNode | RubySceneNode> {
  return children.map((child) => {
    if (typeof child === "string") {
      return child;
    }

    const sceneChild = vnodeToScene(child);
    if (
      sceneChild.type === "Inline" ||
      sceneChild.type === "InlineBox" ||
      sceneChild.type === "InlineRect" ||
      sceneChild.type === "Ruby"
    ) {
      return sceneChild;
    }

    throw new FatalError(
      errorContext.code,
      `${errorContext.parentTypeName} children must be strings, Inline, InlineBox, InlineRect, or Ruby nodes, got "${child.type}"`,
      { stage: "validate", nodeId: getNodeId(child) ?? `<${child.type}>` },
    );
  });
}

function convertInlineChildren(
  children: Array<string | VNodeFor<"Inline"> | VNodeFor<"InlineRect"> | VNodeFor<"Ruby">>,
): Array<string | InlineSceneNode | InlineRectSceneNode | RubySceneNode> {
  return children.map((child) => {
    if (typeof child === "string") {
      return child;
    }

    const sceneChild = vnodeToScene(child);
    if (
      sceneChild.type === "Inline" ||
      sceneChild.type === "InlineRect" ||
      sceneChild.type === "Ruby"
    ) {
      return sceneChild;
    }

    throw new FatalError(
      "SCENE_INVALID_INLINE_CHILD",
      `Inline children must be strings, Inline, InlineRect, or Ruby nodes, got "${child.type}"`,
      { stage: "validate", nodeId: getNodeId(child) ?? `<${child.type}>` },
    );
  });
}

function convertRubyChildren(
  children: Array<string | VNodeFor<"Inline"> | VNodeFor<"Rt">>,
): Array<string | InlineSceneNode | RtSceneNode> {
  return children.map((child) => {
    if (typeof child === "string") {
      return child;
    }

    const sceneChild = vnodeToScene(child);
    if (sceneChild.type === "Inline" || sceneChild.type === "Rt") {
      return sceneChild;
    }

    throw new FatalError(
      "SCENE_INVALID_RUBY_CHILD",
      `Ruby children must be strings, Inline, or Rt nodes, got "${child.type}"`,
      { stage: "validate", nodeId: getNodeId(child) ?? `<${child.type}>` },
    );
  });
}

function convertRtChildren(
  children: Array<string | VNodeFor<"Inline">>,
): Array<string | InlineSceneNode> {
  return children.map((child) => {
    if (typeof child === "string") {
      return child;
    }

    const sceneChild = vnodeToScene(child);
    if (sceneChild.type === "Inline") {
      return sceneChild;
    }

    throw new FatalError(
      "SCENE_INVALID_RT_CHILD",
      `Rt children must be strings or Inline nodes, got "${child.type}"`,
      { stage: "validate", nodeId: getNodeId(child) ?? `<${child.type}>` },
    );
  });
}

function resolveImageSrc(src: string | Uint8Array, mediaType?: string): string {
  if (typeof src === "string") {
    return src;
  }
  if (mediaType) {
    return `data:${mediaType};base64,${uint8ToBase64(src)}`;
  }
  // Returning "" here would report success while silently discarding the
  // image bytes, making the SceneDocument unable to round-trip.
  throw new FatalError(
    "SCENE_IMAGE_MEDIA_TYPE_REQUIRED",
    "Image with a Uint8Array 'src' requires 'mediaType' to be serialized into a SceneDocument",
    { stage: "validate" },
  );
}

function uint8ToBase64(data: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(data).toString("base64");
  }
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// SceneNode → VNode
// ---------------------------------------------------------------------------

/**
 * Convert a SceneNode tree back to a VNode tree.
 */
export function fromSceneDocument(scene: unknown): VNode {
  return decodedSceneToVNode(decodeSceneDocument(scene));
}

/** Resolve the trusted VNode marker before treating an input as untrusted Scene data. */
export function resolveSceneOrVNodeInput(input: VNode | SceneNode): VNode {
  return hasTrustedVNodeMarker(input) ? input : decodedSceneToVNode(decodeSceneDocument(input));
}

function hasTrustedVNodeMarker(input: VNode | SceneNode): input is VNode {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const type = readVNodeMarkerProperty(input, "type");
  const props = readVNodeMarkerProperty(input, "props");
  const children = readVNodeMarkerProperty(input, "children");
  if (
    type === undefined ||
    props === undefined ||
    children === undefined ||
    typeof type !== "string" ||
    !isSceneNodeType(type) ||
    typeof props !== "object" ||
    props === null
  ) {
    return false;
  }
  let propsIsArray: boolean;
  let childrenIsArray: boolean;
  try {
    propsIsArray = Array.isArray(props);
  } catch {
    throw vnodeMarkerReflectionError("/props", "array-check");
  }
  try {
    childrenIsArray = Array.isArray(children);
  } catch {
    throw vnodeMarkerReflectionError("/children", "array-check");
  }
  return !propsIsArray && childrenIsArray;
}

function readVNodeMarkerProperty(input: object, key: string): unknown | undefined {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(input, key);
  } catch {
    throw vnodeMarkerReflectionError(`/${key}`, "get-own-property-descriptor");
  }
  if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
    return undefined;
  }
  return descriptor.value;
}

function vnodeMarkerReflectionError(path: string, operation: string): FatalError {
  return new FatalError(
    "SCENE_DECODE_UNSAFE_VALUE",
    "Scene document contains a value that is not a safe JSON data value.",
    {
      stage: "validate",
      context: { path, reason: "reflection-failed", operation },
    },
  );
}

function decodedSceneToVNode(scene: SceneNode): VNode {
  switch (scene.type) {
    case "Canvas": {
      const props: CanvasProps = {
        width: scene.width,
        height: scene.height,
        ...pickDefined(scene, "id", "meta", "background", "debug", "language"),
        ...pickHandlers(scene),
      };
      return createElement("Canvas", {
        ...props,
        children: sceneChildrenToContainerVNodeChildren(scene.children),
      });
    }

    case "Flex":
      return createElement("Flex", {
        ...pickDefined(
          scene,
          "id",
          "meta",
          "layer",
          "direction",
          "wrap",
          "alignItems",
          "justifyContent",
          "gap",
          "rowGap",
          "columnGap",
        ),
        ...pickPositionProps(scene),
        ...pickBoxModelProps(scene),
        ...pickVisualBoxProps(scene),
        ...pickTransformProps(scene, scene.id ?? "<Flex>"),
        ...pickAnimationProps(scene),
        ...pickFlexItemProps(scene),
        ...pickGridItemProps(scene),
        ...pickHandlers(scene),
        children: sceneChildrenToContainerVNodeChildren(scene.children),
      });

    case "Grid":
      return createElement("Grid", {
        ...pickDefined(
          scene,
          "id",
          "meta",
          "layer",
          "templateColumns",
          "templateRows",
          "gap",
          "rowGap",
          "columnGap",
          "alignItems",
          "justifyItems",
          "alignSelf",
        ),
        ...pickPositionProps(scene),
        ...pickBoxModelProps(scene),
        ...pickVisualBoxProps(scene),
        ...pickTransformProps(scene, scene.id ?? "<Grid>"),
        ...pickAnimationProps(scene),
        ...pickGridItemProps(scene),
        ...pickHandlers(scene),
        children: sceneChildrenToContainerVNodeChildren(scene.children),
      });

    case "Box":
      return createElement("Box", {
        ...pickDefined(scene, "id", "meta", "layer"),
        ...pickPositionProps(scene),
        ...pickBoxModelProps(scene),
        ...pickVisualBoxProps(scene),
        ...pickTransformProps(scene, scene.id ?? "<Box>"),
        ...pickAnimationProps(scene),
        ...pickGridItemProps(scene),
        ...pickHandlers(scene),
        children: sceneChildrenToContainerVNodeChildren(scene.children),
      });

    case "Text":
      return createElement("Text", {
        font: scene.font,
        fontSizePx: scene.fontSizePx,
        ...pickDefined(
          scene,
          "id",
          "meta",
          "layer",
          "fontWeight",
          "fontStyle",
          "fallback",
          "fontVariationSettings",
          "fontFeatureSettings",
          "writingMode",
          "textOrientation",
          "width",
          "height",
          "minWidth",
          "minHeight",
          "maxWidth",
          "maxHeight",
          "aspectRatio",
          "lineHeight",
          "lineHeightPx",
          "letterSpacingPx",
          "textIndent",
          "color",
          "textDecoration",
          "textStroke",
          "textStrokeWidth",
          "textStrokeLinecap",
          "textStrokeLinejoin",
          "textStrokeDasharray",
          "textStrokeMiterlimit",
          "textStrokes",
          "textShadows",
          "animateUnits",
          "wrap",
          "whiteSpace",
          "tabSize",
          "flowExclusions",
          "flowMinRegionWidthPx",
          "fit",
          "maxLines",
          "ellipsis",
          "textAlign",
          "preferredFrame",
          "language",
          "hangingPunctuation",
          "minFontSizePx",
          "shrinkEpsilonPx",
          "shrinkMaxIterations",
          "maxFontSizePx",
          "growEpsilonPx",
          "growMaxIterations",
          "fitMaxProbes",
          "padding",
          "margin",
          "opacity",
          "zIndex",
        ),
        ...pickPositionProps(scene),
        ...pickTransformProps(scene, scene.id ?? "<Text>"),
        ...pickAnimationProps(scene),
        ...pickFlexItemProps(scene),
        ...pickGridItemProps(scene),
        ...pickHandlers(scene),
        children: sceneChildrenToTextVNodeChildren(scene.children),
      });

    case "TextOnPath":
      return createElement("TextOnPath", {
        d: scene.d,
        width: scene.width,
        height: scene.height,
        font: scene.font,
        fontSizePx: scene.fontSizePx,
        ...pickDefined(
          scene,
          "id",
          "meta",
          "layer",
          "fallback",
          "fontWeight",
          "fontStyle",
          "fontVariationSettings",
          "fontFeatureSettings",
          "letterSpacingPx",
          "language",
          "color",
          "startOffsetPx",
          "textAnchor",
          "pathDirection",
          "pathNormal",
          "pathOffsetPx",
          "pathFit",
          "pathOverflow",
          "textStroke",
          "textStrokeWidth",
          "textStrokeLinecap",
          "textStrokeLinejoin",
          "textStrokeDasharray",
          "textStrokeMiterlimit",
          "textStrokes",
          "textShadows",
          "textDecoration",
          "animateUnits",
          "opacity",
          "zIndex",
          "margin",
        ),
        ...pickPositionProps(scene),
        ...pickAnimationProps(scene),
        ...pickHandlers(scene),
        children: sceneChildrenToTextOnPathVNodeChildren(scene.children),
      });

    case "Inline":
      return decodedInlineToVNode(scene);

    case "InlineBox":
      return decodedInlineBoxToVNode(scene);

    case "InlineRect":
      return decodedInlineRectToVNode(scene);

    case "Ruby":
      return decodedRubyToVNode(scene);

    case "Rt":
      return decodedRtToVNode(scene);

    case "Image":
      return createElement("Image", {
        src: scene.src,
        width: scene.width,
        height: scene.height,
        ...pickDefined(
          scene,
          "id",
          "meta",
          "layer",
          "mediaType",
          "objectFit",
          "objectPosition",
          "borderRadius",
          "opacity",
          "zIndex",
          "margin",
        ),
        ...pickPositionProps(scene),
        ...pickTransformProps(scene, scene.id ?? "<Image>"),
        ...pickAnimationProps(scene),
        ...pickFlexItemProps(scene),
        ...pickGridItemProps(scene),
        ...pickHandlers(scene),
      });

    case "Path":
      return createElement("Path", {
        d: scene.d,
        width: scene.width,
        height: scene.height,
        ...pickDefined(
          scene,
          "id",
          "meta",
          "layer",
          "fill",
          "stroke",
          "strokeWidth",
          "strokeScaling",
          "fillRule",
          "strokeLinecap",
          "strokeLinejoin",
          "strokeDasharray",
          "strokeMiterlimit",
          "opacity",
          "zIndex",
          "margin",
        ),
        ...pickPositionProps(scene),
        ...pickTransformProps(scene, scene.id ?? "<Path>"),
        ...pickAnimationProps(scene),
        ...pickFlexItemProps(scene),
        ...pickGridItemProps(scene),
        ...pickHandlers(scene),
      });

    case "Svg":
      return createElement("Svg", {
        content: scene.content,
        width: scene.width,
        height: scene.height,
        ...pickDefined(
          scene,
          "id",
          "meta",
          "layer",
          "preserveAspectRatio",
          "contentIdPrefix",
          "opacity",
          "zIndex",
          "margin",
        ),
        ...pickPositionProps(scene),
        ...pickTransformProps(scene, scene.id ?? "<Svg>"),
        ...pickAnimationProps(scene),
        ...pickFlexItemProps(scene),
        ...pickGridItemProps(scene),
        ...pickHandlers(scene),
      });

    case "Shape":
      return createElement("Shape", {
        width: scene.width,
        height: scene.height,
        ...pickDefined(
          scene,
          "id",
          "meta",
          "fill",
          "stroke",
          "strokeWidth",
          "fillRule",
          "strokeLinecap",
          "strokeLinejoin",
          "strokeDasharray",
          "strokeMiterlimit",
          "preserveAspectRatio",
          "emitPartIds",
          "partPaint",
          "layer",
          "opacity",
          "zIndex",
          "margin",
          "geometry",
          "geometryId",
        ),
        ...pickPositionProps(scene),
        ...pickTransformProps(scene, scene.id ?? "<Shape>"),
        ...pickAnimationProps(scene),
        ...pickFlexItemProps(scene),
        ...pickGridItemProps(scene),
        ...pickHandlers(scene),
      });

    case "Symbol":
      return createElement("Symbol", {
        width: scene.width,
        height: scene.height,
        ...pickDefined(
          scene,
          "id",
          "meta",
          "fill",
          "stroke",
          "strokeWidth",
          "fillRule",
          "strokeLinecap",
          "strokeLinejoin",
          "strokeDasharray",
          "strokeMiterlimit",
          "preserveAspectRatio",
          "emitPartIds",
          "partPaint",
          "layer",
          "opacity",
          "zIndex",
          "margin",
          "symbol",
          "symbolId",
        ),
        ...pickPositionProps(scene),
        ...pickTransformProps(scene, scene.id ?? "<Symbol>"),
        ...pickAnimationProps(scene),
        ...pickFlexItemProps(scene),
        ...pickGridItemProps(scene),
        ...pickHandlers(scene),
      });
  }

  return unreachableDecodedScene(scene);
}

function decodedInlineToVNode(scene: InlineSceneNode): VNodeFor<"Inline"> {
  return createElement("Inline", {
    ...pickDefined(
      scene,
      "font",
      "fallback",
      "fontWeight",
      "fontStyle",
      "fontVariationSettings",
      "fontFeatureSettings",
      "textOrientation",
      "textCombineUpright",
      "fontSizePx",
      "letterSpacingPx",
      "color",
      "textStrokes",
      "textShadows",
      "textDecoration",
      "language",
      "paddingInline",
      "background",
      "borderColor",
      "borderWidth",
      "borderRadius",
      "animate",
    ),
    children: sceneChildrenToInlineVNodeChildren(scene.children),
  });
}

function decodedInlineBoxToVNode(scene: InlineBoxSceneNode): VNodeFor<"InlineBox"> {
  return createElement("InlineBox", {
    ...pickDefined(
      scene,
      "font",
      "fallback",
      "fontWeight",
      "fontStyle",
      "fontSizePx",
      "letterSpacingPx",
      "color",
      "textDecoration",
      "language",
      "paddingInline",
      "background",
      "borderColor",
      "borderWidth",
      "borderRadius",
      "animate",
    ),
    children: sceneChildrenToInlineBoxVNodeChildren(scene.children),
  });
}

function decodedInlineRectToVNode(scene: InlineRectSceneNode): VNodeFor<"InlineRect"> {
  return createElement("InlineRect", {
    ...pickDefined(
      scene,
      "blockSizePx",
      "advancePx",
      "blockAlign",
      "borderRadiusPx",
      "opacity",
      "paintOrder",
      "animate",
    ),
    inlineSizePx: scene.inlineSizePx,
    color: scene.color,
  });
}

function decodedRubyToVNode(scene: RubySceneNode): VNodeFor<"Ruby"> {
  return createElement("Ruby", {
    ...pickDefined(
      scene,
      "rubyPosition",
      "rubyAlign",
      "rubyGapPx",
      "rubyOffsetPx",
      "rubyLineSizing",
    ),
    children: sceneChildrenToRubyVNodeChildren(scene.children),
  });
}

function decodedRtToVNode(scene: RtSceneNode): VNodeFor<"Rt"> {
  return createElement("Rt", {
    ...pickDefined(
      scene,
      "font",
      "fallback",
      "fontWeight",
      "fontStyle",
      "fontVariationSettings",
      "fontFeatureSettings",
      "fontSizePx",
      "lineHeight",
      "lineHeightPx",
      "letterSpacingPx",
      "color",
      "textDecoration",
      "language",
      "textOrientation",
    ),
    children: sceneChildrenToRtVNodeChildren(scene.children),
  });
}

function sceneChildToTextVNodeChild(
  child: string | InlineSceneNode | InlineBoxSceneNode | InlineRectSceneNode | RubySceneNode,
): string | VNodeFor<"Inline"> | VNodeFor<"InlineBox"> | VNodeFor<"InlineRect"> | VNodeFor<"Ruby"> {
  if (typeof child === "string") {
    return child;
  }

  switch (child.type) {
    case "Inline":
      return decodedInlineToVNode(child);
    case "InlineBox":
      return decodedInlineBoxToVNode(child);
    case "InlineRect":
      return decodedInlineRectToVNode(child);
    case "Ruby":
      return decodedRubyToVNode(child);
  }
}

function sceneChildToRubyVNodeChild(
  child: string | InlineSceneNode | RtSceneNode,
): string | VNodeFor<"Inline"> | VNodeFor<"Rt"> {
  if (typeof child === "string") {
    return child;
  }

  switch (child.type) {
    case "Inline":
      return decodedInlineToVNode(child);
    case "Rt":
      return decodedRtToVNode(child);
  }
}

function sceneChildToRtVNodeChild(child: string | InlineSceneNode): string | VNodeFor<"Inline"> {
  if (typeof child === "string") {
    return child;
  }

  return decodedInlineToVNode(child);
}

function sceneChildrenToContainerVNodeChildren(children: SceneNode[]): VNode[] {
  return children.map(decodedSceneToVNode);
}

function sceneChildrenToTextOnPathVNodeChildren(
  children: TextOnPathSceneChild[],
): Array<string | VNodeFor<"Inline">> {
  return children.map((child) => {
    if (typeof child === "string") {
      return child;
    }
    return createElement("Inline", {
      ...pickDefined(
        child,
        "font",
        "fallback",
        "fontWeight",
        "fontStyle",
        "fontVariationSettings",
        "fontFeatureSettings",
        "fontSizePx",
        "letterSpacingPx",
        "language",
        "color",
        "textStrokes",
        "textShadows",
        "textDecoration",
      ),
      children: sceneChildrenToTextOnPathVNodeChildren(child.children),
    });
  });
}

function sceneChildrenToTextVNodeChildren(
  children: Array<
    string | InlineSceneNode | InlineBoxSceneNode | InlineRectSceneNode | RubySceneNode
  >,
): Array<
  string | VNodeFor<"Inline"> | VNodeFor<"InlineBox"> | VNodeFor<"InlineRect"> | VNodeFor<"Ruby">
> {
  return children.map(sceneChildToTextVNodeChild);
}

function sceneChildrenToInlineVNodeChildren(
  children: Array<string | InlineSceneNode | InlineRectSceneNode | RubySceneNode>,
): Array<string | VNodeFor<"Inline"> | VNodeFor<"InlineRect"> | VNodeFor<"Ruby">> {
  return children.map((child) => {
    if (typeof child === "string") {
      return child;
    }
    switch (child.type) {
      case "Inline":
        return decodedInlineToVNode(child);
      case "InlineRect":
        return decodedInlineRectToVNode(child);
      case "Ruby":
        return decodedRubyToVNode(child);
    }
    return unreachableDecodedScene(child);
  });
}

function sceneChildrenToRubyVNodeChildren(
  children: Array<string | InlineSceneNode | RtSceneNode>,
): Array<string | VNodeFor<"Inline"> | VNodeFor<"Rt">> {
  return children.map(sceneChildToRubyVNodeChild);
}

function sceneChildrenToRtVNodeChildren(
  children: Array<string | InlineSceneNode>,
): Array<string | VNodeFor<"Inline">> {
  return children.map(sceneChildToRtVNodeChild);
}

function sceneChildrenToInlineBoxVNodeChildren(
  children: Array<
    string | InlineSceneNode | InlineBoxSceneNode | InlineRectSceneNode | RubySceneNode
  >,
): Array<
  string | VNodeFor<"Inline"> | VNodeFor<"InlineBox"> | VNodeFor<"InlineRect"> | VNodeFor<"Ruby">
> {
  return children.map((child) => {
    if (typeof child === "string") {
      return child;
    }
    switch (child.type) {
      case "Inline":
        return decodedInlineToVNode(child);
      case "InlineBox":
        return decodedInlineBoxToVNode(child);
      case "InlineRect":
        return decodedInlineRectToVNode(child);
      case "Ruby":
        return decodedRubyToVNode(child);
    }
    return unreachableDecodedScene(child);
  });
}

function unreachableDecodedScene(_scene: never): never {
  throw new FatalError(
    "SCENE_DECODE_INVALID_VALUE",
    "Scene document contains a value with an invalid structural type.",
    {
      stage: "validate",
      context: { path: "", expected: "scene-node", actual: "record" },
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNodeId(node: VNode): string | undefined {
  if ("id" in node.props && typeof node.props.id === "string") {
    return node.props.id;
  }
  return undefined;
}

function pickDefined<T extends object, K extends keyof T>(
  obj: T,
  ...keys: K[]
): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

type PositionLike = {
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

type BoxModelLike = {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number;
  padding?: Spacing;
  margin?: Spacing;
};

type VisualBoxLike = {
  background?: string;
  boxShadow?: string;
  borderRadius?: BorderRadius;
  borderWidth?: number;
  borderColor?: string;
  strokeScaling?: StrokeScaling;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  strokeDasharray?: string;
  strokeMiterlimit?: number;
  overflow?: "visible" | "clip";
  opacity?: number;
  zIndex?: number;
};

type FlexItemLike = {
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
};

type GridItemLike = {
  gridColumn?: string;
  gridRow?: string;
};

type TransformLike = {
  transform?: Transform2D;
};

type AnimationLike = {
  animate?: AnimationSpec;
};

type HandlerLike = {
  onClick?: string;
  onDoubleClick?: string;
  onContextMenu?: string;
  onPointerDown?: string;
  onPointerUp?: string;
  onPointerCancel?: string;
  onPointerMove?: string;
  onPointerEnter?: string;
  onPointerLeave?: string;
  onPointerOver?: string;
  onPointerOut?: string;
  onMouseDown?: string;
  onMouseUp?: string;
  onMouseMove?: string;
  onMouseEnter?: string;
  onMouseLeave?: string;
  onMouseOver?: string;
  onMouseOut?: string;
  onTouchStart?: string;
  onTouchEnd?: string;
  onTouchMove?: string;
};

function pickPositionProps<T extends PositionLike>(props: T): Partial<PositionLike> {
  return pickDefined(props, "position", "top", "right", "bottom", "left");
}

function pickBoxModelProps<T extends BoxModelLike>(props: T): Partial<BoxModelLike> {
  return pickDefined(
    props,
    "width",
    "height",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "aspectRatio",
    "padding",
    "margin",
  );
}

function pickVisualBoxProps<T extends VisualBoxLike>(props: T): Partial<VisualBoxLike> {
  return pickDefined(
    props,
    "background",
    "boxShadow",
    "borderRadius",
    "borderWidth",
    "borderColor",
    "strokeScaling",
    "strokeLinecap",
    "strokeLinejoin",
    "strokeDasharray",
    "strokeMiterlimit",
    "overflow",
    "opacity",
    "zIndex",
  );
}

function pickFlexItemProps<T extends FlexItemLike>(props: T): Partial<FlexItemLike> {
  return pickDefined(props, "flexGrow", "flexShrink", "flexBasis", "alignSelf");
}

function pickGridItemProps<T extends GridItemLike>(props: T): Partial<GridItemLike> {
  return pickDefined(props, "gridColumn", "gridRow");
}

function pickTransformProps<T extends TransformLike>(
  props: T,
  nodeId: string,
): Partial<TransformLike> {
  if (props.transform === undefined) {
    return {};
  }
  assertValidTransform2D(props.transform, {
    code: "SCENE_INVALID_TRANSFORM",
    stage: "validate",
    nodeId,
    ownerName: nodeId,
  });
  return { transform: { ...props.transform } };
}

function pickAnimationProps<T extends AnimationLike>(props: T): Partial<AnimationLike> {
  return pickDefined(props, "animate");
}

function pickHandlers<T extends HandlerLike>(props: T): Partial<HandlerLike> {
  return pickDefined(
    props,
    "onClick",
    "onDoubleClick",
    "onContextMenu",
    "onPointerDown",
    "onPointerUp",
    "onPointerCancel",
    "onPointerMove",
    "onPointerEnter",
    "onPointerLeave",
    "onPointerOver",
    "onPointerOut",
    "onMouseDown",
    "onMouseUp",
    "onMouseMove",
    "onMouseEnter",
    "onMouseLeave",
    "onMouseOver",
    "onMouseOut",
    "onTouchStart",
    "onTouchEnd",
    "onTouchMove",
  );
}
