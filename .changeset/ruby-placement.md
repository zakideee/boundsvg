---
"@boundsvg/core": minor
"@boundsvg/react": minor
"@boundsvg/worker": minor
---

Place long Ruby readings at their naturally shaped spacing. Reserve remaining overflow after bounded lending from an adjacent unannotated kana or `、。，．・` in the same final line, column, or exclusion region. The parent text moves as a block. All alignments, annotation levels, and ordinary/flow measurement use the same placement. Long readings no longer emit `LONG_RUBY_ANNOTATION`; other recoverable warnings are preserved.

**Output-affecting:** Long-reading width, position, wrapping, fit, ellipsis, unit line membership/visual order, and ink-centered animation pivots can change. Lending requires the reading to lie entirely farther from the base than the neighbor's cross-axis ink; inward disjoint readings reserve their full remaining demand. All sizes and layout paths use this rule, preserving existing fit certification and work limits. Recheck fixed frames and snapshots. Unit source and Ruby-level identity remain stable. Intentional negative tracking and arbitrary transforms do not cause dynamic collision re-layout.

Short or equal-width readings can also reserve space when their control bounds extend beyond the base range.

The WASM bridge schema is now 39. Update Core and matching Node/Web WASM together. Flow measurement removes `TextFlowFragment.ruby`, `TextFlowRubyAnnotation` and its level/run types, and `topRubyOverflowPx`/`bottomRubyOverflowPx`, including nested shrinkwrap results. Removed own keys are invalid even with `undefined` or `null`; custom producers must omit them.

Flow fragments describe reserved cells, regions, and diagnostic ranges. Render original `Text`/`Inline`/`Ruby`/`Rt` content with `flowExclusions` instead of rebuilding paint from fragments. Ruby-bearing spans always use the canonical rich path, which omits fragment style for the whole document and normalizes whitespace once. Its ranges count rich tokens rather than plain-path graphemes. See the Ruby and boundtext migration documentation for the removed Rust fields/types and signature changes.
