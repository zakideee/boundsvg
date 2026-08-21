//! Inline runs (mixed-style text) support.
//!
//! When a text node has `<Inline>` children with different styles, each run
//! (span) is shaped separately, then glyphs are merged for line breaking.
//! After line breaking, each line is split into fragments matching the
//! original run boundaries, and each fragment is re-shaped for precise width.

mod ellipsis;
mod flow_layout;
mod prepare;
#[cfg(test)]
mod tests;
pub(crate) mod types;

pub use ellipsis::find_ellipsis_truncation_point_inline;
pub use flow_layout::{
    layout_next_flow_column_inline, layout_next_flow_column_inline_with_forced_newlines,
    layout_next_flow_line_inline, layout_next_flow_line_inline_with_forced_newlines,
};
pub use prepare::prepare_inline_runs;
pub(crate) use prepare::{apply_inline_fragments, shape_inline_runs};
pub use types::{RubyAnnotationMeta, RunSegment, ShapedInlineRuns, SpanRubyInfo};
