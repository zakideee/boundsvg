//! Text flow layout engine.
//!
//! Provides variable-width text flow with optional obstacle avoidance via the
//! [`RegionProvider`] trait. The geometry computation (SVG paths, circles,
//! etc.) is handled by the consumer -- this module only deals with text.

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;

use crate::BoundtextError;
use crate::font::FontContext;
use crate::font::line_metrics::{LineMetrics, resolve_line_metrics_for_style};
use crate::font::shaping::{
    FeatureSetting, ShapeOptions, VariationSetting, format_css_font_feature_settings,
    format_css_font_variation_settings,
};
use crate::text::inline_runs;
use crate::text::paragraph::{self, BreakCursor};
use crate::text::rich;
use crate::text::types::{
    InlineBoxDecoration, InlineRectBlockSizeInput, InlineRectFragment, Language, Line,
    PositionedGlyph, RichTextNodeInput, RichTextResourceViolation, TextBBox, TextLayoutResult,
    TextOrientation, TextOverflow, TextSpanInput, TextWarning, WhiteSpaceMode, WrapMode,
    WritingMode, build_notdef_warnings, collect_notdef_from_glyphs, validate_rich_text_resources,
};
use crate::text::vertical;

mod fit;
mod inline;

pub(crate) use fit::{
    DEFAULT_FIT_EPSILON, DEFAULT_FIT_MAX_ITERATIONS, DEFAULT_GROW_MULTIPLIER,
    DEFAULT_MIN_FONT_SIZE, ensure_grid_budget, fit_grow_with, fit_shrink_with,
};
use fit::{flow_fit_grow, flow_fit_grow_vertical, flow_fit_shrink, flow_fit_shrink_vertical};
pub use inline::{build_flow_rich_text_inputs, build_inline_runs_inputs};
use inline::{
    default_alphabetic_baseline_offset_px, measure_inline_flow_at_font_size,
    prepare_inline_flow_inputs, split_fragment_at_run_boundaries,
};

/// Tolerance for the line-bottom containment check: band tops accumulate
/// float error via `band_index * line_height`, so an exact-multiple flow box
/// must still fit its final line.
pub(crate) const FLOW_BOTTOM_EPSILON: f64 = 1e-6;

/// Tolerance for comparing fragment inline advances with region capacities.
pub(crate) const INLINE_CONTAINMENT_EPSILON: f64 = crate::text::kinsoku::INLINE_OVERFLOW_EPSILON;

fn resolve_flow_line_metrics(
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    line_height: Option<f64>,
    line_height_px: Option<f64>,
) -> LineMetrics {
    resolve_line_metrics_for_style(
        font_ctx.registry,
        font_ctx.fallback_registry,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
        font_size_px,
        line_height,
        line_height_px,
    )
}

pub(super) fn resolve_flow_line_height_px(
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    line_height: Option<f64>,
    line_height_px: Option<f64>,
) -> f64 {
    resolve_flow_line_metrics(font_ctx, font_size_px, line_height, line_height_px).line_height_px
}

pub(super) fn resolve_flow_baseline_offset_px(
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    line_height: Option<f64>,
    line_height_px: Option<f64>,
) -> f64 {
    resolve_flow_line_metrics(font_ctx, font_size_px, line_height, line_height_px)
        .baseline_offset_px
}

// ---------------------------------------------------------------------------
// Region providers
// ---------------------------------------------------------------------------

/// State whether a provider/content pair permits monotone fit refinement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FitSearchKind {
    /// Permit binary refinement after boundary checks.
    CertifiedMonotone,
    /// Require descending exact-grid evaluation.
    Uncertified,
}

/// A writing-mode-independent request for usable inline-axis regions.
///
/// Cross-axis values are logical offsets from the flow frame's block-start
/// edge. Returned inline positions use the layout coordinate system.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RegionQuery {
    /// Logical writing mode used to interpret both axes.
    pub writing_mode: WritingMode,
    /// Inclusive logical block-start offset from the flow frame.
    pub cross_start_px: f64,
    /// Exclusive logical block-end offset from the flow frame.
    pub cross_end_px: f64,
    /// Smallest usable interval on the logical inline axis.
    pub min_inline_size_px: f64,
}

/// One usable inline-axis interval returned by a [`RegionProvider`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FlowRegion {
    /// Logical inline start in the layout coordinate system.
    pub inline_start_px: f64,
    /// Usable logical inline extent.
    pub inline_size_px: f64,
}

/// Abstracts deterministic geometry computation for flow layout.
///
/// Implementors return every usable interval for a complete query or a typed
/// error. The engine validates and sorts all intervals before consuming them.
pub trait RegionProvider {
    /// Return every usable logical inline interval for `query`.
    ///
    /// # Errors
    ///
    /// Returns a typed error when geometry cannot answer the complete query.
    fn regions(&self, query: RegionQuery) -> Result<Vec<FlowRegion>, crate::BoundtextError>;

    /// Declares whether font-size fit is proven monotone for this provider.
    /// The conservative default requires an exact descending grid.
    fn fit_search_kind(&self) -> FitSearchKind {
        FitSearchKind::Uncertified
    }
}

/// Maximum number of distinct geometry queries in one public flow layout.
pub const REGION_QUERIES_MAX: usize = 65_536;
/// Maximum cumulative number of intervals returned by distinct queries in
/// one public flow layout.
pub const RETURNED_REGIONS_MAX: usize = 262_144;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct RegionQueryKey {
    writing_mode: u8,
    cross_start_bits: u64,
    cross_end_bits: u64,
    min_inline_size_bits: u64,
}

impl From<RegionQuery> for RegionQueryKey {
    fn from(query: RegionQuery) -> Self {
        fn canonical_coordinate_bits(coordinate_px: f64) -> u64 {
            if coordinate_px == 0.0 {
                0.0_f64.to_bits()
            } else {
                coordinate_px.to_bits()
            }
        }

        Self {
            writing_mode: match query.writing_mode {
                WritingMode::HorizontalTb => 0,
                WritingMode::VerticalRl => 1,
            },
            cross_start_bits: canonical_coordinate_bits(query.cross_start_px),
            cross_end_bits: canonical_coordinate_bits(query.cross_end_px),
            min_inline_size_bits: canonical_coordinate_bits(query.min_inline_size_px),
        }
    }
}

/// Per-layout deterministic cache and budget around an arbitrary provider.
struct BudgetedRegionProvider<'a, P> {
    source: &'a P,
    cache: RefCell<BTreeMap<RegionQueryKey, Result<Vec<FlowRegion>, BoundtextError>>>,
    returned_region_count: Cell<usize>,
    max_query_count: usize,
    max_returned_regions: usize,
}

impl<'a, P> BudgetedRegionProvider<'a, P> {
    fn new(source: &'a P) -> Self {
        Self {
            source,
            cache: RefCell::new(BTreeMap::new()),
            returned_region_count: Cell::new(0),
            max_query_count: REGION_QUERIES_MAX,
            max_returned_regions: RETURNED_REGIONS_MAX,
        }
    }

    #[cfg(test)]
    fn with_limits(source: &'a P, max_query_count: usize, max_returned_regions: usize) -> Self {
        Self {
            source,
            cache: RefCell::new(BTreeMap::new()),
            returned_region_count: Cell::new(0),
            max_query_count,
            max_returned_regions,
        }
    }
}

impl<P: RegionProvider> RegionProvider for BudgetedRegionProvider<'_, P> {
    fn regions(&self, query: RegionQuery) -> Result<Vec<FlowRegion>, BoundtextError> {
        let key = RegionQueryKey::from(query);
        if let Some(cached) = self.cache.borrow().get(&key) {
            return cached.clone();
        }
        if self.cache.borrow().len() >= self.max_query_count {
            return Err(BoundtextError::RegionQueryLimit {
                limit: self.max_query_count,
            });
        }

        let mut response = self.source.regions(query);
        #[cfg(any(test, feature = "phase-trace"))]
        crate::phase_trace::record_region_query(response.as_ref().map_or(0, std::vec::Vec::len));
        if let Ok(regions) = &response {
            let required = self
                .returned_region_count
                .get()
                .saturating_add(regions.len());
            if required > self.max_returned_regions {
                response = Err(BoundtextError::RegionIntervalLimit {
                    required,
                    limit: self.max_returned_regions,
                });
            } else {
                self.returned_region_count.set(required);
            }
        }
        self.cache.borrow_mut().insert(key, response.clone());
        response
    }

    fn fit_search_kind(&self) -> FitSearchKind {
        self.source.fit_search_kind()
    }
}

#[cfg(test)]
mod region_budget_tests {
    use super::*;

    struct CountingProvider {
        calls: Cell<usize>,
        returned_regions: usize,
    }

    impl RegionProvider for CountingProvider {
        fn regions(&self, _query: RegionQuery) -> Result<Vec<FlowRegion>, BoundtextError> {
            self.calls.set(self.calls.get() + 1);
            Ok((0..self.returned_regions)
                .map(|index| FlowRegion {
                    inline_start_px: index as f64,
                    inline_size_px: 1.0,
                })
                .collect())
        }
    }

    fn query(cross_start_px: f64) -> RegionQuery {
        RegionQuery {
            writing_mode: WritingMode::HorizontalTb,
            cross_start_px,
            cross_end_px: cross_start_px + 1.0,
            min_inline_size_px: 0.0,
        }
    }

    #[test]
    fn identical_queries_are_memoized_before_budget_accounting() {
        let source = CountingProvider {
            calls: Cell::new(0),
            returned_regions: 1,
        };
        let provider = BudgetedRegionProvider::with_limits(&source, 2, 2);

        provider.regions(query(0.0)).expect("first query");
        provider.regions(query(0.0)).expect("memoized query");
        provider.regions(query(1.0)).expect("second distinct query");
        let error = provider
            .regions(query(2.0))
            .expect_err("third distinct query exceeds the budget");

        assert_eq!(source.calls.get(), 2);
        assert_eq!(error, BoundtextError::RegionQueryLimit { limit: 2 });
    }

    #[test]
    fn signed_zero_queries_share_one_memoized_budget_entry() {
        let source = CountingProvider {
            calls: Cell::new(0),
            returned_regions: 1,
        };
        let provider = BudgetedRegionProvider::with_limits(&source, 1, 1);

        provider.regions(query(-0.0)).expect("negative-zero query");
        provider.regions(query(0.0)).expect("positive-zero query");

        assert_eq!(source.calls.get(), 1);
    }

    #[test]
    fn interval_exhaustion_is_cached_as_a_typed_failure() {
        let source = CountingProvider {
            calls: Cell::new(0),
            returned_regions: 2,
        };
        let provider = BudgetedRegionProvider::with_limits(&source, 2, 1);

        let expected = BoundtextError::RegionIntervalLimit {
            required: 2,
            limit: 1,
        };
        assert_eq!(provider.regions(query(0.0)), Err(expected.clone()));
        assert_eq!(provider.regions(query(0.0)), Err(expected));
        assert_eq!(source.calls.get(), 1);
    }
}

// ---------------------------------------------------------------------------
// FlowBounds
// ---------------------------------------------------------------------------

