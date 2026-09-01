import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { textLayoutRawSuccessFixtures } from "./text-layout-success-fixtures.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("C2b raw text-layout success fixtures", () => {
  it("seals all six operation inputs and exact base output bytes", () => {
    expect(textLayoutRawSuccessFixtures).toHaveLength(6);
    expect(new Set(textLayoutRawSuccessFixtures.map((fixture) => fixture.operation)).size).toBe(6);
    expect(new Set(textLayoutRawSuccessFixtures.map((fixture) => fixture.wasmMethod)).size).toBe(6);

    for (const fixture of textLayoutRawSuccessFixtures) {
      expect(sha256(fixture.inputJson), fixture.operation).toBe(fixture.inputSha256);
      expect(sha256(fixture.expectedOutputJson), fixture.operation).toBe(fixture.outputSha256);
    }
  });
});
