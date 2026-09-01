import { describe, expect, it } from "vitest";
import * as workerRuntime from "../src/index.js";

describe("Worker public exports", () => {
  it("does not expose the removed generic diagnostic rehydrator", () => {
    expect(Object.hasOwn(workerRuntime, "rehydrateError")).toBe(false);
  });
});