/// Axis-aligned bounding rectangle for flow layout.
///
/// Replaces geometry-specific `FlowBox` from the SVG layer. Contains no
/// SVG-specific dependencies.
#[derive(Debug, Clone, Copy)]
pub struct FlowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Validate, normalize, and deterministically order one provider response.
///
/// # Errors
///
/// Returns a typed error for invalid queries, provider failures, or invalid
/// intervals.
pub(crate) fn query_regions(
    region_provider: &impl RegionProvider,
    writing_mode: WritingMode,
    flow_bounds: &FlowBounds,
    physical_cross_start_px: f64,
    physical_cross_end_px: f64,
    min_inline_size_px: f64,
) -> Result<Vec<(f64, f64)>, crate::BoundtextError> {
    if !flow_bounds.x.is_finite()
        || !flow_bounds.y.is_finite()
        || !flow_bounds.width.is_finite()
        || !flow_bounds.height.is_finite()
        || flow_bounds.width < 0.0
        || flow_bounds.height < 0.0
        || !physical_cross_start_px.is_finite()
        || !physical_cross_end_px.is_finite()
        || physical_cross_end_px < physical_cross_start_px
        || !min_inline_size_px.is_finite()
        || min_inline_size_px < 0.0
    {
        return Err(crate::BoundtextError::InvalidRegionQuery(
            "flow bounds, cross-axis bounds, and minimum inline size must be finite and ordered"
                .to_string(),
        ));
    }
    let (cross_start_px, cross_end_px) = match writing_mode {
        WritingMode::HorizontalTb => (
            physical_cross_start_px - flow_bounds.y,
            physical_cross_end_px - flow_bounds.y,
        ),
        WritingMode::VerticalRl => (
            flow_bounds.x + flow_bounds.width - physical_cross_end_px,
            flow_bounds.x + flow_bounds.width - physical_cross_start_px,
        ),
    };
    let query = RegionQuery {
        writing_mode,
        cross_start_px,
        cross_end_px,
        min_inline_size_px,
    };
    let mut regions = region_provider.regions(query)?;
    let (inline_frame_start, inline_frame_end) = match writing_mode {
        WritingMode::HorizontalTb => (flow_bounds.x, flow_bounds.x + flow_bounds.width),
        WritingMode::VerticalRl => (flow_bounds.y, flow_bounds.y + flow_bounds.height),
    };
    for (index, region) in regions.iter().enumerate() {
        if !region.inline_start_px.is_finite() || !region.inline_size_px.is_finite() {
            return Err(crate::BoundtextError::InvalidFlowRegion {
                index,
                reason: "inline start and size must be finite".to_string(),
            });
        }
        if region.inline_size_px < min_inline_size_px {
            return Err(crate::BoundtextError::InvalidFlowRegion {
                index,
                reason: format!(
                    "inline size {} is below the requested minimum {}",
                    region.inline_size_px, min_inline_size_px
                ),
            });
        }
        let region_end = region.inline_start_px + region.inline_size_px;
        if !region_end.is_finite()
            || region.inline_start_px < inline_frame_start - INLINE_CONTAINMENT_EPSILON
            || region_end > inline_frame_end + INLINE_CONTAINMENT_EPSILON
        {
            return Err(crate::BoundtextError::InvalidFlowRegion {
                index,
                reason: "region must be clipped to the flow frame's inline axis".to_string(),
            });
        }
    }
    regions.sort_by(|left, right| {
        left.inline_start_px
            .total_cmp(&right.inline_start_px)
            .then_with(|| left.inline_size_px.total_cmp(&right.inline_size_px))
    });
    for index in 1..regions.len() {
        let previous_end = regions[index - 1].inline_start_px + regions[index - 1].inline_size_px;
        if previous_end > regions[index].inline_start_px + INLINE_CONTAINMENT_EPSILON {
            return Err(crate::BoundtextError::InvalidFlowRegion {
                index,
                reason: "regions must not overlap".to_string(),
            });
        }
    }
    Ok(regions
        .into_iter()
        .map(|region| (region.inline_start_px, region.inline_size_px))
        .collect())
}

// ---------------------------------------------------------------------------
// Result types (no serde -- pure Rust API)
// ---------------------------------------------------------------------------

/// Why the flow layout stopped before consuming all text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlowOverflowReason {
    /// `max_lines` limit reached with remaining text.
    MaxLinesTruncated,
    /// Flow box bottom reached with remaining text.
    FlowBoxExhausted,
    /// Even at the extreme font size, text does not fit.
    CannotFit,
}

/// Style for a flow fragment.
#[derive(Debug, Clone)]
pub struct FlowFragmentStyle {
    pub font_family: String,
    pub font_weight: u16,
    pub font_style: String,
    pub font_size_px: f64,
    pub letter_spacing_px: Option<f64>,
    pub color: Option<String>,
}

/// Ruby annotation attached to a flow fragment.
#[derive(Debug, Clone)]
pub struct FlowRubyAnnotationRun {
    pub text: String,
    pub style: FlowFragmentStyle,
}

#[derive(Debug, Clone)]
pub struct FlowRubyAnnotationLevel {
    pub text: String,
    pub position: String,
    pub runs: Vec<FlowRubyAnnotationRun>,
}

/// Ruby annotation attached to a flow fragment.
#[derive(Debug, Clone)]
pub struct FlowRubyAnnotation {
    /// Annotation text (e.g. furigana reading).
    pub text: String,
    /// "over" (default) or "under".
    pub position: String,
    /// "start", "center", "space-between", "space-around" (default).
    pub align: String,
    /// Style for the annotation text.
    pub style: FlowFragmentStyle,
    /// Frame gap between annotation and base text (px), derived from
    /// [`rich::ruby_gap_px`].
    pub gap_px: f64,
    /// Additional caller-requested displacement away from the base.
    pub offset_px: f64,
    /// Whether annotation extents reserve stable line space or CSS-like space.
    pub line_sizing: String,
    /// Every annotation level and its styled runs. The legacy top-level
    /// text/position/style fields mirror the first level's first run.
    pub levels: Vec<FlowRubyAnnotationLevel>,
}

#[derive(Debug, Clone)]
pub(crate) struct FlowInlineRect {
    pub inline_offset: f64,
    pub rect: super::types::InlineRectInput,
}

/// A single text fragment placed within a free region.
#[derive(Debug, Clone)]
pub struct FlowFragment {
    pub text: String,
    pub char_start: usize,
    pub char_end: usize,
    pub x: f64,
    pub y: f64,
    /// Consumed inline advance in px (physical width for horizontal, physical height for vertical).
    pub inline_advance_px: f64,
    /// Available inline size of the region in px.
    pub available_inline_size_px: f64,
    pub region_index: usize,
    /// Shared cross-axis reference offset in px: the horizontal alphabetic
    /// baseline from line top, or the vertical centerline from column left.
    pub baseline_offset: f64,
    pub overflow_reason: Option<String>,
    /// Maximum reported inline overflow attributable to the intentional tail.
    pub intentional_overflow_px: f64,
    pub style: Option<FlowFragmentStyle>,
    pub ruby: Option<FlowRubyAnnotation>,
    /// Glyphs shaped and positioned by the flow engine. Kept internal so
    /// renderers can paint a flow result without feeding fragment text back
    /// through text layout.
    pub positioned_glyphs: Vec<PositionedGlyph>,
    pub(crate) inline_rects: Vec<FlowInlineRect>,
}

/// A visual line consisting of one or more fragments across regions.
#[derive(Debug, Clone)]
pub struct FlowLine {
    pub fragments: Vec<FlowFragment>,
    pub line_index: usize,
    pub cross_size: f64,
}

/// Full flow layout result.
#[derive(Debug, Clone)]
pub struct FlowLayoutResult {
    pub lines: Vec<FlowLine>,
    pub exhausted: bool,
    pub used_line_count: usize,
    pub overflow_reason: Option<FlowOverflowReason>,
    pub chosen_font_size_px: Option<f64>,
    pub warnings: Vec<TextWarning>,
    /// Materialized rich inline-box/decorated-span fragments in flow-space.
    pub inline_box_decorations: Vec<InlineBoxDecoration>,
}

/// Lightweight measurement result from the flow band loop.
/// No string allocations -- used by fit binary search.
#[derive(Debug, Clone)]
pub struct FlowMeasure {
    pub used_line_count: usize,
    pub exhausted: bool,
    /// Every non-intentional fragment fits within its assigned free region.
    pub contained: bool,
    pub overflow_reason: Option<FlowOverflowReason>,
}

impl FlowMeasure {
    /// Whether the candidate both consumed all text and stayed within its
    /// assigned inline regions. Fit and shrinkwrap searches must require both.
    #[must_use]
    pub fn fits(&self) -> bool {
        self.exhausted && self.contained
    }
}

/// Simple flow result (line-widths based, no exclusions).
#[derive(Debug, Clone)]
pub struct FlowSimpleResult {
    pub lines: Vec<FlowSimpleLine>,
    pub exhausted: bool,
    pub warnings: Vec<TextWarning>,
}

/// A line from simple flow layout.
#[derive(Debug, Clone)]
pub struct FlowSimpleLine {
    pub text: String,
    pub char_start: usize,
    pub char_end: usize,
    /// Consumed inline advance in px.
    pub inline_advance_px: f64,
    /// Available inline size of the line in px.
    pub available_inline_size_px: f64,
}

// ---------------------------------------------------------------------------
// Input types (pure Rust -- no serde)
// ---------------------------------------------------------------------------

/// Input for region-based flow layout.
#[derive(Clone)]
pub struct FlowLayoutRequest<'a> {
    pub text: &'a str,
    pub font_size_px: f64,
    pub line_height: Option<f64>,
    pub line_height_px: Option<f64>,
    pub letter_spacing_px: f64,
    pub language: Language,
    pub wrap: WrapMode,
    pub white_space: WhiteSpaceMode,
    pub tab_size: u32,
    pub hanging_punctuation: bool,
    pub flow_bounds: FlowBounds,
    pub min_region_width: Option<f64>,
    pub max_lines: Option<usize>,
    pub ellipsis: bool,
    pub fit: Option<&'a str>,
    pub spans: Option<&'a [FlowTextSpan]>,
    pub rich_text: Option<&'a [RichTextNodeInput]>,
    pub writing_mode: WritingMode,
    pub text_orientation: Option<&'a str>,
    // Fit params
    pub min_font_size_px: Option<f64>,
    pub max_font_size_px: Option<f64>,
    pub fit_epsilon_px: Option<f64>,
    pub fit_max_iterations: Option<usize>,
    /// Work limit for an uncertified exact-grid fit search.
    pub fit_max_probes: Option<usize>,
    /// Shape options for the base (non-span) path.
    pub shape_options: ShapeOptions,
}

/// A text span with style overrides for inline-run flow layout.
#[derive(Debug, Clone)]
pub struct FlowTextSpan {
    pub text: String,
    pub font_family: Option<String>,
    pub fallback: Option<Vec<String>>,
    pub font_weight: Option<u16>,
    pub font_style: Option<String>,
    pub font_size_px: Option<f64>,
    pub letter_spacing_px: Option<f64>,
    pub color: Option<String>,
    pub font_variation_settings: Option<String>,
    pub font_feature_settings: Option<String>,
    pub ruby_text: Option<String>,
    pub ruby_position: Option<String>,
    pub ruby_align: Option<String>,
    pub ruby_font_size_px: Option<f64>,
    pub ruby_color: Option<String>,
}

impl FlowTextSpan {
    #[must_use]
    pub fn plain(text: String) -> Self {
        Self {
            text,
            font_family: None,
            fallback: None,
            font_weight: None,
            font_style: None,
            font_size_px: None,
            letter_spacing_px: None,
            color: None,
            font_variation_settings: None,
            font_feature_settings: None,
            ruby_text: None,
            ruby_position: None,
            ruby_align: None,
            ruby_font_size_px: None,
            ruby_color: None,
        }
    }
}

