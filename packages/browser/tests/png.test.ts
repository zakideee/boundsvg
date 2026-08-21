import { describe, expect, it, vi } from "vitest";
import { createPngObjectUrl, pngToBlob, pngToDataUrl, revokePngObjectUrl } from "../src/png.js";

describe("PNG utilities", () => {
  it("converts PNG bytes to a data URL", () => {
    expect(pngToDataUrl(new Uint8Array([137, 80, 78, 71]))).toBe("data:image/png;base64,iVBORw==");
  });

  it("wraps PNG bytes in an image/png Blob", async () => {
    const blob = pngToBlob(new Uint8Array([1, 2, 3]));

    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("creates and revokes object URLs through URL", () => {
    const createObjectUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:png");
    const revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const url = createPngObjectUrl(new Uint8Array([1, 2, 3]));
    revokePngObjectUrl(url);

    expect(url).toBe("blob:png");
    expect(createObjectUrlSpy).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:png");

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });
});
