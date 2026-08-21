// ---------------------------------------------------------------------------
// React Component Code Generation
// ---------------------------------------------------------------------------
// Generates complete React component source code from VNode trees.
// Supports static text and dynamic text props.
// ---------------------------------------------------------------------------

import type { VNode } from "../vnode/types.js";
import { collectUsedTypes, type JsxFormatOptions, vnodeToJsxString } from "./jsx-codegen.js";

const DEFAULT_PNG_SCALE = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Font definition for generated components */
export type CodegenFontDef = {
  alias: string;
  weight: number;
  style: "normal" | "italic";
  source: string;
};

/** Specification for a dynamic text prop */
export type DynamicTextSpec = {
  /** Index of the text element in the VNode tree (depth-first order) */
  textIndex: number;
  /** Name of the generated prop (e.g. "title") */
  propName: string;
  /** Default value for the prop */
  defaultValue: string;
};

/** Renderer mode for generated components */
export type CodegenRendererMode = "boundsvg" | "svg-hook" | "png-hook";

/** Options for generating a React component */
export type GenerateComponentOptions = {
  componentName?: string;
  renderer: CodegenRendererMode;
  fonts: CodegenFontDef[];
  dynamicTexts?: DynamicTextSpec[];
  exportDefault?: boolean;
  jsxFormat?: JsxFormatOptions;
  /** Text path rendering mode for png-hook / svg-hook render options */
  textPathMode?: "merged" | "glyphs";
  /** PNG pixel scale for png-hook render options */
  pngScale?: number;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a complete React functional component from a VNode tree.
 *
 * - Static mode: all text is hardcoded in JSX
 * - Dynamic mode: specified text elements become component props
 */
export function generateReactComponent(vnode: VNode, options: GenerateComponentOptions): string {
  const {
    componentName = "SvgComponent",
    renderer,
    fonts,
    dynamicTexts,
    exportDefault = true,
    jsxFormat,
    textPathMode = "merged",
    pngScale = DEFAULT_PNG_SCALE,
  } = options;

  // Apply dynamic text replacements
  const processedVNode = dynamicTexts?.length ? applyDynamicTexts(vnode, dynamicTexts) : vnode;

  const components = collectUsedTypes(processedVNode).join(", ");
  const jsxBody = vnodeToJsxString(processedVNode, 2, jsxFormat);

  // Generate fonts declaration
  const fontsDecl = generateFontsDecl(fonts);

  // Generate TypeScript interface for dynamic props
  const propsInterface = dynamicTexts?.length
    ? generatePropsInterface(componentName, dynamicTexts)
    : "";

  // Generate prop defaults
  const propDefaults = dynamicTexts?.length ? generatePropDefaults(dynamicTexts) : "";

  const propsParam = dynamicTexts?.length ? `props: ${componentName}Props` : "";

  const exportKeyword = exportDefault ? "export default" : "export";

  // Replace dynamic text placeholders in JSX
  let finalJsxBody = jsxBody;
  if (dynamicTexts?.length) {
    for (const spec of dynamicTexts) {
      finalJsxBody = finalJsxBody.replace(`__DYNAMIC_${spec.propName}__`, `{${spec.propName}}`);
    }
  }

  if (renderer === "boundsvg") {
    return buildBoundSvgComponent({
      componentName,
      components,
      fontsDecl,
      propsInterface,
      propDefaults,
      propsParam,
      finalJsxBody,
      exportKeyword,
    });
  }

  if (renderer === "svg-hook") {
    return buildSvgHookComponent({
      componentName,
      components,
      fontsDecl,
      propsInterface,
      propDefaults,
      propsParam,
      finalJsxBody,
      exportKeyword,
      textPathMode,
    });
  }

  // png-hook
  return buildPngHookComponent({
    componentName,
    components,
    fontsDecl,
    propsInterface,
    propDefaults,
    propsParam,
    finalJsxBody,
    exportKeyword,
    textPathMode,
    pngScale,
  });
}

// ---------------------------------------------------------------------------
// Internal: Component templates
// ---------------------------------------------------------------------------

type TemplateParams = {
  componentName: string;
  components: string;
  fontsDecl: string;
  propsInterface: string;
  propDefaults: string;
  propsParam: string;
  finalJsxBody: string;
  exportKeyword: string;
  textPathMode?: "merged" | "glyphs";
  pngScale?: number;
};

function buildBoundSvgComponent(params: TemplateParams): string {
  return `import { BoundSvg, toVNode, ${params.components} } from "@boundsvg/react";
import { BoundSvgProvider } from "@boundsvg/react/provider";
${params.propsInterface}
${params.fontsDecl}

${params.exportKeyword} function ${params.componentName}(${params.propsParam}) {
${params.propDefaults}  const vnode = toVNode(
${params.finalJsxBody}
  );

  return (
    <BoundSvgProvider config={{ fonts }}>
      <BoundSvg vnode={vnode} />
    </BoundSvgProvider>
  );
}`;
}

function buildSvgHookComponent(params: TemplateParams): string {
  return `import { useRenderToSvg, toVNode, ${params.components} } from "@boundsvg/react";
import { BoundSvgProvider } from "@boundsvg/react/provider";
${params.propsInterface}
${params.fontsDecl}

function SvgPreview(${params.propsParam}) {
${params.propDefaults}  const vnode = toVNode(
${params.finalJsxBody}
  );
  const { svg, error, isReady } = useRenderToSvg(vnode${params.textPathMode === "glyphs" ? `, { textPathMode: "glyphs" }` : ""});
  if (!isReady) return <p>Loading…</p>;
  if (error) return <p>Error: {error.message}</p>;
  return <div dangerouslySetInnerHTML={{ __html: svg! }} />;
}

${params.exportKeyword} function ${params.componentName}(${params.propsParam}) {
  return (
    <BoundSvgProvider config={{ fonts }}>
      <SvgPreview ${params.propsParam ? `{...${(params.propsParam.split(":")[0] ?? "").trim()}}` : ""} />
    </BoundSvgProvider>
  );
}`;
}

function buildPngHookComponent(params: TemplateParams): string {
  return `import { toVNode, ${params.components} } from "@boundsvg/react";
import { BoundSvgProvider } from "@boundsvg/react/provider";
import { useRenderToPng } from "@boundsvg/react/png";
${params.propsInterface}
${params.fontsDecl}

function PngPreview(${params.propsParam}) {
${params.propDefaults}  const vnode = toVNode(
${params.finalJsxBody}
  );
  const { dataUrl, error, isReady } = useRenderToPng(vnode, {
    scale: ${params.pngScale ?? DEFAULT_PNG_SCALE},
    textPathMode: "${params.textPathMode ?? "merged"}",
  });
  if (!isReady) return <p>Loading…</p>;
  if (error) return <p>Error: {error.message}</p>;
  return <img src={dataUrl!} alt="Rendered" />;
}

${params.exportKeyword} function ${params.componentName}(${params.propsParam}) {
  return (
    <BoundSvgProvider config={{ fonts }}>
      <PngPreview ${params.propsParam ? "{...props}" : ""} />
    </BoundSvgProvider>
  );
}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateFontsDecl(fonts: CodegenFontDef[]): string {
  if (fonts.length === 0) {
    return `const fonts: { alias: string; weight: number; style: string; source: string }[] = [];`;
  }

  const entries = fonts.map(
    (font) =>
      `  { alias: "${font.alias}", weight: ${font.weight}, style: "${font.style}", source: "${font.source}" },`,
  );
  return `const fonts = [\n${entries.join("\n")}\n];`;
}

function generatePropsInterface(componentName: string, dynamicTexts: DynamicTextSpec[]): string {
  const fields = dynamicTexts.map((spec) => `  ${spec.propName}?: string;`);
  return `\ninterface ${componentName}Props {\n${fields.join("\n")}\n}\n`;
}

function generatePropDefaults(dynamicTexts: DynamicTextSpec[]): string {
  const defaults = dynamicTexts.map(
    (spec) =>
      `  const ${spec.propName} = props.${spec.propName} ?? "${escapeJsString(spec.defaultValue)}";`,
  );
  return `${defaults.join("\n")}\n`;
}

/** Apply dynamic text replacements to a VNode tree (immutable) */
function applyDynamicTexts(vnode: VNode, specs: DynamicTextSpec[]): VNode {
  let textIndex = 0;
  const specMap = new Map(specs.map((spec) => [spec.textIndex, spec]));

  function walk<T extends VNode>(node: T): T {
    if (node.type === "Text" || node.type === "TextOnPath") {
      const spec = specMap.get(textIndex);
      textIndex++;
      if (spec) {
        const hasNonStringChildren = node.children.some((child) => typeof child !== "string");
        if (hasNonStringChildren) {
          return node;
        }
        return {
          ...node,
          children: [`__DYNAMIC_${spec.propName}__`],
        } as T;
      }
      return node;
    }

    const newChildren = node.children.map((child) => {
      if (typeof child === "string") {
        return child;
      }
      return walk(child);
    });

    return { ...node, children: newChildren as T["children"] };
  }

  return walk(vnode);
}

function escapeJsString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}
