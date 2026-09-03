import type {
  ElasticSegment,
  GeometryDoc,
  GeometryNode,
  GeometryViewBox,
  SymbolDefinition,
  Transform2D,
} from "../shape/types.js";
import type { TextDecoration, TextShadowLayer, TextStrokeLayer } from "../text/types.js";
import type {
  AnimationEasing,
  AnimationKeyframe,
  AnimationSpec,
  AnimationSpring,
  AnimationTransform2D,
  PartPaintOverride,
  TextFlowExclusion,
  TextFlowExclusionMarginPx,
  TextUnitAnimation,
} from "../vnode/types.js";
import type { SceneNode, TextOnPathInlineSceneNode } from "./types.js";

export type SceneDecodeExpected =
  | "scene-node"
  | "record"
  | "array"
  | "string"
  | "boolean"
  | "finite-number"
  | "enum"
  | "string-array"
  | "string-map"
  | "spacing"
  | "border-radius"
  | "padding-inline"
  | "number-or-auto"
  | "number-or-line"
  | "number-or-infinite"
  | "animation-easing"
  | "exclusion-margin"
  | "text-decoration"
  | "decoration-line"
  | "scene-child"
  | "text-child"
  | "text-path-child"
  | "inline-child"
  | "inline-box-child"
  | "ruby-child"
  | "rt-child"
  | "geometry-node"
  | "geometry-doc"
  | "symbol-definition"
  | "part-paint";

export type SceneChildGrammar =
  | "scene"
  | "text"
  | "text-path"
  | "inline"
  | "inline-box"
  | "ruby"
  | "rt";

export type SceneSchema =
  | { readonly kind: "string" }
  | { readonly kind: "boolean" }
  | { readonly kind: "finite-number" }
  | { readonly kind: "enum"; readonly values: ReadonlySet<string> }
  | { readonly kind: "array"; readonly item: SceneSchema; readonly expected?: SceneDecodeExpected }
  | { readonly kind: "tuple"; readonly items: readonly SceneSchema[] }
  | { readonly kind: "record"; readonly name: RecordSchemaName }
  | { readonly kind: "map"; readonly value: SceneSchema; readonly expected: SceneDecodeExpected }
  | {
      readonly kind: "one-of";
      readonly expected: SceneDecodeExpected;
      readonly variants: readonly SceneSchema[];
    }
  | { readonly kind: "discriminated"; readonly name: DiscriminatedSchemaName }
  | { readonly kind: "scene-node" }
  | { readonly kind: "scene-child"; readonly grammar: SceneChildGrammar };

export type SceneFieldSchema = {
  readonly name: string;
  readonly schema: SceneSchema;
  readonly required: boolean;
};

export type SceneRecordSchema = {
  readonly fields: readonly SceneFieldSchema[];
  readonly fieldNames: ReadonlySet<string>;
};

type SceneNodeType = SceneNode["type"];

export type RecordSchemaName =
  | SceneNodeType
  | "textPathInline"
  | "transform"
  | "animationTransform"
  | "animationKeyframe"
  | "animation"
  | "animationSpring"
  | "animationSteps"
  | "textUnitAnimation"
  | "flowMargin"
  | "flowRect"
  | "flowCircle"
  | "flowPath"
  | "textDecoration"
  | "textStroke"
  | "textShadow"
  | "preferredFrame"
  | "geometryViewBox"
  | "geometryPath"
  | "geometryGroup"
  | "geometryTransform"
  | "geometryBoolean"
  | "geometryDoc"
  | "elasticFrame"
  | "elasticSegment"
  | "symbolDefinition"
  | "partPaint";

const stringSchema = { kind: "string" } as const satisfies SceneSchema;
const booleanSchema = { kind: "boolean" } as const satisfies SceneSchema;
const numberSchema = { kind: "finite-number" } as const satisfies SceneSchema;

function enumSchema<const T extends readonly string[]>(values: T): SceneSchema {
  return { kind: "enum", values: new Set(values) };
}

function arraySchema(item: SceneSchema, expected?: SceneDecodeExpected): SceneSchema {
  return expected === undefined ? { kind: "array", item } : { kind: "array", item, expected };
}

function tupleSchema(...items: SceneSchema[]): SceneSchema {
  return { kind: "tuple", items };
}

function recordSchema(name: RecordSchemaName): SceneSchema {
  return { kind: "record", name };
}

function oneOf(expected: SceneDecodeExpected, ...variants: SceneSchema[]): SceneSchema {
  return { kind: "one-of", expected, variants };
}

function required<const Name extends string>(
  name: Name,
  schema: SceneSchema,
): SceneFieldSchema & { readonly name: Name; readonly required: true } {
  return { name, schema, required: true };
}

function optional<const Name extends string>(
  name: Name,
  schema: SceneSchema,
): SceneFieldSchema & { readonly name: Name; readonly required: false } {
  return { name, schema, required: false };
}

function fields<const Groups extends readonly (readonly SceneFieldSchema[])[]>(
  ...groups: Groups
): readonly Groups[number][number][] {
  const result: SceneFieldSchema[] = [];
  const names = new Set<string>();
  for (const group of groups) {
    for (const field of group) {
      if (names.has(field.name)) {
        continue;
      }
      names.add(field.name);
      result.push(field);
    }
  }
  return result as Groups[number][number][];
}

const spacingSchema = oneOf(
  "spacing",
  numberSchema,
  tupleSchema(numberSchema, numberSchema, numberSchema, numberSchema),
);
const borderRadiusSchema = oneOf(
  "border-radius",
  numberSchema,
  tupleSchema(numberSchema, numberSchema, numberSchema, numberSchema),
);
const paddingInlineSchema = oneOf("padding-inline", tupleSchema(numberSchema, numberSchema));
const numberOrAutoSchema = oneOf("number-or-auto", numberSchema, enumSchema(["auto"]));
const numberOrLineSchema = oneOf("number-or-line", numberSchema, enumSchema(["line"]));
const numberOrInfiniteSchema = oneOf("number-or-infinite", numberSchema, enumSchema(["infinite"]));

