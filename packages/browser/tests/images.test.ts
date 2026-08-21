import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserImageLoader } from "../src/images.js";

function pngResponse(bytes: number[]): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

function mockFetch(createResponse: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => createResponse()),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createBrowserImageLoader", () => {
  it("loads image bytes and media type from the response", async () => {
    mockFetch(() => pngResponse([1, 2, 3]));
    const loader = createBrowserImageLoader();

    await expect(loader.load("/logo.png")).resolves.toEqual({
      data: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("caches URL fetches", async () => {
    mockFetch(() => pngResponse([1]));
    const loader = createBrowserImageLoader();

    await loader.load("/logo.png");
    await loader.load("/logo.png");

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refetches after clear()", async () => {
    mockFetch(() => pngResponse([1]));
    const loader = createBrowserImageLoader();

    await loader.load("/logo.png");
    loader.clear();
    await loader.load("/logo.png");

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("strips Content-Type parameters from the media type", async () => {
    mockFetch(
      () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-type": "image/svg+xml; charset=utf-8" },
        }),
    );
    const loader = createBrowserImageLoader();

    await expect(loader.load("/icon.svg")).resolves.toMatchObject({
      mediaType: "image/svg+xml",
    });
  });

  it("passes fetchOptions to fetch", async () => {
    mockFetch(() => pngResponse([1]));
    const loader = createBrowserImageLoader({
      fetchOptions: { headers: { authorization: "Bearer token" } },
    });

    await loader.load("/logo.png");

    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const requestOptions = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(requestOptions.headers).get("authorization")).toBe("Bearer token");
  });

  it("rejects non-OK responses and retries on the next load", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(pngResponse([9]));
    vi.stubGlobal("fetch", fetchMock);
    const loader = createBrowserImageLoader();

    await expect(loader.load("/logo.png")).rejects.toThrow("Failed to fetch image");
    await expect(loader.load("/logo.png")).resolves.toMatchObject({
      data: new Uint8Array([9]),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects responses without a Content-Type header", async () => {
    mockFetch(() => new Response(new Uint8Array([1]), { status: 200 }));
    const loader = createBrowserImageLoader();

    await expect(loader.load("/logo.bin")).rejects.toThrow("Failed to determine image media type");
  });

  it("rejects non-image media types such as an HTML fallback page", async () => {
    mockFetch(
      () =>
        new Response("<!doctype html><title>login</title>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const loader = createBrowserImageLoader();

    await expect(loader.load("/missing.png")).rejects.toThrow('unexpected media type "text/html"');
  });
});
