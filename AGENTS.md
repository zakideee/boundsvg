# Agent guide — boundsvg

A library that generates reproducible SVG/PNG/WebP/GIF from declarative layout components (JSX). Font shaping, measurement, layout, and rasterization are all completed within WASM.

## Documentation

- `docs/third-party-svg-licenses.md` — Third-party SVG license policy
- `apps/docs/` — User-facing documentation (VitePress)

## Build & Test

```bash
# WASM build
pnpm build:wasm          # nodejs target → packages/core/wasm-pkg/
pnpm build:wasm:web      # web target → crates/boundsvg/pkg-web/
pnpm build:wasm:mp4      # boundmp4 (MP4 muxer) web target → packages/video/wasm-pkg/

# TS build
pnpm --filter @boundsvg/shape build     # core's dts build imports its types — build first
pnpm --filter @boundsvg/core build
pnpm --filter @boundsvg/browser build
pnpm --filter @boundsvg/worker build
pnpm --filter @boundsvg/video build
pnpm --filter @boundsvg/react build
pnpm --filter @boundsvg/cli build

# Test
pnpm -r test                            # every package that defines a test script
pnpm --filter @boundsvg/core test       # or one at a time
cargo test --workspace                  # Rust (all five crates)
cd crates/boundsvg && cargo test        # or one crate while iterating
```

**Build dependency order**: When WASM is changed, run in this order: `build:wasm` → `build:wasm:web` → shape `build` → core `build` → browser `build` → worker `build` → react/cli `build` → `test`. The MP4 muxer wasm is independent: `build:wasm:mp4` → video `build`.

## Architecture

```
VNode → Validate → Build Taffy Tree → Compute Layout → Text Resolve → Build IR → Emit (SVG/PNG/WebP/GIF)
```

- **Taffy only**: No Yoga. Box is internally a flex node.
- **No react-reconciler**: `toVNode()` + static tree walk (Satori-style).
- **All-WASM pipeline**: Text shaping, layout, and rasterization run entirely in WASM. No TS-side text engine.
- **Single IR source**: Both renderToSvg and renderToPng generate IR internally and pass it to the emitter.
- **WASM dual target**: nodejs → `packages/core/wasm-pkg/`, web → `crates/boundsvg/pkg-web/`

## Module Boundaries

- `boundtext` owns text-engine logic: shaping, line breaking, whitespace behavior, inline/rich-text fragmentation, kinsoku, vertical text, fit, ellipsis, and intrinsic text measurement.
- `boundsvg` owns rendering-pipeline logic: WASM-facing APIs, Taffy layout integration, scene/layout orchestration, IR build, SVG emit, raster encoding (PNG/WebP/GIF), and font/asset decoding needed for rendering.
- `packages/core` owns the TS public API, VNode flattening/validation, and Rust bridge types. It must not become a second text engine.
- `apps/playground-*` own demos and repros only. Do not park production layout logic there.

When adding a feature, decide its home first:

- If it changes how text is measured, wrapped, fragmented, or fit, implement it in `boundtext` first and bridge it upward.
- If it changes WASM DTOs, render orchestration, or SVG / raster output, implement it in `boundsvg`.
- Do not introduce temporary TS-side or `boundsvg`-side text-layout logic that is expected to be moved into `boundtext` later.

### Mirrored playground samples

Several sample scenes are authored twice — once in `apps/playground-core/src/presets/` with the
core function API, once in `apps/playground-react/src/pages/templates/` as JSX (currently:
`animated-svg-timeline`, `decoration-path-fit`, `font-fallback`, `inline-primitives`, `rich-text-on-path`,
`text-on-path-basics`, `text-path-motion`, `typing-ime-timeline`, `variable-font`,
`vertical-rich-ellipsis`). When changing one copy, update the other in the same change.

## Coding Conventions

- TypeScript strict mode. No `any`.
- All units in px. No em / rem / % / vw.
- Errors split into Fatal (throw) and Recoverable (warn + fallback).
- padding / margin: `number` or `[top, right, bottom, left]`. No 2/3-element shorthand.
- Props → LayoutStyle mapping is centralized in `layout/taffy-style-mapper.ts`.

## Style Enforcement (automated — reference only)

- Run `pnpm lint:fix` before proposing changes.
- Run `pnpm knip` to check for unused exports (enforced in pre-commit hook).
- Prefer specific variable names (`fontEntry` not `data`, `layoutBbox` not `box`).
- Avoid variable shadowing. When an inner scope needs a variable with the same semantic role as an outer scope, use a more specific name (e.g. `renderOptions` instead of re-using `options`). Biome `noShadow` is nursery — enforce by convention until it stabilizes.
- Error handling: use `FatalError` for unrecoverable states, `RecoverableError` for fallback paths. Never use bare `new Error()` in `packages/core/src/`. See `packages/core/src/errors.ts`.
- WASM type files (`wasm/types.ts`, `packages/browser/src/index.ts`) use `snake_case` to match Rust. This is intentional — do not rename.
- Do NOT add `#[allow(clippy::*)]` without justification.
- `as any` type assertions are banned (GritQL plugin in `biome-plugins/`). Use proper types or `as unknown as T` for test doubles.
- Package import boundaries are enforced by `noRestrictedImports` overrides in `biome.json`.
- `export *` is banned. Use explicit named exports.
- All if/for/while must use `{}` block statements.

## Commit Conventions

Conventional Commits. PR title = squash merge commit message.

```
<type>(<scope>): <summary>
```

**type**: `feat` / `fix` / `refactor` / `test` / `perf` / `docs` / `chore` / `ci`
**scope**: `core` / `engine` (Rust crates: boundsvg / boundtext / boundshape) / `browser` / `react` / `worker` / `video` (@boundsvg/video and the boundmp4 crate) / `cli` / `shape` / `extras` / `testing` / `playground-core` / `playground-react` / `playground-cli` / `playground-shared` / `bench` / `tools` / `docs` (apps/docs)

Changes spanning multiple packages use comma-joined scopes, most-affected first (e.g. `feat(core,react): ...`).

## Behavioral Constraints

- No direct push to main. Use feature branch → PR → squash merge.
- Update tests when modifying code in areas that have tests.
- Do not vendor, fork, patch, or replace a third-party dependency's source
  without explicit maintainer approval naming that dependency.
  `pnpm check:third-party-source-overrides` enforces the allowlist
  (`vendor/ttf-parser` is the sole approved entry) and runs in preflight.

## Third-Party SVG License Safety (Mandatory)

- Follow `docs/third-party-svg-licenses.md` for allowlist, license obligations, and raster/snapshot handling.
- If license status is unclear, stop and request maintainer confirmation.

## Forbidden

- Exposing SVG attributes (`x`, `y`, `style`, `transform`) in the public API
- Browser DOM APIs (document, window) inside render functions
- OS-dependent font lookup (always inject via assets)
