import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_ANIMATION_FRAGMENTS,
  MAX_TEXT_ANIMATION_UNITS,
  TEXT_ANIMATION_FRAGMENT_WARNING_THRESHOLD,
  TEXT_ANIMATION_UNIT_WARNING_THRESHOLD,
} from "../../src/text/types.js";

type RustField = { name: string; required: boolean };
type RustVariant = { name: string; fields: RustField[] };
type RustDto = {
  name: string;
  direction: "deserialize" | "serialize";
  fields: RustField[];
  variants: RustVariant[];
  serdeAttributes: string[];
};
type RustInventory = { deriveCount: number; dtos: Map<string, RustDto> };

type TypeTarget = {
  file: string;
  typeName: string;
  path?: string[];
  selectObject?: boolean;
  intentionallyIgnoredTsFields?: string[];
  /**
   * Reviewed serialize-direction exceptions where a Rust field may be omitted
   * although the corresponding TS bridge field is required. Each exception
   * must name the exact field and is checked for staleness.
   */
  intentionallyOptionalRustFields?: string[];
};

type PayloadTarget = {
  file: string;
  functionNames: string[];
};

type FieldShape = Map<string, boolean>;

const repoRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const wasmIndexFile = "packages/core/src/wasm/index.ts";
const protocolDecoderFile = "packages/core/src/wasm/protocol-decoders.ts";
const layoutAdapterFile = "packages/core/src/layout/taffy-layout-adapter.ts";
const irTypesFile = "packages/core/src/ir/types.ts";
const generatedIrTypesFile = "packages/core/src/generated/ir/structural-ir.ts";
const textTypesFile = "packages/core/src/text/types.ts";