/// Input for simple flow layout (line-widths, no exclusions).
pub struct FlowSimpleRequest<'a> {
    pub text: &'a str,
    pub font_size_px: f64,
    pub line_height: Option<f64>,
    pub letter_spacing_px: f64,
    pub language: Language,
    pub wrap: WrapMode,
    pub hanging_punctuation: bool,
    pub line_widths: &'a [f64],
    pub writing_mode: WritingMode,
    pub text_orientation: TextOrientation,
    pub font_variation_settings: Vec<VariationSetting>,
    pub font_feature_settings: Vec<FeatureSetting>,
}

// ---------------------------------------------------------------------------
// Internal band-loop driver
// ---------------------------------------------------------------------------

/// Why the band loop terminated.
enum BandLoopOutcome {
    /// All text consumed (cursor reached end of paragraph).
    TextExhausted,
    /// `max_lines` limit reached.
    MaxLinesReached,
    /// Flow box bottom reached.
    FlowBoxBottom,
}

/// Result of a band-loop run.
struct BandLoopResult {
    outcome: BandLoopOutcome,
    emitted_line_count: usize,
    /// `!cursor.has_remaining()` at loop exit.
    text_exhausted: bool,
}

/// Shared band-loop driver for both measure and layout paths.
///
/// Iterates horizontal line bands top-to-bottom, computes free regions per band
/// via `RegionProvider`, and calls `layout_next_flow_line` to fill regions
/// with text. The `on_flow_line` closure is invoked for each text-producing
/// visual line.
fn run_flow_loop(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    line_height_px: f64,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_width: f64,
    max_lines: Option<usize>,
    wrap: WrapMode,
    mut on_flow_line: impl FnMut(
        usize,
        f64,
        &[(f64, f64)],
        &paragraph::LayoutLine,
        &paragraph::ShapedParagraph,
    ),
) -> Result<BandLoopResult, crate::BoundtextError> {
    let mut cursor = BreakCursor::new();
    let mut band_index = 0usize;
    let mut emitted_line_count = 0usize;

    let outcome = loop {
        let line_top = fb.y + (band_index as f64) * line_height_px;
        let line_bottom = line_top + line_height_px;
        // A line only fits when its BOTTOM is inside the flow box; accepting
        // any line whose top fit let the final line overflow the box by up to
        // one line height (and made fit report such layouts as contained).
        if line_bottom > fb.y + fb.height + FLOW_BOTTOM_EPSILON {
            break BandLoopOutcome::FlowBoxBottom;
        }
        // max_lines check BEFORE region computation: once the limit is
        // reached no more lines can be emitted, regardless of whether
        // subsequent bands are occluded or free.
        if let Some(max) = max_lines
            && emitted_line_count >= max
        {
            break BandLoopOutcome::MaxLinesReached;
        }

        let regions = query_regions(
            region_provider,
            WritingMode::HorizontalTb,
            fb,
            line_top,
            line_bottom,
            min_region_width,
        )?;
        if regions.is_empty() {
            band_index += 1;
            continue;
        }

        let Some(vline) = paragraph::layout_next_flow_line(
            pp,
            &mut cursor,
            font_size_px,
            line_height_px,
            &regions,
            wrap,
        ) else {
            if cursor.has_remaining(pp) {
                band_index += 1;
                continue;
            }
            break BandLoopOutcome::TextExhausted;
        };

        on_flow_line(band_index, line_top, &regions, &vline, pp);
        emitted_line_count += 1;
        band_index += 1;
    };

    Ok(BandLoopResult {
        outcome,
        emitted_line_count,
        text_exhausted: !cursor.has_remaining(pp),
    })
}

/// Actual cross size of an inline (spans) flow line.
///
/// Mixed-size runs combine the largest before-reference and after-reference
/// extents, matching the render path's inline line-box calculation. Ruby
/// extends the corresponding side of that line box.
fn inline_line_box_metrics(
    fragments: &[FlowFragment],
    font_ctx: &FontContext<'_>,
    base_font_size_px: f64,
    line_height: Option<f64>,
    explicit_line_height_px: Option<f64>,
    base_line_height_px: f64,
    writing_mode: WritingMode,
) -> (f64, f64) {
    let mut before_reference = None;
    let mut after_reference = None;

    for fragment in fragments {
        let Some(style) = fragment.style.as_ref() else {
            continue;
        };
        let families = vec![style.font_family.clone()];
        let font_style = if style.font_style == "italic" {
            crate::font::FontStyle::Italic
        } else {
            crate::font::FontStyle::Normal
        };
        let metrics = resolve_line_metrics_for_style(
            font_ctx.registry,
            font_ctx.fallback_registry,
            &families,
            style.font_weight,
            &font_style,
            style.font_size_px,
            line_height,
            explicit_line_height_px,
        );
        let (fragment_cross_size, fragment_reference_offset) =
            if let Some(ruby) = fragment.ruby.as_ref() {
                let ruby_extent =
                    (ruby.style.font_size_px + ruby.gap_px).max(0.0) + ruby.offset_px.max(0.0);
                if writing_mode == WritingMode::VerticalRl {
                    let (left_extent, right_extent) = if ruby.position == "under" {
                        (ruby_extent, 0.0)
                    } else {
                        (0.0, ruby_extent)
                    };
                    rich::resolve_vertical_css_ruby_line_box(
                        metrics.line_height_px,
                        style.font_size_px.max(1.0),
                        left_extent,
                        right_extent,
                    )
                } else {
                    let (over_extent, under_extent) = if ruby.position == "under" {
                        (0.0, ruby_extent)
                    } else {
                        (ruby_extent, 0.0)
                    };
                    rich::resolve_horizontal_css_ruby_line_box(
                        metrics.line_height_px,
                        metrics.baseline_offset_px,
                        metrics.ascent_px,
                        metrics.descent_px,
                        over_extent,
                        under_extent,
                    )
                }
            } else if writing_mode == WritingMode::VerticalRl {
                (metrics.line_height_px, metrics.line_height_px * 0.5)
            } else {
                (metrics.line_height_px, metrics.baseline_offset_px)
            };
        let fragment_before = fragment_reference_offset;
        let fragment_after = fragment_cross_size - fragment_reference_offset;
        before_reference = Some(
            before_reference.map_or(fragment_before, |current: f64| current.max(fragment_before)),
        );
        after_reference = Some(
            after_reference.map_or(fragment_after, |current: f64| current.max(fragment_after)),
        );
    }

    let (Some(before_reference), Some(after_reference)) = (before_reference, after_reference)
    else {
        let base_metrics = resolve_flow_line_metrics(
            font_ctx,
            base_font_size_px,
            line_height,
            explicit_line_height_px,
        );
        let cross_size = base_metrics.line_height_px.max(base_line_height_px);
        let reference_offset = if writing_mode == WritingMode::VerticalRl {
            cross_size * 0.5
        } else {
            base_metrics.baseline_offset_px
        };
        return (cross_size, reference_offset);
    };
    (before_reference + after_reference, before_reference)
}

pub(crate) fn regions_approx_eq(a: &[(f64, f64)], b: &[(f64, f64)]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b.iter())
            .all(|(lhs, rhs)| (lhs.0 - rhs.0).abs() < 1e-6 && (lhs.1 - rhs.1).abs() < 1e-6)
}

fn paragraph_line_is_contained(line: &paragraph::LayoutLine, regions: &[(f64, f64)]) -> bool {
    line.fragments.iter().all(|fragment| {
        regions
            .get(fragment.region_index)
            .is_some_and(|(_, capacity)| {
                fragment.inline_advance_px
                    <= *capacity + fragment.intentional_overflow_px + INLINE_CONTAINMENT_EPSILON
            })
    })
}

/// Whether every non-intentional fragment in a final flow layout fits its
/// reported available inline size.
#[must_use]
pub fn flow_layout_is_contained(flow_layout: &FlowLayoutResult) -> bool {
    flow_layout.lines.iter().all(|line| {
        let mut region_totals = std::collections::HashMap::<usize, (f64, f64, f64)>::new();
        for fragment in &line.fragments {
            let (capacity, total_advance, intentional_overflow_px) = region_totals
                .entry(fragment.region_index)
                .or_insert((fragment.available_inline_size_px, 0.0, 0.0));
            *capacity = capacity.min(fragment.available_inline_size_px);
            *total_advance += fragment.inline_advance_px;
            *intentional_overflow_px += fragment.intentional_overflow_px;
        }
        region_totals
            .values()
            .all(|(capacity, total_advance, intentional_overflow_px)| {
                *total_advance <= *capacity + *intentional_overflow_px + INLINE_CONTAINMENT_EPSILON
            })
    })
}

pub(crate) fn layout_overflow_reason_name(reason: paragraph::LayoutOverflowReason) -> String {
    match reason {
        paragraph::LayoutOverflowReason::KinsokuAbsorb => "kinsokuAbsorb".to_string(),
        paragraph::LayoutOverflowReason::HangingPunctuation => "hangingPunctuation".to_string(),
    }
}

/// Convert a `BandLoopResult` into `(exhausted, overflow_reason)`.
fn resolve_outcome(band_result: &BandLoopResult) -> (bool, Option<FlowOverflowReason>) {
    if band_result.text_exhausted {
        (true, None)
    } else {
        match band_result.outcome {
            BandLoopOutcome::TextExhausted => (true, None),
            BandLoopOutcome::MaxLinesReached => {
                (false, Some(FlowOverflowReason::MaxLinesTruncated))
            }
            BandLoopOutcome::FlowBoxBottom => (false, Some(FlowOverflowReason::FlowBoxExhausted)),
        }
    }
}

// ---------------------------------------------------------------------------
// Measure functions
// ---------------------------------------------------------------------------

