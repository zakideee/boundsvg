import assert from "node:assert/strict";
import test from "node:test";

import { resolveJavaScriptImportClosure, validateWorkflowPins } from "./seal.mjs";

test("release-runtime import closure follows literal local imports and Node built-ins only", () => {
  const files = new Map([
    [
      "scripts/release-runtime/entry.mjs",
      'import fs from "node:fs";\nimport "./nested.mjs";\nvoid fs;\n',
    ],
    ["scripts/release-runtime/nested.mjs", 'export { value } from "./value.mjs";\n'],
    ["scripts/release-runtime/value.mjs", "export const value = 1;\n"],
  ]);
  assert.deepEqual(
    resolveJavaScriptImportClosure(["scripts/release-runtime/entry.mjs"], (path) =>
      files.get(path),
    ),
    [...files.keys()].sort(),
  );
  files.set("scripts/release-runtime/nested.mjs", 'import value from "../outside.mjs";\n');
  assert.throws(
    () =>
      resolveJavaScriptImportClosure(["scripts/release-runtime/entry.mjs"], (path) =>
        files.get(path),
      ),
    { code: "CONTROL_IMPORT_BOUNDARY" },
  );
  files.set(
    "scripts/release-runtime/nested.mjs",
    "const moduleName = './value.mjs';\nawait import(moduleName);\n",
  );
  assert.throws(
    () =>
      resolveJavaScriptImportClosure(["scripts/release-runtime/entry.mjs"], (path) =>
        files.get(path),
      ),
    { code: "CONTROL_DYNAMIC_IMPORT" },
  );
});

test("release-runtime import closure rejects unsealed CommonJS loaders", () => {
  for (const source of [
    'const dependency = require("./dependency.mjs");',
    'import { createRequire } from "node:module";',
  ]) {
    assert.throws(
      () => resolveJavaScriptImportClosure(["scripts/release-runtime/entry.mjs"], () => source),
      { code: "CONTROL_COMMONJS_IMPORT" },
    );
  }
});

test("workflow actions and release tools must use immutable exact pins", () => {
  const workflow = `env:
  RELEASE_NPM_CLI_SHA512: 48377f8478372aa1c4e47b763475b135836da82436a5700f2e5e8eb5084fc840f93c7b117eb3ad3b5f7d3194c81b6710a10d59448f6ddbcb21ac3fb672bdc003
  RELEASE_NPM_CLI_VERSION: 11.19.0
jobs:
  admission:
    steps:
      - uses: actions/checkout@${"a".repeat(40)}
      - uses: pnpm/action-setup@${"b".repeat(40)}
        with:
          version: 10.29.3
      - uses: actions/setup-node@${"c".repeat(40)}
        with:
          node-version: 22.14.0
      - uses: dtolnay/rust-toolchain@${"d".repeat(40)}
        with:
          toolchain: 1.97.0
      - uses: taiki-e/install-action@${"e".repeat(40)}
        with:
          tool: wasm-pack@0.13.1
`;
  assert.deepEqual(validateWorkflowPins(workflow), {
    node: "22.14.0",
    npm: "11.19.0",
    pnpm: "10.29.3",
    rust: "1.97.0",
    wasmPack: "0.13.1",
  });
  assert.throws(
    () =>
      validateWorkflowPins(workflow.replace(/actions\/checkout@[a-f0-9]+/, "actions/checkout@v4")),
    {
      code: "CONTROL_ACTION_UNPINNED",
    },
  );
  assert.throws(() => validateWorkflowPins(workflow.replace("22.14.0", "22")), {
    code: "CONTROL_TOOL_PIN_MISMATCH",
  });
  assert.throws(() => validateWorkflowPins(workflow.replace("48377f847837", "58377f847837")), {
    code: "CONTROL_TOOL_PIN_MISMATCH",
  });
});
