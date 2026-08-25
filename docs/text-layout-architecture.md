# Text layout architecture

This document defines the ownership and correctness contract for ordinary text,
rich text, exclusion flow, fitting, and ellipsis. It is an implementation
contract for the Rust crates; the user-facing behavior is documented under
`apps/docs/`.

## Ownership

- `boundtext` owns source normalization, shaping, source projection, inline
  fragmentation, line breaking, fitting, ellipsis planning, and intrinsic
  measurement.
- `boundsvg` owns layout orchestration, prepared exclusion geometry, the WASM
  bridge, IR construction, and output materialization.
- `packages/core` owns the TypeScript input API, validation, and bridge types.
  It does not measure, break, truncate, or fit text.
- Playground applications contain examples only.

`boundsvg` must not recover from a `boundtext` failure by estimating text from
character or glyph counts. A text failure aborts the render with its typed
error and does not materialize partial layout or output.

## Canonical document

All plain, span, and recursive rich inputs adapt to one immutable logical
document before planning. Every authored item has independent identities for:

- authored order, including zero-source items such as `InlineRect`;
- source range, when the item contributes source text;
- shaping style;
- paint style;
- decoration owner; and
- diagnostic owner.

Internal node and boundary IDs are deterministic for one normalized input but
are not public stable IDs. Source order is not inferred from source offsets:
multiple zero-source items may occupy distinct authored positions at the same
offset.

The structural rules are:

- `Segment` and fragmentable decorated spans may split at legal text
  boundaries.
- `Ruby`, `InlineBox`, `InlineRect`, and text-combine units are atomic.
- A nested decorated span keeps its owner identity across every emitted
  fragment.
- Paint-only boundaries do not split a shaping run.
- An atomic item's children never leak output, warnings, or decoration after
  that item is omitted.

## Planning pipeline

The planner runs in this order:

1. Validate and normalize the complete authored input.
2. Build the canonical document and source projection.
3. Resolve fitting against the complete document with ellipsis disabled.
4. Plan lines or columns at the selected font size.
5. If constrained content overflows and ellipsis is enabled, select the
   longest legal display prefix and re-plan that prefix plus the marker.
6. Commit diagnostics and materialize output exactly once for the selected
   plan.

Fit therefore never measures an already-truncated display sequence. Ellipsis
never changes the selected fit size.

## Logical axes and regions

Line breaking consumes logical inline intervals in logical block bands.
Horizontal and vertical writing share the same planner state; an axis strategy
maps logical coordinates to physical coordinates only at placement time.

Region input is one of:

- an infallible inline `Rect` fast path for ordinary rectangular text; or
- a fallible, normalized, memoized provider for exclusion flow.

A provider query is a pure function of the normalized geometry, logical band,
minimum inline extent, and writing mode. Returned intervals are finite,
non-negative, ordered, disjoint, clipped to the flow box, and stable for an
identical query. `maxLines` remains a breaker constraint, not geometry.

`boundsvg` parses and normalizes path geometry once before it constructs the
provider. Provider work and returned intervals are charged to deterministic
budgets; wall-clock time is never an input.

## Legal ellipsis boundaries

Ellipsis candidates are logical authored prefixes. Full Unicode bidi
reordering remains unsupported; Arabic and other contextual scripts still
shape in logical source order.

A candidate boundary is legal only when all of the following hold:

1. It is an extended-grapheme-cluster boundary under the Unicode segmentation
   version used by the build.
2. It is not inside an atomic rich item.
3. Whitespace normalization has selected the same logical boundary that will
   be displayed; collapsible trailing space is removed before the marker.
4. The configured wrap policy, supplied UAX #14 opportunities, and the active
   kinsoku profile permit the resulting visible tail.
5. Re-shaping the complete candidate as end-of-text produces a valid prefix
   and marker run.

An original shaping-cluster boundary is not a legality requirement. For
example, cutting the source letters of a ligature at an EGC boundary is valid
when the retained prefix is re-shaped; retaining part of the original glyph is
not. Arabic joining forms must likewise be recomputed for the new end of text.
The fixed U+2026 marker is shaped as a separate synthetic run so it cannot
acquire an authored source range or join an authored shaping cluster.

Candidates are evaluated from longest to shortest. The first candidate whose
exact re-shape and re-layout satisfies every line, column, region, height, and
width constraint is the result. The algorithm does not assume that fitting is
monotone in prefix length. An optimization may skip candidates only when a
conservative bound proves that every skipped candidate is impossible; a
last-visible-line heuristic is not a proof.

If the marker alone does not fit, display ink is empty. Authored source and
source units are still retained.

## Synthetic marker projection

The ellipsis marker uses the effective shaping and paint style of the first
omitted authored item. For a zero-source or atomic item, this means its
inherited surrounding text style; ruby annotation style is not selected.
Root style is the final fallback.

The marker is structurally outside every omitted atomic item. It may inherit
the first omitted item's fragmentable decoration owners, but never a ruby
annotation, atomic box background, inline rectangle, or nested atomic
decoration.

The result projection is:

- `sourceText`: the complete normalized authored source;
- `displayText`: the retained logical prefix followed by U+2026;
- authored glyphs: their original source range and role;
- synthetic glyphs: `syntheticKind = "ellipsis"` with no source range or
  source role; and
- omitted source units: retained with empty glyph-member lists.

No UnitMap unit is invented for the marker.

## Diagnostics and materialization

Each validation or layout evaluation writes to an isolated diagnostic ledger.
Diagnostic ownership is one of:

- global input;
- an authored node;
- a synthetic item; or
- final layout.

Rejected ellipsis candidates and rejected fit probes are discarded with their
entire ledgers. Only the selected evaluation is committed. A deterministic key
deduplicates committed diagnostics, which are sorted by source order,
synthetic order, code, and stable detail. This ensures that omitted authored
items do not emit recoverable warnings while the selected synthetic marker can
emit its own warning.

Complete-input fatal validation is not filtered by display selection. An
invalid authored input remains invalid even when the invalid item would have
been omitted.

## Fit contract

The existing `shrinkEpsilonPx`, `shrinkMaxIterations`, `growEpsilonPx`, and
`growMaxIterations` properties remain supported.

The planner selects its search algorithm from a proof, not from an assumption:

- A certified monotone predicate uses endpoint checks and binary search.
  `*MaxIterations` limits binary refinement and `*EpsilonPx` is its convergence
  tolerance.
- An uncertified predicate, including exclusion-flow topology, uses a
  descending deterministic grid whose step is `*EpsilonPx`. It returns the
  largest fitting grid candidate. Both range endpoints are included.

`fitMaxProbes` is an additive public work limit for an exact-grid search. It
does not replace or reinterpret `*MaxIterations`. If the complete grid exceeds
the configured or hard deterministic probe budget, layout fails with
`TEXT_FIT_PROBE_LIMIT`; it does not return an unproven smaller size.

Shrink evaluates the authored size first and clamps to the minimum with
`cannot_fit` when even the minimum fails. Grow requires the authored size to
fit and otherwise reports the existing failure. The existing
`chosenFontSizePx` and `overflow` fields remain the result contract; no
parallel fit-status DTO is introduced.

## Failure and resource contract

Structural invalidity and deterministic resource exhaustion are typed fatal
errors. There is no approximate or partial text output. Numeric limits are
calibrated with public adversarial benchmarks in the same output-affecting
change that enables them; an unexplained constant is not a contract.

The public input variables are:

- `B`: normalized UTF-8 bytes;
- `N`: canonical nodes, including zero-source nodes;
- `R`: resolved shaping/paint/decoration runs;
- `D`: maximum rich nesting depth;
- `S`: legal source boundaries;
- `G`: shaped glyphs;
- `A`: atomic inline items;
- `C`: ellipsis candidates actually evaluated;
- `F`: fit probes;
- `L`: materialized lines or columns;
- `E`: flow exclusions;
- `K`: normalized geometry segments;
- `Q`: region queries;
- `Z`: returned free intervals; and
- `O_g`, `O_d`, `O_r`: materialized glyph, decoration, and inline-rect output.

With `T(p, K, E, Q, Z)` denoting one exact layout of a prefix of length `p`,
the conservative worst case is:

```text
time  = O(B + N + R + K log K + F*T(S,K,E,Q,Z) + sum(T(p_i,K,E,Q,Z)) + O_g + O_d + O_r)
space = O(B + N + R + G + K + Z + O_g + O_d + O_r)
```

The sum covers all evaluated ellipsis candidates and is quadratic in source
length when no safe pruning or reusable checkpoint applies. Benchmarks must
therefore report candidate, fit-probe, region-query, returned-interval,
shaped-glyph, and materialization counters in addition to time and memory.

## Public and Rust migration

- JSX and `RichTextNode` stay source-compatible.
- TypeScript and the WASM request schema add only `fitMaxProbes`.
- `boundtext::layout_text` and its metadata variant return
  `Result<TextLayoutResult, TextLayoutError>` instead of `Option`. Rust callers
  migrate `Some/None` handling to `Ok/Err`; existing `.expect(...)` callers
  continue to compile.
- The two-method physical `FlowRegionSource` trait is replaced by the
  logical-axis, fallible `RegionProvider` contract. Implementors normalize and
  validate returned intervals or return a typed provider error.
- The bundled WASM ABI is updated with TypeScript bridge types in the same
  change. The ABI is internal and versions must not be mixed.

These Rust changes are breaking for the `0.x` crates and require a minor
release migration note. The TypeScript addition is non-breaking. Rendered
output changes are output-affecting and require a changeset; this work does not
perform a version bump.

## Rollback units

Implementation is divided so each completed commit is green and bisectable:

1. Contract tests and canonical document/source identities, with unchanged
   non-overflow output.
2. Typed errors, authoritative measurement, and removal of the orchestration
   fallback.
3. Logical regions and the rectangular fast path.
4. Unified exact ellipsis selection and synthetic projection.
5. Certified fit search and probe budgeting.
6. WASM/TypeScript surfaces, mirrored demos, docs, changeset, and benchmarks.
