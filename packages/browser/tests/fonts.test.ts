import { afterEach, describe, expect, it, vi } from "vitest";
import { clearFontCache, createFontLoader, preloadFonts } from "../src/fonts.js";

function mockFetchOnce(response: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
}

function createDeferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
  reject: (reason: unknown) => void;
} {
  let resolveResponse = (_response: Response): void => {};
  let rejectResponse = (_reason: unknown): void => {};
  const promise = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  return { promise, resolve: resolveResponse, reject: rejectResponse };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearFontCache();
});

describe("createFontLoader", () => {
  it("returns Uint8Array sources without fetching", async () => {
    const fontData = new Uint8Array([1, 2, 3]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const loader = createFontLoader();

    await expect(loader.load(fontData)).resolves.toBe(fontData);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("caches URL fetches", async () => {
    mockFetchOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const loader = createFontLoader();

    await expect(loader.load("/font.woff2")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(loader.load("/font.woff2")).resolves.toEqual(new Uint8Array([1, 2, 3]));

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes fetchOptions to fetch", async () => {
    mockFetchOnce(new Response(new Uint8Array([4]), { status: 200 }));
    const loader = createFontLoader({
      fetchOptions: { headers: { authorization: "Bearer default" } },
    });

    await loader.load("/font.woff2", {
      fetchOptions: { headers: { "x-theme": "dark" }, credentials: "include" },
    });

    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const requestOptions = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(requestOptions.credentials).toBe("include");
    expect(new Headers(requestOptions.headers).get("authorization")).toBe("Bearer default");
    expect(new Headers(requestOptions.headers).get("x-theme")).toBe("dark");
  });

  it("drops failed requests from cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const loader = createFontLoader();

    await expect(loader.load("/font.woff2")).rejects.toThrow("Failed to fetch font");
    await expect(loader.load("/font.woff2")).resolves.toEqual(new Uint8Array([9]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    "before",
    "after",
  ] as const)("does not let a pre-clear rejection evict its replacement when it settles %s the replacement", async (settlementOrder) => {
    const staleResponse = createDeferredResponse();
    const replacementResponse = createDeferredResponse();
    const unintendedResponse = createDeferredResponse();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => staleResponse.promise)
      .mockImplementationOnce(() => replacementResponse.promise)
      .mockImplementationOnce(() => unintendedResponse.promise);
    vi.stubGlobal("fetch", fetchMock);
    const loader = createFontLoader();

    const staleLoad = loader.load("/font.woff2");
    const staleOutcome = staleLoad.catch((error: unknown) => error);
    loader.clear();
    const replacementLoad = loader.load("/font.woff2");

    if (settlementOrder === "after") {
      replacementResponse.resolve(new Response(new Uint8Array([2]), { status: 200 }));
      await replacementLoad;
    }
    staleResponse.reject(new Error("stale failure"));
    await expect(staleOutcome).resolves.toMatchObject({ message: "stale failure" });

    const laterLoad = loader.load("/font.woff2");
    const fetchCalls = fetchMock.mock.calls.length;
    replacementResponse.resolve(new Response(new Uint8Array([2]), { status: 200 }));
    unintendedResponse.resolve(new Response(new Uint8Array([3]), { status: 200 }));
    const [replacementBytes, laterBytes] = await Promise.all([replacementLoad, laterLoad]);

    expect(fetchCalls).toBe(2);
    expect(replacementBytes).toEqual(new Uint8Array([2]));
    expect(laterBytes).toEqual(replacementBytes);
  });

  it("preloads font definitions with defaults", async () => {
    mockFetchOnce(new Response(new Uint8Array([7]), { status: 200 }));
    const loader = createFontLoader();

    await expect(loader.preload([{ alias: "sans", source: "/font.woff2" }])).resolves.toEqual([
      { alias: "sans", weight: 400, style: "normal", data: new Uint8Array([7]) },
    ]);
  });
});

describe("preloadFonts", () => {
  it("uses the shared font loader cache", async () => {
    mockFetchOnce(new Response(new Uint8Array([8]), { status: 200 }));

    await preloadFonts([{ alias: "sans", source: "/font.woff2" }]);
    await preloadFonts([{ alias: "sans", source: "/font.woff2" }]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
