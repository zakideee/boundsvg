import { collectUsedTypes, type JsxFormatOptions, vnodeToJsxString } from "@boundsvg/core/codegen";
import type { VNode } from "@boundsvg/react";
import type { RendererMode } from "../types";

const COMPACT: JsxFormatOptions = { compact: true };

export function generateJsxSnippet(vnode: VNode): string {
  const components = collectUsedTypes(vnode).join(", ");
  const jsxBody = vnodeToJsxString(vnode, 1, COMPACT);
  return `import { toVNode, ${components} } from "@boundsvg/react";\n\nconst vnode = toVNode(\n${jsxBody},\n);`;
}

export function generateFullComponent(vnode: VNode, renderer: RendererMode): string {
  const components = collectUsedTypes(vnode).join(", ");
  const jsxBody = vnodeToJsxString(vnode, 2, COMPACT);
  const fontsDecl = `const fonts = [
  // Replace source with the font path served by your own app.
  { alias: "NotoSansJP-woff2", weight: 400, style: "normal", source: "/fonts/NotoSansJP-Regular.subset.woff2" },
];`;

  if (renderer === "boundsvg") {
    return `import { BoundSvg, toVNode, ${components} } from "@boundsvg/react";
import { BoundSvgProvider } from "@boundsvg/react/provider";

${fontsDecl}

function App() {
  const vnode = toVNode(
${jsxBody}
  );

  return (
    <BoundSvgProvider config={{ fonts }}>
      <BoundSvg vnode={vnode} />
    </BoundSvgProvider>
  );
}`;
  }

  if (renderer === "svg-hook") {
    return `import { useRenderToSvg, toVNode, ${components} } from "@boundsvg/react";
import { BoundSvgProvider } from "@boundsvg/react/provider";

${fontsDecl}

function SvgPreview() {
  const vnode = toVNode(
${jsxBody}
  );
  const { svg, error, isReady } = useRenderToSvg(vnode);
  if (!isReady) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;
  return <div dangerouslySetInnerHTML={{ __html: svg! }} />;
}

function App() {
  return (
    <BoundSvgProvider config={{ fonts }}>
      <SvgPreview />
    </BoundSvgProvider>
  );
}`;
  }

  if (renderer === "png-hook") {
    return `import { toVNode, ${components} } from "@boundsvg/react";
import { BoundSvgProvider } from "@boundsvg/react/provider";
import { useRenderToPng } from "@boundsvg/react/png";

${fontsDecl}

function PngPreview() {
  const vnode = toVNode(
${jsxBody}
  );
  const { dataUrl, error, isReady } = useRenderToPng(vnode, {
    scale: 2,
    textPathMode: "merged",
  });
  if (!isReady) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;
  return <img src={dataUrl!} alt="Rendered" />;
}

function App() {
  return (
    <BoundSvgProvider config={{ fonts }}>
      <PngPreview />
    </BoundSvgProvider>
  );
}`;
  }

  if (renderer === "svg-async") {
    return `import { toVNode, ${components} } from "@boundsvg/react";
import { BoundSvgProvider, useBoundSvg } from "@boundsvg/react/provider";
import { useRenderToSvgAsync } from "@boundsvg/react/worker";

${fontsDecl}

function SvgAsyncPreview() {
  const { workerEngine, status, error: providerError } = useBoundSvg();
  const vnode = toVNode(
${jsxBody}
  );
  const { svg, error, isRendering, isReady } = useRenderToSvgAsync(vnode);
  if (error) return <p>Error: {error.message}</p>;
  if (status === "error") return <p>Init failed: {providerError?.message}</p>;
  // Worker init failed — Provider fell back to main-thread engine
  if (status === "ready" && !workerEngine && !isReady) {
    return <p>Worker unavailable. Use useRenderToSvg for main-thread rendering.</p>;
  }
  if (!isReady) return <p>{isRendering ? "Rendering in Worker..." : "Loading..."}</p>;
  return <div dangerouslySetInnerHTML={{ __html: svg! }} />;
}

function App() {
  return (
    <BoundSvgProvider config={{ fonts, worker: { mode: "prefer" } }}>
      <SvgAsyncPreview />
    </BoundSvgProvider>
  );
}`;
  }

  return `import { toVNode, ${components} } from "@boundsvg/react";
import { BoundSvgProvider, useBoundSvg } from "@boundsvg/react/provider";
import { useRenderToPngAsync } from "@boundsvg/react/worker";

${fontsDecl}

function PngAsyncPreview() {
  const { workerEngine, status, error: providerError } = useBoundSvg();
  const vnode = toVNode(
${jsxBody}
  );
  const { dataUrl, error, isRendering, isReady } = useRenderToPngAsync(vnode, { scale: 2 });
  if (error) return <p>Error: {error.message}</p>;
  if (status === "error") return <p>Init failed: {providerError?.message}</p>;
  // Worker init failed — Provider fell back to main-thread engine
  if (status === "ready" && !workerEngine && !isReady) {
    return <p>Worker unavailable. Use useRenderToPng for main-thread rendering.</p>;
  }
  if (!isReady) return <p>{isRendering ? "Rendering in Worker..." : "Loading..."}</p>;
  return <img src={dataUrl!} alt="Rendered" />;
}

function App() {
  return (
    <BoundSvgProvider config={{ fonts, worker: { mode: "prefer" } }}>
      <PngAsyncPreview />
    </BoundSvgProvider>
  );
}`;
}

/** Naively indent flat HTML/SVG markup for display. */
export function formatMarkup(raw: string): string {
  const separated = raw.replace(/></g, ">\n<").replace(/>\s*([^<]+)\s*</g, ">\n$1\n<");
  const lines = separated.split("\n").filter((line) => line.trim().length > 0);
  let indent = 0;
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^<\//.test(trimmed)) {
      indent = Math.max(0, indent - 1);
    }
    result.push("  ".repeat(indent) + trimmed);
    if (/^<[^/!][^>]*[^/]>$/.test(trimmed) && !/^<(br|hr|img|input|meta|link)\b/i.test(trimmed)) {
      indent++;
    }
  }
  return result.join("\n");
}
