import { describe, expect, it, vi } from "vitest";
import { FatalError } from "../../src/errors.js";
import { createImageLoader, type LoadedImage } from "../../src/resources/image-loader.js";

const PNG_IMAGE: LoadedImage = {
  data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  mediaType: "image/png",
};

function createDeferredImage(): {
  promise: Promise<LoadedImage>;
  resolve: (image: LoadedImage) => void;
  reject: (reason: unknown) => void;
} {
  let resolveImage = (_image: LoadedImage): void => {};
  let rejectImage = (_reason: unknown): void => {};
  const promise = new Promise<LoadedImage>((resolve, reject) => {
    resolveImage = resolve;
    rejectImage = reject;
  });
  return { promise, resolve: resolveImage, reject: rejectImage };
}

describe("createImageLoader", () => {
  it("merges concurrent loads of the same URL into one fetch", async () => {
    const deferred = createDeferredImage();
    const fetchImage = vi.fn(() => deferred.promise);
    const loader = createImageLoader(fetchImage);

    const firstLoad = loader.load("https://example.test/a.png");
    const secondLoad = loader.load("https://example.test/a.png");
    deferred.resolve(PNG_IMAGE);

    const [first, second] = await Promise.all([firstLoad, secondLoad]);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(first).toBe(PNG_IMAGE);
    expect(second).toBe(PNG_IMAGE);
  });

  it("retains successful results across sequential loads", async () => {
    const fetchImage = vi.fn(async () => PNG_IMAGE);
    const loader = createImageLoader(fetchImage);

    await loader.load("https://example.test/a.png");
    await loader.load("https://example.test/a.png");

    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it("fetches distinct URLs independently", async () => {
    const fetchImage = vi.fn(async (url: string) => ({
      data: new Uint8Array([url.length]),
      mediaType: "image/png",
    }));
    const loader = createImageLoader(fetchImage);

    await loader.load("https://example.test/a.png");
    await loader.load("https://example.test/b.png");

    expect(fetchImage).toHaveBeenCalledTimes(2);
  });

  it("refetches after a failed load", async () => {
    const fetchImage = vi
      .fn<(url: string) => Promise<LoadedImage>>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(PNG_IMAGE);
    const loader = createImageLoader(fetchImage);

    await expect(loader.load("https://example.test/a.png")).rejects.toThrow("network down");
    await expect(loader.load("https://example.test/a.png")).resolves.toBe(PNG_IMAGE);
    expect(fetchImage).toHaveBeenCalledTimes(2);
  });

  it("refetches after clear()", async () => {
    const fetchImage = vi.fn(async () => PNG_IMAGE);
    const loader = createImageLoader(fetchImage);

    await loader.load("https://example.test/a.png");
    loader.clear();
    await loader.load("https://example.test/a.png");

    expect(fetchImage).toHaveBeenCalledTimes(2);
  });

  it("does not let a pre-clear failure evict its replacement", async () => {
    const staleImage = createDeferredImage();
    const replacementImage = createDeferredImage();
    const fetchImage = vi
      .fn<(url: string) => Promise<LoadedImage>>()
      .mockImplementationOnce(() => staleImage.promise)
      .mockImplementationOnce(() => replacementImage.promise);
    const loader = createImageLoader(fetchImage);

    const staleLoad = loader.load("https://example.test/a.png");
    const staleOutcome = staleLoad.catch((error: unknown) => error);
    loader.clear();
    const replacementLoad = loader.load("https://example.test/a.png");

    staleImage.reject(new Error("stale failure"));
    await expect(staleOutcome).resolves.toMatchObject({ message: "stale failure" });

    const laterLoad = loader.load("https://example.test/a.png");
    replacementImage.resolve(PNG_IMAGE);
    await expect(replacementLoad).resolves.toBe(PNG_IMAGE);
    await expect(laterLoad).resolves.toBe(PNG_IMAGE);
    expect(fetchImage).toHaveBeenCalledTimes(2);
  });
});

describe("ImageLoader.asResolver()", () => {
  it("resolves through the shared cache with the inliner result shape", async () => {
    const fetchImage = vi.fn(async () => PNG_IMAGE);
    const loader = createImageLoader(fetchImage);
    const resolver = loader.asResolver();

    await loader.load("https://example.test/a.png");
    const resolved = await resolver("https://example.test/a.png");

    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual({ data: PNG_IMAGE.data, mime: PNG_IMAGE.mediaType });
  });

  it("returns null instead of throwing when the fetch fails", async () => {
    const fetchImage = vi.fn(async () => {
      throw new Error("network down");
    });
    const loader = createImageLoader(fetchImage);
    const resolver = loader.asResolver();

    await expect(resolver("https://example.test/missing.png")).resolves.toBeNull();
  });

  it("rethrows FatalError instead of converting it to null", async () => {
    const fetchImage = vi.fn(async (): Promise<LoadedImage> => {
      throw new FatalError("IMAGE_LOADER_MISCONFIGURED", "image loader has no base URL", {
        stage: "engine",
      });
    });
    const loader = createImageLoader(fetchImage);
    const resolver = loader.asResolver();

    await expect(resolver("https://example.test/a.png")).rejects.toThrow(FatalError);
  });
});
