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
  fragment, including fragments split by exclusion regions.
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

Every exclusion-flow input uses a fallible, normalized, memoized
`RegionProvider`. A provider with no exclusions may declare
`FitSearchKind::CertifiedMonotone`; providers with topology-changing geometry
use the conservative `Uncertified` default. Provider certification is only
one half of fit certification: negative tracking or negative proportional
line/ruby metrics force exact-grid evaluation even for rectangular geometry.
Ordinary non-flow text does not query geometry.

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

After the complete document is proven to overflow, the authoritative API
preflights the maximum exact work before shaping a candidate. One projection
may require at most 1,024 exact candidate layouts, including the marker-only
probe and the final empty-display projection when the marker does not fit. A
larger legal candidate set fails with `TEXT_ELLIPSIS_CANDIDATE_LIMIT` and no
partial output. A complete document that fits bypasses this ellipsis budget.

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

When one shaping cluster crosses a paint-only source boundary, the cluster is
painted with the effective paint style of its source-start grapheme. This is a
deterministic ownership rule for indivisible ligatures/contextual clusters; it
does not split or duplicate the shaped glyph.

## Diagnostics and materialization

Each validation or layout evaluation builds an isolated diagnostic set.
Diagnostic ownership is one of:

- global input;
- an authored node;
- a synthetic item; or
- final layout.

Rejected ellipsis candidates and rejected fit probes are discarded with their
entire diagnostic sets. Only the selected evaluation is committed. Missing
glyph diagnostics are grouped deterministically by font alias; authored-node
diagnostics follow normalized authored traversal order after that group. An
atomic node stores the diagnostics of its complete subtree, while a
fragmentable decorated span retains the ownership of each child diagnostic.
This ensures that omitted authored items do not emit recoverable warnings
while the selected synthetic marker can emit its own warning.

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
- An uncertified predicate, including negative tracking/proportional metrics
  or exclusion-flow topology, uses a descending deterministic grid whose step
  is `*EpsilonPx`. It returns the largest fitting grid candidate. Both range
  endpoints are included; shrink is anchored at the authored upper endpoint
  and grow at the configured maximum.

`fitMaxProbes` is an additive public work limit for an exact-grid search. It
does not replace or reinterpret `*MaxIterations`. If the complete grid exceeds
the configured or hard deterministic probe budget, layout fails with
`TEXT_FIT_PROBE_LIMIT`; it does not return an unproven smaller size.
The default exact-grid limit is 4,096 probes and the hard maximum is 65,536.
`fitMaxProbes` must be a positive integer; values above the hard maximum are
clamped to that maximum.

Certified shrink may infer `cannot_fit` from a failing minimum endpoint.
Uncertified shrink evaluates the complete bounded grid and reports
`cannot_fit` only when no candidate fits; a failing minimum does not exclude a
larger fit island. Grow requires the authored size to fit before considering
any larger island and otherwise reports the existing failure. The existing
`chosenFontSizePx` and `overflow` fields remain the result contract; no
parallel fit-status DTO is introduced.

Fit scales `fontSizePx` and `letterSpacingPx` by the same candidate ratio for
plain, span, and rich inputs. An explicit `lineHeightPx` remains an absolute
pixel value; proportional `lineHeight` follows the candidate font size.

## Failure and resource contract

Structural invalidity and deterministic resource exhaustion are typed fatal
errors. There is no approximate or partial text output. Numeric limits are
calibrated with public adversarial benchmarks in the same output-affecting
change that enables them; an unexplained constant is not a contract.

The limits enforced per authoritative operation are:

| Resource                                 |                                 Limit | Fatal code                      |
| ---------------------------------------- | ------------------------------------: | ------------------------------- |
| Recursive rich-text container depth      |                                    48 | `RICH_TEXT_MAX_DEPTH`           |
| Authored inline rectangles per text node |                                 4,096 | `INLINE_RECT_COMPLEXITY_LIMIT`  |
| Exact ellipsis candidate layouts         |                                 1,024 | `TEXT_ELLIPSIS_CANDIDATE_LIMIT` |
| Exact-grid fit probes                    | 4,096 by default; 65,536 hard maximum | `TEXT_FIT_PROBE_LIMIT`          |
| Distinct region queries                  |                                65,536 | `TEXT_REGION_QUERY_LIMIT`       |
| Cumulative returned intervals            |                               262,144 | `TEXT_REGION_INTERVAL_LIMIT`    |

Non-finite, negative, overlapping, out-of-frame, or otherwise invalid provider
queries and intervals fail with `TEXT_REGION_PROVIDER_INVALID`. Region-query
and interval accounting occurs after per-layout memoization, so identical
queries consume one entry.

The public input variables are:

