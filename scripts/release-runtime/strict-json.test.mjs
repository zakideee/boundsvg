import assert from "node:assert/strict";
import test from "node:test";
import { parseStrictJsonBytes } from "./strict-json.mjs";

const parse = (text) => parseStrictJsonBytes(Buffer.from(text), "fixture JSON");
test("strict JSON rejects ambiguity and accepts the supported boundary", () => {
  for (const bytes of [
    ...[
      '{"name":1,"name":2}',
      '{"nested":{"name":1,"name":2}}',
      '[{"name":1,"name":2}]',
      '{"name":1,"\\u006eame":2}',
      '{"git":{"sha1":"a","sha1":"b"}}',
    ].map((text) => Buffer.from(text)),
    Buffer.from([0xc3, 0x28]),
    Buffer.from("{} true"),
    Buffer.from(`${"[".repeat(129)}0${"]".repeat(129)}`),
  ]) {
    assert.throws(() => parseStrictJsonBytes(bytes, "fixture JSON"), {
      code: "ARCHIVE_JSON_INVALID",
    });
  }
  assert.doesNotThrow(() => parse(`${"[".repeat(128)}0${"]".repeat(128)}`));
  assert.equal(parse('{"emoji":"\\uD83D\\uDE00"}').emoji, "😀");
});
