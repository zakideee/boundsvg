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

The authoritative planner adapts recursive rich input, span input, and plain
input that needs fit, ellipsis, or indentation to one immutable logical
document before planning. The plain, non-fit, non-ellipsis fast path still
shapes and breaks text directly; it shares the resulting source and output
contracts but does not construct the canonical rich document. Every authored
item in a canonical document has independent identities for:

- authored order, including zero-source items such as `InlineRect`;
- source range, when the item contributes source text;
- shaping style;
- paint style;
- decoration owner; and
- diagnostic owner.

Node and boundary IDs are deterministic for one normalized input but are not
public stable IDs. Source order is not inferred from source offsets:
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

`kinsoku_unresolved` describes a forced break in an otherwise contained plan;
it is not by itself a width, height, or line-count overflow. If both conditions
occur, the violated layout constraint takes precedence in `TextOverflow`.
Fit and ellipsis therefore retain a contained diagnostic plan, but still
reject or project a plan whose complete content violates a physical limit.

## Logical axes and regions

Line breaking consumes logical inline intervals in logical block bands.
Horizontal and vertical writing share the canonical authored projection and
the fit/ellipsis selection policy. Axis-specific line and column breakers own
their placement state, while both consume the same logical-region contract
before mapping coordinates to physical output.

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

Word-wrapped projection prepares the normalized grapheme byte offsets and its
sorted UAX #14 break set once for the complete candidate enumeration. Each
candidate then performs a binary-search membership check; filtering does not
rebuild or rescan the complete source for every prefix.

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
- `clusterStart` / `clusterEnd`: UTF-8 offsets in the glyph's shaping-source
  namespace. Content and ruby-base glyphs use the normalized base document;
  ruby annotations stay local to their annotation level. These offsets are not
  cross-role identities; consumers use `sourceRole` or UnitMap identity across
  namespaces;
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

The checked `Result`-returning authorities enforce each applicable limit per
operation: `text::engine::layout_text`, the public region-flow layout and
measurement entrypoints, and their `boundsvg` bridges. Legacy direct
`Option`-returning helpers are not alternate contract authorities; their
consolidation requires a separate breaking Rust API decision. The limits are:

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

- `B`: normalized UTF-8 bytes across base and ruby-annotation shaping
  namespaces;
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
- `Z`: returned free intervals;
- `I_w`: configured shrinkwrap search iterations;
- `U`: authored UnitMap source units, including every ruby annotation-level
  grapheme;
- `V`: visible cluster drafts before ruby-unit coalescing; and
- `O_g`, `O_d`, `O_r`, `O_u`: materialized glyph, decoration, inline-rect,
  and UnitMap unit/member-reference output.

With `T(p, K, E, Q, Z)` denoting one exact layout of a prefix of length `p`,
the conservative worst case is:

```text
time  = O(B + N + R + G log G + S log S + (S+A)*D + K log K + F*T(S,K,E,Q,Z) + sum(T(p_i,K,E,Q,Z)) + U*V + V^2 + V log V + O_g + O_d + O_r + O_u)
space = O(B + N + R + (S+A)*D + K + Q + Z + U + V + O_g + O_d + O_r + O_u)
```

The `G log G` term covers deterministic logical-source indexing of whole-run
glyph clusters, including descending RTL-backend cluster order. `S log S`
bounds preparation and lookup of the sorted UAX #14 byte-boundary set for
word-wrapped ellipsis; the complete source is scanned once per candidate
enumeration, not once per candidate.
The `(S+A)*D` term is the complete fragmentable-decoration ancestry carried by
text tokens and zero-source atomic items (with public rich depth capped at
48). `Q+Z` is the memoized region-query cache and its returned intervals. `T`
includes the same indexing and ancestry work for the candidate it shapes. The
sum covers all evaluated ellipsis candidates and is quadratic in source length
when no safe pruning or reusable checkpoint applies. The public hard limits
bound `D`, inline-rectangle contribution to `A`, `C`, `F`, `Q`, and `Z`.
`B`, `N`, `R`, `S`, `G`, `U`, `V`, and the selected output remain explicit
input/output size terms rather than being hidden behind a wall-clock cutoff.
Within one `T`, fragment paint-style ownership walks a segment's graphemes and
decoration runs once. Span-fragment materialization builds a source-unit owner
table in `O(S)` space and performs `O(1)` owner lookup per output glyph; it does
not scan every authored span for every glyph.

