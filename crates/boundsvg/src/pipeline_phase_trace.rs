//! Per-test-thread counters attached to actual Rust pipeline boundaries.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::thread::ThreadId;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct PipelinePhaseCounts {
    pub(super) layout_input_parses: usize,
    pub(super) layout_runs: usize,
    pub(super) animated_outline_resolves: usize,
    pub(super) emit_ir_parses: usize,
    pub(super) full_outline_resolves: usize,
}

static COUNTS: LazyLock<Mutex<HashMap<ThreadId, PipelinePhaseCounts>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn counts() -> MutexGuard<'static, HashMap<ThreadId, PipelinePhaseCounts>> {
    COUNTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn update(update_counts: impl FnOnce(&mut PipelinePhaseCounts)) {
    let mut counts_by_thread = counts();
    update_counts(
        counts_by_thread
            .entry(std::thread::current().id())
            .or_default(),
    );
}

pub(super) fn record_layout_input_parse() {
    update(|phase_counts| phase_counts.layout_input_parses += 1);
}

pub(super) fn record_layout() {
    update(|phase_counts| phase_counts.layout_runs += 1);
}

pub(super) fn record_animated_outline_resolve() {
    update(|phase_counts| phase_counts.animated_outline_resolves += 1);
}

pub(super) fn record_emit_ir_parse() {
    update(|phase_counts| phase_counts.emit_ir_parses += 1);
}

pub(super) fn record_full_outline_resolve() {
    update(|phase_counts| phase_counts.full_outline_resolves += 1);
}

#[must_use]
pub(super) fn snapshot() -> PipelinePhaseCounts {
    counts()
        .get(&std::thread::current().id())
        .copied()
        .unwrap_or_default()
}

pub(super) fn reset() {
    counts().remove(&std::thread::current().id());
}
