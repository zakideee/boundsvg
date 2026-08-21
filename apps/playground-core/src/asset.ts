/// <reference types="vite/client" />

/**
 * Resolve a public-directory asset path against the Vite base URL.
 *
 * Assets under `public/` are served at `<base><path>`. Hardcoded absolute
 * paths like `/fonts/x.woff2` break when the app is deployed under a GitHub
 * Pages subpath (e.g. `/boundsvg/playground/core/`). Prefixing with
 * `import.meta.env.BASE_URL` keeps them correct in both dev (base `/`) and
 * subpath deployments.
 */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}