A higher-level shrinkwrap operation performs at most `I_w + 5` independently
budgeted measure/layout calls in the current adapters. Its geometry-provider
work is therefore `O((I_w + 5) * (Q + Z))`, with `Q` and `Z` capped per call;
`I_w` remains an explicit public input rather than a hidden wall-clock limit.

UnitMap work is opt-in. Its current conservative bound includes `U*V` for
matching authored units against visible shaping clusters and `V^2` for
associating ruby-base clusters with the narrowest containing annotation
range. Logical/visual ordering adds `V log V`; member materialization is
charged to `O_u`. Equal annotation text on separate ruby levels remains
separate by a level-local namespace even when its public source and
cluster ranges are identical. The 4,096 animation-unit scene limit bounds
emitted animation units in `boundsvg`; it does not replace this explicit
construction-cost bound in the public `boundtext` mapping API.

`cargo bench -p boundtext --bench text_layout_adversarial --features phase-trace`
prints one JSON record per adversarial scenario. A reference Linux run on
2026-08-26 produced:

| Scenario                              | Time (µs) | VmHWM (KiB) | Candidates | Word-boundary preparations | Fit probes | Region queries | Shape calls / glyphs | Materialized lines / glyphs |
| ------------------------------------- | --------: | ----------: | ---------: | -------------------------: | ---------: | -------------: | -------------------: | --------------------------: |
| `exact-ellipsis-256`                  |    58,218 |       5,856 |        255 |                          0 |          0 |              0 |         512 / 33,407 |                       1 / 2 |
| `word-ellipsis-candidate-budget-1024` |       950 |       6,232 |          0 |                          1 |          0 |              0 |            1 / 1,025 |                       0 / 0 |
| `exact-exclusion-fit-65`              |    13,216 |       6,232 |         85 |                          0 |         65 |            122 |         236 / 10,926 |                      2 / 12 |
| `default-exact-fit-budget-4096`       |   404,460 |       6,232 |          0 |                          0 |      4,096 |          4,096 |      4,097 / 409,700 |                       1 / 1 |
| `content-exact-fit-209-grid`          |       417 |       6,232 |          0 |                          0 |         75 |              0 |              76 / 76 |                       1 / 1 |

The same executable isolates UnitMap construction after layout. Fixture input
columns are declared from the deterministic scene construction; `U`, `V`, and
`O_u` below come from engine phase counters and are asserted against the
result, so drift fails the benchmark instead of silently changing a label:

| Scenario            | Time (µs) | VmHWM (KiB) | `U` projected units | `V` visible drafts | `O_u` member refs |
| ------------------- | --------: | ----------: | ------------------: | -----------------: | ----------------: |
| `unit-map-ruby-256` |       689 |       7,224 |                 512 |                512 |               512 |
| `unit-map-ruby-512` |     1,687 |       9,304 |               1,024 |              1,024 |             1,024 |

Elapsed time and process high-water memory are observational rather than
portable pass/fail thresholds. Counter assertions are the deterministic
performance contract and demonstrate that word boundaries are prepared once,
budget rejection performs no exact candidate or output materialization work,
and UnitMap work reports the engine-created projection/drafts/output rather
than author-entered output counts. `geometrySegments` is independent from the
exclusion count and is zero for these abstract-provider scenarios, which do
not normalize path geometry.

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
- Flow shrinkwrap measurement preserves `BoundtextError` geometry/resource
  codes through the structured WASM error envelope. The older direct Rust
  preformatted-text shrinkwrap helpers still return `Option`; changing those
  signatures to preserve `TextLayoutError` is a separate SemVer decision.
- The bundled WASM ABI is updated with TypeScript bridge types in the same
  change. It is not a public compatibility boundary, and versions must not be
  mixed.

These Rust changes are breaking for the `0.x` crates and require a minor
release migration note. The TypeScript addition is non-breaking. Rendered
output changes are output-affecting and require a changeset; this work does not
perform a version bump.

## Rollback responsibilities

The Conventional Commit sequence can be reverted in reverse order along three
responsibility boundaries. These are dependency groups, not claims that each
group is represented by one commit:

1. The canonical planner, typed failures, logical provider, exact selection,
   fit budgets, synchronized Rust/TypeScript/WASM contract, tests, fixtures,
   and adversarial benchmark.
2. The semantically mirrored Core/React demo and template-switch regression.
3. User docs, feature/limitation tables, migration notes, and the
   output-affecting changeset.