/// Measure flow layout without producing fragments or allocating text strings.
///
/// Returns line count, exhaustion state, and overflow reason.
///
/// # Errors
///
/// Returns a typed provider, query-validation, or region-budget error.
pub fn measure_flow(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    line_height_px: f64,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_width: f64,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<FlowMeasure, crate::BoundtextError> {
    let budgeted_region_provider = BudgetedRegionProvider::new(region_provider);
    measure_flow_with_budgeted_provider(
        pp,
        font_size_px,
        line_height_px,
        fb,
        &budgeted_region_provider,
        min_region_width,
        max_lines,
        wrap,
    )
}

fn measure_flow_with_budgeted_provider(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    line_height_px: f64,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_width: f64,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<FlowMeasure, crate::BoundtextError> {
    let mut contained = true;
    let loop_result = run_flow_loop(
        pp,
        font_size_px,
        line_height_px,
        fb,
        region_provider,
        min_region_width,
        max_lines,
        wrap,
        |_, _, regions, line, _| {
            contained &= paragraph_line_is_contained(line, regions);
        },
    )?;

    let (exhausted, overflow_reason) = resolve_outcome(&loop_result);
    Ok(FlowMeasure {
        used_line_count: loop_result.emitted_line_count,
        exhausted,
        contained,
        overflow_reason,
    })
}

/// Vertical measure: column loop without fragment/string production.
///
/// # Errors
///
/// Returns a typed provider, query-validation, or region-budget error.
pub fn measure_flow_vertical(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    column_width: f64,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_height: f64,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<FlowMeasure, crate::BoundtextError> {
    let budgeted_region_provider = BudgetedRegionProvider::new(region_provider);
    measure_flow_vertical_with_budgeted_provider(
        pp,
        font_size_px,
        column_width,
        fb,
        &budgeted_region_provider,
        min_region_height,
        max_lines,
        wrap,
    )
}

fn measure_flow_vertical_with_budgeted_provider(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    column_width: f64,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_height: f64,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<FlowMeasure, crate::BoundtextError> {
    let mut cursor = BreakCursor::new();
    let mut column_index = 0usize;
    let mut emitted = 0usize;
    let mut contained = true;

    let outcome = loop {
        let column_right = fb.x + fb.width - (column_index as f64) * column_width;
        let column_left = column_right - column_width;
        if column_left < fb.x {
            break BandLoopOutcome::FlowBoxBottom;
        }
        if let Some(max) = max_lines
            && emitted >= max
        {
            break BandLoopOutcome::MaxLinesReached;
        }

        let regions = query_regions(
            region_provider,
            WritingMode::VerticalRl,
            fb,
            column_left,
            column_right,
            min_region_height,
        )?;
        if regions.is_empty() {
            column_index += 1;
            continue;
        }

        let Some(vline) = paragraph::layout_next_flow_column(
            pp,
            &mut cursor,
            font_size_px,
            column_width,
            &regions,
            wrap,
        ) else {
            if cursor.has_remaining(pp) {
                column_index += 1;
                continue;
            }
            break BandLoopOutcome::TextExhausted;
        };

        contained &= paragraph_line_is_contained(&vline, &regions);

        emitted += 1;
        column_index += 1;
    };

    let text_exhausted = !cursor.has_remaining(pp);
    let (exhausted, overflow_reason) = resolve_outcome(&BandLoopResult {
        outcome,
        emitted_line_count: emitted,
        text_exhausted,
    });
    Ok(FlowMeasure {
        used_line_count: emitted,
        exhausted,
        contained,
        overflow_reason,
    })
}

/// Style-aware horizontal measurement used when fit/shrinkwrap must match
/// final mixed-size line boxes exactly.
///
/// # Errors
///
/// Returns a typed provider, query-validation, or region-budget error.
pub fn measure_flow_inline_with_styles(
    shaped_runs: &inline_runs::ShapedInlineRuns,
    text_spans: &[crate::text::types::TextSpanInput],
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    line_height_px: f64,
    line_height: Option<f64>,
    explicit_line_height_px: Option<f64>,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_width: f64,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<FlowMeasure, crate::BoundtextError> {
    let budgeted_region_provider = BudgetedRegionProvider::new(region_provider);
    measure_flow_inline_with_styles_and_budgeted_provider(
        shaped_runs,
        text_spans,
        font_ctx,
        font_size_px,
        line_height_px,
        line_height,
        explicit_line_height_px,
        fb,
        &budgeted_region_provider,
        min_region_width,
        max_lines,
        wrap,
    )
}

fn measure_flow_inline_with_styles_and_budgeted_provider(
    shaped_runs: &inline_runs::ShapedInlineRuns,
    text_spans: &[crate::text::types::TextSpanInput],
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    line_height_px: f64,
    line_height: Option<f64>,
    explicit_line_height_px: Option<f64>,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_width: f64,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<FlowMeasure, crate::BoundtextError> {
    let grapheme_count = shaped_runs.graphemes.len();
    let mut cursor = BreakCursor::new();
    let mut emitted = 0usize;
    let mut cross_cursor = fb.y;
    let mut contained = true;

    let outcome = loop {
        let line_top = cross_cursor;
        let line_bottom = line_top + line_height_px;
        // A line only fits when its BOTTOM is inside the flow box; accepting
        // any line whose top fit let the final line overflow the box by up to
        // one line height (and made fit report such layouts as contained).
        if line_bottom > fb.y + fb.height + FLOW_BOTTOM_EPSILON {
            break BandLoopOutcome::FlowBoxBottom;
        }
        if let Some(max) = max_lines
            && emitted >= max
        {
            break BandLoopOutcome::MaxLinesReached;
        }

        let saved_cursor = cursor.clone();
        let mut probe_cross_size = line_height_px;
        let mut measured_cross_size = None;
        let mut measured_contained = false;
        let stabilization_limit =
            shaped_runs.segments.len() + shaped_runs.ruby_annotations.len() + 2;
        for _ in 0..stabilization_limit {
            cursor = saved_cursor.clone();
            let regions = query_regions(
                region_provider,
                WritingMode::HorizontalTb,
                fb,
                line_top,
                line_top + probe_cross_size,
                min_region_width,
            )?;
            if regions.is_empty() {
                measured_cross_size = None;
                break;
            }
            let Some(vline) = inline_runs::layout_next_flow_line_inline_with_forced_newlines(
                shaped_runs,
                &mut cursor,
                &regions,
                wrap,
            ) else {
                measured_cross_size = None;
                break;
            };
            let mut fragments = Vec::new();
            for fragment in &vline.fragments {
                fragments.extend(split_fragment_at_run_boundaries(
                    fragment,
                    shaped_runs,
                    line_top,
                    &regions,
                    text_spans,
                    font_ctx,
                    line_height,
                    explicit_line_height_px,
                ));
            }
            let (actual_cross_size, _) = inline_line_box_metrics(
                &fragments,
                font_ctx,
                font_size_px,
                line_height,
                explicit_line_height_px,
                line_height_px,
                WritingMode::HorizontalTb,
            );
            measured_cross_size = Some(actual_cross_size);
            measured_contained = paragraph_line_is_contained(&vline, &regions);
            let next_cross_size = probe_cross_size.max(actual_cross_size);
            let expanded = query_regions(
                region_provider,
                WritingMode::HorizontalTb,
                fb,
                line_top,
                line_top + next_cross_size,
                min_region_width,
            )?;
            if regions_approx_eq(&regions, &expanded) {
                break;
            }
            probe_cross_size = next_cross_size;
        }

        let Some(line_cross_size) = measured_cross_size else {
            cursor = saved_cursor;
            if cursor.has_remaining_count(grapheme_count) {
                cross_cursor += line_height_px;
                continue;
            }
            break BandLoopOutcome::TextExhausted;
        };
        if line_top + line_cross_size > fb.y + fb.height + FLOW_BOTTOM_EPSILON {
            cursor = saved_cursor;
            break BandLoopOutcome::FlowBoxBottom;
        }

        emitted += 1;
        contained &= measured_contained;
        cross_cursor += line_cross_size;
    };

    let text_exhausted = !cursor.has_remaining_count(grapheme_count);
    let (exhausted, overflow_reason) = resolve_outcome(&BandLoopResult {
        outcome,
        emitted_line_count: emitted,
        text_exhausted,
    });
    Ok(FlowMeasure {
        used_line_count: emitted,
        exhausted,
        contained,
        overflow_reason,
    })
}

/// Style-aware vertical measurement used when fit/shrinkwrap must match final
/// mixed-size column boxes exactly.
///
/// # Errors
///
/// Returns a typed provider, query-validation, or region-budget error.
pub fn measure_flow_vertical_inline_with_styles(
    shaped_runs: &inline_runs::ShapedInlineRuns,
    text_spans: &[crate::text::types::TextSpanInput],
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    column_width: f64,
    line_height: Option<f64>,
    explicit_line_height_px: Option<f64>,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_height: f64,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<FlowMeasure, crate::BoundtextError> {
    let budgeted_region_provider = BudgetedRegionProvider::new(region_provider);
    measure_flow_vertical_inline_with_styles_and_budgeted_provider(
        shaped_runs,
        text_spans,
        font_ctx,
        font_size_px,
        column_width,
        line_height,
        explicit_line_height_px,
        fb,
        &budgeted_region_provider,
        min_region_height,
        max_lines,
        wrap,
    )
}

fn measure_flow_vertical_inline_with_styles_and_budgeted_provider(
    shaped_runs: &inline_runs::ShapedInlineRuns,
    text_spans: &[crate::text::types::TextSpanInput],
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    column_width: f64,
    line_height: Option<f64>,
    explicit_line_height_px: Option<f64>,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_height: f64,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<FlowMeasure, crate::BoundtextError> {
    let grapheme_count = shaped_runs.graphemes.len();
    let mut cursor = BreakCursor::new();
    let mut emitted = 0usize;
    let mut cross_cursor = fb.x + fb.width;
    let mut contained = true;

    let outcome = loop {
        let column_right = cross_cursor;
        let column_left = column_right - column_width;
        if column_left < fb.x - FLOW_BOTTOM_EPSILON {
            break BandLoopOutcome::FlowBoxBottom;
        }
        if let Some(max) = max_lines
            && emitted >= max
        {
            break BandLoopOutcome::MaxLinesReached;
        }

        let saved_cursor = cursor.clone();
        let mut probe_cross_size = column_width;
        let mut measured_cross_size = None;
        let mut measured_contained = false;
        let stabilization_limit =
            shaped_runs.segments.len() + shaped_runs.ruby_annotations.len() + 2;
        for _ in 0..stabilization_limit {
            cursor = saved_cursor.clone();
            let probe_left = column_right - probe_cross_size;
            let regions = query_regions(
                region_provider,
                WritingMode::VerticalRl,
                fb,
                probe_left,
                column_right,
                min_region_height,
            )?;
            if regions.is_empty() {
                measured_cross_size = None;
                break;
            }
            let Some(vline) = inline_runs::layout_next_flow_column_inline_with_forced_newlines(
                shaped_runs,
                &mut cursor,
                &regions,
                wrap,
            ) else {
                measured_cross_size = None;
                break;
            };
            let mut fragments = Vec::new();
            for fragment in &vline.fragments {
                fragments.extend(split_fragment_at_run_boundaries(
                    fragment,
                    shaped_runs,
                    probe_left,
                    &regions,
                    text_spans,
                    font_ctx,
                    line_height,
                    explicit_line_height_px,
                ));
            }
            let (actual_cross_size, _) = inline_line_box_metrics(
                &fragments,
                font_ctx,
                font_size_px,
                line_height,
                explicit_line_height_px,
                column_width,
                WritingMode::VerticalRl,
            );
            measured_cross_size = Some(actual_cross_size);
            measured_contained = paragraph_line_is_contained(&vline, &regions);
            let next_cross_size = probe_cross_size.max(actual_cross_size);
            let expanded = query_regions(
                region_provider,
                WritingMode::VerticalRl,
                fb,
                column_right - next_cross_size,
                column_right,
                min_region_height,
            )?;
            if regions_approx_eq(&regions, &expanded) {
                break;
            }
            probe_cross_size = next_cross_size;
        }

        let Some(line_cross_size) = measured_cross_size else {
            cursor = saved_cursor;
            if cursor.has_remaining_count(grapheme_count) {
                cross_cursor -= column_width;
                continue;
            }
            break BandLoopOutcome::TextExhausted;
        };
        if column_right - line_cross_size < fb.x - FLOW_BOTTOM_EPSILON {
            cursor = saved_cursor;
            break BandLoopOutcome::FlowBoxBottom;
        }

        emitted += 1;
        contained &= measured_contained;
        cross_cursor -= line_cross_size;
    };

    let text_exhausted = !cursor.has_remaining_count(grapheme_count);
    let (exhausted, overflow_reason) = resolve_outcome(&BandLoopResult {
        outcome,
        emitted_line_count: emitted,
        text_exhausted,
    });
    Ok(FlowMeasure {
        used_line_count: emitted,
        exhausted,
        contained,
        overflow_reason,
    })
}

// ---------------------------------------------------------------------------
// Ruby overflow extents
// ---------------------------------------------------------------------------

/// Compute legacy ruby annotation extents on the over and under sides.
///
/// Returns `(top_extent_px, bottom_extent_px)` as font size plus frame gap.
/// These values support consumers that manually reconstruct base and
/// annotation fragments. They are not physical line-box overflow and must not
/// be added to measured height. Uses [`rich::ruby_gap_px`] as the single source
/// of truth for the frame gap.
#[must_use]
pub fn compute_ruby_overflow(flow_layout: &FlowLayoutResult) -> (f64, f64) {
    let mut top_overflow: f64 = 0.0;
    let mut bottom_overflow: f64 = 0.0;
    for line in &flow_layout.lines {
        for fragment in &line.fragments {
            if let Some(ref ruby) = fragment.ruby {
                let ruby_height = ruby.style.font_size_px + ruby.gap_px;
                if ruby.position == "under" {
                    bottom_overflow = bottom_overflow.max(ruby_height);
                } else {
                    top_overflow = top_overflow.max(ruby_height);
                }
            }
        }
    }
    (top_overflow, bottom_overflow)
}

// ---------------------------------------------------------------------------
// Public orchestrators
// ---------------------------------------------------------------------------

/// Simple flow layout using per-line widths (no exclusions/regions).
///
/// This is the boundtext equivalent of the original `layout_text_flow`.
///
/// # Errors
///
/// Returns an error when required line widths are missing or flow shaping fails.
pub fn layout_flow_simple(
    req: &FlowSimpleRequest<'_>,
    font_ctx: &FontContext<'_>,
) -> Result<FlowSimpleResult, String> {
    if req.line_widths.is_empty() {
        return Err("line_widths must not be empty".to_string());
    }
    if req.text.is_empty() {
        return Ok(FlowSimpleResult {
            lines: Vec::new(),
            exhausted: true,
            warnings: Vec::new(),
        });
    }
    if font_ctx.families.len() > 1 {
        return layout_flow_simple_fallback(req, font_ctx);
    }
    if req.writing_mode == WritingMode::VerticalRl {
        return layout_flow_simple_vertical(req, font_ctx);
    }

    let shape_options = ShapeOptions {
        writing_mode: None,
        language: match req.language {
            Language::Ja => Some("ja".to_string()),
            Language::En => Some("en".to_string()),
            Language::Auto => None,
        },
        vertical_feature_priority: None,
        text_orientation: None,
        font_variation_settings: req.font_variation_settings.clone(),
        font_feature_settings: req.font_feature_settings.clone(),
    };

    // Verify font can be resolved
    if font_ctx
        .registry
        .resolve_chain(font_ctx.families, font_ctx.weight, font_ctx.style)
        .is_none()
    {
        return Err(format!(
            "Font not found: family={:?}, weight={}, style={:?}",
            font_ctx.families, font_ctx.weight, font_ctx.style
        ));
    }

    let pp = paragraph::shape_paragraph_with_options(
        req.text,
        font_ctx,
        req.language,
        req.wrap,
        req.hanging_punctuation,
        &shape_options,
        None,
        req.letter_spacing_px,
        true,
    )
    .ok_or_else(|| "Failed to prepare paragraph: shaping failed".to_string())?;

    let line_height_px =
        resolve_flow_line_height_px(font_ctx, req.font_size_px, req.line_height, None);
    let widths = req.line_widths;
    let mut cursor = BreakCursor::new();
    let mut lines = Vec::new();

    loop {
        let line_index = lines.len();
        let max_width = widths[line_index.min(widths.len() - 1)];
        let regions = [(0.0, max_width)];
        let previous_char_index = cursor.char_index;
        let previous_pending_empty_line = cursor.pending_empty_line;
        let Some(line) = paragraph::layout_next_flow_line(
            &pp,
            &mut cursor,
            req.font_size_px,
            line_height_px,
            &regions,
            req.wrap,
        ) else {
            break;
        };
        if cursor.char_index <= previous_char_index && !previous_pending_empty_line {
            return Err("Simple flow layout made no forward progress".to_string());
        }
        let (char_start, char_end, inline_advance_px) =
            match (line.fragments.first(), line.fragments.last()) {
                (Some(first_fragment), Some(last_fragment)) => (
                    first_fragment.char_start,
                    last_fragment.char_end,
                    line.fragments
                        .iter()
                        .map(|fragment| fragment.inline_advance_px)
                        .sum(),
                ),
                _ => (previous_char_index, previous_char_index, 0.0),
            };
        let byte_start = pp.char_byte_offsets[char_start] as usize;
        let byte_end = pp.char_byte_offsets[char_end] as usize;
        lines.push(FlowSimpleLine {
            text: pp.text[byte_start..byte_end].to_string(),
            char_start,
            char_end,
            inline_advance_px,
            available_inline_size_px: max_width,
        });
    }

    let exhausted = !cursor.has_remaining(&pp);
    let warnings = build_notdef_warnings(&paragraph::collect_notdef_chars(&pp));

    Ok(FlowSimpleResult {
        lines,
        exhausted,
        warnings,
    })
}

fn layout_flow_simple_fallback(
    req: &FlowSimpleRequest<'_>,
    font_ctx: &FontContext<'_>,
) -> Result<FlowSimpleResult, String> {
    let spans = vec![TextSpanInput {
        text: req.text.to_string(),
        font_family: font_ctx.families.to_vec(),
        font_weight: font_ctx.weight,
        font_style: font_ctx.style.clone(),
        font_size_px: req.font_size_px,
        letter_spacing_px: Some(req.letter_spacing_px),
        language: match req.language {
            Language::Ja => Some("ja".to_string()),
            Language::En => Some("en".to_string()),
            Language::Auto => None,
        },
        text_orientation: match req.text_orientation {
            TextOrientation::Upright => Some("upright".to_string()),
            TextOrientation::Mixed => None,
        },
        color: None,
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: format_css_font_variation_settings(&req.font_variation_settings),
        font_feature_settings: format_css_font_feature_settings(&req.font_feature_settings),
        text_decoration: None,
        decoration_transport_only: false,
    }];
    let vertical = req.writing_mode == WritingMode::VerticalRl;
    let shaped = inline_runs::prepare_inline_runs(
        &spans,
        font_ctx,
        req.letter_spacing_px,
        req.language,
        req.hanging_punctuation,
        &[None],
        vertical,
    );
    if shaped.graphemes.is_empty() {
        return Err("Failed to prepare fallback flow: shaping failed".to_string());
    }

    let mut cursor = BreakCursor::new();
    let mut lines = Vec::new();
    loop {
        let line_index = lines.len();
        let available_inline_size = req.line_widths[line_index.min(req.line_widths.len() - 1)];
        let regions = [(0.0, available_inline_size)];
        let previous_char_index = cursor.char_index;
        let previous_pending_empty_line = cursor.pending_empty_line;
        let next_line = if vertical {
            inline_runs::layout_next_flow_column_inline_with_forced_newlines(
                &shaped,
                &mut cursor,
                &regions,
                req.wrap,
            )
        } else {
            inline_runs::layout_next_flow_line_inline_with_forced_newlines(
                &shaped,
                &mut cursor,
                &regions,
                req.wrap,
            )
        };
        let Some(line) = next_line else {
            break;
        };
        if cursor.char_index <= previous_char_index && !previous_pending_empty_line {
            return Err("Fallback flow layout made no forward progress".to_string());
        }
        let (Some(first_fragment), Some(last_fragment)) =
            (line.fragments.first(), line.fragments.last())
        else {
            lines.push(FlowSimpleLine {
                text: String::new(),
                char_start: previous_char_index,
                char_end: previous_char_index,
                inline_advance_px: 0.0,
                available_inline_size_px: available_inline_size,
            });
            continue;
        };
        let char_start = first_fragment.char_start;
        let char_end = last_fragment.char_end;
        let byte_start = shaped.char_byte_offsets[char_start] as usize;
        let byte_end = shaped.char_byte_offsets[char_end] as usize;
        lines.push(FlowSimpleLine {
            text: shaped.text[byte_start..byte_end].to_string(),
            char_start,
            char_end,
            inline_advance_px: line
                .fragments
                .iter()
                .map(|fragment| fragment.inline_advance_px)
                .sum(),
            available_inline_size_px: available_inline_size,
        });
    }

    Ok(FlowSimpleResult {
        exhausted: !cursor.has_remaining_count(shaped.graphemes.len()),
        lines,
        warnings: build_notdef_warnings(&shaped.notdef_infos),
    })
}

fn layout_flow_simple_vertical(
    req: &FlowSimpleRequest<'_>,
    font_ctx: &FontContext<'_>,
) -> Result<FlowSimpleResult, String> {
    let shape_options = ShapeOptions {
        writing_mode: Some("vertical-rl".to_string()),
        language: match req.language {
            Language::Ja => Some("ja".to_string()),
            Language::En => Some("en".to_string()),
            Language::Auto => None,
        },
        vertical_feature_priority: None,
        text_orientation: match req.text_orientation {
            TextOrientation::Upright => Some("upright".to_string()),
            TextOrientation::Mixed => None,
        },
        font_variation_settings: req.font_variation_settings.clone(),
        font_feature_settings: req.font_feature_settings.clone(),
    };

    if font_ctx
        .registry
        .resolve_chain(font_ctx.families, font_ctx.weight, font_ctx.style)
        .is_none()
    {
        return Err(format!(
            "Font not found: family={:?}, weight={}, style={:?}",
            font_ctx.families, font_ctx.weight, font_ctx.style
        ));
    }

    let glyphs = vertical::shape_text_vertical(
        font_ctx,
        req.text,
        req.font_size_px,
        req.letter_spacing_px,
        &shape_options,
    )
    .ok_or_else(|| "Failed to prepare vertical flow: shaping failed".to_string())?;

    let line_height_px =
        resolve_flow_line_height_px(font_ctx, req.font_size_px, req.line_height, None);
    let break_result = vertical::break_vertical_columns_with_variable_heights(
        &glyphs,
        req.text,
        req.line_widths,
        req.wrap,
        req.font_size_px,
        line_height_px,
        req.language,
        None,
        req.hanging_punctuation,
        true,
    );

    let lines = break_result
        .column_ranges
        .iter()
        .zip(break_result.columns.iter())
        .enumerate()
        .map(|(index, ((char_start, char_end), column))| FlowSimpleLine {
            text: column.text.clone(),
            char_start: *char_start,
            char_end: *char_end,
            inline_advance_px: column.width,
            available_inline_size_px: req.line_widths[index.min(req.line_widths.len() - 1)],
        })
        .collect();

    let primary_alias = font_ctx
        .families
        .first()
        .map_or("", |family| family.as_str());
    let warnings = build_notdef_warnings(&collect_notdef_from_glyphs(
        &glyphs,
        req.text,
        primary_alias,
    ));

    Ok(FlowSimpleResult {
        lines,
        // The simple flow API only varies the inline-axis capacity per visual line/column.
        // When more text remains, it keeps allocating additional columns by repeating the
        // last provided height, so successful layout means the text is fully exhausted.
        exhausted: true,
        warnings,
    })
}

/// Flow layout with region-based obstacle avoidance.
///
/// This is the main public API for flow layout. Dispatches to the appropriate
/// path based on writing mode and presence of inline spans.
///
/// # Errors
///
/// Returns an error when mutually exclusive inputs are combined or shaping/layout
/// preparation fails.
pub fn layout_flow_with_regions(
    req: &FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    region_provider: &impl RegionProvider,
) -> Result<FlowLayoutResult, BoundtextError> {
    validate_flow_request_resources(req)?;
    let budgeted_regions = BudgetedRegionProvider::new(region_provider);
    let flow_layout = layout_flow_with_regions_budgeted(req, font_ctx, &budgeted_regions)?;
    record_flow_materialization(&flow_layout);
    Ok(flow_layout)
}

fn layout_flow_with_regions_budgeted(
    req: &FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    region_provider: &impl RegionProvider,
) -> Result<FlowLayoutResult, BoundtextError> {
    let has_spans = req.spans.is_some_and(|spans| !spans.is_empty());
    let has_rich_text = req.rich_text.is_some_and(|nodes| !nodes.is_empty());

    if has_spans && has_rich_text {
        return Err(BoundtextError::FlowLayout(
            "spans and richText are mutually exclusive".to_string(),
        ));
    }

    if has_rich_text {
        return rich::layout_rich_flow_with_regions(req, font_ctx, region_provider);
    }

    // Ellipsis and fit operate on the canonical rich document for every
    // public input shape. Promoting legacy plain/spans inputs here prevents
    // this diagnostics API from retaining second truncation and fit engines
    // beside the resolved render path.
    if req.ellipsis || req.fit.is_some() {
        let mut canonical_req = req.clone();
        let canonical_nodes = if let Some(flow_spans) = req.spans.filter(|spans| !spans.is_empty())
        {
            let (text_spans, _) = build_inline_runs_inputs(
                flow_spans,
                font_ctx,
                req.font_size_px,
                req.letter_spacing_px,
                req.language,
                req.text_orientation,
                &req.shape_options,
            );
            build_flow_rich_text_inputs(
                flow_spans,
                &text_spans,
                req.line_height,
                req.line_height_px,
            )
        } else {
            vec![RichTextNodeInput::Text {
                text: req.text.to_string(),
            }]
        };

        canonical_req.text = "";
        canonical_req.spans = None;
        canonical_req.rich_text = Some(&canonical_nodes);
        return rich::layout_rich_flow_with_regions(&canonical_req, font_ctx, region_provider);
    }

    // Dispatch to vertical + inline runs path
    if req.writing_mode == WritingMode::VerticalRl && has_spans {
        return layout_flow_vertical_inline(req, font_ctx, region_provider);
    }

    // Dispatch to inline runs path when spans are provided
    if has_spans {
        return layout_flow_inline(req, font_ctx, region_provider);
    }

    // Dispatch to vertical path when writing mode is vertical-rl
    if req.writing_mode == WritingMode::VerticalRl {
        return layout_flow_vertical(req, font_ctx, region_provider);
    }

    // --- Horizontal, single-font path ---

    // Verify font can be resolved
    if font_ctx
        .registry
        .resolve_chain(font_ctx.families, font_ctx.weight, font_ctx.style)
        .is_none()
    {
        return Err(BoundtextError::FlowLayout(format!(
            "Font not found: family={:?}, weight={}, style={:?}",
            font_ctx.families, font_ctx.weight, font_ctx.style
        )));
    }

    let pp = paragraph::shape_paragraph_with_options(
        req.text,
        font_ctx,
        req.language,
        req.wrap,
        req.hanging_punctuation,
        &req.shape_options,
        None,
        req.letter_spacing_px,
        true,
    )
    .ok_or_else(|| {
        BoundtextError::FlowLayout("Failed to prepare paragraph: shaping failed".to_string())
    })?;

    let min_region_width_fixed = req.min_region_width;
    let fb = &req.flow_bounds;

    // Fit: determine settled font size
    let (settled_font_size, fit_overflow) = match req.fit {
        Some("shrink") => {
            let min_size = req.min_font_size_px.unwrap_or(DEFAULT_MIN_FONT_SIZE);
            let epsilon = req.fit_epsilon_px.unwrap_or(DEFAULT_FIT_EPSILON);
            let max_iter = req.fit_max_iterations.unwrap_or(DEFAULT_FIT_MAX_ITERATIONS);
            flow_fit_shrink(
                &pp,
                req.font_size_px,
                min_size,
                epsilon,
                max_iter,
                req.fit_max_probes,
                |candidate| {
                    resolve_flow_line_height_px(
                        font_ctx,
                        candidate,
                        req.line_height,
                        req.line_height_px,
                    )
                },
                fb,
                region_provider,
                min_region_width_fixed,
                req.max_lines,
                req.wrap,
            )
        }
        Some("grow") => {
            let max_size = req
                .max_font_size_px
                .unwrap_or(req.font_size_px * DEFAULT_GROW_MULTIPLIER);
            let epsilon = req.fit_epsilon_px.unwrap_or(DEFAULT_FIT_EPSILON);
            let max_iter = req.fit_max_iterations.unwrap_or(DEFAULT_FIT_MAX_ITERATIONS);
            flow_fit_grow(
                &pp,
                req.font_size_px,
                max_size,
                epsilon,
                max_iter,
                req.fit_max_probes,
                |candidate| {
                    resolve_flow_line_height_px(
                        font_ctx,
                        candidate,
                        req.line_height,
                        req.line_height_px,
                    )
                },
                fb,
                region_provider,
                min_region_width_fixed,
                req.max_lines,
                req.wrap,
            )
        }
        _ => Ok((req.font_size_px, None)),
    }?;

    let line_height_px = resolve_flow_line_height_px(
        font_ctx,
        settled_font_size,
        req.line_height,
        req.line_height_px,
    );
    let min_region_width = min_region_width_fixed.unwrap_or(settled_font_size);
    let chosen_font_size_px = if req.fit.is_some() {
        Some(settled_font_size)
    } else {
        None
    };

    let mut flow_lines = Vec::new();
    let loop_result = run_flow_loop(
        &pp,
        settled_font_size,
        line_height_px,
        fb,
        region_provider,
        min_region_width,
        req.max_lines,
        req.wrap,
        |band_index, line_top, regions, vline, paragraph| {
            let fragments: Vec<FlowFragment> = vline
                .fragments
                .iter()
                .map(|fragment| {
                    let byte_start = paragraph.char_byte_offsets[fragment.char_start] as usize;
                    let byte_end = paragraph.char_byte_offsets[fragment.char_end] as usize;
                    let frag_text = paragraph.text[byte_start..byte_end].to_string();
                    FlowFragment {
                        text: frag_text,
                        char_start: fragment.char_start,
                        char_end: fragment.char_end,
                        x: regions[fragment.region_index].0,
                        y: line_top,
                        inline_advance_px: fragment.inline_advance_px,
                        available_inline_size_px: regions[fragment.region_index].1,
                        region_index: fragment.region_index,
                        baseline_offset: default_alphabetic_baseline_offset_px(
                            font_ctx,
                            settled_font_size,
                            req.line_height,
                            req.line_height_px,
                        ),
                        overflow_reason: fragment.overflow_reason.map(layout_overflow_reason_name),
                        intentional_overflow_px: fragment.intentional_overflow_px,
                        style: None,
                        ruby: None,
                        positioned_glyphs: Vec::new(),
                        inline_rects: Vec::new(),
                    }
                })
                .collect();

            flow_lines.push(FlowLine {
                fragments,
                line_index: band_index,
                cross_size: line_height_px,
            });
        },
    )?;

    let (exhausted, overflow_reason) = resolve_outcome(&loop_result);

    Ok(FlowLayoutResult {
        lines: flow_lines,
        exhausted,
        used_line_count: loop_result.emitted_line_count,
        overflow_reason: fit_overflow.or(overflow_reason),
        chosen_font_size_px,
        warnings: build_notdef_warnings(&paragraph::collect_notdef_chars(&pp)),
        inline_box_decorations: Vec::new(),
    })
}

/// Resolve exclusion flow directly to positioned glyphs for rendering.
///
/// Unlike the diagnostics-oriented [`layout_flow_with_regions`], this path
/// always uses the rich token pipeline. Plain text and legacy spans are
/// promoted to rich inputs before layout, so whitespace normalization,
/// shaping, breaking, and final glyph placement happen exactly once.
///
/// # Errors
///
/// Returns an error when rich-text preparation, shaping, or flow placement
/// cannot produce a renderable layout.
pub fn layout_resolved_flow_with_regions(
    req: &FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    region_provider: &impl RegionProvider,
) -> Result<TextLayoutResult, BoundtextError> {
    validate_flow_request_resources(req)?;
    let budgeted_regions = BudgetedRegionProvider::new(region_provider);
    let layout_result =
        layout_resolved_flow_with_regions_budgeted(req, font_ctx, &budgeted_regions)?;
    record_resolved_flow_materialization(&layout_result);
    Ok(layout_result)
}

fn record_flow_materialization(flow_layout: &FlowLayoutResult) {
    #[cfg(any(test, feature = "phase-trace"))]
    {
        let glyph_count = flow_layout
            .lines
            .iter()
            .flat_map(|line| &line.fragments)
            .map(|fragment| fragment.positioned_glyphs.len())
            .sum();
        let inline_rect_count = flow_layout
            .lines
            .iter()
            .flat_map(|line| &line.fragments)
            .map(|fragment| fragment.inline_rects.len())
            .sum();
        crate::phase_trace::record_materialization(
            flow_layout.lines.len(),
            glyph_count,
            flow_layout.inline_box_decorations.len(),
            inline_rect_count,
        );
    }
    #[cfg(not(any(test, feature = "phase-trace")))]
    let _ = flow_layout;
}

fn validate_flow_request_resources(req: &FlowLayoutRequest<'_>) -> Result<(), BoundtextError> {
    let Some(nodes) = req.rich_text else {
        return Ok(());
    };
    validate_rich_text_resources(nodes).map_err(|violation| match violation {
        RichTextResourceViolation::Depth { actual, limit } => {
            BoundtextError::RichTextDepthLimit { actual, limit }
        }
        RichTextResourceViolation::InlineRects { required, limit } => {
            BoundtextError::InlineRectLimit { required, limit }
        }
    })
}

fn record_resolved_flow_materialization(layout_result: &TextLayoutResult) {
    #[cfg(any(test, feature = "phase-trace"))]
    {
        let glyph_count = layout_result
            .lines
            .iter()
            .map(|line| {
                line.positioned_glyphs
                    .as_ref()
                    .map_or(line.glyphs.len(), std::vec::Vec::len)
            })
            .sum();
        crate::phase_trace::record_materialization(
            layout_result.lines.len(),
            glyph_count,
            layout_result.inline_box_decorations.len() + layout_result.text_decorations.len(),
            layout_result.inline_rects.len(),
        );
    }
    #[cfg(not(any(test, feature = "phase-trace")))]
    let _ = layout_result;
}

fn layout_resolved_flow_with_regions_budgeted(
    req: &FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    region_provider: &impl RegionProvider,
) -> Result<TextLayoutResult, BoundtextError> {
    let mut resolved_req = req.clone();
    let resolved_spans;
    let resolved_rich_text;

    if let Some(flow_spans) = req.spans.filter(|spans| !spans.is_empty()) {
        let (text_spans, _) = build_inline_runs_inputs(
            flow_spans,
            font_ctx,
            req.font_size_px,
            req.letter_spacing_px,
            req.language,
            req.text_orientation,
            &req.shape_options,
        );
        resolved_spans = text_spans;
        resolved_rich_text = build_flow_rich_text_inputs(
            flow_spans,
            &resolved_spans,
            req.line_height,
            req.line_height_px,
        );
        resolved_req.text = "";
        resolved_req.spans = None;
        resolved_req.rich_text = Some(&resolved_rich_text);
    }

    let flow_result =
        rich::layout_rich_flow_with_regions(&resolved_req, font_ctx, region_provider)?;
    let overflow = match flow_result.overflow_reason {
        None => TextOverflow::none(),
        Some(FlowOverflowReason::CannotFit) => TextOverflow::cannot_fit(),
        Some(FlowOverflowReason::MaxLinesTruncated) => {
            TextOverflow::overflow("lines truncated by maxLines")
        }
        Some(FlowOverflowReason::FlowBoxExhausted) => TextOverflow::overflow("flow box exhausted"),
    };
    let chosen_font_size_px = flow_result.chosen_font_size_px.unwrap_or(req.font_size_px);
    let is_vertical = req.writing_mode == WritingMode::VerticalRl;
    let mut lines = Vec::with_capacity(flow_result.lines.len());
    let mut inline_rects = Vec::new();
    let mut inline_box_decorations = flow_result.inline_box_decorations;
    for decoration in &mut inline_box_decorations {
        decoration.x -= req.flow_bounds.x;
        decoration.y -= req.flow_bounds.y;
    }

    for flow_line in flow_result.lines {
        let line_cross_size = flow_line.cross_size;
        let baseline_y = flow_line.fragments.first().map_or(0.0, |fragment| {
            if is_vertical {
                fragment.x + fragment.baseline_offset - req.flow_bounds.x
            } else {
                fragment.y + fragment.baseline_offset - req.flow_bounds.y
            }
        });
        let width = flow_line
            .fragments
            .iter()
            .map(|fragment| {
                if is_vertical {
                    fragment.y + fragment.inline_advance_px - req.flow_bounds.y
                } else {
                    fragment.x + fragment.inline_advance_px - req.flow_bounds.x
                }
            })
            .fold(0.0_f64, f64::max);
        let mut text = String::new();
        let mut positioned_glyphs = Vec::new();
        for fragment in flow_line.fragments {
            for inline_rect in &fragment.inline_rects {
                let block_size = match inline_rect.rect.block_size_px.as_ref() {
                    Some(InlineRectBlockSizeInput::Pixels(size)) => *size,
                    Some(InlineRectBlockSizeInput::Line(_)) | None => line_cross_size,
                };
                let block_offset = match inline_rect.rect.block_align.as_deref().unwrap_or("center")
                {
                    "start" if is_vertical => line_cross_size - block_size,
                    "start" => 0.0,
                    "end" if is_vertical => 0.0,
                    "end" => line_cross_size - block_size,
                    _ => (line_cross_size - block_size) * 0.5,
                };
                inline_rects.push(InlineRectFragment {
                    fragment_id: inline_rect.rect.fragment_id.clone(),
                    x: if is_vertical {
                        fragment.x + block_offset - req.flow_bounds.x
                    } else {
                        fragment.x + inline_rect.inline_offset - req.flow_bounds.x
                    },
                    y: if is_vertical {
                        fragment.y + inline_rect.inline_offset - req.flow_bounds.y
                    } else {
                        fragment.y + block_offset - req.flow_bounds.y
                    },
                    width: if is_vertical {
                        block_size
                    } else {
                        inline_rect.rect.inline_size_px
                    },
                    height: if is_vertical {
                        inline_rect.rect.inline_size_px
                    } else {
                        block_size
                    },
                    color: inline_rect.rect.color.clone(),
                    border_radius_px: inline_rect.rect.border_radius_px.unwrap_or(0.0),
                    opacity: inline_rect.rect.opacity.unwrap_or(1.0),
                    paint_order: inline_rect
                        .rect
                        .paint_order
                        .clone()
                        .unwrap_or_else(|| "front".to_string()),
                });
            }
            text.push_str(&fragment.text);
            positioned_glyphs.extend(fragment.positioned_glyphs.into_iter().map(|mut glyph| {
                glyph.translate(-req.flow_bounds.x, -req.flow_bounds.y);
                glyph
            }));
        }
        lines.push(Line {
            text,
            glyphs: Vec::new(),
            width,
            baseline_y,
            fragments: None,
            positioned_glyphs: Some(positioned_glyphs),
        });
    }

    let mut layout_result = TextLayoutResult {
        lines,
        bbox: TextBBox {
            x: 0.0,
            y: 0.0,
            w: req.flow_bounds.width,
            h: req.flow_bounds.height,
        },
        chosen_font_size_px,
        overflow,
        source_text: None,
        display_text: None,
        unit_map: None,
        warnings: flow_result.warnings,
        inline_box_decorations,
        text_decorations: Vec::new(),
        inline_rects,
    };
    if req.white_space == WhiteSpaceMode::PreWrap {
        layout_result.convert_spaces_to_nbsp();
    }
    Ok(layout_result)
}

// ---------------------------------------------------------------------------
// Vertical flow layout (vertical-rl writing mode, single font)
// ---------------------------------------------------------------------------

fn layout_flow_vertical(
    req: &FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    region_provider: &impl RegionProvider,
) -> Result<FlowLayoutResult, BoundtextError> {
    if font_ctx
        .registry
        .resolve_chain(font_ctx.families, font_ctx.weight, font_ctx.style)
        .is_none()
    {
        return Err(BoundtextError::FlowLayout(format!(
            "Font not found: family={:?}, weight={}, style={:?}",
            font_ctx.families, font_ctx.weight, font_ctx.style
        )));
    }

    let pp = paragraph::shape_paragraph_with_options(
        req.text,
        font_ctx,
        req.language,
        req.wrap,
        req.hanging_punctuation,
        &req.shape_options,
        None,
        req.letter_spacing_px,
        true,
    )
    .ok_or_else(|| {
        BoundtextError::FlowLayout("Failed to prepare paragraph: shaping failed".to_string())
    })?;

    let min_region_height_fixed = req.min_region_width;
    let fb = &req.flow_bounds;

    // Fit
    let (settled_font_size, fit_overflow) = match req.fit {
        Some("shrink") => {
            let min_size = req.min_font_size_px.unwrap_or(DEFAULT_MIN_FONT_SIZE);
            let epsilon = req.fit_epsilon_px.unwrap_or(DEFAULT_FIT_EPSILON);
            let max_iter = req.fit_max_iterations.unwrap_or(DEFAULT_FIT_MAX_ITERATIONS);
            flow_fit_shrink_vertical(
                &pp,
                req.font_size_px,
                min_size,
                epsilon,
                max_iter,
                req.fit_max_probes,
                |candidate| {
                    resolve_flow_line_height_px(
                        font_ctx,
                        candidate,
                        req.line_height,
                        req.line_height_px,
                    )
                },
                fb,
                region_provider,
                min_region_height_fixed,
                req.max_lines,
                req.wrap,
            )
        }
        Some("grow") => {
            let max_size = req
                .max_font_size_px
                .unwrap_or(req.font_size_px * DEFAULT_GROW_MULTIPLIER);
            let epsilon = req.fit_epsilon_px.unwrap_or(DEFAULT_FIT_EPSILON);
            let max_iter = req.fit_max_iterations.unwrap_or(DEFAULT_FIT_MAX_ITERATIONS);
            flow_fit_grow_vertical(
                &pp,
                req.font_size_px,
                max_size,
                epsilon,
                max_iter,
                req.fit_max_probes,
                |candidate| {
                    resolve_flow_line_height_px(
                        font_ctx,
                        candidate,
                        req.line_height,
                        req.line_height_px,
                    )
                },
                fb,
                region_provider,
                min_region_height_fixed,
                req.max_lines,
                req.wrap,
            )
        }
        _ => Ok((req.font_size_px, None)),
    }?;

    let column_width = resolve_flow_line_height_px(
        font_ctx,
        settled_font_size,
        req.line_height,
        req.line_height_px,
    );
    let min_region_height = min_region_height_fixed.unwrap_or(settled_font_size);
    let chosen_font_size_px = if req.fit.is_some() {
        Some(settled_font_size)
    } else {
        None
    };

    // Column loop: right-to-left
    let mut cursor = BreakCursor::new();
    let mut flow_lines = Vec::new();
    let mut column_index = 0usize;
    let mut emitted_column_count = 0usize;

    let outcome = loop {
        let column_right = fb.x + fb.width - (column_index as f64) * column_width;
        let column_left = column_right - column_width;
        if column_left < fb.x {
            break BandLoopOutcome::FlowBoxBottom;
        }
        if let Some(max) = req.max_lines
            && emitted_column_count >= max
        {
            break BandLoopOutcome::MaxLinesReached;
        }

        let regions = query_regions(
            region_provider,
            WritingMode::VerticalRl,
            fb,
            column_left,
            column_right,
            min_region_height,
        )?;
        if regions.is_empty() {
            column_index += 1;
            continue;
        }

        let Some(vline) = paragraph::layout_next_flow_column(
            &pp,
            &mut cursor,
            settled_font_size,
            column_width,
            &regions,
            req.wrap,
        ) else {
            if cursor.has_remaining(&pp) {
                column_index += 1;
                continue;
            }
            break BandLoopOutcome::TextExhausted;
        };

        let fragments: Vec<FlowFragment> = vline
            .fragments
            .iter()
            .map(|fragment| {
                let byte_start = pp.char_byte_offsets[fragment.char_start] as usize;
                let byte_end = pp.char_byte_offsets[fragment.char_end] as usize;
                let frag_text = pp.text[byte_start..byte_end].to_string();
                FlowFragment {
                    text: frag_text,
                    char_start: fragment.char_start,
                    char_end: fragment.char_end,
                    x: column_left,
                    y: regions[fragment.region_index].0,
                    inline_advance_px: fragment.inline_advance_px,
                    available_inline_size_px: regions[fragment.region_index].1,
                    region_index: fragment.region_index,
                    baseline_offset: column_width * 0.5,
                    overflow_reason: fragment.overflow_reason.map(layout_overflow_reason_name),
                    intentional_overflow_px: fragment.intentional_overflow_px,
                    style: None,
                    ruby: None,
                    positioned_glyphs: Vec::new(),
                    inline_rects: Vec::new(),
                }
            })
            .collect();

        flow_lines.push(FlowLine {
            fragments,
            line_index: column_index,
            cross_size: column_width,
        });

        emitted_column_count += 1;
        column_index += 1;
    };

    let loop_result = BandLoopResult {
        outcome,
        emitted_line_count: emitted_column_count,
        text_exhausted: !cursor.has_remaining(&pp),
    };
    let (exhausted, overflow_reason) = resolve_outcome(&loop_result);

    Ok(FlowLayoutResult {
        lines: flow_lines,
        exhausted,
        used_line_count: loop_result.emitted_line_count,
        overflow_reason: fit_overflow.or(overflow_reason),
        chosen_font_size_px,
        warnings: build_notdef_warnings(&paragraph::collect_notdef_chars(&pp)),
        inline_box_decorations: Vec::new(),
    })
}

// ---------------------------------------------------------------------------
// Inline runs flow layout (horizontal)
// ---------------------------------------------------------------------------

fn layout_flow_inline(
    req: &FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    region_provider: &impl RegionProvider,
) -> Result<FlowLayoutResult, BoundtextError> {
    let (settled_font_size, fit_overflow) = match req.fit {
        Some("shrink") => {
            let min_size = req.min_font_size_px.unwrap_or(DEFAULT_MIN_FONT_SIZE);
            let epsilon = req.fit_epsilon_px.unwrap_or(DEFAULT_FIT_EPSILON);
            let max_iter = req.fit_max_iterations.unwrap_or(DEFAULT_FIT_MAX_ITERATIONS);
            fit_shrink_with(
                req.font_size_px,
                min_size,
                epsilon,
                max_iter,
                region_provider.fit_search_kind(),
                req.fit_max_probes,
                |candidate| {
                    measure_inline_flow_at_font_size(req, font_ctx, region_provider, candidate)
                        .map(|measure| measure.fits())
                },
            )
        }
        Some("grow") => {
            let max_size = req
                .max_font_size_px
                .unwrap_or(req.font_size_px * DEFAULT_GROW_MULTIPLIER);
            let epsilon = req.fit_epsilon_px.unwrap_or(DEFAULT_FIT_EPSILON);
            let max_iter = req.fit_max_iterations.unwrap_or(DEFAULT_FIT_MAX_ITERATIONS);
            fit_grow_with(
                req.font_size_px,
                max_size,
                epsilon,
                max_iter,
                region_provider.fit_search_kind(),
                req.fit_max_probes,
                |candidate| {
                    measure_inline_flow_at_font_size(req, font_ctx, region_provider, candidate)
                        .map(|measure| measure.fits())
                },
            )
        }
        _ => Ok((req.font_size_px, None)),
    }?;

    let (_scaled_spans, text_spans, _ruby_info, shaped_runs) =
        prepare_inline_flow_inputs(req, font_ctx, settled_font_size);
    let grapheme_count = shaped_runs.graphemes.len();
    let line_height_px = resolve_flow_line_height_px(
        font_ctx,
        settled_font_size,
        req.line_height,
        req.line_height_px,
    );
    let min_region_width = req.min_region_width.unwrap_or(settled_font_size);
    let fb = &req.flow_bounds;
    let chosen_font_size_px = if req.fit.is_some() {
        Some(settled_font_size)
    } else {
        None
    };

    // Band loop (inline variant). Lines advance by their ACTUAL cross size
    // (a mixed-size line is taller than the base line height), so the cross
    // position is accumulated rather than derived from the band index.
    let mut cursor = BreakCursor::new();
    let mut flow_lines = Vec::new();
    let mut band_index = 0usize;
    let mut emitted_line_count = 0usize;
    let mut cross_cursor = fb.y;

    let outcome = loop {
        let line_top = cross_cursor;
        let line_bottom = line_top + line_height_px;
        // A line only fits when its BOTTOM is inside the flow box; accepting
        // any line whose top fit let the final line overflow the box by up to
        // one line height (and made fit report such layouts as contained).
        if line_bottom > fb.y + fb.height + FLOW_BOTTOM_EPSILON {
            break BandLoopOutcome::FlowBoxBottom;
        }
        if let Some(max) = req.max_lines
            && emitted_line_count >= max
        {
            break BandLoopOutcome::MaxLinesReached;
        }

        let saved_cursor = cursor.clone();
        let mut probe_cross_size = line_height_px;
        let mut resolved_line = None;
        let stabilization_limit =
            shaped_runs.segments.len() + shaped_runs.ruby_annotations.len() + 2;
        for _ in 0..stabilization_limit {
            cursor = saved_cursor.clone();
            let regions = query_regions(
                region_provider,
                WritingMode::HorizontalTb,
                fb,
                line_top,
                line_top + probe_cross_size,
                min_region_width,
            )?;
            if regions.is_empty() {
                resolved_line = None;
                break;
            }
            let Some(vline) = inline_runs::layout_next_flow_line_inline_with_forced_newlines(
                &shaped_runs,
                &mut cursor,
                &regions,
                req.wrap,
            ) else {
                resolved_line = None;
                break;
            };
            let mut line_fragments = Vec::new();
            for fragment in &vline.fragments {
                line_fragments.extend(split_fragment_at_run_boundaries(
                    fragment,
                    &shaped_runs,
                    line_top,
                    &regions,
                    &text_spans,
                    font_ctx,
                    req.line_height,
                    req.line_height_px,
                ));
            }
            let (line_cross_size, baseline_offset) = inline_line_box_metrics(
                &line_fragments,
                font_ctx,
                settled_font_size,
                req.line_height,
                req.line_height_px,
                line_height_px,
                WritingMode::HorizontalTb,
            );
            for fragment in &mut line_fragments {
                fragment.baseline_offset = baseline_offset;
            }
            resolved_line = Some((line_fragments, line_cross_size));
            let next_cross_size = probe_cross_size.max(line_cross_size);
            let expanded = query_regions(
                region_provider,
                WritingMode::HorizontalTb,
                fb,
                line_top,
                line_top + next_cross_size,
                min_region_width,
            )?;
            if regions_approx_eq(&regions, &expanded) {
                break;
            }
            probe_cross_size = next_cross_size;
        }

        let Some((line_fragments, line_cross_size)) = resolved_line else {
            cursor = saved_cursor;
            if cursor.has_remaining_count(grapheme_count) {
                band_index += 1;
                cross_cursor += line_height_px;
                continue;
            }
            break BandLoopOutcome::TextExhausted;
        };

        // The line is as tall as its tallest run. Re-check containment with
        // that real height (the provisional check above used the base line
        // height) and roll the cursor back if the line does not fit.
        if line_top + line_cross_size > fb.y + fb.height + FLOW_BOTTOM_EPSILON {
            cursor = saved_cursor;
            break BandLoopOutcome::FlowBoxBottom;
        }

        flow_lines.push(FlowLine {
            fragments: line_fragments,
            line_index: band_index,
            cross_size: line_cross_size,
        });

        emitted_line_count += 1;
        band_index += 1;
        cross_cursor += line_cross_size;
    };

    let loop_result = BandLoopResult {
        outcome,
        emitted_line_count,
        text_exhausted: !cursor.has_remaining_count(grapheme_count),
    };
    let (exhausted, overflow_reason) = resolve_outcome(&loop_result);

    Ok(FlowLayoutResult {
        lines: flow_lines,
        exhausted,
        used_line_count: loop_result.emitted_line_count,
        overflow_reason: fit_overflow.or(overflow_reason),
        chosen_font_size_px,
        warnings: build_notdef_warnings(&shaped_runs.notdef_infos),
        inline_box_decorations: Vec::new(),
    })
}

// ---------------------------------------------------------------------------
// Vertical + inline runs flow layout
// ---------------------------------------------------------------------------

fn layout_flow_vertical_inline(
    req: &FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    region_provider: &impl RegionProvider,
) -> Result<FlowLayoutResult, BoundtextError> {
    let (settled_font_size, fit_overflow) = match req.fit {
        Some("shrink") => {
            let min_size = req.min_font_size_px.unwrap_or(DEFAULT_MIN_FONT_SIZE);
            let epsilon = req.fit_epsilon_px.unwrap_or(DEFAULT_FIT_EPSILON);
            let max_iter = req.fit_max_iterations.unwrap_or(DEFAULT_FIT_MAX_ITERATIONS);
            fit_shrink_with(
                req.font_size_px,
                min_size,
                epsilon,
                max_iter,
                region_provider.fit_search_kind(),
                req.fit_max_probes,
                |candidate| {
                    measure_inline_flow_at_font_size(req, font_ctx, region_provider, candidate)
                        .map(|measure| measure.fits())
                },
            )
        }
        Some("grow") => {
            let max_size = req
                .max_font_size_px
                .unwrap_or(req.font_size_px * DEFAULT_GROW_MULTIPLIER);
            let epsilon = req.fit_epsilon_px.unwrap_or(DEFAULT_FIT_EPSILON);
            let max_iter = req.fit_max_iterations.unwrap_or(DEFAULT_FIT_MAX_ITERATIONS);
            fit_grow_with(
                req.font_size_px,
                max_size,
                epsilon,
                max_iter,
                region_provider.fit_search_kind(),
                req.fit_max_probes,
                |candidate| {
                    measure_inline_flow_at_font_size(req, font_ctx, region_provider, candidate)
                        .map(|measure| measure.fits())
                },
            )
        }
        _ => Ok((req.font_size_px, None)),
    }?;

    let (_scaled_spans, text_spans, _ruby_info, shaped_runs) =
        prepare_inline_flow_inputs(req, font_ctx, settled_font_size);
    let grapheme_count = shaped_runs.graphemes.len();
    let column_width = resolve_flow_line_height_px(
        font_ctx,
        settled_font_size,
        req.line_height,
        req.line_height_px,
    );
    let min_region_height = req.min_region_width.unwrap_or(settled_font_size);
    let fb = &req.flow_bounds;
    let chosen_font_size_px = if req.fit.is_some() {
        Some(settled_font_size)
    } else {
        None
    };

    // Column loop: right-to-left
    let mut cursor = BreakCursor::new();
    let mut flow_lines = Vec::new();
    let mut column_index = 0usize;
    let mut emitted_column_count = 0usize;
    let mut cross_cursor = fb.x + fb.width;

    let outcome = loop {
        let column_right = cross_cursor;
        let column_left = column_right - column_width;
        if column_left < fb.x - FLOW_BOTTOM_EPSILON {
            break BandLoopOutcome::FlowBoxBottom;
        }
        if let Some(max) = req.max_lines
            && emitted_column_count >= max
        {
            break BandLoopOutcome::MaxLinesReached;
        }

        let saved_cursor = cursor.clone();
        let mut probe_cross_size = column_width;
        let mut resolved_column = None;
        let stabilization_limit =
            shaped_runs.segments.len() + shaped_runs.ruby_annotations.len() + 2;
        for _ in 0..stabilization_limit {
            cursor = saved_cursor.clone();
            let probe_left = column_right - probe_cross_size;
            let regions = query_regions(
                region_provider,
                WritingMode::VerticalRl,
                fb,
                probe_left,
                column_right,
                min_region_height,
            )?;
            if regions.is_empty() {
                resolved_column = None;
                break;
            }
            let Some(vline) = inline_runs::layout_next_flow_column_inline_with_forced_newlines(
                &shaped_runs,
                &mut cursor,
                &regions,
                req.wrap,
            ) else {
                resolved_column = None;
                break;
            };

            let mut line_fragments = Vec::new();
            for fragment in &vline.fragments {
                let mut sub_fragments = split_fragment_at_run_boundaries(
                    fragment,
                    &shaped_runs,
                    probe_left,
                    &regions,
                    &text_spans,
                    font_ctx,
                    req.line_height,
                    req.line_height_px,
                );
                for sub_fragment in &mut sub_fragments {
                    let x = sub_fragment.y;
                    let y = sub_fragment.x;
                    sub_fragment.x = x;
                    sub_fragment.y = y;
                }
                line_fragments.extend(sub_fragments);
            }
            let (line_cross_size, reference_offset) = inline_line_box_metrics(
                &line_fragments,
                font_ctx,
                settled_font_size,
                req.line_height,
                req.line_height_px,
                column_width,
                WritingMode::VerticalRl,
            );
            let actual_left = column_right - line_cross_size;
            for fragment in &mut line_fragments {
                fragment.x = actual_left;
                fragment.baseline_offset = reference_offset;
            }
            resolved_column = Some((line_fragments, line_cross_size));
            let next_cross_size = probe_cross_size.max(line_cross_size);
            let expanded = query_regions(
                region_provider,
                WritingMode::VerticalRl,
                fb,
                column_right - next_cross_size,
                column_right,
                min_region_height,
            )?;
            if regions_approx_eq(&regions, &expanded) {
                break;
            }
            probe_cross_size = next_cross_size;
        }

        let Some((line_fragments, line_cross_size)) = resolved_column else {
            cursor = saved_cursor;
            if cursor.has_remaining_count(grapheme_count) {
                column_index += 1;
                cross_cursor -= column_width;
                continue;
            }
            break BandLoopOutcome::TextExhausted;
        };
        if column_right - line_cross_size < fb.x - FLOW_BOTTOM_EPSILON {
            cursor = saved_cursor;
            break BandLoopOutcome::FlowBoxBottom;
        }
        flow_lines.push(FlowLine {
            fragments: line_fragments,
            line_index: column_index,
            cross_size: line_cross_size,
        });

        emitted_column_count += 1;
        column_index += 1;
        cross_cursor -= line_cross_size;
    };

    let loop_result = BandLoopResult {
        outcome,
        emitted_line_count: emitted_column_count,
        text_exhausted: !cursor.has_remaining_count(grapheme_count),
    };
    let (exhausted, overflow_reason) = resolve_outcome(&loop_result);

    Ok(FlowLayoutResult {
        lines: flow_lines,
        exhausted,
        used_line_count: loop_result.emitted_line_count,
        overflow_reason: fit_overflow.or(overflow_reason),
        chosen_font_size_px,
        warnings: build_notdef_warnings(&shaped_runs.notdef_infos),
        inline_box_decorations: Vec::new(),
    })
}
