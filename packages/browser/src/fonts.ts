export type BrowserFontDefinition = {
  alias: string;
  weight?: number;
  style?: "normal" | "italic";
  source: string | URL | Uint8Array;
};

export type ResolvedBrowserFont = {
  alias: string;
  weight: number;
  style: "normal" | "italic";
  data: Uint8Array;
};

export type FontLoaderOptions = {
  fetchOptions?: RequestInit;
};

export type FontLoader = {
  load(source: BrowserFontDefinition["source"], options?: FontLoaderOptions): Promise<Uint8Array>;
  preload(
    fonts: ReadonlyArray<BrowserFontDefinition>,
    options?: FontLoaderOptions,
  ): Promise<ResolvedBrowserFont[]>;
  clear(): void;
};

const sharedFontLoader = createFontLoader();

export function createFontLoader(defaultOptions: FontLoaderOptions = {}): FontLoader {
  const cache = new Map<string, Promise<Uint8Array>>();

  async function load(
    source: BrowserFontDefinition["source"],
    options: FontLoaderOptions = {},
  ): Promise<Uint8Array> {
    if (source instanceof Uint8Array) {
      return source;
    }

    const url = source instanceof URL ? source.href : source;
    const cached = cache.get(url);
    if (cached) {
      return cached;
    }

    const request = fetchFont(url, mergeFontLoaderOptions(defaultOptions, options));
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

  async function preload(
    fonts: ReadonlyArray<BrowserFontDefinition>,
    options: FontLoaderOptions = {},
  ): Promise<ResolvedBrowserFont[]> {
    return Promise.all(
      fonts.map(async (fontEntry) => ({
        alias: fontEntry.alias,
        weight: fontEntry.weight ?? 400,
        style: fontEntry.style ?? "normal",
        data: await load(fontEntry.source, options),
      })),
    );
  }

  return {
    load,
    preload,
    clear() {
      cache.clear();
    },
  };
}

export function preloadFonts(
  fonts: ReadonlyArray<BrowserFontDefinition>,
  options?: FontLoaderOptions,
): Promise<ResolvedBrowserFont[]> {
  return sharedFontLoader.preload(fonts, options);
}

export function clearFontCache(): void {
  sharedFontLoader.clear();
}

async function fetchFont(url: string, options: FontLoaderOptions): Promise<Uint8Array> {
  const response = await fetch(url, options.fetchOptions);
  if (!response.ok) {
    throw new Error(`Failed to fetch font: ${url} (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function mergeFontLoaderOptions(
  defaults: FontLoaderOptions,
  overrides: FontLoaderOptions,
): FontLoaderOptions {
  return {
    fetchOptions: mergeRequestInit(defaults.fetchOptions, overrides.fetchOptions),
  };
}

function mergeRequestInit(defaults: RequestInit | undefined, overrides: RequestInit | undefined) {
  if (!defaults) {
    return overrides;
  }
  if (!overrides) {
    return defaults;
  }
  return {
    ...defaults,
    ...overrides,
    headers: mergeHeaders(defaults.headers, overrides.headers),
  };
}

function mergeHeaders(
  defaults: HeadersInit | undefined,
  overrides: HeadersInit | undefined,
): HeadersInit | undefined {
  if (!defaults) {
    return overrides;
  }
  if (!overrides) {
    return defaults;
  }
  const headers = new Headers(defaults);
  const overrideHeaders = new Headers(overrides);
  for (const [key, value] of overrideHeaders) {
    headers.set(key, value);
  }
  return headers;
}
