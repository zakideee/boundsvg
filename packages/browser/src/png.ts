const PNG_MIME_TYPE = "image/png";

export function pngToDataUrl(png: Uint8Array): string {
  let binary = "";
  for (const byte of png) {
    binary += String.fromCharCode(byte);
  }
  return `data:${PNG_MIME_TYPE};base64,${btoa(binary)}`;
}

export function pngToBlob(png: Uint8Array): Blob {
  return new Blob([new Uint8Array(png)], { type: PNG_MIME_TYPE });
}

export function createPngObjectUrl(png: Uint8Array): string {
  return URL.createObjectURL(pngToBlob(png));
}

export function revokePngObjectUrl(url: string): void {
  URL.revokeObjectURL(url);
}