- `B`: normalized UTF-8 bytes;
- `N`: canonical nodes, including zero-source nodes;
- `R`: resolved shaping/paint/decoration runs;
- `D`: maximum rich nesting depth;
- `S`: legal source boundaries;
- `G`: glyphs in the complete-document shape;
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
time  = O(B + N + R + (G+S) log G + (S+A)*D + K log K + F*T(S,K,E,Q,Z) + sum(T(p_i,K,E,Q,Z)) + O_g + O_d + O_r)
space = O(B + N + R + (S+A)*D + K + Q + Z + O_g + O_d + O_r)
```

The `(G+S) log G` term covers deterministic logical-source indexing and lookup
of whole-run glyph clusters, including descending RTL-backend cluster order.
The `(S+A)*D` term is the complete fragmentable-decoration ancestry carried by
text tokens and zero-source atomic items (with public rich depth capped at
48). `Q+Z` is the memoized region-query cache and its returned intervals. `T`
includes the same indexing and ancestry work for the candidate it shapes. The
sum covers all evaluated ellipsis candidates and is quadratic in source length
when no safe pruning or reusable checkpoint applies. The public hard limits
bound `D`, inline-rectangle contribution to `A`, `C`, `F`, `Q`, and `Z`.
`B`, `N`, `R`, `S`, `G`, and the selected output remain explicit input/output
size terms rather than being hidden behind a wall-clock cutoff.

`cargo bench -p boundtext --bench text_layout_adversarial --features phase-trace`
prints one JSON record per adversarial scenario. A reference Linux run on
2026-08-25 produced:

| Scenario                         | Time (µs) | VmHWM (KiB) | Candidates | Fit probes | Region queries | Shape calls / glyphs | Materialized lines / glyphs |
| -------------------------------- | --------: | ----------: | ---------: | ---------: | -------------: | -------------------: | --------------------------: |
| `exact-ellipsis-256`             |   244,847 |       6,132 |        255 |          0 |              0 |         512 / 33,407 |                       1 / 2 |
| `ellipsis-candidate-budget-1024` |       921 |       6,488 |          0 |          0 |              0 |            1 / 1,025 |                       0 / 0 |
| `exact-exclusion-fit-65`         |    45,847 |       6,488 |         85 |         65 |            122 |         236 / 10,926 |                      2 / 12 |
| `default-exact-fit-budget-4096`  | 1,739,867 |       6,488 |          0 |      4,096 |          4,096 |      4,097 / 409,700 |                       1 / 1 |
| `content-exact-fit-209-grid`     |       412 |       6,488 |          0 |         75 |              0 |              76 / 76 |                       1 / 1 |

Elapsed time and process high-water memory are observational rather than
portable pass/fail thresholds. Counter assertions are the deterministic
performance contract and demonstrate that budget rejection performs no exact
candidate or output materialization work.

## Public and Rust migration

- JSX and `RichTextNode` stay source-compatible.
- TypeScript and the WASM request schema add only `fitMaxProbes`; the bundled
  schema handshake advances from 25 to 26.
- `boundtext::layout_text` and its metadata variant return
  `Result<TextLayoutResult, TextLayoutError>` instead of `Option`. Rust callers
  migrate `Some/None` handling to `Ok/Err`; existing `.expect(...)` callers
  continue to compile.
- Direct `TextLayoutRequest` and `FlowLayoutRequest` struct literals add
  `fit_max_probes`. Exhaustive error matches add `InvalidFitStep` and
  `FitProbeLimit`; ordinary and flow fit can both take the exact-grid path
  when content is not monotone-certified.
- Direct Rust layout and flow calls now enforce rich depth and inline-rectangle
  limits before recursive preparation or provider queries. Exhaustive error
  matches add `RichTextDepthLimit` and `InlineRectLimit`.
- The two-method physical `FlowRegionSource` trait is replaced by the
  logical-axis, fallible `RegionProvider` contract. Implementors normalize and
  validate returned intervals or return a typed provider error.
- Ordinary `TextSpanInput` requests now adapt to the canonical rich planner;
  authored paint boundaries remain available on positioned glyphs but no
  longer reset shaping. Text-on-path retains its separately prepared shaping
  run/paint-range adapter.
- `FlowLayoutResult` adds `inline_box_decorations`; consumers that construct
  this public struct add an empty vector for plain flow or forward the
  materialized rich-flow decorations.
- Shrinkwrap adapters preserve `BoundtextError` resource codes through the
  structured WASM error envelope instead of flattening them to strings.
- The bundled WASM ABI is updated with TypeScript bridge types in the same
  change. The ABI is internal and versions must not be mixed.

These Rust changes are breaking for the `0.x` crates and require a minor
release migration note. The TypeScript addition is non-breaking. Rendered
output changes are output-affecting and require a changeset; this work does not
perform a version bump.

## Rollback units

The implementation is rollbackable in three green responsibility units:

1. The canonical planner, typed failures, logical provider, exact selection,
   fit budgets, synchronized Rust/TypeScript/WASM contract, tests, fixtures,
   and adversarial benchmark.
2. The semantically mirrored Core/React demo and template-switch regression.
3. User docs, feature/limitation tables, migration notes, and the
   output-affecting changeset.
