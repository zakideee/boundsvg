---
"@boundsvg/browser": minor
"@boundsvg/core": minor
"@boundsvg/react": minor
"@boundsvg/worker": minor
---

Add document-synchronized animated SVG playback with
`playback: { mode: "timeline", durationMs, iterations }`. Timeline mode compiles every authored
track onto one deterministic document clock; existing static rendering and
`playback: { mode: "independent" }` behavior are unchanged.

This widens the `AnimatedSvgPlayback` union and therefore has source impact for exhaustive switches.
Add a `"timeline"` case, or continue passing `{ mode: "independent" }` to preserve authored clocks.

Timeline playback accepts a finite document `durationMs` in `[1, 2^32]` and document `iterations`
as `"infinite"` or a positive finite value at most `2^20`. In timeline mode, authored track
`durationMs` must be in `[1, 2^32]`, authored and effective-unit `delayMs` in
`[-2^32, 2^32]`, and finite authored track `iterations` in `[2^-32, 2^20]` (or
`"infinite"`). Values outside that authored domain fail with
`ANIMATED_SVG_TIMELINE_UNREPRESENTABLE` and reason `authored-value-out-of-domain`.

When adopting timeline mode, bring the reported authored field into the supported range. If the
authored clock or a wider numeric range must be retained, use independent playback instead.