const stringArraySchema = arraySchema(stringSchema, "string-array");
const metaSchema = {
  kind: "map",
  value: stringSchema,
  expected: "string-map",
} as const satisfies SceneSchema;
const partPaintMapSchema = {
  kind: "map",
  value: recordSchema("partPaint"),
  expected: "part-paint",
} as const satisfies SceneSchema;

const positionFields = [
  optional("position", enumSchema(["relative", "absolute"])),
  optional("top", numberSchema),
  optional("right", numberSchema),
  optional("bottom", numberSchema),
  optional("left", numberSchema),
] as const;

const boxModelFields = [
  optional("width", numberSchema),
  optional("height", numberSchema),
  optional("minWidth", numberSchema),
  optional("minHeight", numberSchema),
  optional("maxWidth", numberSchema),
  optional("maxHeight", numberSchema),
  optional("aspectRatio", numberSchema),
  optional("padding", spacingSchema),
  optional("margin", spacingSchema),
] as const;

const visualBoxFields = [
  optional("background", stringSchema),
  optional("boxShadow", stringSchema),
  optional("borderRadius", borderRadiusSchema),
  optional("borderWidth", numberSchema),
  optional("borderColor", stringSchema),
  optional("strokeScaling", enumSchema(["transform", "canvas"])),
  optional("strokeLinecap", enumSchema(["butt", "round", "square"])),
  optional("strokeLinejoin", enumSchema(["miter", "round", "bevel"])),
  optional("strokeDasharray", stringSchema),
  optional("strokeMiterlimit", numberSchema),
  optional("overflow", enumSchema(["visible", "clip"])),
  optional("opacity", numberSchema),
  optional("zIndex", numberSchema),
] as const;

const flexItemFields = [
  optional("flexGrow", numberSchema),
  optional("flexShrink", numberSchema),
  optional("flexBasis", numberOrAutoSchema),
  optional("alignSelf", enumSchema(["auto", "start", "center", "end", "stretch"])),
] as const;

const gridItemFields = [
  optional("gridColumn", stringSchema),
  optional("gridRow", stringSchema),
] as const;
const transformFields = [optional("transform", recordSchema("transform"))] as const;
const animationFields = [optional("animate", recordSchema("animation"))] as const;
const layerFields = [optional("layer", stringSchema)] as const;

const eventHandlerFields = [
  optional("onClick", stringSchema),
  optional("onDoubleClick", stringSchema),
  optional("onPointerMove", stringSchema),
  optional("onPointerDown", stringSchema),
  optional("onPointerUp", stringSchema),
  optional("onPointerCancel", stringSchema),
  optional("onPointerEnter", stringSchema),
  optional("onPointerLeave", stringSchema),
  optional("onPointerOver", stringSchema),
  optional("onPointerOut", stringSchema),
  optional("onContextMenu", stringSchema),
  optional("onMouseDown", stringSchema),
  optional("onMouseUp", stringSchema),
  optional("onMouseMove", stringSchema),
  optional("onMouseEnter", stringSchema),
  optional("onMouseLeave", stringSchema),
  optional("onMouseOver", stringSchema),
  optional("onMouseOut", stringSchema),
  optional("onTouchStart", stringSchema),
  optional("onTouchEnd", stringSchema),
  optional("onTouchMove", stringSchema),
] as const;

const identityFields = [optional("id", stringSchema), optional("meta", metaSchema)] as const;

const textPaintFields = [
  optional("color", stringSchema),
  optional(
    "textDecoration",
    oneOf("text-decoration", enumSchema(["none"]), recordSchema("textDecoration")),
  ),
  optional("textStroke", stringSchema),
  optional("textStrokeWidth", numberSchema),
  optional("textStrokeLinecap", enumSchema(["butt", "round", "square"])),
  optional("textStrokeLinejoin", enumSchema(["miter", "round", "bevel"])),
  optional("textStrokeDasharray", stringSchema),
  optional("textStrokeMiterlimit", numberSchema),
  optional("textStrokes", arraySchema(recordSchema("textStroke"))),
  optional("textShadows", arraySchema(recordSchema("textShadow"))),
] as const;

const shapePaintFields = [
  optional("fill", stringSchema),
  optional("stroke", stringSchema),
  optional("strokeWidth", numberSchema),
  optional("fillRule", enumSchema(["nonzero", "evenodd"])),
  optional("strokeLinecap", enumSchema(["butt", "round", "square"])),
  optional("strokeLinejoin", enumSchema(["miter", "round", "bevel"])),
  optional("strokeDasharray", stringSchema),
  optional("strokeMiterlimit", numberSchema),
] as const;

const SCENE_NODE_TYPES = [
  "Canvas",
  "Flex",
  "Grid",
  "Box",
  "Text",
  "TextOnPath",
  "Inline",
  "InlineBox",
  "InlineRect",
  "Ruby",
  "Rt",
  "Image",
  "Path",
  "Svg",
  "Shape",
  "Symbol",
] as const satisfies readonly SceneNodeType[];

const sceneNodeTypeName = {
  canvas: SCENE_NODE_TYPES[0],
  flex: SCENE_NODE_TYPES[1],
  grid: SCENE_NODE_TYPES[2],
  box: SCENE_NODE_TYPES[3],
  text: SCENE_NODE_TYPES[4],
  textOnPath: SCENE_NODE_TYPES[5],
  inline: SCENE_NODE_TYPES[6],
  inlineBox: SCENE_NODE_TYPES[7],
  inlineRect: SCENE_NODE_TYPES[8],
  ruby: SCENE_NODE_TYPES[9],
  rt: SCENE_NODE_TYPES[10],
  image: SCENE_NODE_TYPES[11],
  path: SCENE_NODE_TYPES[12],
  svg: SCENE_NODE_TYPES[13],
  shape: SCENE_NODE_TYPES[14],
  symbol: SCENE_NODE_TYPES[15],
} as const satisfies Record<string, SceneNodeType>;

