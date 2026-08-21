# @boundsvg/cli

CLI tool for boundsvg — convert, export and inspect SVG files and Scene Documents, plus a local environment doctor.

## Installation

> Not yet published to npm — build from source. See the [monorepo README](https://github.com/zakideee/boundsvg) for setup instructions.

## Usage

```bash
# Convert an SVG file to a boundsvg React component (.tsx)
# --default-font is required for SVG input: the analyzer needs an alias to fall back to
boundsvg convert input.svg -o OutputComponent.tsx --default-font Inter

# Export an SVG to PNG using the WASM engine
# --format png is required here: only .webp, .gif and .mp4 output paths infer their format
boundsvg export input.svg -o output.png --format png --default-font Inter --font Inter:400:normal:./fonts/Inter.ttf
```

## Diagnostics

```bash
# Inspect a scene without writing rendered output
boundsvg inspect input.svg --default-font Inter --font Inter:400:normal:./fonts/Inter.ttf

# Export and keep a JSON report for CI artifacts
boundsvg export input.scene.json --font Inter:400:normal:./fonts/Inter.ttf --report input.report.json

# Check local WASM, font file setup, and ffmpeg for MP4
boundsvg doctor --font Inter:400:normal:./fonts/Inter.ttf
```

Use `inspect` before publishing generated assets, `export --report` in CI, and `doctor` when a local environment cannot initialize WASM or read fonts.

## Commands

| Command   | Description                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `convert` | Convert between SVG, Scene Document (.scene.json), and bound component (.tsx)                                                  |
| `export`  | Export SVG or Scene Document to SVG, PNG, WebP, animated WebP, GIF, MP4, layered output, or a component, using the WASM engine |
| `inspect` | Inspect render diagnostics for SVG or Scene Document input                                                                     |
| `doctor`  | Check local WASM, font configuration, and ffmpeg availability for MP4                                                          |

Run `boundsvg <command> --help` for detailed options.

## SVG analyzer limitations

The `convert` analyzer maps `<text>` onto boundsvg's layout model rather than reproducing SVG text verbatim:

- `<tspan>` per-span styles (fill, font-weight, font-style) are parsed but not preserved. Every span collapses into one `<Text>` using the parent `<text>` attributes. The per-span line structure is lost too: the generated `Text` uses the default `whiteSpace: "normal"`, which folds the joining newlines into spaces
- Text position within its bounding rect is discarded; text renders at the top-left of the inferred Box (`text-anchor` still maps to `textAlign`)
- CSS `<style>` blocks and class-based styling are ignored; only inline attributes are used
- Unsupported SVG text attributes (`transform`, `rotate`, `textLength`, `text-decoration`, etc.) are dropped with a recoverable warning. Run with `--verbose` to see which

## Documentation

Full documentation: <https://github.com/zakideee/boundsvg>

## License

MIT OR Apache-2.0
