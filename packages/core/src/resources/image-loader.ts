/**
 * Image loader with single-flight fetch coalescing.
 *
 * Core never performs network I/O during rendering — the fetch implementation
 * is injected by the caller (`FetchImageFn`), so this module stays runtime
 * agnostic and the no-I/O contract of the render pipeline is preserved.
 */

import { FatalError } from "../errors.js";
import type { ImageResolver } from "../svg/image-inliner.js";

/**
 * Image bytes plus the media type used when embedding them as a data URI.
 *
 * The same object (including the `data` buffer) is shared by every caller
 * that loads the same URL — treat it as immutable.
 */
export type LoadedImage = {
  data: Uint8Array;
  mediaType: string;
};

/** Injected fetch implementation. Rejects when the URL cannot be resolved. */
export type FetchImageFn = (url: string) => Promise<LoadedImage>;

export type ImageLoader = {
  /** Concurrent calls for the same URL merge into one fetch (single-flight). Successful results are retained. */
  load(url: string): Promise<LoadedImage>;
  /** Returns a resolver usable with `inlineExternalImages`. Load failures resolve to `null`; `FatalError` is rethrown. */
  asResolver(): ImageResolver;
  /** Forgets cached and in-flight entries so subsequent loads fetch again. Fetches already in flight still settle for their original callers. */
  clear(): void;
};

/**
 * Create an `ImageLoader` backed by the given fetch implementation.
 *
 * There is no default fetch on purpose: image I/O must always be an explicit
 * caller decision (see `createBrowserImageLoader` in `@boundsvg/browser` for
 * a `globalThis.fetch` based implementation).
 */
export function createImageLoader(fetchImage: FetchImageFn): ImageLoader {
  const cache = new Map<string, Promise<LoadedImage>>();

  async function load(url: string): Promise<LoadedImage> {
    const cached = cache.get(url);
    if (cached) {
      return cached;
    }

    const request = fetchImage(url);
    cache.set(url, request);
    try {
      return await request;
    } catch (error) {
      // A pre-clear failure must not evict a newer request for the same URL.
      if (cache.get(url) === request) {
        cache.delete(url);
      }
      throw error;
    }
  }

  function asResolver(): ImageResolver {
    return async (href) => {
      try {
        const { data, mediaType } = await load(href);
        return { data, mime: mediaType };
      } catch (error) {
        // Fatal errors signal misconfiguration, not an unresolvable href —
        // hiding them behind a null would let a broken loader render "cleanly".
        if (error instanceof FatalError) {
          throw error;
        }
        // inlineExternalImages reports unresolvable hrefs via its `failed`
        // list, so recoverable resolver errors become null instead of thrown.
        return null;
      }
    };
  }

  return {
    load,
    asResolver,
    clear() {
      cache.clear();
    },
  };
}
