//! Test-only counters proving render orchestration does not repeat shaping.
//! The feature is enabled only by the `boundsvg` dev-dependency.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::thread::ThreadId;

static BACKEND_SHAPE_CALLS: LazyLock<Mutex<HashMap<ThreadId, usize>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn shape_calls() -> MutexGuard<'static, HashMap<ThreadId, usize>> {
    BACKEND_SHAPE_CALLS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub fn record_backend_shape() {
    let mut calls_by_thread = shape_calls();
    *calls_by_thread
        .entry(std::thread::current().id())
        .or_default() += 1;
}

#[must_use]
pub fn current_backend_shape_calls() -> usize {
    shape_calls()
        .get(&std::thread::current().id())
        .copied()
        .unwrap_or_default()
}

pub fn reset_backend_shape_calls() {
    shape_calls().remove(&std::thread::current().id());
}
