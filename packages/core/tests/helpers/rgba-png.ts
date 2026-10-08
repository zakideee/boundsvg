import { inflateSync } from "node:zlib";
import { expect } from "vitest";

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function paeth(left: number, upperByte: number, upperLeft: number): number {
  const estimate = left + upperByte - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - upperByte);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return upDistance <= upperLeftDistance ? upperByte : upperLeft;
}

function readRgbaPngPayload(png: Uint8Array): {
  width: number;
  height: number;
  filtered: Uint8Array;
} {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idatChunks: Uint8Array[] = [];
  while (offset < png.length) {
    const length = readU32(png, offset);
    const type = String.fromCharCode(...png.slice(offset + 4, offset + 8));
    const payload = png.slice(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = readU32(payload, 0);
      height = readU32(payload, 4);
      expect(payload[8]).toBe(8);
      expect(payload[9]).toBe(6);
      expect(payload[12]).toBe(0);
    } else if (type === "IDAT") {
      idatChunks.push(payload);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  const compressed = Buffer.concat(idatChunks.map((chunk) => Buffer.from(chunk)));
  return { width, height, filtered: inflateSync(compressed) };
}

function reconstructFilteredByte(
  filter: number,
  raw: number,
  left: number,
  upperByte: number,
  upperLeft: number,
): number {
  if (filter === 0) {
    return raw;
  }
  if (filter === 1) {
    return raw + left;
  }
  if (filter === 2) {
    return raw + upperByte;
  }
  if (filter === 3) {
    return raw + Math.floor((left + upperByte) / 2);
  }
  return raw + paeth(left, upperByte, upperLeft);
}

function unfilterRgba(filtered: Uint8Array, width: number, height: number): Uint8Array {
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const rgba = new Uint8Array(width * height * bytesPerPixel);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset] ?? 0;
    expect(filter).toBeLessThanOrEqual(4);
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset + x] ?? 0;
      const destination = y * stride + x;
      const left = x >= bytesPerPixel ? (rgba[destination - bytesPerPixel] ?? 0) : 0;
      const upperByte = y > 0 ? (rgba[destination - stride] ?? 0) : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? (rgba[destination - stride - 4] ?? 0) : 0;
      const reconstructed = reconstructFilteredByte(filter, raw, left, upperByte, upperLeft);
      rgba[destination] = reconstructed & 0xff;
    }
    sourceOffset += stride;
  }
  return rgba;
}

/** Decode the non-interlaced RGBA8 PNGs emitted by the raster fixtures. */
export function decodeRgbaPng(png: Uint8Array): {
  width: number;
  height: number;
  rgba: Uint8Array;
} {
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const { width, height, filtered } = readRgbaPngPayload(png);
  const rgba = unfilterRgba(filtered, width, height);
  return { width, height, rgba };
}
