//! Hidden deterministic work counters used by public regression benchmarks.

use std::cell::RefCell;

/// Count deterministic units of text-layout work for regression benchmarks.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TextWorkCounters {
    // Planning work
    /// Calls into the selected shaping backend.
    pub backend_shape_calls: usize,
    /// Glyphs returned by shaping backends.
    pub shaped_glyphs: usize,
    /// Exact ellipsis candidates evaluated.
    pub ellipsis_candidates: usize,
    /// Word-boundary sets prepared for ellipsis candidate filtering.
    pub ellipsis_word_boundary_preparations: usize,
    /// Font-size fit candidates evaluated.
    pub fit_probes: usize,
    /// Distinct geometry-provider queries.
    pub region_queries: usize,
    /// Intervals returned by distinct geometry-provider queries.
    pub returned_regions: usize,

    // Unit map work
    /// Authored source units projected for request-aware unit mapping.
    pub unit_map_projected_units: usize,
    /// Visible cluster drafts produced before ruby-unit coalescing.
    pub unit_map_visible_drafts: usize,
    /// Glyph-member references copied into unit-map output.
    pub unit_map_member_refs: usize,

    // Output materialization
    /// Lines copied into public output.
    pub materialized_lines: usize,
    /// Glyphs copied into public output.
    pub materialized_glyphs: usize,
    /// Decorations copied into public output.
    pub materialized_decorations: usize,
    /// Inline rectangles copied into public output.
    pub materialized_inline_rects: usize,
}

thread_local! {
    static COUNTERS: RefCell<TextWorkCounters> = RefCell::new(TextWorkCounters::default());
}

fn update(mut operation: impl FnMut(&mut TextWorkCounters)) {
    COUNTERS.with(|counters| operation(&mut counters.borrow_mut()));
}

/// Record one call into a shaping backend.
pub fn record_backend_shape() {
    update(|counters| counters.backend_shape_calls += 1);
}

/// Record glyphs returned by a shaping backend.
pub fn record_shaped_glyphs(count: usize) {
    update(|counters| counters.shaped_glyphs += count);
}

/// Record one exact ellipsis candidate evaluation.
pub fn record_ellipsis_candidate() {
    update(|counters| counters.ellipsis_candidates += 1);
}

/// Record one complete word-boundary preparation for ellipsis filtering.
pub fn record_ellipsis_word_boundary_preparation() {
    update(|counters| counters.ellipsis_word_boundary_preparations += 1);
}

/// Record one font-size fit candidate evaluation.
pub fn record_fit_probe() {
    update(|counters| counters.fit_probes += 1);
}

/// Record one distinct geometry query and its returned intervals.
pub fn record_region_query(returned_regions: usize) {
    update(|counters| {
        counters.region_queries += 1;
        counters.returned_regions += returned_regions;
    });
}

/// Record one completed unit-map construction.
pub fn record_unit_map_work(projected_units: usize, visible_drafts: usize, member_refs: usize) {
    update(|counters| {
        counters.unit_map_projected_units += projected_units;
        counters.unit_map_visible_drafts += visible_drafts;
        counters.unit_map_member_refs += member_refs;
    });
}

/// Record public output materialized by one completed layout.
pub fn record_materialization(
    lines: usize,
    glyphs: usize,
    decorations: usize,
    inline_rects: usize,
) {
    update(|counters| {
        counters.materialized_lines += lines;
        counters.materialized_glyphs += glyphs;
        counters.materialized_decorations += decorations;
        counters.materialized_inline_rects += inline_rects;
    });
}

/// Return the current thread's deterministic work counters.
#[must_use]
pub fn snapshot_work() -> TextWorkCounters {
    COUNTERS.with(|counters| *counters.borrow())
}

/// Reset every deterministic work counter for the current thread.
pub fn reset_work() {
    COUNTERS.with(|counters| *counters.borrow_mut() = TextWorkCounters::default());
}

/// Return the current thread's shaping-backend call count.
#[must_use]
pub fn current_backend_shape_calls() -> usize {
    snapshot_work().backend_shape_calls
}

/// Reset only the shaping-backend call count for the current thread.
pub fn reset_backend_shape_calls() {
    update(|counters| counters.backend_shape_calls = 0);
}
