import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadPng, readPngDimensions } from "../src/assets.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser assets", () => {
  it("reads PNG dimensions from IHDR", () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    const view = new DataView(png.buffer);
    view.setUint32(16, 320, false);
    view.setUint32(20, 180, false);

    expect(readPngDimensions(png)).toEqual({ width: 320, height: 180 });
  });

  it("returns null for non-PNG data", () => {
    expect(readPngDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("downloads through one transient anchor and releases the object URL", () => {
    const anchor = {
      href: "",
      download: "",
      click: vi.fn(),
    };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const createElement = vi.fn(() => anchor);
    vi.stubGlobal("document", {
      createElement,
      body: { appendChild, removeChild },
    });
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const png = new Uint8Array([137, 80, 78, 71]);

    downloadPng(png, "preview.png");

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(createElement).toHaveBeenCalledWith("a");
    expect(anchor).toMatchObject({ href: "blob:download", download: "preview.png" });
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(removeChild).toHaveBeenCalledWith(anchor);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:download");
  });

  it("releases the transient anchor and object URL when the click fails", () => {
    const clickError = new Error("synthetic click failed");
    const anchor = {
      href: "",
      download: "",
      click: vi.fn(() => {
        throw clickError;
      }),
    };
    const removeChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn(), removeChild },
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:throwing-download");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    expect(() => downloadPng(new Uint8Array([1]), "failure.png")).toThrow(clickError);
    expect(removeChild).toHaveBeenCalledWith(anchor);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:throwing-download");
  });
});
