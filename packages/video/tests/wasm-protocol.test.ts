import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../wasm-pkg/boundmp4.js");
  vi.resetModules();
});

async function setup(schema: unknown) {
  const initialize = vi.fn().mockResolvedValue({});
  vi.doMock("../wasm-pkg/boundmp4.js", () => ({
    default: initialize,
    Mp4VideoMuxer: class {},
    mp4_wasm_schema_version: schema,
  }));
  const { initVideoWasm } = await import("../src/mp4-writer.js");
  return { initialize, initVideoWasm };
}

describe("MP4 independent handshake", () => {
  it.each([
    undefined,
    null,
    1,
    () => 0,
    () => 2,
    () => "1",
    () => null,
    () => {
      throw new Error("schema trap");
    },
  ])("rejects absent or invalid schema %s and checks again on retry", async (schema) => {
    const { initialize, initVideoWasm } = await setup(schema);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(initVideoWasm()).rejects.toMatchObject({
        code: "VIDEO_MUXER_ABI_MISMATCH",
        stage: "wasm",
        context: { domain: "video", category: "protocol", operation: "load" },
      });
    }
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("shares initialization and retains the first successful input", async () => {
    const schema = vi.fn().mockReturnValue(1);
    const { initialize, initVideoWasm } = await setup(schema);
    const first = new Uint8Array([1]);
    const second = new Uint8Array([2]);
    await Promise.all([initVideoWasm(first), initVideoWasm(second)]);
    await initVideoWasm(second);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith({ module_or_path: first });
    expect(schema).toHaveBeenCalledTimes(1);
  });

  it("classifies init failure before schema validation and retries with the next input", async () => {
    const schema = vi.fn().mockReturnValue(1);
    const { initialize, initVideoWasm } = await setup(schema);
    initialize.mockRejectedValueOnce(new Error("private URL"));
    await expect(initVideoWasm(new Uint8Array([1]))).rejects.toMatchObject({
      code: "VIDEO_MUXER_LOAD_FAILED",
      message: "MP4 muxer could not be initialized",
    });
    expect(schema).not.toHaveBeenCalled();
    const retry = new Uint8Array([2]);
    await initVideoWasm(retry);
    expect(initialize).toHaveBeenLastCalledWith({ module_or_path: retry });
    expect(schema).toHaveBeenCalledTimes(1);
  });
});