const typeTargets: Record<string, TypeTarget[]> = {
  AnimationKeyframe: [{ file: "packages/core/src/vnode/types.ts", typeName: "AnimationKeyframe" }],
  AnimationSpec: [{ file: "packages/core/src/vnode/types.ts", typeName: "AnimationSpec" }],
  AffineMatrixDto: [{ file: "packages/core/src/engine.ts", typeName: "AnimationAffineMatrix" }],
  AnimationSpring: [{ file: "packages/core/src/vnode/types.ts", typeName: "AnimationSpring" }],
  AnimationStateSample: [{ file: protocolDecoderFile, typeName: "DecodedAnimationStateSample" }],
  AnimationSteps: [{ file: "packages/core/src/vnode/types.ts", typeName: "AnimationSteps" }],
  AnimationTransform2D: [
    { file: "packages/core/src/vnode/types.ts", typeName: "AnimationTransform2D" },
  ],
  FlowBox: [
    { file: wasmIndexFile, typeName: "TextFlowWithExclusionsInput", path: ["flowBox"] },
    { file: wasmIndexFile, typeName: "ShrinkwrapFlowInput", path: ["flowBox"] },
  ],
  FlowExclusionMarginEdges: [
    { file: wasmIndexFile, typeName: "FlowExclusionMarginPx", selectObject: true },
  ],
  FlowTextSpanDto: [{ file: wasmIndexFile, typeName: "TextMeasureSpan" }],
  IntrinsicInlineSizeInput: [{ file: wasmIndexFile, typeName: "IntrinsicInlineSizeInput" }],
  IntrinsicInlineSizeResult: [{ file: wasmIndexFile, typeName: "IntrinsicInlineSizeResult" }],
  MeasureTextBlockInput: [{ file: wasmIndexFile, typeName: "MeasureTextBlockInput" }],
  MeasureTextBlockLineDto: [{ file: wasmIndexFile, typeName: "MeasureTextBlockLine" }],
  MeasureTextBlockResult: [{ file: wasmIndexFile, typeName: "MeasureTextBlockResult" }],
  ShrinkwrapFlowInput: [{ file: wasmIndexFile, typeName: "ShrinkwrapFlowInput" }],
  ShrinkwrapFlowResultDto: [{ file: wasmIndexFile, typeName: "ShrinkwrapFlowResult" }],
  ShrinkwrapTextInput: [{ file: wasmIndexFile, typeName: "ShrinkwrapTextInput" }],
  ShrinkwrapTextResult: [{ file: wasmIndexFile, typeName: "ShrinkwrapTextResult" }],
  TextFlowExclusionLine: [{ file: wasmIndexFile, typeName: "TextFlowExclusionLine" }],
  TextFlowFragment: [{ file: wasmIndexFile, typeName: "TextFlowFragment" }],
  TextFlowFragmentStyle: [{ file: wasmIndexFile, typeName: "TextFlowFragmentStyle" }],
  TextFlowInput: [{ file: wasmIndexFile, typeName: "TextFlowInput" }],
  TextFlowLayoutInput: [{ file: layoutAdapterFile, typeName: "WasmTextInput", path: ["flow"] }],
  TextFlowLine: [{ file: wasmIndexFile, typeName: "TextFlowLine" }],
  TextFlowResult: [{ file: wasmIndexFile, typeName: "TextFlowResult" }],
  TextFlowRubyAnnotation: [{ file: wasmIndexFile, typeName: "TextFlowRubyAnnotation" }],
  TextFlowRubyAnnotationLevel: [
    { file: wasmIndexFile, typeName: "TextFlowRubyAnnotation", path: ["levels", "[]"] },
  ],
  TextFlowRubyAnnotationRun: [
    {
      file: wasmIndexFile,
      typeName: "TextFlowRubyAnnotation",
      path: ["levels", "[]", "runs", "[]"],
    },
  ],
  TextFlowWithExclusionsInput: [{ file: wasmIndexFile, typeName: "TextFlowWithExclusionsInput" }],
  TextFlowWithExclusionsResult: [{ file: wasmIndexFile, typeName: "TextFlowWithExclusionsResult" }],
  FontInput: [{ file: layoutAdapterFile, typeName: "WasmFontInput" }],
  HandlersInput: [{ file: irTypesFile, typeName: "HandlersRef" }],
  // IR output DTOs (serialize direction — the public TS IR contract)
  BBox: [{ file: textTypesFile, typeName: "BBox" }],
  BorderRadii: [{ file: irTypesFile, typeName: "BorderRadii" }],
  BoxShadow: [{ file: irTypesFile, typeName: "IRNode", path: ["boxShadow"] }],
  GradientStop: [{ file: irTypesFile, typeName: "IRNode", path: ["gradient", "stops", "[]"] }],
  RadialGradientGeometry: [
    { file: irTypesFile, typeName: "IRNode", path: ["gradient", "geometry"] },
  ],
  HandlersRef: [{ file: irTypesFile, typeName: "HandlersRef" }],
  StructuralIr: [{ file: generatedIrTypesFile, typeName: "GeneratedStructuralIr" }],
  SerializedFatalError: [{ file: "packages/core/src/errors.ts", typeName: "SerializedFatalError" }],
  SerializedRecoverableError: [
    { file: "packages/core/src/errors.ts", typeName: "SerializedRecoverableError" },
  ],
  RenderToIrOutput: [{ file: "packages/core/src/wasm/types.ts", typeName: "RenderToIrEnvelope" }],
  OutlineGlyphLimitExceeded: [
    {
      file: "packages/core/src/wasm/types.ts",
      typeName: "PngOutlineGlyphLimitExceeded",
    },
  ],
  RenderToSvgOutput: [{ file: "packages/core/src/wasm/types.ts", typeName: "RenderToSvgEnvelope" }],
  RenderSvgOptionsInput: [
    {
      file: "packages/core/src/engine.ts",
      typeName: "InternalRenderOptions",
      intentionallyIgnoredTsFields: [
        "skipValidation",
        "rasterBackground",
        "rasterOversizeBehavior",
        "onPngResolutionAdjusted",
        "onWarning",
        "playback",
      ],
    },
  ],
  StaticSvgOptionsInput: [
    {
      file: "packages/core/src/engine.ts",
      typeName: "RenderSvgOptions",
      intentionallyIgnoredTsFields: ["skipValidation", "onWarning"],
    },
  ],
  AnimatedSvgOptionsInput: [
    {
      file: "packages/core/src/engine.ts",
      typeName: "RenderAnimatedSvgOptions",
      intentionallyIgnoredTsFields: ["skipValidation", "onWarning"],
    },
  ],
  OutputGenerator: [
    { file: "packages/core/src/engine.ts", typeName: "OutputGenerator" },
    { file: wasmIndexFile, typeName: "PngRenderOptions", path: ["generator"] },
  ],
  DebugOverlayConfigInput: [
    { file: "packages/core/src/svg/types.ts", typeName: "DebugOverlayConfig" },
  ],
  EmitIrInput: [
    {
      file: irTypesFile,
      typeName: "IR",
      // drawOrder/warnings are not read by SVG emission; the Rust input DTO
      // deliberately omits them.
      intentionallyIgnoredTsFields: ["drawOrder", "warnings"],
    },
  ],
  LineWire: [{ file: textTypesFile, typeName: "Line" }],
  LineFragmentWire: [{ file: textTypesFile, typeName: "LineFragment" }],
  TextOutlinePath: [{ file: textTypesFile, typeName: "TextOutlinePath" }],
  TextUnitAnimation: [{ file: "packages/core/src/vnode/types.ts", typeName: "TextUnitAnimation" }],
  TextUnitAnimationSample: [{ file: irTypesFile, typeName: "IRTextUnitAnimationSample" }],
  TextStrokeLayer: [{ file: textTypesFile, typeName: "TextStrokeLayer" }],
  TextShadowLayer: [{ file: textTypesFile, typeName: "TextShadowLayer" }],
  ShapePartBounds: [{ file: "packages/core/src/shape/types.ts", typeName: "GeometryPartBounds" }],
  ShapePartPaint: [{ file: irTypesFile, typeName: "ShapePathPart", path: ["paint"] }],
  ShapePathPart: [{ file: irTypesFile, typeName: "ShapePathPart" }],
  LineProjection: [{ file: textTypesFile, typeName: "Line" }],
  FragmentProjection: [{ file: textTypesFile, typeName: "LineFragment" }],
  TextRunStyleProjection: [{ file: textTypesFile, typeName: "TextRunStyle" }],
  ImageInput: [{ file: layoutAdapterFile, typeName: "WasmImageInput" }],
  LayoutInput: [{ file: layoutAdapterFile, typeName: "WasmLayoutInput" }],
  LayoutTransitionCheckpointInput: [
    {
      file: "packages/core/src/layout-transition.ts",
      typeName: "ResolvedLayoutTransitionInput",
      path: ["wirePlan", "checkpoints", "[]"],
    },
  ],
  LayoutTransitionCompileOptionsInput: [
    {
      file: "packages/core/src/engine.ts",
      typeName: "CompileOptions",
      intentionallyIgnoredTsFields: ["skipValidation"],
    },
  ],
  LayoutTransitionPlanInput: [
    {
      file: "packages/core/src/layout-transition.ts",
      typeName: "ResolvedLayoutTransitionInput",
      path: ["wirePlan"],
    },
  ],
  LayoutNodeInput: [{ file: layoutAdapterFile, typeName: "WasmNodeInput" }],
  LayoutNodeOutput: [{ file: layoutAdapterFile, typeName: "WasmNodeOutput" }],
  LayoutOutput: [{ file: layoutAdapterFile, typeName: "WasmLayoutOutput" }],
  PartPaintOverrideInput: [
    { file: "packages/core/src/vnode/types.ts", typeName: "PartPaintOverride" },
  ],
  TextUnitGlyphMember: [{ file: textTypesFile, typeName: "TextUnitGlyphMember" }],
  TextUnitMapEntry: [{ file: textTypesFile, typeName: "TextUnitMapEntry" }],
  TextUnitMap: [{ file: textTypesFile, typeName: "TextUnitMap" }],
  VisualInput: [{ file: layoutAdapterFile, typeName: "WasmVisualInput" }],
  PreferredFrame: [
    { file: layoutAdapterFile, typeName: "WasmTextInput", path: ["preferredFrame"] },
  ],
  TaffyStyleInput: [{ file: layoutAdapterFile, typeName: "WasmStyleInput" }],
  TextInput: [{ file: layoutAdapterFile, typeName: "WasmTextInput" }],
  TextPathInput: [{ file: layoutAdapterFile, typeName: "WasmTextPathInput" }],
  TextPathMetadata: [{ file: irTypesFile, typeName: "IRTextNode", path: ["textPath"] }],
  TextUnitMapRequest: [{ file: layoutAdapterFile, typeName: "WasmTextUnitMapRequest" }],
  TextLayoutOutput: [{ file: layoutAdapterFile, typeName: "WasmNodeOutput", path: ["textLayout"] }],
  PositionedGlyphPathRequest: [
    {
      file: wasmIndexFile,
      typeName: "PositionedGlyphPathRequest",
      // These fields are TS-side outline-resolution metadata. Rust serde accepts unknown keys,
      // and positioned extraction consumes only the already-resolved glyph/font coordinates.
      intentionallyIgnoredTsFields: ["fontFallback", "text"],
    },
  ],
  ValidateLayeredSvgCompositionInput: [
    { file: wasmIndexFile, typeName: "WasmLayeredCompositionValidationInput" },
  ],
  FontFamilyConfig: [{ file: wasmIndexFile, typeName: "PngRenderOptions", path: ["fontFamilies"] }],
  LayeredCompositionValidationMetrics: [
    { file: wasmIndexFile, typeName: "WasmLayeredCompositionValidationMetrics" },
  ],
  LayeredSvgValidationLayerInput: [
    {
      file: wasmIndexFile,
      typeName: "WasmLayeredCompositionValidationInput",
      path: ["layers", "[]"],
    },
  ],
  RasterizeOptions: [
    { file: wasmIndexFile, typeName: "PngRenderOptions" },
    { file: wasmIndexFile, typeName: "WasmLayeredCompositionValidationInput", path: ["options"] },
  ],
  AnimationEncodeInput: [{ file: wasmIndexFile, typeName: "AnimationEncodeInput" }],
  AnimationFrameInput: [
    { file: wasmIndexFile, typeName: "AnimationEncodeInput", path: ["frames", "[]"] },
  ],
};

