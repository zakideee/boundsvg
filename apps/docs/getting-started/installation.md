---
title: Installation
---

# Installation

::: warning Work in Progress
boundsvg is not yet published to npm. For now, build from source.
:::

## From Source

```bash
git clone https://github.com/zakideee/boundsvg.git
cd boundsvg
pnpm install

# Build WASM (Node.js target)
pnpm build:wasm

# Build TypeScript packages
pnpm --filter @boundsvg/shape build
pnpm --filter @boundsvg/core build
```

`@boundsvg/shape` comes first: it supplies the geometry types core re-exports, so
core's declaration build fails on a fresh checkout without it. Core's JavaScript
output does not import it.

## Requirements

- Node.js >= 20
- pnpm >= 9
- Rust toolchain (for building WASM from source) — `rust-toolchain.toml` pins the version
- wasm-pack

## Browser Usage

For browser environments, you also need the web WASM target:

```bash
pnpm build:wasm:web
pnpm --filter @boundsvg/browser build
pnpm --filter @boundsvg/worker build
pnpm --filter @boundsvg/react build
```

## MP4 Export

`@boundsvg/video` bundles its own muxer WASM, built on a separate chain:

```bash
pnpm build:wasm:mp4
pnpm --filter @boundsvg/video build
```
