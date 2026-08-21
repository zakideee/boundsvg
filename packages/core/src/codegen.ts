// @boundsvg/core/codegen — JSX/React code generation

export type {
  CodegenFontDef,
  CodegenRendererMode,
  DynamicTextSpec,
  GenerateComponentOptions,
  JsxFormatOptions,
  PlainSvgComponentOptions,
} from "./codegen/index.js";
export {
  collectUsedTypes,
  generateJsxSnippet,
  generatePlainSvgComponent,
  generateReactComponent,
  svgStringToJsx,
  vnodeToJsxString,
} from "./codegen/index.js";
