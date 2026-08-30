---
title: Introduction
---

# Introduction

## Why

SVG has no built-in text measurement or layout: you cannot auto-size text to fit a container, wrap lines, or use flexbox the way HTML does. The usual workarounds — `canvas.measureText`, hidden DOM elements — depend on the runtime, so the same document can measure differently across OS fonts and browser engines.

boundsvg takes OS font measurement out of the equation. Font shaping
(rustybuzz, HarfBuzz-compatible) and layout (Taffy flexbox and CSS Grid) run in
version-pinned WASM against fonts you supply. Within one boundsvg version,
accepted owned inputs produce byte-identical SVG, PNG, WebP, and GIF artifacts
across supported runtimes after any documented normalization. Raw embedded
SVG, live animation scheduling, and external video encoders have explicit
boundaries in the [determinism contract](/reference/determinism). Text can
shrink or grow to fit its container, wrap, truncate with an ellipsis, or stop
at a line limit.

## Examples

<div class="example-output">
  <img src="/generated/terminal-code.svg" alt="Terminal-style code viewer" />
</div>

<div class="example-output">
  <img src="/generated/figure-flow.svg" alt="A heading that shrink-fits its row while Japanese body copy wraps around a donut chart via a circular text-flow exclusion" />
</div>

<div class="example-output">
  <img src="/generated/vertical-ruby-ja.svg" alt="Vertical Japanese text with Ruby annotations" />
</div>

## Packages

The nine publishable packages, plus the three playground apps. Internal tooling
(`@boundsvg/docs`, `@boundsvg/playground-shared`, `@boundsvg/bench`,
`@boundsvg/boundtext-visual-validator`) is private and not listed.

| Package                      | Path                    | Description                                                    |
| ---------------------------- | ----------------------- | -------------------------------------------------------------- |
| `@boundsvg/core`             | `packages/core`         | Main library — text measurement, layout, SVG/PNG/WebP/GIF emit |
| `@boundsvg/react`            | `packages/react`        | React integration — Provider, hooks, `<BoundSvg>` component    |
| `@boundsvg/worker`           | `packages/worker`       | Web Worker adapter — off-main-thread rendering                 |
| `@boundsvg/cli`              | `packages/cli`          | CLI tool — `convert`, `export`, `inspect`, `doctor`            |
| `@boundsvg/browser`          | `packages/browser`      | Browser WASM loader and SVG DOM utilities                      |
| `@boundsvg/video`            | `packages/video`        | Browser MP4 export — WebCodecs H.264 plus a bundled muxer      |
| `@boundsvg/extras`           | `packages/extras`       | Unstyled utility components — `HStack`, `FitText`, etc.        |
| `@boundsvg/shape`            | `packages/shape`        | Geometry / symbol data builders for `Shape` and `Symbol`       |
| `@boundsvg/testing`          | `packages/testing`      | Test helpers — SVG snapshots, warnings, Vitest matchers        |
| `@boundsvg/playground-react` | `apps/playground-react` | Interactive React demo app                                     |
| `@boundsvg/playground-core`  | `apps/playground-core`  | Core API demo (no React, TypeScript + Vite)                    |
| `@boundsvg/playground-cli`   | `apps/playground-cli`   | CLI demo — SVG analysis + multi-format output                  |

## Architecture

```
VNode → Validate → Build Taffy Tree → Compute Layout
  → Text Resolve → Build IR → Emit (SVG/PNG/WebP/GIF)
```

## License

boundsvg is licensed under either the [MIT License](https://github.com/zakideee/boundsvg/blob/main/LICENSE-MIT) or the [Apache License 2.0](https://github.com/zakideee/boundsvg/blob/main/LICENSE-APACHE), at your option.
