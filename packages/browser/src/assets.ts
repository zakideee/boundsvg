import { createPngObjectUrl, revokePngObjectUrl } from "./png.js";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export type PngDimensions = {
  width: number;
  height: number;
};

/**
 * Read PNG dimensions from the header without decoding pixel data.
 */
export function readPngDimensions(png: Uint8Array): PngDimensions | null {
  if (png.byteLength < 24) {
    return null;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (png[i] !== PNG_SIGNATURE[i]) {
      return null;
    }
  }

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

/**
 * Trigger a browser download for generated PNG bytes.
 *
 * This uses DOM APIs and should be called from browser event handlers, not
 * from Node.js or SSR code.
 */
export function downloadPng(png: Uint8Array, fileName: string): void {
  const url = createPngObjectUrl(png);
  let anchor: HTMLAnchorElement | null = null;
  let appended = false;
  try {
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    appended = true;
    anchor.click();
  } finally {
    try {
      if (anchor && appended) {
        document.body.removeChild(anchor);
      }
    } finally {
      revokePngObjectUrl(url);
    }
  }
}
