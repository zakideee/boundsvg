import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import type { VNode } from "@boundsvg/core";
import ts from "typescript";
import { generateFullComponent } from "../src/lib/codegen.ts";
import type { RendererMode } from "../src/types.ts";

const vnode: VNode = {
  type: "Canvas",
  props: { width: 240, height: 80 },
  children: [
    { type: "Text", props: { font: "NotoSansJP-woff2", fontSizePx: 24 }, children: ["sample"] },
  ],
};

test("all generated component modes typecheck against public package entries", () => {
  const modes: RendererMode[] = ["boundsvg", "svg-hook", "png-hook", "svg-async", "png-async"];
  const sources = new Map(
    modes.map((mode) => [resolve(`generated-${mode}.tsx`), generateFullComponent(vnode, mode)]),
  );
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
  };
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sources.get(fileName);
    return source === undefined
      ? readSource(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TSX);
  };
  const program = ts.createProgram([...sources.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    }),
  );
});