const SCENE_NODE_TYPE_SET: ReadonlySet<string> = new Set(SCENE_NODE_TYPES);
const reflectApply = Reflect.apply;
const setPrototypeHas = Set.prototype.has;

const childSchemas = {
  scene: { kind: "scene-child", grammar: "scene" },
  text: { kind: "scene-child", grammar: "text" },
  "text-path": { kind: "scene-child", grammar: "text-path" },
  inline: { kind: "scene-child", grammar: "inline" },
  "inline-box": { kind: "scene-child", grammar: "inline-box" },
  ruby: { kind: "scene-child", grammar: "ruby" },
  rt: { kind: "scene-child", grammar: "rt" },
} as const satisfies Record<SceneChildGrammar, SceneSchema>;

const sceneChildren = (grammar: SceneChildGrammar): SceneSchema =>
  arraySchema(childSchemas[grammar]);

const nodeFields = {
  [sceneNodeTypeName.canvas]: fields(
    [
      required("type", enumSchema(["Canvas"])),
      ...identityFields,
      required("width", numberSchema),
      required("height", numberSchema),
      optional("background", stringSchema),
      optional("debug", booleanSchema),
      optional("language", enumSchema(["ja", "en", "auto"])),
      required("children", sceneChildren("scene")),
    ],
    eventHandlerFields,
  ),
  [sceneNodeTypeName.flex]: fields(
    [
      required("type", enumSchema(["Flex"])),
      ...identityFields,
      optional("direction", enumSchema(["row", "column"])),
      optional("wrap", enumSchema(["nowrap", "wrap"])),
      optional("alignItems", enumSchema(["start", "center", "end", "stretch"])),
      optional(
        "justifyContent",
        enumSchema(["start", "center", "end", "space-between", "space-around"]),
      ),
      optional("gap", numberSchema),
      optional("rowGap", numberSchema),
      optional("columnGap", numberSchema),
      required("children", sceneChildren("scene")),
    ],
    positionFields,
    boxModelFields,
    visualBoxFields,
    flexItemFields,
    gridItemFields,
    transformFields,
    animationFields,
    layerFields,
    eventHandlerFields,
  ),
  [sceneNodeTypeName.grid]: fields(
    [
      required("type", enumSchema(["Grid"])),
      ...identityFields,
      optional("templateColumns", stringSchema),
      optional("templateRows", stringSchema),
      optional("gap", numberSchema),
      optional("rowGap", numberSchema),
      optional("columnGap", numberSchema),
      optional("alignItems", enumSchema(["start", "center", "end", "stretch"])),
      optional("justifyItems", enumSchema(["start", "center", "end", "stretch"])),
      optional("alignSelf", enumSchema(["auto", "start", "center", "end", "stretch"])),
      required("children", sceneChildren("scene")),
    ],
    positionFields,
    boxModelFields,
    visualBoxFields,
    gridItemFields,
    transformFields,
    animationFields,
    layerFields,
    eventHandlerFields,
  ),
  [sceneNodeTypeName.box]: fields(
    [
      required("type", enumSchema(["Box"])),
      ...identityFields,
      required("children", sceneChildren("scene")),
    ],
    positionFields,
    boxModelFields,
    visualBoxFields,
    gridItemFields,
    transformFields,
    animationFields,
    layerFields,
    eventHandlerFields,
  ),
  [sceneNodeTypeName.text]: fields(
    [
      required("type", enumSchema(["Text"])),
      ...identityFields,
      required("font", stringSchema),
      optional("fontWeight", numberSchema),
      optional("fontStyle", enumSchema(["normal", "italic"])),
      optional("fallback", stringArraySchema),
      optional("fontVariationSettings", stringSchema),
      optional("fontFeatureSettings", stringSchema),
      optional("writingMode", enumSchema(["horizontal-tb", "vertical-rl"])),
      optional("textOrientation", enumSchema(["mixed", "upright"])),
      required("fontSizePx", numberSchema),
      optional("lineHeight", numberSchema),
      optional("lineHeightPx", numberSchema),
      optional("letterSpacingPx", numberSchema),
      optional("textIndent", numberSchema),
      ...textPaintFields,
      optional("animateUnits", recordSchema("textUnitAnimation")),
      optional("wrap", enumSchema(["none", "word", "char"])),
      optional("fit", enumSchema(["none", "shrink", "grow"])),
      optional("maxLines", numberSchema),
      optional("ellipsis", booleanSchema),
      optional("textAlign", enumSchema(["start", "center", "end"])),
      optional("preferredFrame", recordSchema("preferredFrame")),
      optional("language", enumSchema(["ja", "en", "auto"])),
      optional("hangingPunctuation", booleanSchema),
      optional("minFontSizePx", numberSchema),
      optional("shrinkEpsilonPx", numberSchema),
      optional("shrinkMaxIterations", numberSchema),
      optional("maxFontSizePx", numberSchema),
      optional("growEpsilonPx", numberSchema),
      optional("growMaxIterations", numberSchema),
      optional("fitMaxProbes", numberSchema),
      optional("whiteSpace", enumSchema(["normal", "nowrap", "pre-wrap"])),
      optional("tabSize", numberSchema),
      optional("flowExclusions", arraySchema({ kind: "discriminated", name: "flowExclusion" })),
      optional("flowMinRegionWidthPx", numberSchema),
      required("children", sceneChildren("text")),
    ],
    positionFields,
    boxModelFields,
    flexItemFields,
    gridItemFields,
    transformFields,
    animationFields,
    layerFields,
    eventHandlerFields,
    [optional("opacity", numberSchema), optional("zIndex", numberSchema)],
  ),
  [sceneNodeTypeName.textOnPath]: fields(
    [
      required("type", enumSchema(["TextOnPath"])),
      ...identityFields,
      required("d", stringSchema),
      required("width", numberSchema),
      required("height", numberSchema),
      required("font", stringSchema),
      optional("fallback", stringArraySchema),
      optional("fontWeight", numberSchema),
      optional("fontStyle", enumSchema(["normal", "italic"])),
      optional("fontVariationSettings", stringSchema),
      optional("fontFeatureSettings", stringSchema),
      required("fontSizePx", numberSchema),
      optional("letterSpacingPx", numberSchema),
      optional("language", enumSchema(["ja", "en", "auto"])),
      ...textPaintFields,
      optional("startOffsetPx", numberSchema),
      optional("textAnchor", enumSchema(["start", "middle", "end"])),
      optional("pathDirection", enumSchema(["forward", "reverse"])),
      optional("pathNormal", enumSchema(["left", "right"])),
      optional("pathOffsetPx", numberSchema),
      optional("pathFit", enumSchema(["none", "spacing", "scale", "shrink"])),
      optional("pathOverflow", enumSchema(["hidden", "error", "ellipsis"])),
      optional("animateUnits", recordSchema("textUnitAnimation")),
      optional("opacity", numberSchema),
      optional("zIndex", numberSchema),
      optional("margin", spacingSchema),
      required("children", sceneChildren("text-path")),
    ],
    positionFields,
    animationFields,
    layerFields,
    eventHandlerFields,
  ),
  [sceneNodeTypeName.inline]: fields([
    required("type", enumSchema(["Inline"])),
    optional("font", stringSchema),
    optional("fallback", stringArraySchema),
    optional("fontWeight", numberSchema),
    optional("fontStyle", enumSchema(["normal", "italic"])),
    optional("fontVariationSettings", stringSchema),
    optional("fontFeatureSettings", stringSchema),
    optional("textOrientation", enumSchema(["mixed", "upright"])),
    optional("textCombineUpright", enumSchema(["none", "all"])),
    optional("fontSizePx", numberSchema),
    optional("letterSpacingPx", numberSchema),
    optional("color", stringSchema),
    optional("textStrokes", arraySchema(recordSchema("textStroke"))),
    optional("textShadows", arraySchema(recordSchema("textShadow"))),
    optional(
      "textDecoration",
      oneOf("text-decoration", enumSchema(["none"]), recordSchema("textDecoration")),
    ),
    optional("language", enumSchema(["ja", "en", "auto"])),
    optional("paddingInline", paddingInlineSchema),
    optional("background", stringSchema),
    optional("borderColor", stringSchema),
    optional("borderWidth", numberSchema),
    optional("borderRadius", tupleSchema(numberSchema, numberSchema, numberSchema, numberSchema)),
    optional("animate", recordSchema("animation")),
    required("children", sceneChildren("inline")),
  ]),
  [sceneNodeTypeName.inlineBox]: fields([
    required("type", enumSchema(["InlineBox"])),
    optional("font", stringSchema),
    optional("fallback", stringArraySchema),
    optional("fontWeight", numberSchema),
    optional("fontStyle", enumSchema(["normal", "italic"])),
    optional("fontSizePx", numberSchema),
    optional("letterSpacingPx", numberSchema),
    optional("color", stringSchema),
    optional(
      "textDecoration",
      oneOf("text-decoration", enumSchema(["none"]), recordSchema("textDecoration")),
    ),
    optional("language", enumSchema(["ja", "en", "auto"])),
    optional("paddingInline", paddingInlineSchema),
    optional("background", stringSchema),
    optional("borderColor", stringSchema),
    optional("borderWidth", numberSchema),
    optional("borderRadius", numberSchema),
    optional("animate", recordSchema("animation")),
    required("children", sceneChildren("inline-box")),
  ]),
  [sceneNodeTypeName.inlineRect]: fields([
    required("type", enumSchema(["InlineRect"])),
    required("inlineSizePx", numberSchema),
    optional("blockSizePx", numberOrLineSchema),
    optional("advancePx", numberSchema),
    optional("blockAlign", enumSchema(["start", "center", "end"])),
    required("color", stringSchema),
    optional("borderRadiusPx", numberSchema),
    optional("opacity", numberSchema),
    optional("paintOrder", enumSchema(["behind", "front"])),
    optional("animate", recordSchema("animation")),
  ]),
  [sceneNodeTypeName.ruby]: fields([
    required("type", enumSchema(["Ruby"])),
    optional("rubyPosition", enumSchema(["over", "under", "alternate", "inter-character"])),
    optional("rubyAlign", enumSchema(["start", "center", "space-between", "space-around"])),
    optional("rubyGapPx", numberSchema),
    optional("rubyOffsetPx", numberSchema),
    optional("rubyLineSizing", enumSchema(["stable", "css"])),
    required("children", sceneChildren("ruby")),
  ]),
  [sceneNodeTypeName.rt]: fields([
    required("type", enumSchema(["Rt"])),
    optional("font", stringSchema),
    optional("fallback", stringArraySchema),
    optional("fontWeight", numberSchema),
    optional("fontStyle", enumSchema(["normal", "italic"])),
    optional("fontVariationSettings", stringSchema),
    optional("fontFeatureSettings", stringSchema),
    optional("fontSizePx", numberSchema),
    optional("lineHeight", numberSchema),
    optional("lineHeightPx", numberSchema),
    optional("letterSpacingPx", numberSchema),
    optional("color", stringSchema),
    optional(
      "textDecoration",
      oneOf("text-decoration", enumSchema(["none"]), recordSchema("textDecoration")),
    ),
    optional("language", enumSchema(["ja", "en", "auto"])),
    optional("textOrientation", enumSchema(["mixed", "upright"])),
    required("children", sceneChildren("rt")),
  ]),
  [sceneNodeTypeName.image]: fields(
    [
      required("type", enumSchema(["Image"])),
      ...identityFields,
      required("src", stringSchema),
      optional(
        "mediaType",
        enumSchema(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]),
      ),
      required("width", numberSchema),
      required("height", numberSchema),
      optional("objectFit", enumSchema(["fill", "contain", "cover"])),
      optional("objectPosition", stringSchema),
      optional("borderRadius", borderRadiusSchema),
      optional("opacity", numberSchema),
      optional("zIndex", numberSchema),
      optional("margin", spacingSchema),
    ],
    positionFields,
    flexItemFields,
    gridItemFields,
    transformFields,
    animationFields,
    layerFields,
    eventHandlerFields,
  ),
  [sceneNodeTypeName.path]: fields(
    [
      required("type", enumSchema(["Path"])),
      ...identityFields,
      required("d", stringSchema),
      required("width", numberSchema),
      required("height", numberSchema),
      ...shapePaintFields,
      optional("strokeScaling", enumSchema(["transform", "canvas"])),
      optional("opacity", numberSchema),
      optional("zIndex", numberSchema),
      optional("margin", spacingSchema),
    ],
    positionFields,
    flexItemFields,
    gridItemFields,
    transformFields,
    animationFields,
    layerFields,
    eventHandlerFields,
  ),
  [sceneNodeTypeName.svg]: fields(
    [
      required("type", enumSchema(["Svg"])),
      ...identityFields,
      required("content", stringSchema),
      required("width", numberSchema),
      required("height", numberSchema),
      optional("preserveAspectRatio", enumSchema(["none", "meet", "slice"])),
      optional("contentIdPrefix", stringSchema),
      optional("opacity", numberSchema),
      optional("zIndex", numberSchema),
      optional("margin", spacingSchema),
    ],
    positionFields,
    flexItemFields,
    gridItemFields,
    transformFields,
    animationFields,
    layerFields,
    eventHandlerFields,
  ),
  [sceneNodeTypeName.shape]: fields(
    [
      required("type", enumSchema(["Shape"])),
      ...identityFields,
      required("width", numberSchema),
      required("height", numberSchema),
      ...shapePaintFields,
      optional("preserveAspectRatio", enumSchema(["none", "meet", "slice"])),
      optional("emitPartIds", booleanSchema),
      optional("partPaint", partPaintMapSchema),
      optional("opacity", numberSchema),
      optional("zIndex", numberSchema),
      optional("margin", spacingSchema),
      optional("geometry", recordSchema("geometryDoc")),
      optional("geometryId", stringSchema),
    ],
    positionFields,
    flexItemFields,
    gridItemFields,
    transformFields,
    animationFields,
    layerFields,
    eventHandlerFields,
  ),
  [sceneNodeTypeName.symbol]: fields(
    [
      required("type", enumSchema(["Symbol"])),
      ...identityFields,
      required("width", numberSchema),
      required("height", numberSchema),
      ...shapePaintFields,
      optional("preserveAspectRatio", enumSchema(["none", "meet", "slice"])),
      optional("emitPartIds", booleanSchema),
      optional("partPaint", partPaintMapSchema),
      optional("opacity", numberSchema),
      optional("zIndex", numberSchema),
      optional("margin", spacingSchema),
      optional("symbol", recordSchema("symbolDefinition")),
      optional("symbolId", stringSchema),
    ],
    positionFields,
    flexItemFields,
    gridItemFields,
    transformFields,
    animationFields,
    layerFields,
    eventHandlerFields,
  ),
} as const satisfies Record<SceneNodeType, readonly SceneFieldSchema[]>;

