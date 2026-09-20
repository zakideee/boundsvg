import type { BoundSvgConfig } from "../types.js";
import { snapshotRenderOptions } from "./snapshot-render-options.js";

/** Capture asset values before initialization awaits; executable owners retain their identity. */
export function snapshotProviderConfig(config: BoundSvgConfig): BoundSvgConfig {
  const fetchOptions = config.fontFetchOptions;
  return {
    ...config,
    fonts: config.fonts.map((font) => ({
      ...font,
      source:
        font.source instanceof Uint8Array
          ? font.source.slice()
          : font.source instanceof URL
            ? new URL(font.source.href)
            : font.source,
    })),
    ...(config.geometries !== undefined
      ? { geometries: snapshotRenderOptions(config.geometries) }
      : {}),
    ...(config.symbols !== undefined ? { symbols: snapshotRenderOptions(config.symbols) } : {}),
    ...(fetchOptions !== undefined
      ? {
          fontFetchOptions: {
            ...fetchOptions,
            ...(fetchOptions.headers !== undefined
              ? { headers: new Headers(fetchOptions.headers) }
              : {}),
            ...(fetchOptions.body instanceof URLSearchParams
              ? { body: new URLSearchParams(fetchOptions.body) }
              : {}),
            ...(fetchOptions.body instanceof ArrayBuffer
              ? { body: fetchOptions.body.slice(0) }
              : {}),
            ...(ArrayBuffer.isView(fetchOptions.body)
              ? {
                  body: new Uint8Array(
                    fetchOptions.body.buffer,
                    fetchOptions.body.byteOffset,
                    fetchOptions.body.byteLength,
                  ).slice(),
                }
              : {}),
          },
        }
      : {}),
    ...(config.worker
      ? {
          worker: {
            ...config.worker,
            ...(config.worker.url ? { url: new URL(config.worker.url.href) } : {}),
          },
        }
      : {}),
  };
}
