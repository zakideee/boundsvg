import assert from "node:assert/strict";
import test from "node:test";

import { boundedRequestSignal, readBoundedResponseBytes } from "./network.mjs";

test("network reads enforce declared and streamed response byte limits", async () => {
  await assert.rejects(
    readBoundedResponseBytes(new Response("x", { headers: { "content-length": "5" } }), {
      errorCode: "FIXTURE_NETWORK_UNKNOWN",
      label: "fixture",
      maximumBytes: 4,
    }),
    { code: "FIXTURE_NETWORK_UNKNOWN" },
  );
  await assert.rejects(
    readBoundedResponseBytes(new Response("12345"), {
      errorCode: "FIXTURE_NETWORK_UNKNOWN",
      label: "fixture",
      maximumBytes: 4,
    }),
    { code: "FIXTURE_NETWORK_UNKNOWN" },
  );
  assert.equal(
    (
      await readBoundedResponseBytes(new Response("1234"), {
        errorCode: "FIXTURE_NETWORK_UNKNOWN",
        label: "fixture",
        maximumBytes: 4,
      })
    ).toString("utf8"),
    "1234",
  );
});

test("network requests always carry a bounded abort signal", () => {
  const signal = boundedRequestSignal(undefined, 1_000);
  assert.equal(signal.aborted, false);
  assert.throws(() => boundedRequestSignal(undefined, 0), {
    code: "NETWORK_TIMEOUT_INVALID",
  });
});
test("network distinguishes encoded representation length from decoded bytes", async () => {
  const options = { errorCode: "FIXTURE_NETWORK_UNKNOWN", label: "fixture", maximumBytes: 64 };
  const read = (response, maximumBytes = 64) =>
    readBoundedResponseBytes(response, { ...options, maximumBytes });
  const rejects = (response, maximumBytes = 64) =>
    assert.rejects(read(response, maximumBytes), { code: options.errorCode });
  const response = (body, headers) => new Response(body, { headers });
  const gzipHeaders = { "content-encoding": "gzip", "content-length": "43" };
  assert.equal((await read(response("decoded response bytes!", gzipHeaders))).length, 23);
  const identityHeaders = { "content-encoding": "identity", "content-length": "5" };
  await rejects(response("1234", identityHeaders));
  for (const encoding of ["", "zstd", "gzip,br", "gzip,,br", "identity,gzip"]) {
    await rejects(response("1234", { "content-encoding": encoding }));
  }
  identityHeaders["content-length"] = "4";
  assert.equal((await read(response("1234", identityHeaders))).length, 4);
  await rejects(response("12345", { "content-encoding": "br", "content-length": "4" }), 4);
  const declaredOverflow = {
    get body() {
      return assert.fail("declared overflow read its body");
    },
    headers: new Headers({ "content-length": "5" }),
  };
  await rejects(declaredOverflow, 4);
});