type RequiredStringKeys<Value> = {
  [Key in keyof Value]-?: object extends Pick<Value, Key> ? never : Key;
}[keyof Value] &
  string;

type CatalogKeys<Fields extends readonly SceneFieldSchema[]> = Fields[number]["name"];
type CatalogRequiredKeys<Fields extends readonly SceneFieldSchema[]> = Extract<
  Fields[number],
  { readonly required: true }
>["name"];

type EqualSets<Left, Right> =
  Exclude<Left, Right> extends never ? (Exclude<Right, Left> extends never ? true : false) : false;

type NodeCatalogCheck<Type extends SceneNodeType> =
  EqualSets<
    keyof Extract<SceneNode, { type: Type }> & string,
    CatalogKeys<(typeof nodeFields)[Type]>
  > extends true
    ? EqualSets<
        RequiredStringKeys<Extract<SceneNode, { type: Type }>>,
        CatalogRequiredKeys<(typeof nodeFields)[Type]>
      > extends true
      ? true
      : never
    : never;

const NODE_CATALOG_COMPLETENESS: { readonly [Type in SceneNodeType]: NodeCatalogCheck<Type> } = {
  [sceneNodeTypeName.canvas]: true,
  [sceneNodeTypeName.flex]: true,
  [sceneNodeTypeName.grid]: true,
  [sceneNodeTypeName.box]: true,
  [sceneNodeTypeName.text]: true,
  [sceneNodeTypeName.textOnPath]: true,
  [sceneNodeTypeName.inline]: true,
  [sceneNodeTypeName.inlineBox]: true,
  [sceneNodeTypeName.inlineRect]: true,
  [sceneNodeTypeName.ruby]: true,
  [sceneNodeTypeName.rt]: true,
  [sceneNodeTypeName.image]: true,
  [sceneNodeTypeName.path]: true,
  [sceneNodeTypeName.svg]: true,
  [sceneNodeTypeName.shape]: true,
  [sceneNodeTypeName.symbol]: true,
};

