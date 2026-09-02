import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type PackageJson = {
  exports: Record<string, unknown>;
};

const expectedShapeOperationExports = [
  "wasmCompileShapePaths",
  "wasmCompileShapeSvg",
  "wasmComputeShapeIntersections",
  "wasmDivideShapeRegions",
  "wasmEvaluateShapeParts",
  "wasmEvaluateShapeRegion",
  "wasmHitTestShapeParts",
  "wasmRenderShapeRegionSvg",
  "wasmResolveSymbolGeometry",
] as const;
const testDirectory = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(testDirectory, "..");
const builtWasmEsm = resolve(packageRoot, "dist/wasm.js");
const builtWasmCjs = resolve(packageRoot, "dist/wasm.cjs");
const builtWasmDeclaration = resolve(packageRoot, "dist/wasm.d.ts");
const builtWasmMissing = [builtWasmEsm, builtWasmCjs, builtWasmDeclaration].some(
  (path) => !existsSync(path),
);
const require = createRequire(import.meta.url);

if (process.env.CI !== undefined && builtWasmMissing) {
  throw new Error("CI must build @boundsvg/core before its WASM public-entry tests");
}

function selectShapeOperationExports(names: Iterable<string>): string[] {
  return [...names]
    .filter(
      (name) =>
        name.startsWith("wasm") && (name.includes("Shape") || name.includes("SymbolGeometry")),
    )
    .sort();
}

function collectDirectDeclarationExports(statement: ts.Statement, names: Set<string>): void {
  const isExported = statement.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
  if (!isExported) {
    return;
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        names.add(declaration.name.text);
      }
    }
    return;
  }
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
    names.add(statement.name.text);
  }
}

function declarationExportNames(sourceText: string): Set<string> {
  const sourceFile = ts.createSourceFile(
    builtWasmDeclaration,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        names.add(element.name.text);
      }
      continue;
    }
    collectDirectDeclarationExports(statement, names);
  }
  return names;
}

describe("public core entries", () => {
  it("exposes inspection through the root and canonical inspect subpath", async () => {
    const rootEntry = await import("../src/index.js");
    const inspectEntry = await import("../src/inspect.js");

    expect(rootEntry.inspectScene).toBeTypeOf("function");
    expect(Reflect.has(rootEntry, "collectInspectionBBoxes")).toBe(false);
    expect(inspectEntry.inspectScene).toBe(rootEntry.inspectScene);
    expect(inspectEntry.collectInspectionBBoxes).toBeTypeOf("function");
  });

  it("publishes inspect without a debug compatibility alias", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(testDirectory, "../package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.exports["./inspect"]).toBeDefined();
    expect(packageJson.exports["./debug"]).toBeUndefined();
  });

  it("exports the complete low-level shape operation family only from the WASM entry", async () => {
    const rootEntry = await import("../src/index.js");
    const wasmEntry = await import("../src/wasm.js");

    expect(selectShapeOperationExports(Object.keys(rootEntry))).toEqual([]);
    expect(selectShapeOperationExports(Object.keys(wasmEntry))).toEqual(
      expectedShapeOperationExports,
    );
  });

  it.skipIf(builtWasmMissing)(
    "keeps declaration, ESM, and CommonJS shape operation exports aligned",
    async () => {
      const declarationNames = declarationExportNames(readFileSync(builtWasmDeclaration, "utf8"));
      const esmEntry = (await import(pathToFileURL(builtWasmEsm).href)) as Record<string, unknown>;
      const cjsEntry = require(builtWasmCjs) as Record<string, unknown>;

      expect(selectShapeOperationExports(declarationNames)).toEqual(expectedShapeOperationExports);
      expect(selectShapeOperationExports(Object.keys(esmEntry))).toEqual(
        expectedShapeOperationExports,
      );
      expect(selectShapeOperationExports(Object.keys(cjsEntry))).toEqual(
        expectedShapeOperationExports,
      );
    },
  );
});
