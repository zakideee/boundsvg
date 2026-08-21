# Third-Party SVG License Policy

This document defines how `boundsvg` can use third-party SVG assets in tests, fixtures, and playground samples.

## Active Profile

- Current profile: `MIT/CC0 only`
- Imported as actual files: `microsoft/fluentui-emoji` and Natural Earth assets.
- `mdn/html-examples` remains allowlisted, but is documentation-only (no committed SVG imports yet).

## Scope

- Applies to files committed into this repository.
- Applies to generated outputs derived from third-party assets (for example PNG snapshots).
- Applies to both humans and coding agents.

## Repository Allowlist (Current)

### 1) MDN html-examples

- Upstream: `https://github.com/mdn/html-examples`
- License: CC0-1.0
- License file: `https://github.com/mdn/html-examples/blob/main/LICENSE`
- Status: allowlisted but not yet imported as fixture files.
- Required action:
  - Record upstream URL + commit SHA + asset path when importing files.
  - Pass the "Asset Complexity Gate" defined below when importing.

### 2) Microsoft Fluent UI Emoji

- Upstream: `https://github.com/microsoft/fluentui-emoji`
- Asset type used in this repo: SVG files under `assets/**/Color/*.svg`
- License: MIT
- Required action:
  - Keep MIT license notice available in repository distribution context.
  - Record upstream URL + commit SHA + asset path when importing files.
  - Pass the "Asset Complexity Gate" defined below.

### 3) Natural Earth

- Upstream: `https://github.com/zakideee/natural-earth-svg`
- Original data: `https://www.naturalearthdata.com/`
- Asset type used in this repo: SVG map rendered from Natural Earth data (1:50m terrain + coastline + borders)
- License: Public Domain
- Required action:
  - Record upstream URL + commit SHA when importing files.
  - Pass the "Asset Complexity Gate" defined below.
  - Note: No attribution legally required (public domain), but provenance is tracked for integrity.

### 4) Mozilla fxemoji

- Upstream: `https://github.com/mozilla/fxemoji`
- Asset type used in this repo: visual SVG assets under `svgs/**`
- License split:
  - Code: Apache-2.0
  - Visual design/assets: CC BY 4.0
- Current status: paused (not allowed in active MIT/CC0 profile).

## Asset Complexity Gate (Mandatory)

Do not use extremely small, simple icon-style assets in this repository.

Reject the asset when all of the following are true:

- Intrinsic size is small (`width` and `height` <= 64, or equivalent `viewBox` size).
- File size is small (below 32 KiB).
- Structural complexity is low (fewer than 120 shape/structure elements such as `path`, `circle`, `rect`, `g`, gradients, clip/mask).

If uncertain, reject by default and pick a more complex source asset.

## Disallowed / Restricted

- Do not use `googlefonts/noto-emoji` in this repository.
- Do not use `twitter/twemoji` in this repository (small icon-style asset set for current policy).
- Do not use `duerrsimon/bioicons` in this repository (mixed per-icon licenses and higher compliance risk).
- Do not use `web-platform-tests/wpt` SVG assets in this repository (license provenance/usage scope complexity).
- Do not use `mozilla/fxemoji` while MIT/CC0 profile is active.
- Do not import assets with `NOASSERTION`, unknown, or unclear license.
- Do not import assets with restrictive terms that conflict with repository use (for example `CC BY-ND`, `All Rights Reserved`) unless explicitly approved by a maintainer.

## Modification Rules (Safety)

If CC BY sources are re-enabled in a future profile, the following count as adaptation/modification:

- Editing path/style/structure in SVG.
- Simplifying/optimizing SVG content.
- Using the SVG to generate raster outputs and committing those outputs.

When any of the above is done:

- Keep attribution.
- Keep license notice.
- Mark that changes were made.

## Rasterized Outputs (PNG/Snapshots)

- Default: do not commit third-party-derived rasterized outputs.
- Exception: allowed only when redistribution conditions are verified and required attribution/license notices are included in-repo.
- If uncertain, do not commit raster outputs.

## Mandatory import record

For every imported third-party SVG, keep traceable metadata in PR description (or equivalent review record):

- Upstream repository URL
- Commit SHA (or immutable release tag)
- Original asset path
- License name/version applied to that asset
- Complexity gate evidence (`width/height` or `viewBox`, file size, element count)
- Whether modifications were made
- Whether rasterized derivatives were generated and committed

## Coding agent guardrails

- Coding agents must not auto-download or auto-rewrite third-party assets outside the allowed sources and rules in this document.
- Coding agents must apply the "Asset Complexity Gate" before proposing or importing SVG fixtures.
- If license status is unclear, stop and request maintainer confirmation.