void NODE_CATALOG_COMPLETENESS;

const textPathInlineFields = fields([
  required("type", enumSchema(["Inline"])),
  optional("font", stringSchema),
  optional("fallback", stringArraySchema),
  optional("fontWeight", numberSchema),
  optional("fontStyle", enumSchema(["normal", "italic"])),
  optional("fontVariationSettings", stringSchema),
  optional("fontFeatureSettings", stringSchema),
  optional("fontSizePx", numberSchema),
  optional("letterSpacingPx", numberSchema),
  optional("language", enumSchema(["ja", "en", "auto"])),
  optional("color", stringSchema),
  optional("textStrokes", arraySchema(recordSchema("textStroke"))),
  optional("textShadows", arraySchema(recordSchema("textShadow"))),
  optional(
    "textDecoration",
    oneOf("text-decoration", enumSchema(["none"]), recordSchema("textDecoration")),
  ),
  required("children", sceneChildren("text-path")),
]);

function catalogRecord(recordFields: readonly SceneFieldSchema[]): SceneRecordSchema {
  return { fields: recordFields, fieldNames: new Set(recordFields.map((field) => field.name)) };
}

const nestedFields = {
  transform: fields([
    optional("translateX", numberSchema),
    optional("translateY", numberSchema),
    optional("scaleX", numberSchema),
    optional("scaleY", numberSchema),
    optional("rotateDeg", numberSchema),
    optional("originX", numberSchema),
    optional("originY", numberSchema),
  ]),
  animationTransform: fields([
    optional("translateX", numberSchema),
    optional("translateY", numberSchema),
    optional("scaleX", numberSchema),
    optional("scaleY", numberSchema),
    optional("rotateDeg", numberSchema),
  ]),
  animationKeyframe: fields([
    required("at", numberSchema),
    optional("opacity", numberSchema),
    optional("transform", recordSchema("animationTransform")),
  ]),
  animation: fields([
    required("keyframes", arraySchema(recordSchema("animationKeyframe"))),
    required("durationMs", numberSchema),
    optional("delayMs", numberSchema),
    optional(
      "easing",
      oneOf(
        "animation-easing",
        enumSchema([
          "linear",
          "ease",
          "ease-in",
          "ease-out",
          "ease-in-out",
          "step-start",
          "step-end",
        ]),
        tupleSchema(numberSchema, numberSchema, numberSchema, numberSchema),
        { kind: "discriminated", name: "animationEasing" },
      ),
    ),
    optional("iterations", numberOrInfiniteSchema),
    optional("fill", enumSchema(["none", "both"])),
  ]),
  animationSpring: fields([
    required("type", enumSchema(["spring"])),
    optional("stiffness", numberSchema),
    optional("damping", numberSchema),
    optional("mass", numberSchema),
  ]),
  animationSteps: fields([
    required("type", enumSchema(["steps"])),
    required("count", numberSchema),
    optional("position", enumSchema(["jump-start", "jump-end", "jump-none", "jump-both"])),
  ]),
  textUnitAnimation: fields([
    required("by", enumSchema(["cluster", "line"])),
    required("animation", recordSchema("animation")),
    optional("delayStepMs", numberSchema),
    optional("order", enumSchema(["logical", "visual"])),
    optional("ruby", enumSchema(["with-base", "separate"])),
  ]),
  flowMargin: fields([
    optional("top", numberSchema),
    optional("right", numberSchema),
    optional("bottom", numberSchema),
    optional("left", numberSchema),
  ]),
  flowRect: fields([
    required("kind", enumSchema(["rect"])),
    required("x", numberSchema),
    required("y", numberSchema),
    required("width", numberSchema),
    required("height", numberSchema),
    optional("marginPx", oneOf("exclusion-margin", numberSchema, recordSchema("flowMargin"))),
  ]),
  flowCircle: fields([
    required("kind", enumSchema(["circle"])),
    required("cx", numberSchema),
    required("cy", numberSchema),
    required("r", numberSchema),
    optional("marginPx", oneOf("exclusion-margin", numberSchema, recordSchema("flowMargin"))),
  ]),
  flowPath: fields([
    required("kind", enumSchema(["path"])),
    required("d", stringSchema),
    optional("x", numberSchema),
    optional("y", numberSchema),
    optional("fillRule", enumSchema(["nonzero", "evenodd"])),
    optional("marginPx", oneOf("exclusion-margin", numberSchema, recordSchema("flowMargin"))),
  ]),
  textDecoration: fields([
    required(
      "line",
      oneOf(
        "decoration-line",
        enumSchema(["underline", "overline", "line-through"]),
        arraySchema(enumSchema(["underline", "overline", "line-through"])),
      ),
    ),
    optional("color", stringSchema),
    optional("style", enumSchema(["solid", "double", "dotted", "dashed", "wavy"])),
    optional("thicknessPx", numberSchema),
    optional("offsetPx", numberSchema),
    optional("skipInk", enumSchema(["none", "all"])),
  ]),
  textStroke: fields([
    required("color", stringSchema),
    required("widthPx", numberSchema),
    optional("linejoin", enumSchema(["miter", "round", "bevel"])),
    optional("linecap", enumSchema(["butt", "round", "square"])),
    optional("dasharray", stringSchema),
    optional("miterlimit", numberSchema),
  ]),
  textShadow: fields([
    required("dx", numberSchema),
    required("dy", numberSchema),
    optional("blurPx", numberSchema),
    required("color", stringSchema),
  ]),
  preferredFrame: fields([optional("w", numberSchema), optional("h", numberSchema)]),
  geometryViewBox: fields([
    optional("x", numberSchema),
    optional("y", numberSchema),
    required("width", numberSchema),
    required("height", numberSchema),
  ]),
  geometryPath: fields([
    required("kind", enumSchema(["path"])),
    optional("nodeId", stringSchema),
    required("d", stringSchema),
    optional("fillRule", enumSchema(["nonzero", "evenodd"])),
  ]),
  geometryGroup: fields([
    required("kind", enumSchema(["group"])),
    optional("nodeId", stringSchema),
    required("children", arraySchema({ kind: "discriminated", name: "geometryNode" })),
  ]),
  geometryTransform: fields([
    required("kind", enumSchema(["transform"])),
    optional("nodeId", stringSchema),
    required("transform", recordSchema("transform")),
    required("child", { kind: "discriminated", name: "geometryNode" }),
  ]),
  geometryBoolean: fields([
    required("kind", enumSchema(["boolean"])),
    optional("nodeId", stringSchema),
    required("op", enumSchema(["union", "subtract", "intersect", "xor"])),
    required("children", arraySchema({ kind: "discriminated", name: "geometryNode" })),
  ]),
  geometryDoc: fields([
    required("viewBox", recordSchema("geometryViewBox")),
    required("root", { kind: "discriminated", name: "geometryNode" }),
  ]),
  elasticFrame: fields([
    required("x", numberSchema),
    required("y", numberSchema),
    required("width", numberSchema),
    required("height", numberSchema),
  ]),
  elasticSegment: fields([
    required("nodeId", stringSchema),
    required("axis", enumSchema(["x", "y"])),
    required("role", enumSchema(["fixed-start", "stretch", "fixed-end"])),
    required("frame", recordSchema("elasticFrame")),
  ]),
  symbolDefinition: fields([
    required("geometry", recordSchema("geometryDoc")),
    optional("elasticSegments", arraySchema(recordSchema("elasticSegment"))),
  ]),
  partPaint: fields([
    optional("fill", stringSchema),
    optional("stroke", stringSchema),
    optional("strokeWidth", numberSchema),
    optional("strokeLinecap", enumSchema(["butt", "round", "square"])),
    optional("strokeLinejoin", enumSchema(["miter", "round", "bevel"])),
    optional("strokeDasharray", stringSchema),
    optional("strokeMiterlimit", numberSchema),
  ]),
} as const;

