import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EncodedSample } from "../src/encode-pipeline.js";
import { createMp4Writer, initVideoWasm } from "../src/mp4-writer.js";

const NTSC_30 = { numerator: 30000, denominator: 1001 };

/** Minimal avcC record: High profile, level 4.0, four-byte NAL lengths. */
const CODEC_DESCRIPTION = new Uint8Array([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x28, 0x01, 0x00, 0x03, 0x68,
  0xee, 0x3c,
]);

let nextTimestampMicros = 0;

function sample(bytes: number[], overrides: Partial<EncodedSample> = {}): EncodedSample {
  const timestampMicros = nextTimestampMicros;
  nextTimestampMicros += 33_333;
  return {
    bytes: new Uint8Array(bytes),
    timestampMicros,
    keyFrame: true,
    ...overrides,
  };
}

function writerOptions(frameCountHint = 4) {
  return { width: 64, height: 32, frameRate: NTSC_30, frameCountHint };
}

/**
 * Walk the top-level box chain, returning each box type in file order.
 *
 * Searching the raw bytes would also match sample payloads, which is exactly
 * what the ordering assertion must not depend on.
 */
function topLevelBoxTypes(fileBytes: Uint8Array): string[] {
  const view = new DataView(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  const decoder = new TextDecoder("latin1");
  const types: string[] = [];
  let offset = 0;
  while (offset + 8 <= fileBytes.byteLength) {
    const declaredSize = view.getUint32(offset);
    types.push(decoder.decode(fileBytes.subarray(offset + 4, offset + 8)));
    // Size 1 means the real 64-bit size follows the type field.
    const boxSize = declaredSize === 1 ? Number(view.getBigUint64(offset + 8)) : declaredSize;
    if (boxSize <= 0) {
      break;
    }
    offset += boxSize;
  }
  return types;
}

beforeEach(() => {
  nextTimestampMicros = 0;
});

beforeAll(async () => {
  // The wasm-pack web target fetches its binary by URL in a browser; under
  // vitest it is supplied directly.
  const wasmPath = fileURLToPath(new URL("../wasm-pkg/boundmp4_bg.wasm", import.meta.url));
  await initVideoWasm(await readFile(wasmPath));
});

describe("createMp4Writer", () => {
  it("writes a playable single-track file with a faststart layout", async () => {
    const writer = await createMp4Writer(writerOptions(2));
    writer.write(sample([1, 2, 3, 4], { codecDescription: CODEC_DESCRIPTION }));
    writer.write(sample([5, 6, 7], { keyFrame: false }));
    expect(writer.sampleCount()).toBe(2);
    const fileBytes = writer.finish();

    const boxTypes = topLevelBoxTypes(fileBytes);
    expect(boxTypes[0]).toBe("ftyp");
    expect(boxTypes.indexOf("moov")).toBeGreaterThan(0);
    expect(boxTypes.indexOf("moov")).toBeLessThan(boxTypes.indexOf("mdat"));
  });

  it("produces identical bytes for identical samples", async () => {
    const build = async () => {
      nextTimestampMicros = 0;
      const writer = await createMp4Writer(writerOptions(2));
      writer.write(sample([1, 2, 3], { codecDescription: CODEC_DESCRIPTION }));
      writer.write(sample([4, 5, 6], { keyFrame: false }));
      return writer.finish();
    };
    expect(await build()).toEqual(await build());
  });

  it("embeds a deterministic generator as the MP4 encoding tool", async () => {
    const build = async () => {
      nextTimestampMicros = 0;
      const writer = await createMp4Writer({
        ...writerOptions(2),
        generator: { name: "@scope/aaaa", version: "1.2.3-beta.1" },
      });
      writer.write(sample([1, 2, 3], { codecDescription: CODEC_DESCRIPTION }));
      writer.write(sample([4, 5, 6], { keyFrame: false }));
      return writer.finish();
    };
    const first = await build();
    const second = await build();
    expect(first).toEqual(second);
    expect(new TextDecoder("latin1").decode(first)).toContain("@scope/aaaa/1.2.3-beta.1");
    expect(
      Array.from(first).some((byte, index) => {
        return (
          byte === 0xa9 &&
          first[index + 1] === 0x74 &&
          first[index + 2] === 0x6f &&
          first[index + 3] === 0x6f
        );
      }),
    ).toBe(true);

    nextTimestampMicros = 0;
    const defaultWriter = await createMp4Writer(writerOptions(2));
    defaultWriter.write(sample([1, 2, 3], { codecDescription: CODEC_DESCRIPTION }));
    defaultWriter.write(sample([4, 5, 6], { keyFrame: false }));
    expect(new TextDecoder("latin1").decode(defaultWriter.finish())).not.toContain(
      "@scope/aaaa/1.2.3-beta.1",
    );
  });

  it("adopts only the first codec description it sees", async () => {
    const writer = await createMp4Writer(writerOptions(2));
    writer.write(sample([1, 2, 3], { codecDescription: CODEC_DESCRIPTION }));
    writer.write(
      sample([4, 5, 6], { keyFrame: false, codecDescription: new Uint8Array([0xff, 0xff]) }),
    );
    expect(() => writer.finish()).not.toThrow();
  });

  it("refuses a sample the encoder never described", async () => {
    const writer = await createMp4Writer(writerOptions());
    expect(() => writer.write(sample([1, 2, 3]))).toThrowError(
      expect.objectContaining({ code: "VIDEO_ENCODER_UNSUPPORTED" }),
    );
  });

  it("refuses to finish without samples", async () => {
    const writer = await createMp4Writer(writerOptions());
    expect(() => writer.finish()).toThrowError(
      expect.objectContaining({ code: "VIDEO_ENCODER_UNSUPPORTED" }),
    );
  });

  it("rejects samples that arrive out of presentation order", async () => {
    const writer = await createMp4Writer(writerOptions());
    writer.write(sample([1, 2, 3], { codecDescription: CODEC_DESCRIPTION, timestampMicros: 100 }));
    expect(() => writer.write(sample([4, 5, 6], { timestampMicros: 50 }))).toThrowError(
      expect.objectContaining({ code: "VIDEO_ENCODER_UNSUPPORTED" }),
    );
  });

  it("rejects odd frame dimensions", async () => {
    await expect(createMp4Writer({ ...writerOptions(), width: 65 })).rejects.toMatchObject({
      code: "VIDEO_ENCODER_UNSUPPORTED",
    });
  });

  it("survives a double dispose", async () => {
    const writer = await createMp4Writer(writerOptions());
    writer.dispose();
    expect(() => {
      writer.dispose();
    }).not.toThrow();
  });
});
