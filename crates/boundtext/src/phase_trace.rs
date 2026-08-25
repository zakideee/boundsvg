//! Hidden deterministic work counters used by public regression benchmarks.

use std::cell::RefCell;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TextWorkCounters {
    pub backend_shape_calls: usize,
    pub shaped_glyphs: usize,
    pub ellipsis_candidates: usize,
    pub fit_probes: usize,
    pub region_queries: usize,
    pub returned_regions: usize,
    pub materialized_lines: usize,
    pub materialized_glyphs: usize,
    pub materialized_decorations: usize,
    pub materialized_inline_rects: usize,
}

thread_local! {
    static COUNTERS: RefCell<TextWorkCounters> = RefCell::new(TextWorkCounters::default());
}

fn update(mut operation: impl FnMut(&mut TextWorkCounters)) {
    COUNTERS.with(|counters| operation(&mut counters.borrow_mut()));
}

pub fn record_backend_shape() {
    update(|counters| counters.backend_shape_calls += 1);
}

pub fn record_shaped_glyphs(count: usize) {
    update(|counters| counters.shaped_glyphs += count);
}

pub fn record_ellipsis_candidate() {
    update(|counters| counters.ellipsis_candidates += 1);
}

pub fn record_fit_probe() {
    update(|counters| counters.fit_probes += 1);
}

pub fn record_region_query(returned_regions: usize) {
    update(|counters| {
        counters.region_queries += 1;
        counters.returned_regions += returned_regions;
    });
}

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

#[must_use]
pub fn snapshot_work() -> TextWorkCounters {
    COUNTERS.with(|counters| *counters.borrow())
}

pub fn reset_work() {
    COUNTERS.with(|counters| *counters.borrow_mut() = TextWorkCounters::default());
}

#[must_use]
pub fn current_backend_shape_calls() -> usize {
    snapshot_work().backend_shape_calls
}

pub fn reset_backend_shape_calls() {
    update(|counters| counters.backend_shape_calls = 0);
}