type NestedRecordTypes = {
  textPathInline: TextOnPathInlineSceneNode;
  transform: Transform2D;
  animationTransform: AnimationTransform2D;
  animationKeyframe: AnimationKeyframe;
  animation: AnimationSpec;
  animationSpring: AnimationSpring;
  animationSteps: Extract<AnimationEasing, { type: "steps" }>;
  textUnitAnimation: TextUnitAnimation;
  flowMargin: Extract<TextFlowExclusionMarginPx, object>;
  flowRect: Extract<TextFlowExclusion, { kind: "rect" }>;
  flowCircle: Extract<TextFlowExclusion, { kind: "circle" }>;
  flowPath: Extract<TextFlowExclusion, { kind: "path" }>;
  textDecoration: Extract<TextDecoration, object>;
  textStroke: TextStrokeLayer;
  textShadow: TextShadowLayer;
  preferredFrame: NonNullable<Extract<SceneNode, { type: "Text" }>["preferredFrame"]>;
  geometryViewBox: GeometryViewBox;
  geometryPath: Extract<GeometryNode, { kind: "path" }>;
  geometryGroup: Extract<GeometryNode, { kind: "group" }>;
  geometryTransform: Extract<GeometryNode, { kind: "transform" }>;
  geometryBoolean: Extract<GeometryNode, { kind: "boolean" }>;
  geometryDoc: GeometryDoc;
  elasticFrame: ElasticSegment["frame"];
  elasticSegment: ElasticSegment;
  symbolDefinition: SymbolDefinition;
  partPaint: PartPaintOverride;
};

