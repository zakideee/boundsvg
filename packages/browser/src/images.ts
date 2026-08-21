import { createImageLoader, type ImageLoader, type LoadedImage } from "@boundsvg/core";

export type ImageLoaderOptions = {
  fetchOptions?: RequestInit;
};

/**
 * Create an `ImageLoader` backed by `globalThis.fetch`.
 *
 * The media type is taken from the response `Content-Type` header
 * (parameters stripped). Responses without an `image/*` media type are
 * rejected — a common failure mode is an SPA dev server or CDN answering a
 * missing asset with a `200 text/html` fallback page, which would otherwise
 * be embedded as a broken data URI.
 */
export function createBrowserImageLoader(options: ImageLoaderOptions = {}): ImageLoader {
  return createImageLoader((url) => fetchImage(url, options));
}

async function fetchImage(url: string, options: ImageLoaderOptions): Promise<LoadedImage> {
  const response = await fetch(url, options.fetchOptions);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${url} (${response.status})`);
  }
  const contentType = response.headers.get("content-type");
  const mediaType = contentType?.split(";")[0]?.trim();
  if (!mediaType) {
    throw new Error(
      `Failed to determine image media type: ${url} (missing or malformed Content-Type)`,
    );
  }
  if (!mediaType.startsWith("image/")) {
    throw new Error(`Failed to fetch image: ${url} (unexpected media type "${mediaType}")`);
  }
  return { data: new Uint8Array(await response.arrayBuffer()), mediaType };
}