const payloadTargets: Record<string, PayloadTarget> = {
  CompileShapeSvgInput: {
    file: wasmIndexFile,
    functionNames: ["wasmCompileShapeSvg", "wasmCompileShapePaths"],
  },
  EvaluateShapePartsInput: { file: wasmIndexFile, functionNames: ["wasmEvaluateShapeParts"] },
  EvaluateShapeRegionInput: { file: wasmIndexFile, functionNames: ["wasmEvaluateShapeRegion"] },
  HitTestShapePartsInput: { file: wasmIndexFile, functionNames: ["wasmHitTestShapeParts"] },
  RenderShapeRegionSvgInput: {
    file: wasmIndexFile,
    functionNames: ["wasmRenderShapeRegionSvg"],
  },
  ResolveSymbolGeometryInput: {
    file: wasmIndexFile,
    functionNames: ["wasmResolveSymbolGeometry"],
  },
  ShapeBooleanPairInput: {
    file: wasmIndexFile,
    functionNames: ["wasmDivideShapeRegions", "wasmComputeShapeIntersections"],
  },
};

const unitEnumTargets: Record<string, TypeTarget> = {
  AnimationRenderModeInput: {
    file: "packages/core/src/engine.ts",
    typeName: "InternalRenderOptions",
    path: ["animation"],
  },
  FillRule: { file: wasmIndexFile, typeName: "FlowExclusionShape", path: ["fillRule"] },
  FlowOverflowReason: { file: wasmIndexFile, typeName: "FlowOverflowReason" },
  ShrinkwrapStatusDto: { file: wasmIndexFile, typeName: "ShrinkwrapStatus" },
  OversizeBehavior: {
    file: wasmIndexFile,
    typeName: "PngRenderOptions",
    path: ["oversizeBehavior"],
  },
  // IR output enums (serialize direction)
  FatalSeverity: {
    file: "packages/core/src/errors.ts",
    typeName: "SerializedFatalError",
    path: ["severity"],
  },
  RecoverableSeverity: {
    file: "packages/core/src/errors.ts",
    typeName: "SerializedRecoverableError",
    path: ["severity"],
  },
  PipelineStage: { file: "packages/core/src/errors.ts", typeName: "PipelineStage" },
  StrokeLinecap: { file: irTypesFile, typeName: "IRNode", path: ["strokeLinecap"] },
  StrokeLinejoin: { file: irTypesFile, typeName: "IRNode", path: ["strokeLinejoin"] },
  StrokeScaling: { file: irTypesFile, typeName: "IRNode", path: ["strokeScaling"] },
  IrFillRule: { file: irTypesFile, typeName: "IRNode", path: ["fillRule"] },
  IrTextAlign: { file: irTypesFile, typeName: "IRNode", path: ["textAlign"] },
  NodeIdMetadataInput: {
    file: "packages/core/src/engine.ts",
    typeName: "SvgEmissionOptions",
    path: ["nodeIdMetadata"],
  },
  TextUnitKind: { file: textTypesFile, typeName: "TextUnitKind" },
  TextUnitAnimationOrder: {
    file: "packages/core/src/vnode/types.ts",
    typeName: "TextUnitAnimation",
    path: ["order"],
  },
  TextUnitRubyMode: { file: textTypesFile, typeName: "TextUnitRubyMode" },
  TextUnitSourceRole: { file: textTypesFile, typeName: "TextUnitSourceRole" },
};

function walkRustFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return walkRustFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".rs") ? [entryPath] : [];
  });
}

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === "{") {
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function serdeAttributes(value: string): string[] {
  return [...value.matchAll(/#\[serde\(([\s\S]*?)\)\]/g)].map((match) =>
    (match[1] ?? "").replace(/\s+/g, " ").trim(),
  );
}

function serdeSetting(attributes: string[], name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`);
  for (const attribute of attributes) {
    const match = attribute.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function renameIdentifier(value: string, rule: string | null): string {
  if (rule === "lowercase") {
    return value.toLowerCase();
  }
  if (rule !== "camelCase" && rule !== "kebab-case") {
    return value;
  }
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (rule === "kebab-case") {
    return words.join("-");
  }
  return words
    .map((word, index) => (index === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join("");
}

function wireName(name: string, attributes: string[], renameAll: string | null): string {
  return serdeSetting(attributes, "rename") ?? renameIdentifier(name, renameAll);
}

function parseRustFields(
  body: string,
  direction: RustDto["direction"],
  renameAll: string | null,
): RustField[] {
  const fields: RustField[] = [];
  const fieldPattern =
    /(?:^|\n)\s*((?:#\[[^\]]+\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?([A-Za-z_]\w*)\s*:\s*([^,\n]+)/g;
  for (const match of body.matchAll(fieldPattern)) {
    const attributes = serdeAttributes(match[1] ?? "");
    const rustType = (match[3] ?? "").trim();
    const optionalInput =
      rustType.includes("Option<") || attributes.some((item) => /\bdefault\b/.test(item));
    const optionalOutput = attributes.some((item) => /\bskip_serializing_if\b/.test(item));
    fields.push({
      name: wireName(match[2] ?? "", attributes, renameAll),
      required: direction === "deserialize" ? !optionalInput : !optionalOutput,
    });
  }
  return fields;
}

function updateNestingDepth(line: string, initialDepth: number): number {
  let depth = initialDepth;
  for (const character of line) {
    if ("{([".includes(character)) {
      depth += 1;
    } else if ("})]".includes(character)) {
      depth = Math.max(0, depth - 1);
    }
  }
  return depth;
}

function parseRustVariantFields(
  text: string,
  line: string,
  variantName: string,
  bodyOpenIndex: number,
  bodyOffset: number,
  direction: RustDto["direction"],
  renameAllFields: string | null,
): RustField[] {
  const variantOpenOffset = line.indexOf("{", line.indexOf(variantName) + variantName.length);
  if (variantOpenOffset < 0) {
    return [];
  }
  const variantOpenIndex = bodyOpenIndex + 1 + bodyOffset + variantOpenOffset;
  const variantCloseIndex = findMatchingBrace(text, variantOpenIndex);
  return parseRustFields(
    text.slice(variantOpenIndex + 1, variantCloseIndex),
    direction,
    renameAllFields,
  );
}

function parseRustVariants(
  text: string,
  body: string,
  bodyOpenIndex: number,
  direction: RustDto["direction"],
  attributes: string[],
  renameAll: string | null,
): RustVariant[] {
  const variants: RustVariant[] = [];
  let nesting = 0;
  let bodyOffset = 0;
  let pendingAttributes = "";
  for (const line of body.split("\n")) {
    if (nesting === 0 && /^\s*#\[/.test(line)) {
      pendingAttributes += `${line}\n`;
    }
    const variantMatch = nesting === 0 ? line.match(/^\s*([A-Z][A-Za-z0-9_]*)\b/) : null;
    const variantName = variantMatch?.[1];
    if (variantName) {
      variants.push({
        name: wireName(variantName, serdeAttributes(pendingAttributes), renameAll),
        fields: parseRustVariantFields(
          text,
          line,
          variantName,
          bodyOpenIndex,
          bodyOffset,
          direction,
          serdeSetting(attributes, "rename_all_fields") ?? renameAll,
        ),
      });
      pendingAttributes = "";
    } else if (nesting === 0 && line.trim() !== "" && !/^\s*#\[/.test(line)) {
      pendingAttributes = "";
    }
    nesting = updateNestingDepth(line, nesting);
    bodyOffset += line.length + 1;
  }
  return variants;
}

function parseRustDto(text: string, deriveMatch: RegExpMatchArray): RustDto | null {
  const windowStart = (deriveMatch.index ?? 0) + deriveMatch[0].length;
  const declarationWindow = text.slice(windowStart, windowStart + 1800);
  const declarationMatch = declarationWindow.match(
    /(?:#\[[^\]]+\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(struct|enum)\s+([A-Za-z_]\w*)[^{;]*(\{|;)/,
  );
  if (!declarationMatch || declarationMatch[3] !== "{") {
    return null;
  }
  const direction = /(?:^|\W)Deserialize(?:$|\W)/.test(deriveMatch[1] ?? "")
    ? "deserialize"
    : "serialize";
  const declarationIndex = windowStart + declarationWindow.indexOf(declarationMatch[0]);
  const openIndex = declarationIndex + declarationMatch[0].lastIndexOf("{");
  const closeIndex = findMatchingBrace(text, openIndex);
  if (closeIndex < 0) {
    return null;
  }
  const name = declarationMatch[2] ?? "";
  const attributes = serdeAttributes(text.slice(windowStart, openIndex));
  const renameAll = serdeSetting(attributes, "rename_all");
  const body = text.slice(openIndex + 1, closeIndex);
  const isStruct = declarationMatch[1] === "struct";
  return {
    name,
    direction,
    fields: isStruct ? parseRustFields(body, direction, renameAll) : [],
    variants: isStruct
      ? []
      : parseRustVariants(text, body, openIndex, direction, attributes, renameAll),
    serdeAttributes: attributes,
  };
}

function parseRustDtos(): RustInventory {
  const dtos = new Map<string, RustDto>();
  let deriveCount = 0;
  const rustRoot = resolve(repoRoot, "crates/boundsvg/src");
  const rustSources: Array<{ path: string; includeNames?: ReadonlySet<string> }> = [
    ...walkRustFiles(rustRoot).map((path) => ({ path })),
    { path: resolve(repoRoot, "crates/boundtext/src/text/unit_map.rs") },
    {
      path: resolve(repoRoot, "crates/boundtext/src/text/types.rs"),
      includeNames: new Set(["TextStrokeLayer", "TextShadowLayer"]),
    },
  ];
  for (const rustSource of rustSources) {
    const text = readFileSync(rustSource.path, "utf8");
    const derivePattern = /#\[derive\(([^)]*(?:Serialize|Deserialize)[^)]*)\)\]/g;
    for (const deriveMatch of text.matchAll(derivePattern)) {
      const dto = parseRustDto(text, deriveMatch);
      if (!dto || (rustSource.includeNames && !rustSource.includeNames.has(dto.name))) {
        continue;
      }
      deriveCount += 1;
      dtos.set(dto.name, dto);
    }
  }
  return { deriveCount, dtos };
}

function createTypeProgram(): { checker: ts.TypeChecker; program: ts.Program } {
  const configPath = resolve(repoRoot, "packages/core/tsconfig.build.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    resolve(repoRoot, "packages/core"),
  );
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  return { checker: program.getTypeChecker(), program };
}

function expandTypes(types: ts.Type[]): ts.Type[] {
  return types
    .flatMap((type) => (type.isUnion() ? expandTypes(type.types) : [type]))
    .filter(
      (type) =>
        (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never)) === 0,
    );
}

function includesUndefined(type: ts.Type): boolean {
  return (
    (type.flags & ts.TypeFlags.Undefined) !== 0 ||
    (type.isUnion() && type.types.some(includesUndefined))
  );
}

function declarationType(
  program: ts.Program,
  checker: ts.TypeChecker,
  target: TypeTarget,
): ts.Type[] {
  const source = program.getSourceFile(resolve(repoRoot, target.file));
  if (!source) {
    throw new TypeError(`missing TypeScript source: ${target.file}`);
  }
  const declaration = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
      (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) &&
      statement.name.text === target.typeName,
  );
  if (!declaration) {
    throw new TypeError(`missing TypeScript type: ${target.file}#${target.typeName}`);
  }
  let types = [checker.getTypeAtLocation(declaration.name)];
  for (const segment of target.path ?? []) {
    if (segment === "[]") {
      types = expandTypes(types).flatMap((type) => {
        const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
        return element ? [element] : [];
      });
      continue;
    }
    types = expandTypes(types).flatMap((type) => {
      const property = checker.getPropertyOfType(type, segment);
      const location = property?.valueDeclaration ?? property?.declarations?.[0];
      return property && location ? [checker.getTypeOfSymbolAtLocation(property, location)] : [];
    });
  }
  const expanded = expandTypes(types);
  return target.selectObject
    ? expanded.filter((type) => (type.flags & ts.TypeFlags.Object) !== 0)
    : expanded;
}

function fieldShape(types: ts.Type[], checker: ts.TypeChecker): FieldShape {
  const members = expandTypes(types);
  const names = new Set(
    members.flatMap((type) => checker.getPropertiesOfType(type).map((item) => item.name)),
  );
  return new Map(
    [...names].map((name) => {
      const required = members.every((type) => {
        const property = checker.getPropertyOfType(type, name);
        const location = property?.valueDeclaration ?? property?.declarations?.[0];
        if (!property || !location || (property.flags & ts.SymbolFlags.Optional) !== 0) {
          return false;
        }
        return !includesUndefined(checker.getTypeOfSymbolAtLocation(property, location));
      });
      return [name, required];
    }),
  );
}

function payloadShape(
  program: ts.Program,
  checker: ts.TypeChecker,
  target: PayloadTarget,
  functionName: string,
): FieldShape {
  const source = program.getSourceFile(resolve(repoRoot, target.file));
  const declaration = source?.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === functionName,
  );
  if (!declaration) {
    throw new TypeError(`missing payload function: ${target.file}#${functionName}`);
  }
  const payloads: ts.ObjectLiteralExpression[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(source) === "JSON" &&
      node.expression.name.text === "stringify" &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      payloads.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(declaration);
  if (payloads.length !== 1) {
    throw new TypeError(
      `expected one JSON.stringify object payload in ${functionName}, found ${payloads.length}`,
    );
  }
  const payload = payloads[0];
  if (!payload) {
    throw new TypeError(`missing JSON.stringify object payload: ${functionName}`);
  }
  const entries: Array<[string, boolean]> = [];
  for (const property of payload.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      throw new TypeError(
        `unsupported payload member in ${functionName}: ${property.getText(source)}`,
      );
    }
    const name = property.name.getText(source).replaceAll(/["']/g, "");
    const valueType = checker.getTypeAtLocation(
      ts.isPropertyAssignment(property) ? property.initializer : property.name,
    );
    entries.push([name, !includesUndefined(valueType)]);
  }
  return new Map(entries);
}

function compareFields(
  dto: RustDto,
  targetName: string,
  tsFields: FieldShape,
  intentionallyIgnoredTsFields: string[] = [],
  intentionallyOptionalRustFields: string[] = [],
): void {
  const rustFields = new Map(dto.fields.map((field) => [field.name, field.required]));
  const ignoredFields = new Set(intentionallyIgnoredTsFields);
  const looserFields = new Set(intentionallyOptionalRustFields);
  const missing =
    dto.direction === "deserialize"
      ? [
          ...new Set([
            ...[...tsFields.keys()].filter(
              (name) => !rustFields.has(name) && !ignoredFields.has(name),
            ),
            ...[...rustFields].flatMap(([name, required]) =>
              required && !tsFields.has(name) ? [name] : [],
            ),
          ]),
        ]
      : [...rustFields.keys()].filter((name) => !tsFields.has(name));
  const optionality = [...rustFields].flatMap(([name, rustRequired]) => {
    const tsRequired = tsFields.get(name);
    if (tsRequired === undefined || looserFields.has(name)) {
      return [];
    }
    const incompatible =
      dto.direction === "deserialize" ? rustRequired && !tsRequired : !rustRequired && tsRequired;
    return incompatible
      ? [
          `${name}: Rust=${rustRequired ? "required" : "optional"}, TS=${tsRequired ? "required" : "optional"}`,
        ]
      : [];
  });
  expect(missing, `${dto.name} -> ${targetName}: directional field mismatch`).toEqual([]);
  expect(optionality, `${dto.name} -> ${targetName}: requiredness mismatch`).toEqual([]);
  expect(
    intentionallyIgnoredTsFields.filter(
      (name) => !tsFields.has(name) || rustFields.has(name) || dto.direction !== "deserialize",
    ),
    `${dto.name} -> ${targetName}: stale intentional TS-only field exception`,
  ).toEqual([]);
  expect(
    intentionallyOptionalRustFields.filter(
      (name) =>
        dto.direction !== "serialize" ||
        rustFields.get(name) !== false ||
        tsFields.get(name) !== true,
    ),
    `${dto.name} -> ${targetName}: stale intentional looser-Rust field exception`,
  ).toEqual([]);
}

function stringLiterals(types: ts.Type[]): string[] {
  return [
    ...new Set(expandTypes(types).flatMap((type) => (type.isStringLiteral() ? [type.value] : []))),
  ].sort();
}

// Scope: serde declarations owned by the boundsvg crate that form direct WASM entry/exit DTOs,
// plus the boundtext unit-map DTOs and canonical text-effect layers embedded in layout/IR output.
// Other nested boundtext/boundshape declarations and general primitive-type equivalence are not
// enumerated here; selected wire literals below and real-WASM properties cover representative value
// semantics in addition to this exhaustive key/requiredness inventory.
describe("boundsvg WASM serde / TypeScript entry and exit schema", () => {
  const rustInventory = parseRustDtos();
  const rustDtos = rustInventory.dtos;
  const { checker, program } = createTypeProgram();

  it("keeps text animation budget constants equal across TypeScript and Rust", () => {
    const rustSource = readFileSync(resolve(repoRoot, "crates/boundsvg/src/ir/types.rs"), "utf8");
    const expected = new Map([
      ["MAX_TEXT_ANIMATION_UNITS", MAX_TEXT_ANIMATION_UNITS],
      ["MAX_TEXT_ANIMATION_FRAGMENTS", MAX_TEXT_ANIMATION_FRAGMENTS],
      ["TEXT_ANIMATION_UNIT_WARNING_THRESHOLD", TEXT_ANIMATION_UNIT_WARNING_THRESHOLD],
      ["TEXT_ANIMATION_FRAGMENT_WARNING_THRESHOLD", TEXT_ANIMATION_FRAGMENT_WARNING_THRESHOLD],
    ]);
    for (const [name, value] of expected) {
      const match = rustSource.match(new RegExp(`pub const ${name}: usize = ([0-9_]+);`));
      expect(match?.[1]?.replaceAll("_", ""), name).toBe(String(value));
    }
  });

  it("maps every current boundsvg WASM serde DTO to TypeScript bridge consumers", () => {
    const mappedNames = [
      ...Object.keys(typeTargets),
      ...Object.keys(payloadTargets),
      ...Object.keys(unitEnumTargets),
      "BorderRadius",
      "BorderRadiusInputValue",
      "AnimationEasing",
      "AnimationIterations",
      "AnimatedSvgPlaybackInput",
      "AnimatedSvgTimelineIterationsInput",
      "AnimatedRasterInfinite",
      "AnimatedRasterIterations",
      "ReducedMotionInput",
      "DebugOverlayInput",
      "FlowExclusionMargin",
      "FlowExclusionShape",
      "Gradient",
      "IrNode",
      "IrNodeKind",
    ].sort();
    expect(rustInventory.deriveCount, "every boundsvg serde derive must be parsed").toBe(
      rustDtos.size,
    );
    expect([...rustDtos.keys()].sort()).toEqual(mappedNames);
    expect(rustDtos.size).toBe(132);
    expect(
      [...rustDtos.values()].reduce(
        (sum, dto) =>
          sum + dto.fields.length + dto.variants.flatMap((variant) => variant.fields).length,
        0,
      ),
    ).toBe(864);
    expect([...rustDtos.values()].reduce((sum, dto) => sum + dto.variants.length, 0)).toBe(81);
  });

  it("keeps struct wire fields and requiredness directionally compatible", () => {
    for (const [dtoName, targets] of Object.entries(typeTargets)) {
      const dto = rustDtos.get(dtoName);
      expect(dto, `missing Rust DTO ${dtoName}`).toBeDefined();
      if (!dto) {
        continue;
      }
      for (const target of targets) {
        compareFields(
          dto,
          `${target.file}#${target.typeName}${target.path?.length ? `.${target.path.join(".")}` : ""}`,
          fieldShape(declarationType(program, checker, target), checker),
          target.intentionallyIgnoredTsFields,
          target.intentionallyOptionalRustFields,
        );
      }
    }
  });

  it("keeps transition top-level signatures exhaustive and stroke preflight keys explicit", () => {
    const rustSource = readFileSync(
      resolve(repoRoot, "crates/boundsvg/src/layout_transition/signature.rs"),
      "utf8",
    );
    const rustStringArray = (constantName: string): string[] => {
      const match = rustSource.match(
        new RegExp(`const ${constantName}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`, "u"),
      );
      expect(match?.[1], `missing Rust constant ${constantName}`).toBeDefined();
      return [...(match?.[1] ?? "").matchAll(/"([^"]+)"/gu)]
        .map((entry) => entry[1])
        .filter((entry): entry is string => entry !== undefined)
        .sort();
    };
    const transportFields = [
      ...fieldShape(
        declarationType(program, checker, { file: layoutAdapterFile, typeName: "WasmNodeInput" }),
        checker,
      ).keys(),
    ].sort();

    expect(rustStringArray("LAYOUT_NODE_TRANSPORT_KEYS")).toEqual(transportFields);
    expect(rustStringArray("CANVAS_STROKE_SIGNATURE_KEYS")).toEqual(
      ["strokeScaling", "borderWidth", "borderColor", "strokeWidth", "stroke"].sort(),
    );
  });

  it("keeps inline JSON payload fields directionally compatible", () => {
    for (const [dtoName, target] of Object.entries(payloadTargets)) {
      const dto = rustDtos.get(dtoName);
      expect(dto, `missing Rust DTO ${dtoName}`).toBeDefined();
      if (!dto) {
        continue;
      }
      for (const functionName of target.functionNames) {
        compareFields(dto, functionName, payloadShape(program, checker, target, functionName));
      }
    }
  });

  it("keeps renamed unit enum values aligned", () => {
    for (const [dtoName, target] of Object.entries(unitEnumTargets)) {
      const dto = rustDtos.get(dtoName);
      expect(dto, `missing Rust enum ${dtoName}`).toBeDefined();
      if (!dto) {
        continue;
      }
      expect(stringLiterals(declarationType(program, checker, target)), dtoName).toEqual(
        dto.variants.map((variant) => variant.name).sort(),
      );
    }
  });

  it("keeps each flattened IR node kind aligned with its TS discriminated variant", () => {
    const irNode = rustDtos.get("IrNode");
    expect(irNode?.fields.map((field) => field.name).sort()).toEqual(["bbox", "kind", "nodeId"]);

    const kind = rustDtos.get("IrNodeKind");
    expect(kind?.serdeAttributes.some((attribute) => /\btag = "type"/.test(attribute))).toBe(true);
    if (!kind) {
      return;
    }
    const irNodeTypes = declarationType(program, checker, {
      file: irTypesFile,
      typeName: "IRNode",
    });
    const typeLiterals = stringLiterals(
      declarationType(program, checker, { file: irTypesFile, typeName: "IRNodeType" }),
    );
    for (const variant of kind.variants) {
      expect(typeLiterals, `IRNodeType covers ${variant.name}`).toContain(variant.name);
      const variantTypes = irNodeTypes.filter((type) => {
        const discriminant = checker.getPropertyOfType(type, "type");
        const location = discriminant?.valueDeclaration ?? discriminant?.declarations?.[0];
        return (
          discriminant != null &&
          location != null &&
          stringLiterals([checker.getTypeOfSymbolAtLocation(discriminant, location)]).includes(
            variant.name,
          )
        );
      });
      expect(variantTypes, `one TS IR variant for ${variant.name}`).toHaveLength(1);
      const variantShape = fieldShape(variantTypes, checker);
      expect(variantShape.get("nodeId"), `${variant.name}.nodeId is required`).toBe(true);
      expect(variantShape.get("bbox"), `${variant.name}.bbox is required`).toBe(true);
      compareFields(
        {
          name: `IrNodeKind.${variant.name}`,
          direction: "serialize",
          fields: variant.fields,
          variants: [],
          serdeAttributes: [],
        },
        `IR${variant.name[0]?.toUpperCase()}${variant.name.slice(1)}Node`,
        variantShape,
      );
    }
  });

  it("keeps the tagged IR gradient variants aligned with the TS gradient union", () => {
    const dto = rustDtos.get("Gradient");
    expect(dto?.serdeAttributes.some((attribute) => /\btag = "type"/.test(attribute))).toBe(true);
    if (!dto) {
      return;
    }
    const gradientTypes = declarationType(program, checker, {
      file: irTypesFile,
      typeName: "IRNode",
      path: ["gradient"],
    });
    for (const variant of dto.variants) {
      const variantTypes = gradientTypes.filter((type) => {
        const kind = checker.getPropertyOfType(type, "type");
        const location = kind?.valueDeclaration ?? kind?.declarations?.[0];
        return (
          kind != null &&
          location != null &&
          stringLiterals([checker.getTypeOfSymbolAtLocation(kind, location)]).includes(variant.name)
        );
      });
      expect(variantTypes, `missing TS gradient variant ${variant.name}`).toHaveLength(1);
      const taggedDto: RustDto = {
        ...dto,
        fields: [{ name: "type", required: true }, ...variant.fields],
      };
      compareFields(
        taggedDto,
        `IRNode.gradient.${variant.name}`,
        fieldShape(variantTypes, checker),
      );
    }
  });

  it("keeps tagged animated SVG playback variants aligned with the TS union", () => {
    const dto = rustDtos.get("AnimatedSvgPlaybackInput");
    expect(dto?.serdeAttributes.some((attribute) => /\btag = "mode"/.test(attribute))).toBe(true);
    if (!dto) {
      return;
    }
    const playbackTypes = declarationType(program, checker, {
      file: "packages/core/src/engine.ts",
      typeName: "AnimatedSvgPlayback",
    });
    for (const variant of dto.variants) {
      const variantTypes = playbackTypes.filter((type) => {
        const mode = checker.getPropertyOfType(type, "mode");
        const location = mode?.valueDeclaration ?? mode?.declarations?.[0];
        return (
          mode != null &&
          location != null &&
          stringLiterals([checker.getTypeOfSymbolAtLocation(mode, location)]).includes(variant.name)
        );
      });
      expect(variantTypes, `missing TS playback variant ${variant.name}`).toHaveLength(1);
      compareFields(
        {
          ...dto,
          fields: [{ name: "mode", required: true }, ...variant.fields],
          variants: [],
        },
        `AnimatedSvgPlayback.${variant.name}`,
        fieldShape(variantTypes, checker),
      );
    }
  });

  it("keeps the untagged resolved border radius scalar/object arms aligned", () => {
    const dto = rustDtos.get("BorderRadius");
    expect(dto?.serdeAttributes).toContain("untagged");
    expect(dto?.variants).toHaveLength(2);
    const types = declarationType(program, checker, {
      file: irTypesFile,
      typeName: "IRNode",
      path: ["borderRadius"],
    });
    expect(types.some((type) => (type.flags & ts.TypeFlags.NumberLike) !== 0)).toBe(true);
    expect(types.some((type) => (type.flags & ts.TypeFlags.Object) !== 0)).toBe(true);
  });

  it("keeps the untagged border radius scalar/array arms aligned", () => {
    const dto = rustDtos.get("BorderRadiusInputValue");
    expect(dto?.serdeAttributes).toContain("untagged");
    expect(dto?.variants).toHaveLength(2);
    const types = declarationType(program, checker, {
      file: "packages/core/src/vnode/types.ts",
      typeName: "BorderRadius",
    });
    expect(types.some((type) => (type.flags & ts.TypeFlags.NumberLike) !== 0)).toBe(true);
    expect(types.some((type) => (type.flags & ts.TypeFlags.Object) !== 0)).toBe(true);
  });

  it("keeps animation easing and iteration unions untagged", () => {
    expect(rustDtos.get("AnimationEasing")?.serdeAttributes).toContain("untagged");
    expect(rustDtos.get("AnimationEasing")?.variants).toHaveLength(4);
    // Untagged arms are tried in order and AnimationSteps also carries `type`,
    // so Spring must stay ahead of Steps for both object shapes to parse.
    expect(rustDtos.get("AnimationEasing")?.variants.map((variant) => variant.name)).toEqual([
      "Named",
      "CubicBezier",
      "Spring",
      "Steps",
    ]);
    expect(rustDtos.get("AnimationIterations")?.serdeAttributes).toContain("untagged");
    expect(rustDtos.get("AnimationIterations")?.variants).toHaveLength(2);

    expect(rustDtos.get("AnimatedSvgTimelineIterationsInput")?.serdeAttributes).toContain(
      "untagged",
    );
    expect(rustDtos.get("AnimatedSvgTimelineIterationsInput")?.variants).toHaveLength(2);
    const animatedSvgIterationTypes = declarationType(program, checker, {
      file: "packages/core/src/engine.ts",
      typeName: "AnimationTimeline",
      path: ["iterations"],
    });
    expect(
      animatedSvgIterationTypes.some((type) => (type.flags & ts.TypeFlags.NumberLike) !== 0),
    ).toBe(true);
    expect(stringLiterals(animatedSvgIterationTypes)).toEqual(["infinite"]);

    expect(rustDtos.get("AnimatedRasterIterations")?.serdeAttributes).toContain("untagged");
    expect(rustDtos.get("AnimatedRasterIterations")?.variants).toHaveLength(2);
    expect(rustDtos.get("AnimatedRasterInfinite")?.variants.map((variant) => variant.name)).toEqual(
      ["infinite"],
    );
    const animatedRasterIterationTypes = declarationType(program, checker, {
      file: wasmIndexFile,
      typeName: "AnimationEncodeInput",
      path: ["iterations"],
    });
    expect(
      animatedRasterIterationTypes.some((type) => (type.flags & ts.TypeFlags.NumberLike) !== 0),
    ).toBe(true);
    expect(stringLiterals(animatedRasterIterationTypes)).toEqual(["infinite"]);
  });

  it("keeps the untagged margin scalar/object arms aligned", () => {
    const dto = rustDtos.get("FlowExclusionMargin");
    expect(dto?.serdeAttributes).toContain("untagged");
    expect(dto?.variants).toHaveLength(2);
    const types = declarationType(program, checker, {
      file: wasmIndexFile,
      typeName: "FlowExclusionMarginPx",
    });
    expect(types.some((type) => (type.flags & ts.TypeFlags.NumberLike) !== 0)).toBe(true);
    expect(types.some((type) => (type.flags & ts.TypeFlags.Object) !== 0)).toBe(true);
  });

  it("keeps tagged exclusion variants and their fields aligned", () => {
    const dto = rustDtos.get("FlowExclusionShape");
    expect(dto?.serdeAttributes.some((attribute) => /\btag = "kind"/.test(attribute))).toBe(true);
    if (!dto) {
      return;
    }
    const types = declarationType(program, checker, {
      file: wasmIndexFile,
      typeName: "FlowExclusionShape",
    });
    for (const variant of dto.variants) {
      const variantTypes = types.filter((type) => {
        const kind = checker.getPropertyOfType(type, "kind");
        const location = kind?.valueDeclaration ?? kind?.declarations?.[0];
        return (
          kind != null &&
          location != null &&
          stringLiterals([checker.getTypeOfSymbolAtLocation(kind, location)]).includes(variant.name)
        );
      });
      expect(variantTypes, `missing TS exclusion variant ${variant.name}`).toHaveLength(1);
      const taggedDto: RustDto = {
        ...dto,
        fields: [{ name: "kind", required: true }, ...variant.fields],
      };
      compareFields(
        taggedDto,
        `FlowExclusionShape.${variant.name}`,
        fieldShape(variantTypes, checker),
      );
    }
  });
});