type NestedFields = typeof nestedFields & { readonly textPathInline: typeof textPathInlineFields };
type NestedCatalogCheck<Name extends keyof NestedRecordTypes> =
  EqualSets<keyof NestedRecordTypes[Name] & string, CatalogKeys<NestedFields[Name]>> extends true
    ? EqualSets<
        RequiredStringKeys<NestedRecordTypes[Name]>,
        CatalogRequiredKeys<NestedFields[Name]>
      > extends true
      ? true
      : never
    : never;

const NESTED_CATALOG_COMPLETENESS: {
  readonly [Name in keyof NestedRecordTypes]: NestedCatalogCheck<Name>;
} = {
  textPathInline: true,
  transform: true,
  animationTransform: true,
  animationKeyframe: true,
  animation: true,
  animationSpring: true,
  animationSteps: true,
  textUnitAnimation: true,
  flowMargin: true,
  flowRect: true,
  flowCircle: true,
  flowPath: true,
  textDecoration: true,
  textStroke: true,
  textShadow: true,
  preferredFrame: true,
  geometryViewBox: true,
  geometryPath: true,
  geometryGroup: true,
  geometryTransform: true,
  geometryBoolean: true,
  geometryDoc: true,
  elasticFrame: true,
  elasticSegment: true,
  symbolDefinition: true,
  partPaint: true,
};

void NESTED_CATALOG_COMPLETENESS;

