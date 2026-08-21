# Vendored ttf-parser 0.25.1 (patched)

Copy of ttf-parser 0.25.1 from crates.io (MIT/Apache-2.0, licenses included),
with fixes for fonts that have exactly `maxp.numGlyphs == 65535` (`u16::MAX`) —
e.g. Google's official Noto Sans CJK JP variable font. Such a font is
well-formed: 65535 is the maximum valid glyph count, and by spec the `loca`
and `gvar` offset arrays then hold `numGlyphs + 1 == 65536` entries, which does
not fit the `u16` counts the released code used.

- `src/tables/loca.rs`: backport of the upstream fix
  (harfbuzz/ttf-parser commit `3a193ba`, merged 2026-08-05, unreleased as of
  0.25.1). The offset count and index are widened to `u32`
  (`LazyArray16` → `LazyArray32`), so all 65536 offsets survive and the last
  valid glyph id (65534) keeps its offset pair. The released code rejected the
  count outright, which dropped the whole table and silently erased every
  glyph outline while metrics/shaping kept working.
- `src/tables/gvar.rs`: the same widening applied to the glyph variation data
  offsets. Still unfixed in upstream `main` as of 2026-08-20 (the
  `glyph_count.checked_add(1)?` overflow remains) — upstream issue/PR
  candidate.

Why a backport instead of pinning upstream `main`: the fix is unreleased
(0.26.0 pending), 0.26 is a breaking release that the `ttf-parser 0.25`
consumers in this workspace (rustybuzz among them) cannot follow
automatically, and upstream `main` requires MSRV 1.88 while this workspace
pins 1.85.

Other deliberate differences from the crates.io tarball: `examples/` and
`testing-tools/` are dropped (with their `Cargo.toml` entries), the README is
reformatted by this repo's Prettier, `Cargo.lock` floats with the workspace,
and each patched module carries a `boundsvg_patch_tests` regression test that
builds the full 65536-offset tables.

Wired in via `[patch.crates-io]` in the workspace `Cargo.toml`, which also
covers every other dependency on the same version (rustybuzz, fontdb, usvg,
resvg). Search for `PATCHED` to find the exact regions. Remove this vendored
copy once the whole dependency graph can move to a released ttf-parser that
contains both fixes.
