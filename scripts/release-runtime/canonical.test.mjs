import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, compareCanonicalStrings } from "./canonical.mjs";

test("canonical JSON preserves prototype-sensitive keys without mutating prototypes", () => {
  const value = JSON.parse('{"z":1,"__proto__":{"polluted":true},"constructor":"kept"}');
  assert.equal(canonicalJson(value), '{"__proto__":{"polluted":true},"constructor":"kept","z":1}');
  assert.equal({}.polluted, undefined);
});

test("canonical string ordering is locale-independent UTF-16 code-unit order", () => {
  const values = ["a", "é", "A", "a_b", "a-b", "Cargo.lock"];
  assert.deepEqual(values.sort(compareCanonicalStrings), [
    "A",
    "Cargo.lock",
    "a",
    "a-b",
    "a_b",
    "é",
  ]);
});