export const RECORD_SCHEMAS: Readonly<Record<RecordSchemaName, SceneRecordSchema>> = {
  [sceneNodeTypeName.canvas]: catalogRecord(nodeFields[sceneNodeTypeName.canvas]),
  [sceneNodeTypeName.flex]: catalogRecord(nodeFields[sceneNodeTypeName.flex]),
  [sceneNodeTypeName.grid]: catalogRecord(nodeFields[sceneNodeTypeName.grid]),
  [sceneNodeTypeName.box]: catalogRecord(nodeFields[sceneNodeTypeName.box]),
  [sceneNodeTypeName.text]: catalogRecord(nodeFields[sceneNodeTypeName.text]),
  [sceneNodeTypeName.textOnPath]: catalogRecord(nodeFields[sceneNodeTypeName.textOnPath]),
  [sceneNodeTypeName.inline]: catalogRecord(nodeFields[sceneNodeTypeName.inline]),
  [sceneNodeTypeName.inlineBox]: catalogRecord(nodeFields[sceneNodeTypeName.inlineBox]),
  [sceneNodeTypeName.inlineRect]: catalogRecord(nodeFields[sceneNodeTypeName.inlineRect]),
  [sceneNodeTypeName.ruby]: catalogRecord(nodeFields[sceneNodeTypeName.ruby]),
  [sceneNodeTypeName.rt]: catalogRecord(nodeFields[sceneNodeTypeName.rt]),
  [sceneNodeTypeName.image]: catalogRecord(nodeFields[sceneNodeTypeName.image]),
  [sceneNodeTypeName.path]: catalogRecord(nodeFields[sceneNodeTypeName.path]),
  [sceneNodeTypeName.svg]: catalogRecord(nodeFields[sceneNodeTypeName.svg]),
  [sceneNodeTypeName.shape]: catalogRecord(nodeFields[sceneNodeTypeName.shape]),
  [sceneNodeTypeName.symbol]: catalogRecord(nodeFields[sceneNodeTypeName.symbol]),
  textPathInline: catalogRecord(textPathInlineFields),
  transform: catalogRecord(nestedFields.transform),
  animationTransform: catalogRecord(nestedFields.animationTransform),
  animationKeyframe: catalogRecord(nestedFields.animationKeyframe),
  animation: catalogRecord(nestedFields.animation),
  animationSpring: catalogRecord(nestedFields.animationSpring),
  animationSteps: catalogRecord(nestedFields.animationSteps),
  textUnitAnimation: catalogRecord(nestedFields.textUnitAnimation),
  flowMargin: catalogRecord(nestedFields.flowMargin),
  flowRect: catalogRecord(nestedFields.flowRect),
  flowCircle: catalogRecord(nestedFields.flowCircle),
  flowPath: catalogRecord(nestedFields.flowPath),
  textDecoration: catalogRecord(nestedFields.textDecoration),
  textStroke: catalogRecord(nestedFields.textStroke),
  textShadow: catalogRecord(nestedFields.textShadow),
  preferredFrame: catalogRecord(nestedFields.preferredFrame),
  geometryViewBox: catalogRecord(nestedFields.geometryViewBox),
  geometryPath: catalogRecord(nestedFields.geometryPath),
  geometryGroup: catalogRecord(nestedFields.geometryGroup),
  geometryTransform: catalogRecord(nestedFields.geometryTransform),
  geometryBoolean: catalogRecord(nestedFields.geometryBoolean),
  geometryDoc: catalogRecord(nestedFields.geometryDoc),
  elasticFrame: catalogRecord(nestedFields.elasticFrame),
  elasticSegment: catalogRecord(nestedFields.elasticSegment),
  symbolDefinition: catalogRecord(nestedFields.symbolDefinition),
  partPaint: catalogRecord(nestedFields.partPaint),
};

export type DiscriminatedSchemaName = "animationEasing" | "flowExclusion" | "geometryNode";

type DiscriminatedSchema = {
  readonly discriminant: "type" | "kind";
  readonly expected: SceneDecodeExpected;
  readonly variants: Readonly<Record<string, RecordSchemaName>>;
};

export const DISCRIMINATED_SCHEMAS: Readonly<Record<DiscriminatedSchemaName, DiscriminatedSchema>> =
  {
    animationEasing: {
      discriminant: "type",
      expected: "animation-easing",
      variants: { spring: "animationSpring", steps: "animationSteps" },
    },
    flowExclusion: {
      discriminant: "kind",
      expected: "record",
      variants: { rect: "flowRect", circle: "flowCircle", path: "flowPath" },
    },
    geometryNode: {
      discriminant: "kind",
      expected: "geometry-node",
      variants: {
        path: "geometryPath",
        group: "geometryGroup",
        transform: "geometryTransform",
        boolean: "geometryBoolean",
      },
    },
  };

export const SCENE_NODE_SCHEMA = { kind: "scene-node" } as const satisfies SceneSchema;

export function isSceneNodeType(value: string): value is SceneNodeType {
  return reflectApply(setPrototypeHas, SCENE_NODE_TYPE_SET, [value]) as boolean;
}

export function childExpected(grammar: SceneChildGrammar): SceneDecodeExpected {
  switch (grammar) {
    case "scene":
      return "scene-child";
    case "text":
      return "text-child";
    case "text-path":
      return "text-path-child";
    case "inline":
      return "inline-child";
    case "inline-box":
      return "inline-box-child";
    case "ruby":
      return "ruby-child";
    case "rt":
      return "rt-child";
  }
}

export function childRecordName(
  grammar: SceneChildGrammar,
  type: SceneNodeType,
): RecordSchemaName | undefined {
  switch (grammar) {
    case "scene":
      return type;
    case "text":
      return type === "Inline" || type === "InlineBox" || type === "InlineRect" || type === "Ruby"
        ? type
        : undefined;
    case "text-path":
      return type === "Inline" ? "textPathInline" : undefined;
    case "inline":
      return type === "Inline" || type === "InlineRect" || type === "Ruby" ? type : undefined;
    case "inline-box":
      return type === "Inline" || type === "InlineBox" || type === "InlineRect" || type === "Ruby"
        ? type
        : undefined;
    case "ruby":
      return type === "Inline" || type === "Rt" ? type : undefined;
    case "rt":
      return type === "Inline" ? type : undefined;
  }
}
