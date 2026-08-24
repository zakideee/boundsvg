use crate::font::FontContext;
use crate::font::backend::{FontFace, GlyphBBox};
use crate::font::line_metrics::{LineMetrics, resolve_line_metrics_for_style};
use crate::font::shaping::{
    self, GlyphInfo, ShapeOptions, parse_css_font_feature_settings,
    parse_css_font_variation_settings,
};
use crate::font::{FontEntry, FontRegistry, FontStyle};

mod flow_layout;
mod line_layout;
mod prepare;

use super::flow as text_flow;
use super::grapheme::grapheme_split;
use super::kinsoku::KinsokuProfile;
use super::types::{
    FitMode, InlineRectInput, IntrinsicInlineSizes, Language, PositionedGlyph,
    RichTextDecorationRunInput, TextBBox, TextDecorationGlyphGeometry, TextDecorationInput,
    TextLayoutRequest, TextLayoutResult, TextOrientation, TextOverflow, TextWarning, WrapMode,
};
#[cfg(test)]
use super::types::{RichTextNodeInput, RichTextStyleInput, WhiteSpaceMode};
pub(crate) use flow_layout::layout_rich_flow_with_regions;
#[cfg(test)]
use line_layout::{
    assemble_horizontal_line, assemble_vertical_line, break_tokens_horizontal,
    break_tokens_vertical, resolve_fragment_border_radius,
};
use line_layout::{effective_line_width, layout_horizontal_tokens, layout_vertical_tokens};
use prepare::{
    build_default_style, collect_notdef_warnings_from_tokens, expand_tabs_in_nodes,
    flatten_rich_nodes_with_warnings,
};

/// Maximum nesting depth for `InlineBox` (outer + 2 nested).
const MAX_INLINE_BOX_DEPTH: u32 = 3;

#[derive(Debug, Clone, PartialEq)]
struct ResolvedStyle {
    font_families: Vec<String>,
    font_weight: u16,
    font_style: FontStyle,
    font_size_px: f64,
    line_height: Option<f64>,
    line_height_px: Option<f64>,
    letter_spacing_px: f64,
    language: Option<String>,
    color: Option<String>,
    text_strokes: Option<Vec<super::types::TextStrokeLayer>>,
    text_shadows: Option<Vec<super::types::TextShadowLayer>>,
    font_variation_settings: Option<String>,
    font_feature_settings: Option<String>,
    text_orientation: TextOrientation,
    /// Paint-only metadata. Equality is bypassed by the shaping coalescer so
    /// decoration boundaries never become shaping boundaries.
    text_decoration: Option<TextDecorationInput>,
}

#[derive(Debug, Clone)]
struct RichSegment {
    text: String,
    style: ResolvedStyle,
    combine: bool,
    decoration_runs: Vec<RichTextDecorationRunInput>,
}

#[derive(Debug, Clone)]
struct RichRuby {
    ruby_position: RubyPosition,
    ruby_align: RubyAlign,
    ruby_gap_px: f64,
    ruby_offset_px: f64,
    ruby_line_sizing: RubyLineSizing,
    base: Vec<RichSegment>,
    rt_levels: Vec<Vec<RichSegment>>,
}

#[derive(Debug, Clone)]
struct RichInlineBox {
    children: Vec<RichInlineNode>,
    padding_inline: [f64; 2],
    border_width: f64,
    background: Option<String>,
    border_color: Option<String>,
    border_radius: Option<f64>,
    /// Caller-assigned provenance key echoed on the emitted decoration fragment.
    span_key: Option<String>,
}

#[derive(Debug, Clone)]
struct RichInlineRect {
    input: InlineRectInput,
    style: ResolvedStyle,
}

/// Fragmentable decorated inline span. Children are grapheme-split and
/// can wrap across lines, producing per-line decoration fragments.
#[derive(Debug, Clone)]
struct RichDecoratedSpan {
    children: Vec<RichInlineNode>,
    padding_inline: [f64; 2],
    border_width: f64,
    background: Option<String>,
    border_color: Option<String>,
    border_radius: Option<[f64; 4]>,
    /// Caller-assigned provenance key echoed on emitted decoration fragments.
    span_key: Option<String>,
}

#[derive(Debug, Clone)]
enum RichInlineNode {
    Segment(RichSegment),
    Ruby(RichRuby),
    InlineBox(RichInlineBox),
    InlineRect(RichInlineRect),
    DecoratedSpan(RichDecoratedSpan),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RubyPosition {
    Over,
    Under,
    Alternate,
    InterCharacter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RubyAlign {
    Start,
    Center,
    SpaceBetween,
    SpaceAround,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RubyLineSizing {
    Stable,
    Css,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RubySide {
    Over,
    Under,
}

#[derive(Debug, Clone, Copy)]
#[expect(
    clippy::struct_field_names,
    reason = "px suffix documents the crate-wide pixel unit convention for line metrics"
)]
struct InlineLineBoxMetrics {
    line_height_px: f64,
    baseline_offset_px: f64,
    ascent_px: f64,
    descent_px: f64,
}

#[derive(Debug, Clone, Copy)]
#[expect(
    clippy::struct_field_names,
    reason = "px suffix documents the crate-wide pixel unit convention for ruby metrics"
)]
struct RubyAnnotationLineBoxMetrics {
    box_measure_px: f64,
    baseline_offset_px: f64,
    center_offset_px: f64,
}

#[derive(Debug, Clone, Copy)]
enum RubyInkAxis {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Copy)]
struct GlyphInkBounds {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
}

#[derive(Clone, Copy)]
struct RubyInkBoundsContext<'a> {
    font_registry: &'a FontRegistry,
    fallback_registry: Option<&'a FontRegistry>,
    axis: RubyInkAxis,
}

struct RubyInkPlacement<'a> {
    glyphs: &'a mut [PositionedGlyph],
    base_end: usize,
    level_ranges: &'a [(RubySide, usize, usize)],
    desired_gap: f64,
    normalize_extent: bool,
    cross_size: &'a mut f64,
    reference_offset: &'a mut f64,
}

#[derive(Debug, Clone)]
struct InlineBoxDecorationInput {
    total_advance: f64,
    cross_size: f64,
    background: Option<String>,
    border_color: Option<String>,
    border_width: Option<f64>,
    border_radius: Option<[f64; 4]>,
    /// Caller-assigned provenance key echoed on the emitted decoration fragment.
    span_key: Option<String>,
}

/// Metadata for a fragmentable decorated span (shared across tokens with the same span ID).
#[derive(Debug, Clone)]
struct DecorationSpanMeta {
    background: Option<String>,
    border_color: Option<String>,
    border_width: f64,
    border_radius: Option<[f64; 4]>,
    /// Caller-assigned provenance key echoed on emitted decoration fragments.
    span_key: Option<String>,
}

/// Decoration from a nested `InlineBox`, with offset relative to the parent token's content start.
#[derive(Debug, Clone)]
struct NestedInlineBoxDecoration {
    offset: f64,
    decoration: InlineBoxDecorationInput,
}

#[derive(Debug, Clone)]
struct NestedInlineRect {
    offset: f64,
    rect: InlineRectInput,
}

#[derive(Debug, Clone)]
struct LayoutToken {
    text: String,
    /// Japanese kinsoku state at the token's logical leading edge.
    /// `None` is reserved for synthetic tokens that inherit the request.
    kinsoku_start: Option<bool>,
    /// Japanese kinsoku state at the token's logical trailing edge.
    /// Atomic tokens can have different languages at their two edges.
    kinsoku_end: Option<bool>,
    /// Glyph-only advance (does not include decoration padding/border).
    advance: f64,
    cross_size: f64,
    reference_offset: f64,
    glyphs: Vec<PositionedGlyph>,
    inline_rects: Vec<NestedInlineRect>,
    inline_box_decoration: Option<InlineBoxDecorationInput>,
    /// Decorations from nested `InlineBoxes`, with offsets relative to this token's content start.
    nested_decorations: Vec<NestedInlineBoxDecoration>,
    /// Fragmentable decoration span tracking.
    decoration_span_id: Option<u32>,
    /// Extra advance for decoration start (`padding_inline`[0] + `border_width`).
    /// Non-zero only on the first token of a decoration span.
    decoration_start_advance: f64,
    /// Extra advance for decoration end (`padding_inline`[1] + `border_width`).
    /// Non-zero only on the last token of a decoration span.
    decoration_end_advance: f64,
    flow_ruby: Option<text_flow::FlowRubyAnnotation>,
    /// letterSpacing to re-add after this token when it is not stream-final.
    /// Per-token shaping drops inter-token tracking; see `build_tokens`.
    trailing_tracking_px: f64,
}

/// Inline box decoration with advance-direction offset relative to line start.
#[derive(Debug, Clone)]
struct LineInlineBoxDecoration {
    offset: f64,
    advance: f64,
    cross_size: f64,
    /// Cross-axis shift applied to align decoration with the line's `reference_offset`.
    /// In horizontal: always 0 (decorations span the full line height).
    /// In vertical: `line_reference_offset - token_reference_offset` to match glyph alignment.
    cross_offset: f64,
    background: Option<String>,
    border_color: Option<String>,
    border_width: Option<f64>,
    border_radius: Option<[f64; 4]>,
    /// Decoration span ID for fragmentable spans. None for atomic `InlineBox`.
    span_id: Option<u32>,
    /// Caller-assigned provenance key echoed on emitted decoration fragments.
    span_key: Option<String>,
}

#[derive(Debug, Clone)]
struct LineInlineRect {
    offset: f64,
    rect: InlineRectInput,
}

#[derive(Debug, Clone)]
struct LayoutLine {
    text: String,
    advance: f64,
    cross_size: f64,
    reference_offset: f64,
    glyphs: Vec<PositionedGlyph>,
    decorations: Vec<LineInlineBoxDecoration>,
    inline_rects: Vec<LineInlineRect>,
    kinsoku_unresolved: bool,
}

struct PreparedRichText {
    tokens: Vec<LayoutToken>,
    decoration_spans: Vec<DecorationSpanMeta>,
    warnings: Vec<TextWarning>,
}

fn style_uses_ja_kinsoku(style: &ResolvedStyle) -> bool {
    style.language.as_deref() == Some("ja")
}

fn segment_kinsoku_edges(segments: &[RichSegment]) -> (Option<bool>, Option<bool>) {
    let start = segments
        .iter()
        .find(|segment| !segment.text.is_empty())
        .map(|segment| style_uses_ja_kinsoku(&segment.style));
    let end = segments
        .iter()
        .rfind(|segment| !segment.text.is_empty())
        .map(|segment| style_uses_ja_kinsoku(&segment.style));
    (start, end)
}

fn extend_kinsoku_edges(
    start: &mut Option<bool>,
    end: &mut Option<bool>,
    child_start: Option<bool>,
    child_end: Option<bool>,
) {
    if start.is_none() {
        *start = child_start;
    }
    if child_end.is_some() {
        *end = child_end;
    }
}

#[must_use]
pub fn layout_rich_text(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
) -> Option<TextLayoutResult> {
    if req.fit == FitMode::Shrink {
        return fit_rich_text(req, font_ctx, true);
    }
    if req.fit == FitMode::Grow {
        return fit_rich_text(req, font_ctx, false);
    }

    layout_rich_text_at_font_size(req, font_ctx, req.font_size_px)
}

/// Build the flattened inline-node list (with whitespace normalization) and
/// the resolved default style for a rich layout request.
fn build_normalized_inline_nodes(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    chosen_font_size_px: f64,
) -> (Vec<RichInlineNode>, ResolvedStyle, Vec<TextWarning>) {
    let default_style = build_default_style(
        req,
        font_ctx.families,
        font_ctx.weight,
        font_ctx.style,
        chosen_font_size_px,
    );
    let mut inline_nodes = Vec::new();
    let mut flatten_warnings = Vec::new();
    if let Some(rich_nodes) = req.rich_text {
        flatten_rich_nodes_with_warnings(
            rich_nodes,
            &default_style,
            &mut inline_nodes,
            chosen_font_size_px / req.font_size_px,
            &mut flatten_warnings,
        );
    } else if !req.text.is_empty() {
        inline_nodes.push(RichInlineNode::Segment(RichSegment {
            text: req.text.to_string(),
            style: default_style.clone(),
            combine: false,
            decoration_runs: Vec::new(),
        }));
    }

    if req.has_forced_newline_breaks() {
        expand_tabs_in_nodes(&mut inline_nodes, req.tab_size);
    } else if matches!(
        req.white_space,
        crate::text::types::WhiteSpaceMode::Normal | crate::text::types::WhiteSpaceMode::NoWrap
    ) {
        prepare::collapse_whitespace_in_nodes(&mut inline_nodes);
    }
    (inline_nodes, default_style, flatten_warnings)
}

fn build_inline_nodes(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    chosen_font_size_px: f64,
) -> (Vec<RichInlineNode>, ResolvedStyle, Vec<TextWarning>) {
    let (mut inline_nodes, default_style, flatten_warnings) =
        build_normalized_inline_nodes(req, font_ctx, chosen_font_size_px);
    if prepare::request_has_text_decoration(req) {
        prepare::coalesce_shaping_segments(&mut inline_nodes);
    }
    (inline_nodes, default_style, flatten_warnings)
}

#[derive(Debug)]
struct DecorationByteSlice {
    byte_start: usize,
    byte_end: usize,
    decoration: TextDecorationInput,
}

#[derive(Debug)]
struct PendingAnnotationDecoration {
    base_byte_start: usize,
    base_byte_end: usize,
    level: u32,
    text: String,
    slices: Vec<DecorationByteSlice>,
}

pub(super) fn normalized_text_decoration_ranges(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    chosen_font_size_px: f64,
) -> Vec<super::decoration::DecorationRange> {
    let (inline_nodes, _, _) = build_normalized_inline_nodes(req, font_ctx, chosen_font_size_px);
    let mut base_text = String::new();
    let mut base_slices = Vec::new();
    let mut annotations = Vec::new();
    collect_decoration_slices(
        &inline_nodes,
        &mut base_text,
        &mut base_slices,
        &mut annotations,
    );

    let base_graphemes = grapheme_byte_ranges(&base_text);
    let mut ranges = Vec::new();
    append_converted_decoration_ranges(
        &mut ranges,
        &base_graphemes,
        &base_slices,
        super::decoration::DecorationTarget::Base,
    );
    for annotation in annotations {
        let Some((ruby_source_start, ruby_source_end)) = byte_range_to_source_range(
            &base_graphemes,
            annotation.base_byte_start,
            annotation.base_byte_end,
        ) else {
            continue;
        };
        let annotation_graphemes = grapheme_byte_ranges(&annotation.text);
        append_converted_decoration_ranges(
            &mut ranges,
            &annotation_graphemes,
            &annotation.slices,
            super::decoration::DecorationTarget::RubyAnnotation {
                ruby_source_start,
                ruby_source_end,
                level: annotation.level,
            },
        );
    }
    ranges
}

fn collect_decoration_slices(
    nodes: &[RichInlineNode],
    base_text: &mut String,
    base_slices: &mut Vec<DecorationByteSlice>,
    annotations: &mut Vec<PendingAnnotationDecoration>,
) {
    for node in nodes {
        match node {
            RichInlineNode::Segment(segment) => {
                append_segment_decoration_slice(base_text, base_slices, segment);
            }
            RichInlineNode::Ruby(ruby) => {
                let base_byte_start = base_text.len();
                for segment in &ruby.base {
                    append_segment_decoration_slice(base_text, base_slices, segment);
                }
                let base_byte_end = base_text.len();
                for (level_index, level) in ruby.rt_levels.iter().enumerate() {
                    let mut annotation_text = String::new();
                    let mut annotation_slices = Vec::new();
                    for segment in level {
                        append_segment_decoration_slice(
                            &mut annotation_text,
                            &mut annotation_slices,
                            segment,
                        );
                    }
                    annotations.push(PendingAnnotationDecoration {
                        base_byte_start,
                        base_byte_end,
                        level: u32::try_from(level_index).unwrap_or(u32::MAX),
                        text: annotation_text,
                        slices: annotation_slices,
                    });
                }
            }
            RichInlineNode::InlineBox(inline_box) => {
                collect_decoration_slices(
                    &inline_box.children,
                    base_text,
                    base_slices,
                    annotations,
                );
            }
            RichInlineNode::InlineRect(_) => {}
            RichInlineNode::DecoratedSpan(span) => {
                collect_decoration_slices(&span.children, base_text, base_slices, annotations);
            }
        }
    }
}

fn append_segment_decoration_slice(
    text: &mut String,
    slices: &mut Vec<DecorationByteSlice>,
    segment: &RichSegment,
) {
    let byte_start = text.len();
    text.push_str(&segment.text);
    let byte_end = text.len();
    let decoration_run_text = segment
        .decoration_runs
        .iter()
        .map(|run| run.text.as_str())
        .collect::<String>();
    if !segment.decoration_runs.is_empty() && decoration_run_text == segment.text {
        let mut run_byte_start = byte_start;
        for run in &segment.decoration_runs {
            let run_byte_end = run_byte_start.saturating_add(run.text.len());
            if run_byte_start < run_byte_end
                && let Some(decoration) = &run.text_decoration
            {
                slices.push(DecorationByteSlice {
                    byte_start: run_byte_start,
                    byte_end: run_byte_end,
                    decoration: decoration.clone(),
                });
            }
            run_byte_start = run_byte_end;
        }
    } else if byte_start < byte_end
        && let Some(decoration) = &segment.style.text_decoration
    {
        slices.push(DecorationByteSlice {
            byte_start,
            byte_end,
            decoration: decoration.clone(),
        });
    }
}

fn grapheme_byte_ranges(text: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut byte_cursor = 0_usize;
    for grapheme in grapheme_split(text) {
        let byte_end = byte_cursor.saturating_add(grapheme.len());
        ranges.push((byte_cursor, byte_end));
        byte_cursor = byte_end;
    }
    ranges
}

fn byte_range_to_source_range(
    grapheme_ranges: &[(usize, usize)],
    byte_start: usize,
    byte_end: usize,
) -> Option<(u32, u32)> {
    let source_start =
        grapheme_ranges.partition_point(|(_, grapheme_end)| *grapheme_end <= byte_start);
    let source_end =
        grapheme_ranges.partition_point(|(grapheme_start, _)| *grapheme_start < byte_end);
    if source_start >= source_end {
        return None;
    }
    Some((
        u32::try_from(source_start).unwrap_or(u32::MAX),
        u32::try_from(source_end).unwrap_or(u32::MAX),
    ))
}

fn append_converted_decoration_ranges(
    output: &mut Vec<super::decoration::DecorationRange>,
    grapheme_ranges: &[(usize, usize)],
    slices: &[DecorationByteSlice],
    target: super::decoration::DecorationTarget,
) {
    for slice in slices {
        let Some((source_start, source_end)) =
            byte_range_to_source_range(grapheme_ranges, slice.byte_start, slice.byte_end)
        else {
            continue;
        };
        if let Some(previous) = output.last_mut()
            && previous.target == target
            && previous.source_end >= source_start
            && previous.decoration == slice.decoration
        {
            previous.source_end = previous.source_end.max(source_end);
            continue;
        }
        output.push(super::decoration::DecorationRange {
            source_start,
            source_end,
            decoration: slice.decoration.clone(),
            target,
        });
    }
}

fn prepare_rich_text(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    chosen_font_size_px: f64,
) -> Option<PreparedRichText> {
    let (inline_nodes, default_style, flatten_warnings) =
        build_inline_nodes(req, font_ctx, chosen_font_size_px);

    if inline_nodes.is_empty() {
        return Some(PreparedRichText {
            tokens: Vec::new(),
            decoration_spans: Vec::new(),
            warnings: flatten_warnings,
        });
    }

    let (tokens, decoration_spans) = build_tokens(
        &inline_nodes,
        req,
        font_ctx.registry,
        font_ctx.fallback_registry,
        &default_style,
    )?;

    let mut warnings = collect_notdef_warnings_from_tokens(&tokens);
    warnings.extend(flatten_warnings);

    Some(PreparedRichText {
        tokens,
        decoration_spans,
        warnings,
    })
}

/// Compute intrinsic (min-content / max-content) inline sizes for text.
///
/// - `max_content_inline_size`: the longest unconstrained logical inline run.
///   In horizontal text this is physical line width; in vertical text this is
///   physical column height. Newline-only tokens act as separators.
/// - `min_content_inline_size`: the largest single unbreakable token.
#[must_use]
pub fn measure_intrinsic_inline_size(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
) -> Option<IntrinsicInlineSizes> {
    let prepared = prepare_rich_text(req, font_ctx, req.font_size_px)?;

    if prepared.tokens.is_empty() {
        return Some(IntrinsicInlineSizes {
            min_content_inline_size: 0.0,
            max_content_inline_size: 0.0,
            warnings: prepared.warnings,
        });
    }

    // min-content: largest single unbreakable token, including decoration
    // advance if the token is the first/last of a decoration span.
    let mut min_content_inline_size = prepared
        .tokens
        .iter()
        .filter(|token| token.text != "\n")
        .map(|token| token.advance + token.decoration_start_advance + token.decoration_end_advance)
        .fold(0.0_f64, f64::max);
    let text_indent = req.text_indent.unwrap_or(0.0);
    if let Some(first_token) = prepared.tokens.first().filter(|token| token.text != "\n") {
        min_content_inline_size = min_content_inline_size.max(
            first_token.advance
                + first_token.decoration_start_advance
                + first_token.decoration_end_advance
                + text_indent,
        );
    }

    // max-content: sum all advances per logical line/column, including decoration
    // start/end advance. Use effective_line_width for the full token range
    // per logical line (split at newline tokens).
    let mut max_content_inline_size = 0.0_f64;
    let mut line_start = 0usize;
    for (i, token) in prepared.tokens.iter().enumerate() {
        if token.text == "\n" {
            let line_width = effective_line_width(
                &prepared.tokens,
                line_start,
                i,
                if line_start == 0 { text_indent } else { 0.0 },
            );
            max_content_inline_size = max_content_inline_size.max(line_width);
            line_start = i + 1;
        }
    }
    if line_start < prepared.tokens.len() {
        let line_width = effective_line_width(
            &prepared.tokens,
            line_start,
            prepared.tokens.len(),
            if line_start == 0 { text_indent } else { 0.0 },
        );
        max_content_inline_size = max_content_inline_size.max(line_width);
    }

    Some(IntrinsicInlineSizes {
        min_content_inline_size,
        max_content_inline_size,
        warnings: prepared.warnings,
    })
}

fn fit_rich_text(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    shrink: bool,
) -> Option<TextLayoutResult> {
    let epsilon = if shrink {
        req.shrink_epsilon_px.unwrap_or(0.25)
    } else {
        req.grow_epsilon_px.unwrap_or(0.25)
    };
    let iterations = if shrink {
        req.shrink_max_iterations.unwrap_or(12)
    } else {
        req.grow_max_iterations.unwrap_or(12)
    };

    let mut lo = if shrink {
        req.min_font_size_px.unwrap_or(8.0)
    } else {
        req.font_size_px
    };
    let mut hi = if shrink {
        req.font_size_px
    } else {
        req.max_font_size_px.unwrap_or(req.font_size_px * 4.0)
    };
    let mut best: Option<TextLayoutResult> = None;
    let defer_ellipsis = req.ellipsis && req.max_lines.is_some();
    let unellipsized_request = defer_ellipsis.then(|| TextLayoutRequest {
        ellipsis: false,
        ..req.clone()
    });
    let fit_request = unellipsized_request.as_ref().unwrap_or(req);

    for _ in 0..iterations {
        if hi - lo < epsilon {
            break;
        }
        let mid = (lo + hi) * 0.5;
        let candidate = layout_rich_text_at_font_size(fit_request, font_ctx, mid)?;
        let fits = rich_text_fits_constraints(req, &candidate);
        if fits {
            best = Some(candidate.clone());
            lo = mid;
        } else {
            hi = mid;
        }
    }

    let result = best.or_else(|| layout_rich_text_at_font_size(fit_request, font_ctx, lo))?;
    if defer_ellipsis && !rich_text_fits_constraints(req, &result) {
        return apply_rich_ellipsis(req, font_ctx, result.chosen_font_size_px).or(Some(result));
    }
    Some(result)
}

const RICH_TEXT_CONSTRAINT_TOLERANCE_PX: f64 = 0.001;
const HORIZONTAL_RICH_ELLIPSIS_TOLERANCE_PX: f64 = 0.01;

fn rich_text_fits_constraints(req: &TextLayoutRequest, result: &TextLayoutResult) -> bool {
    if !rich_text_fits_geometry(req, result) {
        return false;
    }
    matches!(
        result.overflow.overflow_type.as_str(),
        "none" | "kinsoku_unresolved"
    )
}

fn rich_text_fits_geometry(req: &TextLayoutRequest, result: &TextLayoutResult) -> bool {
    if result.bbox.w > req.max_width + RICH_TEXT_CONSTRAINT_TOLERANCE_PX {
        return false;
    }
    if let Some(max_h) = req.max_height {
        if result.bbox.h > max_h + RICH_TEXT_CONSTRAINT_TOLERANCE_PX {
            return false;
        }
    }
    if let Some(max_lines) = req.max_lines {
        if result.lines.len() > max_lines {
            return false;
        }
    }
    true
}

fn rich_text_requires_ellipsis(req: &TextLayoutRequest, result: &TextLayoutResult) -> bool {
    result.overflow.overflow_type == "overflow"
        || (req.is_vertical() && !rich_text_fits_geometry(req, result))
}

fn rich_ellipsis_candidate_fits(req: &TextLayoutRequest, result: &TextLayoutResult) -> bool {
    if req.is_vertical() {
        return rich_text_fits_constraints(req, result);
    }
    let max_width = req.max_width.max(1.0);
    result.lines.len() <= req.max_lines.unwrap_or(result.lines.len())
        && result.bbox.w <= max_width + HORIZONTAL_RICH_ELLIPSIS_TOLERANCE_PX
}

fn layout_rich_text_at_font_size(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    chosen_font_size_px: f64,
) -> Option<TextLayoutResult> {
    let prepared = prepare_rich_text(req, font_ctx, chosen_font_size_px)?;

    if prepared.tokens.is_empty() {
        return Some(TextLayoutResult {
            lines: Vec::new(),
            bbox: TextBBox {
                x: 0.0,
                y: 0.0,
                w: 0.0,
                h: 0.0,
            },
            chosen_font_size_px,
            overflow: TextOverflow::none(),
            source_text: None,
            display_text: None,
            unit_map: None,
            warnings: prepared.warnings,
            inline_box_decorations: Vec::new(),
            text_decorations: Vec::new(),
            inline_rects: Vec::new(),
        });
    }
    if req.is_vertical() {
        let result = layout_vertical_tokens(
            req,
            &prepared.tokens,
            &prepared.decoration_spans,
            chosen_font_size_px,
            prepared.warnings,
        )?;
        if req.ellipsis && req.max_lines.is_some() && rich_text_requires_ellipsis(req, &result) {
            if let Some(ellipsized) = apply_rich_ellipsis(req, font_ctx, chosen_font_size_px) {
                return Some(ellipsized);
            }
        }
        Some(result)
    } else {
        let result = layout_horizontal_tokens(
            req,
            &prepared.tokens,
            &prepared.decoration_spans,
            chosen_font_size_px,
            prepared.warnings,
        )?;
        // maxLines + ellipsis: relayout with truncated inline nodes.
        if req.ellipsis && req.max_lines.is_some() && rich_text_requires_ellipsis(req, &result) {
            if let Some(ellipsized) = apply_rich_ellipsis(req, font_ctx, chosen_font_size_px) {
                return Some(ellipsized);
            }
        }
        Some(result)
    }
}

/// Apply ellipsis to rich text by relayout: truncate the flattened inline
/// nodes at grapheme granularity (ruby and inline boxes are atomic — kept
/// whole or dropped), append "…" styled as the last kept segment, and
/// binary-search the largest kept prefix that fits within the horizontal line
/// or vertical column constraints.
fn apply_rich_ellipsis(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    chosen_font_size_px: f64,
) -> Option<TextLayoutResult> {
    apply_rich_ellipsis_with_probe_observer(req, font_ctx, chosen_font_size_px, &mut || {})
}

fn apply_rich_ellipsis_with_probe_observer(
    req: &TextLayoutRequest,
    font_ctx: &FontContext<'_>,
    chosen_font_size_px: f64,
    on_probe: &mut impl FnMut(),
) -> Option<TextLayoutResult> {
    req.max_lines?;
    let (inline_nodes, default_style, _) = build_inline_nodes(req, font_ctx, chosen_font_size_px);
    let total = count_inline_graphemes(&inline_nodes);
    if total == 0 {
        return None;
    }

    let mut probe = |keep: usize| -> Option<TextLayoutResult> {
        on_probe();
        let (mut truncated, _consumed) = truncate_inline_nodes(&inline_nodes, keep);
        let ellipsis_style =
            last_segment_style(&truncated).unwrap_or_else(|| default_style.clone());
        truncated.push(RichInlineNode::Segment(RichSegment {
            text: "\u{2026}".to_string(),
            style: ellipsis_style,
            combine: false,
            decoration_runs: Vec::new(),
        }));
        let (tokens, decoration_spans) = build_tokens(
            &truncated,
            req,
            font_ctx.registry,
            font_ctx.fallback_registry,
            &default_style,
        )?;
        let probe_req = TextLayoutRequest {
            max_lines: None,
            ellipsis: false,
            ..req.clone()
        };
        if req.is_vertical() {
            layout_vertical_tokens(
                &probe_req,
                &tokens,
                &decoration_spans,
                chosen_font_size_px,
                Vec::new(),
            )
        } else {
            layout_horizontal_tokens(
                &probe_req,
                &tokens,
                &decoration_spans,
                chosen_font_size_px,
                Vec::new(),
            )
        }
    };
    let fits = |result: &TextLayoutResult| rich_ellipsis_candidate_fits(req, result);

    // Binary search the largest keep count whose relayout fits. Keeping
    // everything is known not to fit (the caller checked overflow).
    let mut lo = 0usize;
    let mut hi = total - 1;
    let mut best: Option<(usize, TextLayoutResult)> = None;
    while lo <= hi {
        let mid = lo + (hi - lo) / 2;
        let candidate = probe(mid)?;
        if fits(&candidate) {
            best = Some((mid, candidate));
            lo = mid + 1;
        } else {
            if mid == 0 {
                break;
            }
            hi = mid - 1;
        }
    }
    let (keep, mut result) = match best {
        Some(found) => found,
        // Even "…" alone overflows — return it as the best effort.
        None => (0, probe(0)?),
    };

    // Back up past tail-prohibited characters (same contract as plain).
    if let Some(profile) =
        crate::text::kinsoku::get_kinsoku_profile(Some(language_to_str(req.language)))
    {
        let graphemes = collect_inline_graphemes(&inline_nodes);
        let grapheme_refs: Vec<&str> = graphemes.iter().map(String::as_str).collect();
        let mut adjusted = keep;
        while adjusted > 0
            && !crate::text::kinsoku::is_valid_ellipsis_boundary(&grapheme_refs, adjusted, profile)
        {
            adjusted -= 1;
        }
        if adjusted != keep {
            result = probe(adjusted)?;
        }
    }

    result.overflow = TextOverflow::overflow("ellipsis applied");
    Some(result)
}

/// Extra probes allowed for fallback and kinsoku boundary adjustment.
#[cfg(test)]
const RICH_ELLIPSIS_PROBE_OVERHEAD: usize = 3;

#[cfg(test)]
fn rich_ellipsis_probe_limit(unit_count: usize) -> usize {
    let binary_search_steps = if unit_count <= 1 {
        0
    } else {
        usize::BITS as usize - (unit_count - 1).leading_zeros() as usize
    };
    binary_search_steps + RICH_ELLIPSIS_PROBE_OVERHEAD
}

/// Count the grapheme budget of inline nodes: segment text by graphemes,
/// ruby by its base graphemes, an inline box as a single atomic unit.
fn count_inline_graphemes(nodes: &[RichInlineNode]) -> usize {
    nodes
        .iter()
        .map(|node| match node {
            RichInlineNode::Segment(seg) => grapheme_split(&seg.text).len(),
            RichInlineNode::Ruby(ruby) => ruby
                .base
                .iter()
                .map(|seg| grapheme_split(&seg.text).len())
                .sum(),
            RichInlineNode::InlineBox(_) | RichInlineNode::InlineRect(_) => 1,
            RichInlineNode::DecoratedSpan(span) => count_inline_graphemes(&span.children),
        })
        .sum()
}

/// Flatten inline-node text into a grapheme list aligned with
/// [`count_inline_graphemes`] indexing (for kinsoku boundary validation).
fn collect_inline_graphemes(nodes: &[RichInlineNode]) -> Vec<String> {
    let mut out = Vec::new();
    for node in nodes {
        match node {
            RichInlineNode::Segment(seg) => out.extend(grapheme_split(&seg.text)),
            RichInlineNode::Ruby(ruby) => {
                for seg in &ruby.base {
                    out.extend(grapheme_split(&seg.text));
                }
            }
            // Object replacement character: atomic, never tail-prohibited.
            RichInlineNode::InlineBox(_) | RichInlineNode::InlineRect(_) => {
                out.push("\u{FFFC}".to_string());
            }
            RichInlineNode::DecoratedSpan(span) => {
                out.extend(collect_inline_graphemes(&span.children));
            }
        }
    }
    out
}

/// Keep a `keep`-grapheme prefix of the inline nodes. Ruby and inline boxes
/// are atomic: they are kept whole when their full budget fits, otherwise
/// dropped. Returns the truncated nodes and the consumed grapheme count.
fn truncate_inline_nodes(nodes: &[RichInlineNode], keep: usize) -> (Vec<RichInlineNode>, usize) {
    let mut out = Vec::new();
    let mut remaining = keep;
    for node in nodes {
        if remaining == 0 {
            break;
        }
        match node {
            RichInlineNode::Segment(seg) => {
                let graphemes = grapheme_split(&seg.text);
                if graphemes.len() <= remaining {
                    remaining -= graphemes.len();
                    out.push(node.clone());
                } else {
                    out.push(RichInlineNode::Segment(RichSegment {
                        text: graphemes[..remaining].concat(),
                        style: seg.style.clone(),
                        combine: seg.combine,
                        decoration_runs: seg.decoration_runs.clone(),
                    }));
                    remaining = 0;
                }
            }
            RichInlineNode::Ruby(_)
            | RichInlineNode::InlineBox(_)
            | RichInlineNode::InlineRect(_) => {
                let unit = count_inline_graphemes(std::slice::from_ref(node));
                if unit <= remaining {
                    remaining -= unit;
                    out.push(node.clone());
                } else {
                    // Atomic node does not fit the budget — drop it and stop.
                    remaining = 0;
                }
            }
            RichInlineNode::DecoratedSpan(span) => {
                let (children, consumed) = truncate_inline_nodes(&span.children, remaining);
                remaining -= consumed;
                if !children.is_empty() {
                    out.push(RichInlineNode::DecoratedSpan(RichDecoratedSpan {
                        children,
                        ..span.clone()
                    }));
                }
            }
        }
    }
    (out, keep - remaining)
}

/// Style of the last text segment in document order (for the "…" segment).
fn last_segment_style(nodes: &[RichInlineNode]) -> Option<ResolvedStyle> {
    for node in nodes.iter().rev() {
        match node {
            RichInlineNode::Segment(seg) => return Some(seg.style.clone()),
            RichInlineNode::Ruby(ruby) => {
                if let Some(seg) = ruby.base.last() {
                    return Some(seg.style.clone());
                }
            }
            RichInlineNode::DecoratedSpan(span) => {
                if let Some(style) = last_segment_style(&span.children) {
                    return Some(style);
                }
            }
            RichInlineNode::InlineBox(_) => {}
            RichInlineNode::InlineRect(rect) => return Some(rect.style.clone()),
        }
    }
    None
}

fn build_tokens(
    nodes: &[RichInlineNode],
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
) -> Option<(Vec<LayoutToken>, Vec<DecorationSpanMeta>)> {
    let mut tokens = Vec::new();
    let mut decoration_spans: Vec<DecorationSpanMeta> = Vec::new();
    let mut next_span_id: u32 = 0;

    build_tokens_inner(
        nodes,
        req,
        font_registry,
        fallback_registry,
        default_style,
        &mut tokens,
        &mut decoration_spans,
        &mut next_span_id,
        None,
    )?;

    // Whole-string letterSpacing parity: per-token shaping drops the
    // tracking between tokens (a single-grapheme token gets none at all),
    // so re-add each segment token's tracking on every token except the
    // stream-final one. Newline markers carry no advance of their own.
    let last_index = tokens.len().saturating_sub(1);
    for (index, token) in tokens.iter_mut().enumerate() {
        if index == last_index {
            break;
        }
        if token.trailing_tracking_px != 0.0 && token.text != "\n" {
            token.advance = crate::font::shaping::add_inline_tracking(
                token.advance,
                token.trailing_tracking_px,
            );
        }
    }

    // Convert the run-local ranges assigned while shaping into one logical
    // grapheme address space for the complete rich-text node.
    let mut source_cursor = 0_u32;
    for token in &mut tokens {
        for glyph in &mut token.glyphs {
            if let Some(source_start) = glyph.source_start.as_mut() {
                *source_start += source_cursor;
            }
            if let Some(source_end) = glyph.source_end.as_mut() {
                *source_end += source_cursor;
            }
        }
        source_cursor = source_cursor
            .saturating_add(u32::try_from(grapheme_split(&token.text).len()).unwrap_or(u32::MAX));
    }

    Some((tokens, decoration_spans))
}

fn build_tokens_inner(
    nodes: &[RichInlineNode],
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
    tokens: &mut Vec<LayoutToken>,
    decoration_spans: &mut Vec<DecorationSpanMeta>,
    next_span_id: &mut u32,
    current_span_id: Option<u32>,
) -> Option<()> {
    for node in nodes {
        match node {
            RichInlineNode::Segment(segment) => {
                if segment.text.is_empty() {
                    continue;
                }
                if req.is_vertical() && segment.combine {
                    let mut token = build_vertical_combine_token(
                        segment,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?;
                    if let Some(id) = current_span_id {
                        token.decoration_span_id = Some(id);
                    }
                    tokens.push(token);
                    continue;
                }

                let segment_tokens = if segment.combine || req.wrap == WrapMode::None {
                    let mut token = if req.is_vertical() {
                        build_vertical_plain_token(
                            &segment.text,
                            &segment.style,
                            req,
                            font_registry,
                            fallback_registry,
                            default_style,
                        )?
                    } else {
                        build_horizontal_plain_token(
                            &segment.text,
                            &segment.style,
                            req,
                            font_registry,
                            fallback_registry,
                            default_style,
                        )?
                    };
                    token.trailing_tracking_px = segment.style.letter_spacing_px;
                    vec![token]
                } else {
                    build_fragmentable_plain_tokens(
                        segment,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?
                };

                for mut token in segment_tokens {
                    if let Some(id) = current_span_id {
                        token.decoration_span_id = Some(id);
                    }
                    tokens.push(token);
                }
            }
            RichInlineNode::Ruby(ruby) => {
                let mut token = if req.is_vertical() {
                    build_vertical_ruby_token(
                        ruby,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?
                } else {
                    build_horizontal_ruby_token(
                        ruby,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?
                };
                if let Some(id) = current_span_id {
                    token.decoration_span_id = Some(id);
                }
                tokens.push(token);
            }
            RichInlineNode::InlineBox(ibox) => {
                let mut token = if req.is_vertical() {
                    build_vertical_inline_box_token(
                        ibox,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?
                } else {
                    build_horizontal_inline_box_token(
                        ibox,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?
                };
                if let Some(id) = current_span_id {
                    token.decoration_span_id = Some(id);
                }
                tokens.push(token);
            }
            RichInlineNode::InlineRect(rect) => {
                let mut token = build_inline_rect_token(
                    rect,
                    font_registry,
                    fallback_registry,
                    req.is_vertical(),
                );
                if let Some(id) = current_span_id {
                    token.decoration_span_id = Some(id);
                }
                tokens.push(token);
            }
            RichInlineNode::DecoratedSpan(dspan) => {
                if current_span_id.is_some() {
                    let mut token = if req.is_vertical() {
                        build_vertical_atomic_decorated_span_token(
                            dspan,
                            req,
                            font_registry,
                            fallback_registry,
                            default_style,
                        )?
                    } else {
                        build_horizontal_atomic_decorated_span_token(
                            dspan,
                            req,
                            font_registry,
                            fallback_registry,
                            default_style,
                        )?
                    };
                    token.decoration_span_id = current_span_id;
                    tokens.push(token);
                    continue;
                }

                let span_id = *next_span_id;
                *next_span_id += 1;
                decoration_spans.push(DecorationSpanMeta {
                    background: dspan.background.clone(),
                    border_color: dspan.border_color.clone(),
                    border_width: dspan.border_width,
                    border_radius: dspan.border_radius,
                    span_key: dspan.span_key.clone(),
                });

                let first_token_idx = tokens.len();
                build_tokens_inner(
                    &dspan.children,
                    req,
                    font_registry,
                    fallback_registry,
                    default_style,
                    tokens,
                    decoration_spans,
                    next_span_id,
                    Some(span_id),
                )?;
                let last_token_idx = tokens.len();

                // Set decoration start/end advance on first/last tokens of this span
                if first_token_idx < last_token_idx {
                    let start_extra = dspan.padding_inline[0] + dspan.border_width;
                    let end_extra = dspan.padding_inline[1] + dspan.border_width;
                    tokens[first_token_idx].decoration_start_advance = start_extra;
                    tokens[last_token_idx - 1].decoration_end_advance = end_extra;
                }
            }
        }
    }
    Some(())
}

fn build_fragmentable_plain_tokens(
    segment: &RichSegment,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
) -> Option<Vec<LayoutToken>> {
    let graphemes = grapheme_split(&segment.text);
    if graphemes.is_empty() {
        return Some(Vec::new());
    }

    // Newlines remain mandatory standalone tokens, while each surrounding
    // text chunk keeps its own contextual shaping.
    let mut tokens = Vec::with_capacity(graphemes.len());
    let mut chunk = Vec::new();
    for grapheme in graphemes {
        if grapheme == "\n" {
            append_fragmentable_plain_chunk(
                &mut tokens,
                &chunk,
                segment,
                req,
                font_registry,
                fallback_registry,
                default_style,
            )?;
            chunk.clear();
            let mut newline_token = if req.is_vertical() {
                build_vertical_plain_token(
                    &grapheme,
                    &segment.style,
                    req,
                    font_registry,
                    fallback_registry,
                    default_style,
                )?
            } else {
                build_horizontal_plain_token(
                    &grapheme,
                    &segment.style,
                    req,
                    font_registry,
                    fallback_registry,
                    default_style,
                )?
            };
            newline_token.trailing_tracking_px = segment.style.letter_spacing_px;
            tokens.push(newline_token);
        } else {
            chunk.push(grapheme);
        }
    }
    append_fragmentable_plain_chunk(
        &mut tokens,
        &chunk,
        segment,
        req,
        font_registry,
        fallback_registry,
        default_style,
    )?;
    Some(tokens)
}

fn append_fragmentable_plain_chunk(
    tokens: &mut Vec<LayoutToken>,
    graphemes: &[String],
    segment: &RichSegment,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
) -> Option<()> {
    if graphemes.is_empty() {
        return Some(());
    }

    let text = graphemes.concat();
    if let Some(contextual_tokens) = build_contextually_shaped_plain_tokens(
        &text,
        graphemes,
        &segment.style,
        req,
        font_registry,
        fallback_registry,
    ) {
        tokens.extend(contextual_tokens);
        return Some(());
    }

    for grapheme in graphemes {
        let mut token = if req.is_vertical() {
            build_vertical_plain_token(
                grapheme,
                &segment.style,
                req,
                font_registry,
                fallback_registry,
                default_style,
            )?
        } else {
            build_horizontal_plain_token(
                grapheme,
                &segment.style,
                req,
                font_registry,
                fallback_registry,
                default_style,
            )?
        };
        token.trailing_tracking_px = segment.style.letter_spacing_px;
        tokens.push(token);
    }
    Some(())
}

fn build_contextually_shaped_plain_tokens(
    text: &str,
    graphemes: &[String],
    style: &ResolvedStyle,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
) -> Option<Vec<LayoutToken>> {
    let shaped = shape_text(
        font_registry,
        fallback_registry,
        style,
        text,
        req.is_vertical(),
    )?;
    distribute_contextually_shaped_plain_tokens(
        text,
        graphemes,
        style,
        req,
        font_registry,
        fallback_registry,
        &shaped,
    )
}

fn distribute_contextually_shaped_plain_tokens(
    text: &str,
    graphemes: &[String],
    style: &ResolvedStyle,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    shaped: &[GlyphInfo],
) -> Option<Vec<LayoutToken>> {
    if shaped.is_empty()
        || shaped
            .windows(2)
            .any(|pair| pair[0].cluster > pair[1].cluster)
    {
        return None;
    }

    let mut byte_offsets = Vec::with_capacity(graphemes.len() + 1);
    let mut byte_offset = 0usize;
    byte_offsets.push(byte_offset);
    for grapheme in graphemes {
        byte_offset += grapheme.len();
        byte_offsets.push(byte_offset);
    }

    let mut tokens = Vec::with_capacity(graphemes.len());
    let mut glyph_index = 0usize;
    for (index, grapheme) in graphemes.iter().enumerate() {
        let start = byte_offsets[index];
        let end = byte_offsets[index + 1];
        let start_u32 = u32::try_from(start).ok()?;
        let glyph_start = glyph_index;
        while glyph_index < shaped.len()
            && usize::try_from(shaped[glyph_index].cluster).is_ok_and(|cluster| cluster < end)
        {
            glyph_index += 1;
        }
        let mut grapheme_glyphs = shaped[glyph_start..glyph_index].to_vec();
        for glyph in &mut grapheme_glyphs {
            debug_assert!(glyph.cluster >= start_u32);
            glyph.cluster -= start_u32;
        }

        // When one shaped cluster spans multiple graphemes (for example an
        // fi ligature), keep its full source text on the glyph-bearing token.
        // Continuation grapheme tokens carry zero advance, matching the spans
        // path while preserving grapheme-based cursor and ellipsis indices.
        // Consequently, a glyph's cluster_end may exceed token.text.len();
        // glyph.text retains the complete cluster source for positioning.
        let next_cluster = shaped
            .get(glyph_index)
            .and_then(|glyph| usize::try_from(glyph.cluster).ok())
            .unwrap_or(text.len());
        let glyph_source_end = end.max(next_cluster).min(text.len());
        let glyph_source_text = if grapheme_glyphs.is_empty() {
            grapheme.as_str()
        } else {
            text.get(start..glyph_source_end)?
        };

        let mut token = if req.is_vertical() {
            build_vertical_plain_token_from_glyphs(
                glyph_source_text,
                style,
                font_registry,
                fallback_registry,
                &grapheme_glyphs,
            )
        } else {
            build_horizontal_plain_token_from_glyphs(
                glyph_source_text,
                style,
                font_registry,
                fallback_registry,
                &grapheme_glyphs,
            )
        };
        token.text.clone_from(grapheme);
        if index + 1 == graphemes.len() {
            // Whole-run shaping already includes internal tracking. Only the
            // segment boundary still needs the stream-level compensation.
            token.trailing_tracking_px = style.letter_spacing_px;
        }
        tokens.push(token);
    }

    Some(tokens)
}

fn build_horizontal_plain_token(
    text: &str,
    style: &ResolvedStyle,
    _req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    _default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    let glyphs = shape_text(font_registry, fallback_registry, style, text, false)?;
    Some(build_horizontal_plain_token_from_glyphs(
        text,
        style,
        font_registry,
        fallback_registry,
        &glyphs,
    ))
}

fn build_inline_rect_token(
    rect: &RichInlineRect,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    is_vertical: bool,
) -> LayoutToken {
    let line_metrics = resolve_style_line_metrics(font_registry, fallback_registry, &rect.style);
    let reference_offset = if is_vertical {
        line_metrics.line_height_px * 0.5
    } else {
        line_metrics.baseline_offset_px
    };
    LayoutToken {
        text: String::new(),
        kinsoku_start: None,
        kinsoku_end: None,
        advance: rect.input.advance_px.unwrap_or(0.0),
        cross_size: line_metrics.line_height_px,
        reference_offset,
        glyphs: Vec::new(),
        inline_rects: vec![NestedInlineRect {
            offset: 0.0,
            rect: rect.input.clone(),
        }],
        inline_box_decoration: None,
        nested_decorations: Vec::new(),
        decoration_span_id: None,
        decoration_start_advance: 0.0,
        decoration_end_advance: 0.0,
        flow_ruby: None,
        trailing_tracking_px: 0.0,
    }
}

fn build_horizontal_plain_token_from_glyphs(
    text: &str,
    style: &ResolvedStyle,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    glyphs: &[GlyphInfo],
) -> LayoutToken {
    let line_metrics = resolve_style_line_metrics(font_registry, fallback_registry, style);
    let baseline = line_metrics.baseline_offset_px;
    let positioned = position_horizontal_glyphs(text, glyphs, style, 0.0, baseline);
    let advance = glyphs.iter().map(|glyph| glyph.x_advance).sum::<f64>();
    let uses_ja_kinsoku = style_uses_ja_kinsoku(style);
    LayoutToken {
        text: text.to_string(),
        kinsoku_start: Some(uses_ja_kinsoku),
        kinsoku_end: Some(uses_ja_kinsoku),
        advance,
        cross_size: line_metrics.line_height_px,
        reference_offset: baseline,
        glyphs: positioned,
        inline_rects: Vec::new(),
        inline_box_decoration: None,
        nested_decorations: Vec::new(),
        decoration_span_id: None,
        decoration_start_advance: 0.0,
        decoration_end_advance: 0.0,
        flow_ruby: None,
        trailing_tracking_px: 0.0,
    }
}

fn build_vertical_plain_token(
    text: &str,
    style: &ResolvedStyle,
    _req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    _default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    let glyphs = shape_text(font_registry, fallback_registry, style, text, true)?;
    Some(build_vertical_plain_token_from_glyphs(
        text,
        style,
        font_registry,
        fallback_registry,
        &glyphs,
    ))
}

fn build_vertical_plain_token_from_glyphs(
    text: &str,
    style: &ResolvedStyle,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    glyphs: &[GlyphInfo],
) -> LayoutToken {
    let lane_width =
        resolve_style_line_metrics(font_registry, fallback_registry, style).line_height_px;
    let positioned = position_vertical_glyphs(text, glyphs, style, lane_width * 0.5, 0.0);
    let advance = glyphs.iter().map(glyph_advance_in_vertical).sum::<f64>();
    let uses_ja_kinsoku = style_uses_ja_kinsoku(style);
    LayoutToken {
        text: text.to_string(),
        kinsoku_start: Some(uses_ja_kinsoku),
        kinsoku_end: Some(uses_ja_kinsoku),
        advance,
        cross_size: lane_width,
        reference_offset: lane_width * 0.5,
        glyphs: positioned,
        inline_rects: Vec::new(),
        inline_box_decoration: None,
        nested_decorations: Vec::new(),
        decoration_span_id: None,
        decoration_start_advance: 0.0,
        decoration_end_advance: 0.0,
        flow_ruby: None,
        trailing_tracking_px: 0.0,
    }
}

fn build_vertical_combine_token(
    segment: &RichSegment,
    _req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    let cell_advance = default_style.font_size_px;
    let column_width =
        resolve_style_line_metrics(font_registry, fallback_registry, default_style).line_height_px;
    let mut style = segment.style.clone();
    let raw = shape_text(
        font_registry,
        fallback_registry,
        &style,
        &segment.text,
        false,
    )?;
    let raw_width = raw.iter().map(|glyph| glyph.x_advance).sum::<f64>();
    if raw_width > 0.0 && raw_width > cell_advance {
        style.font_size_px *= cell_advance / raw_width;
    }
    let glyphs = shape_text(
        font_registry,
        fallback_registry,
        &style,
        &segment.text,
        false,
    )?;
    let width = glyphs.iter().map(|glyph| glyph.x_advance).sum::<f64>();
    let line_metrics = resolve_style_line_metrics(font_registry, fallback_registry, &style);
    let baseline = (cell_advance - line_metrics.line_height_px).max(0.0) * 0.5
        + line_metrics.baseline_offset_px;
    let origin_x = (column_width - width).max(0.0) * 0.5;
    let mut positioned =
        position_horizontal_glyphs(&segment.text, &glyphs, &style, origin_x, baseline);
    let decoration_geometry = TextDecorationGlyphGeometry {
        inline_start: 0.0,
        inline_end: cell_advance,
        baseline: column_width * 0.5,
        block_half_extent: cell_advance * 0.5,
    };
    for glyph in &mut positioned {
        glyph.outline_writing_mode = Some("horizontal-tb".to_string());
        glyph.text_decoration_geometry = Some(decoration_geometry);
    }
    Some(LayoutToken {
        text: segment.text.clone(),
        kinsoku_start: Some(style_uses_ja_kinsoku(&segment.style)),
        kinsoku_end: Some(style_uses_ja_kinsoku(&segment.style)),
        advance: cell_advance,
        cross_size: column_width,
        reference_offset: column_width * 0.5,
        glyphs: positioned,
        inline_rects: Vec::new(),
        inline_box_decoration: None,
        nested_decorations: Vec::new(),
        decoration_span_id: None,
        decoration_start_advance: 0.0,
        decoration_end_advance: 0.0,
        flow_ruby: None,
        // The combined run is one atomic typographic character, but tracking
        // still belongs at its boundary with the following token.
        trailing_tracking_px: segment.style.letter_spacing_px,
    })
}

fn build_horizontal_ruby_token(
    ruby: &RichRuby,
    _req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    _default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    let base_metrics =
        resolve_segments_line_box_metrics(font_registry, fallback_registry, &ruby.base);
    let level_measures: Vec<(RubySide, f64, f64)> = ruby
        .rt_levels
        .iter()
        .enumerate()
        .map(|(index, level)| {
            (
                ruby_side_for_level(ruby.ruby_position, index),
                resolve_segments_ruby_line_box_metrics(font_registry, fallback_registry, level)
                    .box_measure_px,
                resolve_segments_ruby_line_box_metrics(font_registry, fallback_registry, level)
                    .baseline_offset_px,
            )
        })
        .collect();
    let over_extent = ruby_stack_extent(
        &level_measures,
        RubySide::Over,
        ruby.ruby_gap_px,
        ruby.ruby_offset_px,
    );
    let under_extent = ruby_stack_extent(
        &level_measures,
        RubySide::Under,
        ruby.ruby_gap_px,
        ruby.ruby_offset_px,
    );
    let stable_line_sizing = ruby.ruby_line_sizing == RubyLineSizing::Stable;
    let (mut token_height, base_line_top) = if stable_line_sizing {
        (
            over_extent + base_metrics.line_height_px + under_extent,
            over_extent,
        )
    } else {
        let (cross_size, base_baseline) = resolve_horizontal_css_ruby_line_box(
            base_metrics.line_height_px,
            base_metrics.baseline_offset_px,
            base_metrics.ascent_px,
            base_metrics.descent_px,
            over_extent,
            under_extent,
        );
        (cross_size, base_baseline - base_metrics.baseline_offset_px)
    };
    let base_frame_top = base_line_top + base_metrics.baseline_offset_px - base_metrics.ascent_px;
    let base_frame_bottom =
        base_line_top + base_metrics.baseline_offset_px + base_metrics.descent_px;
    let mut base_baseline = base_line_top + base_metrics.baseline_offset_px;

    let (base_glyphs, base_width) = shape_segment_run_horizontal(
        &ruby.base,
        font_registry,
        fallback_registry,
        base_baseline,
        0.0,
    )?;

    let advance = base_width;
    let mut over_distance = ruby.ruby_gap_px + ruby.ruby_offset_px;
    let mut under_distance = ruby.ruby_gap_px + ruby.ruby_offset_px;
    let mut all_rt_glyphs = Vec::new();
    let mut level_ranges = Vec::with_capacity(ruby.rt_levels.len());
    for (index, level) in ruby.rt_levels.iter().enumerate() {
        let side = level_measures[index].0;
        let box_height = level_measures[index].1;
        let baseline_offset = level_measures[index].2;
        let frame_top = if side == RubySide::Over {
            let top = base_frame_top - over_distance - box_height;
            over_distance += box_height + ruby.ruby_gap_px;
            top
        } else {
            let top = base_frame_bottom + under_distance;
            under_distance += box_height + ruby.ruby_gap_px;
            top
        };
        let baseline = frame_top + baseline_offset;
        let (mut rt_glyphs, rt_width) =
            shape_segment_run_horizontal(level, font_registry, fallback_registry, baseline, 0.0)?;
        for glyph in &mut rt_glyphs {
            glyph.decoration_level = Some(u32::try_from(index).unwrap_or(u32::MAX));
        }
        align_ruby_glyphs_horizontal(&mut rt_glyphs, rt_width, advance, ruby.ruby_align);
        let start = all_rt_glyphs.len();
        all_rt_glyphs.extend(rt_glyphs);
        level_ranges.push((side, start, all_rt_glyphs.len()));
    }

    let mut glyphs = base_glyphs;
    let base_end = glyphs.len();
    let level_ranges: Vec<(RubySide, usize, usize)> = level_ranges
        .into_iter()
        .map(|(side, start, end)| (side, start + base_end, end + base_end))
        .collect();
    glyphs.extend(all_rt_glyphs);
    mark_ruby_glyph_sources(&mut glyphs, base_end, &ruby.base);
    stabilize_ruby_ink_gaps(
        RubyInkPlacement {
            glyphs: &mut glyphs,
            base_end,
            level_ranges: &level_ranges,
            desired_gap: resolve_ruby_ink_gap_px(ruby),
            normalize_extent: stable_line_sizing,
            cross_size: &mut token_height,
            reference_offset: &mut base_baseline,
        },
        RubyInkBoundsContext {
            font_registry,
            fallback_registry,
            axis: RubyInkAxis::Horizontal,
        },
    );

    let (kinsoku_start, kinsoku_end) = segment_kinsoku_edges(&ruby.base);
    Some(LayoutToken {
        text: ruby
            .base
            .iter()
            .map(|segment| segment.text.as_str())
            .collect(),
        kinsoku_start,
        kinsoku_end,
        advance,
        cross_size: token_height,
        reference_offset: base_baseline,
        glyphs,
        inline_rects: Vec::new(),
        inline_box_decoration: None,
        nested_decorations: Vec::new(),
        decoration_span_id: None,
        decoration_start_advance: 0.0,
        decoration_end_advance: 0.0,
        flow_ruby: Some(build_flow_ruby_annotation(ruby)),
        trailing_tracking_px: 0.0,
    })
}

/// Per-child cross-axis metrics used to compute the `InlineBox` token's
/// final `reference_offset` and `cross_size`, then re-align all glyphs.
struct ChildCrossMetrics {
    reference_offset: f64,
    after_reference: f64,
    glyph_start: usize,
}

fn build_horizontal_atomic_decorated_span_token(
    dspan: &RichDecoratedSpan,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    build_horizontal_atomic_decorated_token(
        &dspan.children,
        dspan.padding_inline,
        dspan.border_width,
        dspan.background.clone(),
        dspan.border_color.clone(),
        dspan.border_radius,
        dspan.span_key.clone(),
        req,
        font_registry,
        fallback_registry,
        default_style,
    )
}

fn build_vertical_atomic_decorated_span_token(
    dspan: &RichDecoratedSpan,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    build_vertical_atomic_decorated_token(
        &dspan.children,
        dspan.padding_inline,
        dspan.border_width,
        dspan.background.clone(),
        dspan.border_color.clone(),
        dspan.border_radius,
        dspan.span_key.clone(),
        req,
        font_registry,
        fallback_registry,
        default_style,
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "atomic decoration builder keeps geometry inputs explicit"
)]
fn build_horizontal_atomic_decorated_token(
    children: &[RichInlineNode],
    padding_inline: [f64; 2],
    border_width: f64,
    background: Option<String>,
    border_color: Option<String>,
    border_radius: Option<[f64; 4]>,
    span_key: Option<String>,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    build_atomic_box_token_inner(
        children,
        padding_inline,
        border_width,
        background,
        border_color,
        border_radius,
        span_key,
        false,
        req,
        font_registry,
        fallback_registry,
        default_style,
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "atomic decoration builder keeps geometry inputs explicit"
)]
fn build_vertical_atomic_decorated_token(
    children: &[RichInlineNode],
    padding_inline: [f64; 2],
    border_width: f64,
    background: Option<String>,
    border_color: Option<String>,
    border_radius: Option<[f64; 4]>,
    span_key: Option<String>,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    build_atomic_box_token_inner(
        children,
        padding_inline,
        border_width,
        background,
        border_color,
        border_radius,
        span_key,
        true,
        req,
        font_registry,
        fallback_registry,
        default_style,
    )
}

fn build_horizontal_inline_box_token(
    ibox: &RichInlineBox,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    build_atomic_box_token_inner(
        &ibox.children,
        ibox.padding_inline,
        ibox.border_width,
        ibox.background.clone(),
        ibox.border_color.clone(),
        ibox.border_radius.map(|r| [r, r, r, r]),
        ibox.span_key.clone(),
        false,
        req,
        font_registry,
        fallback_registry,
        default_style,
    )
}

fn build_vertical_inline_box_token(
    ibox: &RichInlineBox,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    build_atomic_box_token_inner(
        &ibox.children,
        ibox.padding_inline,
        ibox.border_width,
        ibox.background.clone(),
        ibox.border_color.clone(),
        ibox.border_radius.map(|r| [r, r, r, r]),
        ibox.span_key.clone(),
        true,
        req,
        font_registry,
        fallback_registry,
        default_style,
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "atomic segment shaping keeps direction and geometry inputs explicit"
)]
fn shape_atomic_box_segment(
    segment: &RichSegment,
    is_vertical: bool,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
    reference_offset: f64,
    after_reference: f64,
    cursor: f64,
) -> Option<(Vec<PositionedGlyph>, f64, f64, f64)> {
    if is_vertical && segment.combine {
        let combine_token = build_vertical_combine_token(
            segment,
            req,
            font_registry,
            fallback_registry,
            default_style,
        )?;
        let combine_reference_offset = combine_token.reference_offset;
        let combine_after_reference = combine_token.cross_size - combine_reference_offset;
        let mut combine_glyphs = combine_token.glyphs;
        shift_glyphs_y(&mut combine_glyphs, cursor);
        return Some((
            combine_glyphs,
            combine_token.advance,
            combine_reference_offset,
            combine_after_reference,
        ));
    }

    let (run_glyphs, run_advance) = if is_vertical {
        shape_segment_run_vertical(
            std::slice::from_ref(segment),
            font_registry,
            fallback_registry,
            reference_offset,
            cursor,
        )?
    } else {
        shape_segment_run_horizontal(
            std::slice::from_ref(segment),
            font_registry,
            fallback_registry,
            reference_offset,
            cursor,
        )?
    };
    Some((run_glyphs, run_advance, reference_offset, after_reference))
}

// Shared inner helper for `InlineBox` and atomic `DecoratedSpan` token
// building. Handles child-node traversal, direction-dependent shaping
// dispatch, and cross-axis realignment.
#[expect(
    clippy::too_many_arguments,
    reason = "atomic decoration builder keeps geometry inputs explicit"
)]
fn build_atomic_box_token_inner(
    children: &[RichInlineNode],
    padding_inline: [f64; 2],
    border_width: f64,
    background: Option<String>,
    border_color: Option<String>,
    border_radius: Option<[f64; 4]>,
    span_key: Option<String>,
    is_vertical: bool,
    req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    let default_metrics =
        resolve_style_line_metrics(font_registry, fallback_registry, default_style);
    let base_measure = default_metrics.line_height_px;
    let (base_ref, base_after) = if is_vertical {
        (base_measure * 0.5, base_measure * 0.5)
    } else {
        (
            default_metrics.baseline_offset_px,
            base_measure - default_metrics.baseline_offset_px,
        )
    };
    let content_offset = padding_inline[0] + border_width;

    let mut glyphs = Vec::new();
    let mut cursor = content_offset;
    let mut text = String::new();
    let mut child_metrics: Vec<ChildCrossMetrics> = Vec::new();
    let mut nested_decorations: Vec<NestedInlineBoxDecoration> = Vec::new();
    let mut inline_rects: Vec<NestedInlineRect> = Vec::new();
    let mut kinsoku_start = None;
    let mut kinsoku_end = None;

    for child in children {
        match child {
            RichInlineNode::Segment(seg) => {
                let (child_start, child_end) = segment_kinsoku_edges(std::slice::from_ref(seg));
                extend_kinsoku_edges(&mut kinsoku_start, &mut kinsoku_end, child_start, child_end);
                let glyph_start = glyphs.len();
                let (seg_glyphs, seg_advance, reference_offset, after_reference) =
                    shape_atomic_box_segment(
                        seg,
                        is_vertical,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                        base_ref,
                        base_after,
                        cursor,
                    )?;
                glyphs.extend(seg_glyphs);
                cursor += seg_advance;
                text.push_str(&seg.text);
                child_metrics.push(ChildCrossMetrics {
                    reference_offset,
                    after_reference,
                    glyph_start,
                });
            }
            RichInlineNode::Ruby(ruby) => {
                let glyph_start = glyphs.len();
                let ruby_token = if is_vertical {
                    build_vertical_ruby_token(
                        ruby,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?
                } else {
                    build_horizontal_ruby_token(
                        ruby,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?
                };
                extend_kinsoku_edges(
                    &mut kinsoku_start,
                    &mut kinsoku_end,
                    ruby_token.kinsoku_start,
                    ruby_token.kinsoku_end,
                );
                let mut ruby_glyphs = ruby_token.glyphs;
                if is_vertical {
                    shift_glyphs_y(&mut ruby_glyphs, cursor);
                } else {
                    shift_glyphs_x(&mut ruby_glyphs, cursor);
                }
                glyphs.extend(ruby_glyphs);
                cursor += ruby_token.advance;
                text.push_str(&ruby_token.text);
                child_metrics.push(ChildCrossMetrics {
                    reference_offset: ruby_token.reference_offset,
                    after_reference: ruby_token.cross_size - ruby_token.reference_offset,
                    glyph_start,
                });
            }
            RichInlineNode::InlineRect(rect) => {
                let glyph_start = glyphs.len();
                let rect_token =
                    build_inline_rect_token(rect, font_registry, fallback_registry, is_vertical);
                let child_start = cursor;
                cursor += rect_token.advance;
                inline_rects.extend(rect_token.inline_rects.into_iter().map(|mut nested_rect| {
                    nested_rect.offset += child_start;
                    nested_rect
                }));
                child_metrics.push(ChildCrossMetrics {
                    reference_offset: rect_token.reference_offset,
                    after_reference: rect_token.cross_size - rect_token.reference_offset,
                    glyph_start,
                });
            }
            RichInlineNode::InlineBox(nested) => {
                let glyph_start = glyphs.len();
                let nested_token = if is_vertical {
                    build_vertical_inline_box_token(
                        nested,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?
                } else {
                    build_horizontal_inline_box_token(
                        nested,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?
                };
                extend_kinsoku_edges(
                    &mut kinsoku_start,
                    &mut kinsoku_end,
                    nested_token.kinsoku_start,
                    nested_token.kinsoku_end,
                );
                let child_start = cursor;
                let mut nested_glyphs = nested_token.glyphs;
                if is_vertical {
                    shift_glyphs_y(&mut nested_glyphs, cursor);
                } else {
                    shift_glyphs_x(&mut nested_glyphs, cursor);
                }
                glyphs.extend(nested_glyphs);
                cursor += nested_token.advance;
                text.push_str(&nested_token.text);
                child_metrics.push(ChildCrossMetrics {
                    reference_offset: nested_token.reference_offset,
                    after_reference: nested_token.cross_size - nested_token.reference_offset,
                    glyph_start,
                });
                if let Some(deco) = nested_token.inline_box_decoration {
                    nested_decorations.push(NestedInlineBoxDecoration {
                        offset: cursor - nested_token.advance,
                        decoration: deco,
                    });
                }
                for mut nd in nested_token.nested_decorations {
                    nd.offset += cursor - nested_token.advance;
                    nested_decorations.push(nd);
                }
                for mut nested_rect in nested_token.inline_rects {
                    nested_rect.offset += child_start;
                    inline_rects.push(nested_rect);
                }
            }
            RichInlineNode::DecoratedSpan(nested) => {
                let glyph_start = glyphs.len();
                let nested_token = if is_vertical {
                    build_vertical_atomic_decorated_span_token(
                        nested,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?
                } else {
                    build_horizontal_atomic_decorated_span_token(
                        nested,
                        req,
                        font_registry,
                        fallback_registry,
                        default_style,
                    )?
                };
                extend_kinsoku_edges(
                    &mut kinsoku_start,
                    &mut kinsoku_end,
                    nested_token.kinsoku_start,
                    nested_token.kinsoku_end,
                );
                let child_start = cursor;
                let mut nested_glyphs = nested_token.glyphs;
                if is_vertical {
                    shift_glyphs_y(&mut nested_glyphs, cursor);
                } else {
                    shift_glyphs_x(&mut nested_glyphs, cursor);
                }
                glyphs.extend(nested_glyphs);
                cursor += nested_token.advance;
                text.push_str(&nested_token.text);
                child_metrics.push(ChildCrossMetrics {
                    reference_offset: nested_token.reference_offset,
                    after_reference: nested_token.cross_size - nested_token.reference_offset,
                    glyph_start,
                });
                if let Some(deco) = nested_token.inline_box_decoration {
                    nested_decorations.push(NestedInlineBoxDecoration {
                        offset: cursor - nested_token.advance,
                        decoration: deco,
                    });
                }
                for mut nd in nested_token.nested_decorations {
                    nd.offset += cursor - nested_token.advance;
                    nested_decorations.push(nd);
                }
                for mut nested_rect in nested_token.inline_rects {
                    nested_rect.offset += child_start;
                    inline_rects.push(nested_rect);
                }
            }
        }
    }

    let (cross_size, reference_offset) = if child_metrics.is_empty() {
        (base_measure, base_ref)
    } else {
        let final_ref = child_metrics
            .iter()
            .map(|m| m.reference_offset)
            .fold(0.0_f64, f64::max);
        let final_after = child_metrics
            .iter()
            .map(|m| m.after_reference)
            .fold(0.0_f64, f64::max);

        let next_starts: Vec<usize> = child_metrics
            .iter()
            .skip(1)
            .map(|m| m.glyph_start)
            .chain(std::iter::once(glyphs.len()))
            .collect();
        for (metrics, &end) in child_metrics.iter().zip(next_starts.iter()) {
            let delta = final_ref - metrics.reference_offset;
            if delta.abs() > f64::EPSILON {
                if is_vertical {
                    shift_glyphs_x(&mut glyphs[metrics.glyph_start..end], delta);
                } else {
                    shift_glyphs_y(&mut glyphs[metrics.glyph_start..end], delta);
                }
            }
        }

        (final_ref + final_after, final_ref)
    };

    let children_advance = cursor - content_offset;
    let reserved = padding_inline[0] + padding_inline[1] + border_width * 2.0;
    let total_advance = children_advance + reserved;

    Some(LayoutToken {
        text,
        kinsoku_start,
        kinsoku_end,
        advance: total_advance,
        cross_size,
        reference_offset,
        glyphs,
        inline_rects,
        inline_box_decoration: Some(InlineBoxDecorationInput {
            total_advance,
            cross_size,
            background,
            border_color,
            border_width: if border_width > 0.0 {
                Some(border_width)
            } else {
                None
            },
            border_radius,
            span_key,
        }),
        nested_decorations,
        decoration_span_id: None,
        decoration_start_advance: 0.0,
        decoration_end_advance: 0.0,
        flow_ruby: None,
        trailing_tracking_px: 0.0,
    })
}

fn build_vertical_ruby_token(
    ruby: &RichRuby,
    _req: &TextLayoutRequest,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    _default_style: &ResolvedStyle,
) -> Option<LayoutToken> {
    let base_lane_width =
        resolve_segments_line_box_metrics(font_registry, fallback_registry, &ruby.base)
            .line_height_px;
    let base_frame_width = resolve_segments_max_font_size(&ruby.base).max(1.0);
    let base_leading = (base_lane_width - base_frame_width).max(0.0);
    let level_measures: Vec<(RubySide, f64, f64)> = ruby
        .rt_levels
        .iter()
        .enumerate()
        .map(|(index, level)| {
            (
                ruby_side_for_level(ruby.ruby_position, index),
                resolve_segments_ruby_line_box_metrics(font_registry, fallback_registry, level)
                    .box_measure_px,
                resolve_segments_ruby_line_box_metrics(font_registry, fallback_registry, level)
                    .center_offset_px,
            )
        })
        .collect();
    let left_extent = ruby_stack_extent(
        &level_measures,
        RubySide::Under,
        ruby.ruby_gap_px,
        ruby.ruby_offset_px,
    );
    let right_extent = ruby_stack_extent(
        &level_measures,
        RubySide::Over,
        ruby.ruby_gap_px,
        ruby.ruby_offset_px,
    );
    let stable_line_sizing = ruby.ruby_line_sizing == RubyLineSizing::Stable;
    let (mut cross_size, base_line_left) = if stable_line_sizing {
        (left_extent + base_lane_width + right_extent, left_extent)
    } else {
        let (resolved_cross_size, base_center) = resolve_vertical_css_ruby_line_box(
            base_lane_width,
            base_frame_width,
            left_extent,
            right_extent,
        );
        (
            resolved_cross_size,
            base_center - base_leading * 0.5 - base_frame_width * 0.5,
        )
    };
    let base_frame_left = base_line_left + base_leading * 0.5;
    let base_frame_right = base_frame_left + base_frame_width;
    let mut base_center_x = base_frame_left + base_frame_width * 0.5;

    let (base_glyphs, base_height) = shape_segment_run_vertical(
        &ruby.base,
        font_registry,
        fallback_registry,
        base_center_x,
        0.0,
    )?;

    let advance = base_height;
    let mut over_distance = ruby.ruby_gap_px + ruby.ruby_offset_px;
    let mut under_distance = ruby.ruby_gap_px + ruby.ruby_offset_px;
    let mut all_rt_glyphs = Vec::new();
    let mut level_ranges = Vec::with_capacity(ruby.rt_levels.len());
    for (index, level) in ruby.rt_levels.iter().enumerate() {
        let side = level_measures[index].0;
        let box_width = level_measures[index].1;
        let position_width = level_measures[index].2;
        let leading = (box_width - position_width).max(0.0) * 0.5;
        let frame_left = if side == RubySide::Over {
            let left = base_frame_right + over_distance;
            over_distance += box_width + ruby.ruby_gap_px;
            left
        } else {
            let left = base_frame_left - under_distance - box_width;
            under_distance += box_width + ruby.ruby_gap_px;
            left
        };
        let rt_center_x = frame_left + leading + position_width * 0.5;
        let (mut rt_glyphs, rt_height) =
            shape_segment_run_vertical(level, font_registry, fallback_registry, rt_center_x, 0.0)?;
        for glyph in &mut rt_glyphs {
            glyph.decoration_level = Some(u32::try_from(index).unwrap_or(u32::MAX));
        }
        align_ruby_glyphs_vertical(&mut rt_glyphs, rt_height, advance, ruby.ruby_align);
        let start = all_rt_glyphs.len();
        all_rt_glyphs.extend(rt_glyphs);
        level_ranges.push((side, start, all_rt_glyphs.len()));
    }

    let mut glyphs = base_glyphs;
    let base_end = glyphs.len();
    let level_ranges: Vec<(RubySide, usize, usize)> = level_ranges
        .into_iter()
        .map(|(side, start, end)| (side, start + base_end, end + base_end))
        .collect();
    glyphs.extend(all_rt_glyphs);
    mark_ruby_glyph_sources(&mut glyphs, base_end, &ruby.base);
    stabilize_ruby_ink_gaps(
        RubyInkPlacement {
            glyphs: &mut glyphs,
            base_end,
            level_ranges: &level_ranges,
            desired_gap: resolve_ruby_ink_gap_px(ruby),
            normalize_extent: stable_line_sizing,
            cross_size: &mut cross_size,
            reference_offset: &mut base_center_x,
        },
        RubyInkBoundsContext {
            font_registry,
            fallback_registry,
            axis: RubyInkAxis::Vertical,
        },
    );

    let (kinsoku_start, kinsoku_end) = segment_kinsoku_edges(&ruby.base);
    Some(LayoutToken {
        text: ruby
            .base
            .iter()
            .map(|segment| segment.text.as_str())
            .collect(),
        kinsoku_start,
        kinsoku_end,
        advance,
        cross_size,
        reference_offset: base_center_x,
        glyphs,
        inline_rects: Vec::new(),
        inline_box_decoration: None,
        nested_decorations: Vec::new(),
        decoration_span_id: None,
        decoration_start_advance: 0.0,
        decoration_end_advance: 0.0,
        flow_ruby: Some(build_flow_ruby_annotation(ruby)),
        trailing_tracking_px: 0.0,
    })
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "ruby base grapheme count is well within u32::MAX"
)]
fn mark_ruby_glyph_sources(glyphs: &mut [PositionedGlyph], base_end: usize, base: &[RichSegment]) {
    let base_grapheme_count = base
        .iter()
        .map(|segment| grapheme_split(&segment.text).len())
        .sum::<usize>() as u32;
    for glyph in &mut glyphs[..base_end] {
        glyph.source_role = Some("rubyBase".to_string());
    }
    for glyph in &mut glyphs[base_end..] {
        glyph.source_start = Some(0);
        glyph.source_end = Some(base_grapheme_count);
        glyph.source_role = Some("rubyAnnotation".to_string());
    }
}

fn align_ruby_glyphs_horizontal(
    glyphs: &mut [PositionedGlyph],
    current_advance: f64,
    target_advance: f64,
    ruby_align: RubyAlign,
) {
    let delta = target_advance - current_advance;
    if delta.abs() <= f64::EPSILON || glyphs.is_empty() {
        return;
    }

    let cluster_ranges = positioned_glyph_cluster_ranges(glyphs);
    match ruby_align {
        RubyAlign::Start => {}
        RubyAlign::SpaceBetween if cluster_ranges.len() > 1 => {
            let steps = (cluster_ranges.len() - 1) as f64;
            for (index, (start, end)) in cluster_ranges.into_iter().enumerate() {
                shift_glyphs_x(&mut glyphs[start..end], delta * (index as f64 / steps));
            }
        }
        RubyAlign::SpaceAround => {
            let count = cluster_ranges.len() as f64;
            for (index, (start, end)) in cluster_ranges.into_iter().enumerate() {
                shift_glyphs_x(
                    &mut glyphs[start..end],
                    delta * ((index as f64 + 0.5) / count),
                );
            }
        }
        RubyAlign::Center | RubyAlign::SpaceBetween => shift_glyphs_x(glyphs, delta * 0.5),
    }
}

fn align_ruby_glyphs_vertical(
    glyphs: &mut [PositionedGlyph],
    current_advance: f64,
    target_advance: f64,
    ruby_align: RubyAlign,
) {
    let delta = target_advance - current_advance;
    if delta.abs() <= f64::EPSILON || glyphs.is_empty() {
        return;
    }

    let cluster_ranges = positioned_glyph_cluster_ranges(glyphs);
    match ruby_align {
        RubyAlign::Start => {}
        RubyAlign::SpaceBetween if cluster_ranges.len() > 1 => {
            let steps = (cluster_ranges.len() - 1) as f64;
            for (index, (start, end)) in cluster_ranges.into_iter().enumerate() {
                shift_glyphs_y(&mut glyphs[start..end], delta * (index as f64 / steps));
            }
        }
        RubyAlign::SpaceAround => {
            let count = cluster_ranges.len() as f64;
            for (index, (start, end)) in cluster_ranges.into_iter().enumerate() {
                shift_glyphs_y(
                    &mut glyphs[start..end],
                    delta * ((index as f64 + 0.5) / count),
                );
            }
        }
        RubyAlign::Center | RubyAlign::SpaceBetween => shift_glyphs_y(glyphs, delta * 0.5),
    }
}

fn positioned_glyph_cluster_ranges(glyphs: &[PositionedGlyph]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut start = 0;
    while start < glyphs.len() {
        let cluster = (glyphs[start].cluster_start, glyphs[start].cluster_end);
        let mut end = start + 1;
        while end < glyphs.len() && (glyphs[end].cluster_start, glyphs[end].cluster_end) == cluster
        {
            end += 1;
        }
        ranges.push((start, end));
        start = end;
    }
    ranges
}

fn stabilize_ruby_ink_gaps(placement: RubyInkPlacement<'_>, context: RubyInkBoundsContext<'_>) {
    let glyphs = placement.glyphs;
    let Some(base_bounds) = glyphs_ink_bounds(&glyphs[..placement.base_end], &context) else {
        return;
    };
    let mut over_inner = base_bounds;
    let mut under_inner = base_bounds;

    for &(side, start, end) in placement.level_ranges {
        if start >= end || end > glyphs.len() {
            continue;
        }
        let inner_bounds = if side == RubySide::Over {
            over_inner
        } else {
            under_inner
        };
        let Some(mut level_bounds) = glyphs_ink_bounds(&glyphs[start..end], &context) else {
            continue;
        };
        let axis_shift = ruby_ink_gap_shift(
            context.axis,
            side,
            inner_bounds,
            level_bounds,
            placement.desired_gap,
        );
        if axis_shift.abs() > f64::EPSILON {
            match context.axis {
                RubyInkAxis::Horizontal => {
                    shift_glyphs_y(&mut glyphs[start..end], axis_shift);
                    level_bounds = shift_bounds_y(level_bounds, axis_shift);
                }
                RubyInkAxis::Vertical => {
                    shift_glyphs_x(&mut glyphs[start..end], axis_shift);
                    level_bounds = shift_bounds_x(level_bounds, axis_shift);
                }
            }
        }
        if side == RubySide::Over {
            over_inner = level_bounds;
        } else {
            under_inner = level_bounds;
        }
    }

    if placement.normalize_extent {
        normalize_ruby_ink_extent(
            glyphs,
            &context,
            placement.cross_size,
            placement.reference_offset,
        );
    }
}

fn ruby_ink_gap_shift(
    axis: RubyInkAxis,
    side: RubySide,
    inner_bounds: GlyphInkBounds,
    level_bounds: GlyphInkBounds,
    desired_gap: f64,
) -> f64 {
    match (axis, side) {
        (RubyInkAxis::Horizontal, RubySide::Over) => {
            let current_gap = inner_bounds.min_y - level_bounds.max_y;
            if current_gap < desired_gap {
                -(desired_gap - current_gap)
            } else {
                0.0
            }
        }
        (RubyInkAxis::Horizontal, RubySide::Under) => {
            let current_gap = level_bounds.min_y - inner_bounds.max_y;
            if current_gap < desired_gap {
                desired_gap - current_gap
            } else {
                0.0
            }
        }
        (RubyInkAxis::Vertical, RubySide::Over) => {
            let current_gap = level_bounds.min_x - inner_bounds.max_x;
            if current_gap < desired_gap {
                desired_gap - current_gap
            } else {
                0.0
            }
        }
        (RubyInkAxis::Vertical, RubySide::Under) => {
            let current_gap = inner_bounds.min_x - level_bounds.max_x;
            if current_gap < desired_gap {
                -(desired_gap - current_gap)
            } else {
                0.0
            }
        }
    }
}

fn normalize_ruby_ink_extent(
    glyphs: &mut [PositionedGlyph],
    context: &RubyInkBoundsContext<'_>,
    cross_size: &mut f64,
    reference_offset: &mut f64,
) {
    let Some(mut bounds) = glyphs_ink_bounds(glyphs, context) else {
        return;
    };
    match context.axis {
        RubyInkAxis::Horizontal => {
            if bounds.min_y < 0.0 {
                let shift = -bounds.min_y;
                shift_glyphs_y(glyphs, shift);
                *reference_offset += shift;
                *cross_size += shift;
                bounds = shift_bounds_y(bounds, shift);
            }
            if bounds.max_y > *cross_size {
                *cross_size = bounds.max_y;
            }
        }
        RubyInkAxis::Vertical => {
            if bounds.min_x < 0.0 {
                let shift = -bounds.min_x;
                shift_glyphs_x(glyphs, shift);
                *reference_offset += shift;
                *cross_size += shift;
                bounds = shift_bounds_x(bounds, shift);
            }
            if bounds.max_x > *cross_size {
                *cross_size = bounds.max_x;
            }
        }
    }
}

fn glyphs_ink_bounds(
    glyphs: &[PositionedGlyph],
    context: &RubyInkBoundsContext<'_>,
) -> Option<GlyphInkBounds> {
    let mut bounds = None;
    for glyph in glyphs {
        let Some(glyph_bounds) = positioned_glyph_ink_bounds(glyph, context) else {
            continue;
        };
        bounds = Some(match bounds {
            Some(current) => union_bounds(current, glyph_bounds),
            None => glyph_bounds,
        });
    }
    bounds
}

fn positioned_glyph_ink_bounds(
    glyph: &PositionedGlyph,
    context: &RubyInkBoundsContext<'_>,
) -> Option<GlyphInkBounds> {
    let glyph_id = u16::try_from(glyph.glyph_id).ok()?;
    let font_size_px = glyph.font_size_px?;
    let (font_entry, registry) = resolve_positioned_glyph_font(glyph, context)?;
    let variation_settings = glyph
        .font_variation_settings
        .as_deref()
        .map(parse_css_font_variation_settings)
        .unwrap_or_default();
    let variations = shaping::to_shape_variations(&variation_settings);
    let face = font_entry.font_face(registry.backend(), &variations)?;
    let bbox = face.glyph_bounding_box(glyph_id)?;
    let scale = font_size_px / f64::from(face.units_per_em());

    let corners = [
        (f64::from(bbox.x_min), f64::from(bbox.y_min)),
        (f64::from(bbox.x_min), f64::from(bbox.y_max)),
        (f64::from(bbox.x_max), f64::from(bbox.y_min)),
        (f64::from(bbox.x_max), f64::from(bbox.y_max)),
    ];
    let mut bounds = None;
    for (x, y) in corners {
        let (point_x, point_y) = transform_glyph_bbox_point(
            glyph,
            face.as_ref(),
            glyph_id,
            bbox,
            scale,
            (x, y),
            context.axis,
        );
        let point_bounds = GlyphInkBounds {
            min_x: point_x,
            max_x: point_x,
            min_y: point_y,
            max_y: point_y,
        };
        bounds = Some(match bounds {
            Some(current) => union_bounds(current, point_bounds),
            None => point_bounds,
        });
    }
    bounds
}

fn resolve_positioned_glyph_font<'a>(
    glyph: &PositionedGlyph,
    context: &RubyInkBoundsContext<'a>,
) -> Option<(&'a FontEntry, &'a FontRegistry)> {
    if let Some(entry) =
        context
            .font_registry
            .resolve(&glyph.font_alias, glyph.font_weight, &glyph.font_style)
    {
        return Some((entry, context.font_registry));
    }
    let fallback_registry = context.fallback_registry?;
    fallback_registry
        .resolve(&glyph.font_alias, glyph.font_weight, &glyph.font_style)
        .map(|entry| (entry, fallback_registry))
}

fn transform_glyph_bbox_point(
    glyph: &PositionedGlyph,
    face: &dyn FontFace,
    glyph_id: u16,
    bbox: GlyphBBox,
    scale: f64,
    point: (f64, f64),
    axis: RubyInkAxis,
) -> (f64, f64) {
    let (x, y) = point;
    let (shift_x, shift_y) = match axis {
        RubyInkAxis::Horizontal => (0.0, 0.0),
        RubyInkAxis::Vertical => vertical_glyph_outline_shift(glyph, face, glyph_id, bbox, scale),
    };
    let transformed_x = glyph.origin_x + x * scale + shift_x;
    let transformed_y = glyph.origin_y - y * scale + shift_y;
    if matches!(axis, RubyInkAxis::Vertical) && glyph.rotation_deg == 90 {
        let dx = transformed_x - glyph.origin_x;
        let dy = transformed_y - glyph.origin_y;
        (glyph.origin_x - dy, glyph.origin_y + dx)
    } else {
        (transformed_x, transformed_y)
    }
}

fn vertical_glyph_outline_shift(
    glyph: &PositionedGlyph,
    face: &dyn FontFace,
    glyph_id: u16,
    bbox: GlyphBBox,
    scale: f64,
) -> (f64, f64) {
    if glyph.rotation_deg == 90 {
        let center_x = (f64::from(bbox.x_min) + f64::from(bbox.x_max)) * 0.5 * scale;
        let font_center_y = face
            .typographic_ascender()
            .map_or(f64::from(face.ascender()), f64::from)
            .mul_add(
                0.5,
                face.typographic_descender()
                    .map_or(f64::from(face.descender()), f64::from)
                    * 0.5,
            )
            * scale;
        (-center_x, font_center_y)
    } else {
        (
            face.glyph_hor_advance(glyph_id)
                .map_or(-glyph.font_size_px.unwrap_or(0.0) * 0.5, |advance| {
                    -(f64::from(advance) * scale * 0.5)
                }),
            0.0,
        )
    }
}

fn union_bounds(left: GlyphInkBounds, right: GlyphInkBounds) -> GlyphInkBounds {
    GlyphInkBounds {
        min_x: left.min_x.min(right.min_x),
        max_x: left.max_x.max(right.max_x),
        min_y: left.min_y.min(right.min_y),
        max_y: left.max_y.max(right.max_y),
    }
}

fn shift_bounds_x(bounds: GlyphInkBounds, shift: f64) -> GlyphInkBounds {
    GlyphInkBounds {
        min_x: bounds.min_x + shift,
        max_x: bounds.max_x + shift,
        ..bounds
    }
}

fn shift_bounds_y(bounds: GlyphInkBounds, shift: f64) -> GlyphInkBounds {
    GlyphInkBounds {
        min_y: bounds.min_y + shift,
        max_y: bounds.max_y + shift,
        ..bounds
    }
}

fn ruby_side_for_level(position: RubyPosition, level_index: usize) -> RubySide {
    match position {
        RubyPosition::Under => RubySide::Under,
        RubyPosition::Over | RubyPosition::InterCharacter => RubySide::Over,
        RubyPosition::Alternate => {
            if level_index % 2 == 0 {
                RubySide::Over
            } else {
                RubySide::Under
            }
        }
    }
}

fn ruby_stack_extent(
    level_measures: &[(RubySide, f64, f64)],
    side: RubySide,
    gap_px: f64,
    offset_px: f64,
) -> f64 {
    let level_count = level_measures
        .iter()
        .filter(|(level_side, _, _)| *level_side == side)
        .count();
    if level_count == 0 {
        return 0.0;
    }
    let box_total = level_measures
        .iter()
        .filter(|(level_side, _, _)| *level_side == side)
        .map(|(_, box_measure, _)| *box_measure)
        .sum::<f64>();
    (box_total + gap_px * level_count as f64).max(0.0) + offset_px.max(0.0)
}

fn resolve_css_ruby_base_origin(default_origin: f64, min_origin: f64, max_origin: f64) -> f64 {
    let lower = min_origin.max(0.0);
    if lower <= max_origin {
        default_origin.clamp(lower, max_origin)
    } else {
        lower
    }
}

/// Resolve the CSS-like horizontal ruby line box used by both rich text and
/// legacy flow spans. The annotation consumes existing half-leading first and
/// expands the line only when the base frame plus ruby frames cannot fit.
pub(crate) fn resolve_horizontal_css_ruby_line_box(
    base_line_height_px: f64,
    base_baseline_offset_px: f64,
    base_ascent_px: f64,
    base_descent_px: f64,
    over_extent: f64,
    under_extent: f64,
) -> (f64, f64) {
    let base_frame_height = (base_ascent_px + base_descent_px).max(1.0);
    let cross_size = base_line_height_px.max(over_extent + base_frame_height + under_extent);
    let frame_top_at_origin = base_baseline_offset_px - base_ascent_px;
    let frame_bottom_at_origin = base_baseline_offset_px + base_descent_px;
    let base_line_top = resolve_css_ruby_base_origin(
        0.0,
        over_extent - frame_top_at_origin,
        cross_size - frame_bottom_at_origin - under_extent,
    );
    (cross_size, base_line_top + base_baseline_offset_px)
}

/// Vertical counterpart of [`resolve_horizontal_css_ruby_line_box`]. `left`
/// is the under side and `right` is the over side in vertical-rl writing.
pub(crate) fn resolve_vertical_css_ruby_line_box(
    base_lane_width: f64,
    base_frame_width: f64,
    left_extent: f64,
    right_extent: f64,
) -> (f64, f64) {
    let cross_size = base_lane_width.max(left_extent + base_frame_width + right_extent);
    let base_leading = (base_lane_width - base_frame_width).max(0.0);
    let frame_left_at_origin = base_leading * 0.5;
    let frame_right_at_origin = frame_left_at_origin + base_frame_width;
    let base_line_left = resolve_css_ruby_base_origin(
        0.0,
        left_extent - frame_left_at_origin,
        cross_size - frame_right_at_origin - right_extent,
    );
    (
        cross_size,
        base_line_left + frame_left_at_origin + base_frame_width * 0.5,
    )
}

fn resolve_ruby_ink_gap_px(ruby: &RichRuby) -> f64 {
    let requested_gap = ruby.ruby_gap_px + ruby.ruby_offset_px;
    if requested_gap < 0.0 {
        requested_gap
    } else {
        requested_gap.max(resolve_ruby_min_ink_gap_px(ruby))
    }
}

fn resolve_ruby_min_ink_gap_px(ruby: &RichRuby) -> f64 {
    ruby.rt_levels
        .iter()
        .flatten()
        .map(|segment| ruby_min_ink_gap_px(segment.style.font_size_px))
        .fold(0.0_f64, f64::max)
}

fn resolve_style_line_metrics(
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    style: &ResolvedStyle,
) -> LineMetrics {
    resolve_line_metrics_for_style(
        font_registry,
        fallback_registry,
        &style.font_families,
        style.font_weight,
        &style.font_style,
        style.font_size_px,
        style.line_height,
        style.line_height_px,
    )
}

fn resolve_segments_line_box_metrics(
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    segments: &[RichSegment],
) -> InlineLineBoxMetrics {
    let mut before_reference = 0.0_f64;
    let mut after_reference = 0.0_f64;
    let mut ascent = 0.0_f64;
    let mut descent = 0.0_f64;
    for segment in segments {
        let metrics = resolve_style_line_metrics(font_registry, fallback_registry, &segment.style);
        before_reference = before_reference.max(metrics.baseline_offset_px);
        after_reference = after_reference.max(metrics.line_height_px - metrics.baseline_offset_px);
        ascent = ascent.max(metrics.ascent_px);
        descent = descent.max(metrics.descent_px);
    }
    if before_reference == 0.0 && after_reference == 0.0 {
        return InlineLineBoxMetrics {
            line_height_px: 1.0,
            baseline_offset_px: 0.5,
            ascent_px: 0.5,
            descent_px: 0.5,
        };
    }
    InlineLineBoxMetrics {
        line_height_px: before_reference + after_reference,
        baseline_offset_px: before_reference,
        ascent_px: ascent.max(1.0),
        descent_px: descent.max(0.0),
    }
}

fn resolve_segments_max_font_size(segments: &[RichSegment]) -> f64 {
    segments
        .iter()
        .map(|segment| segment.style.font_size_px)
        .fold(0.0_f64, f64::max)
}

fn resolve_segments_ruby_line_box_metrics(
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    segments: &[RichSegment],
) -> RubyAnnotationLineBoxMetrics {
    let mut before_reference = 0.0_f64;
    let mut after_reference = 0.0_f64;
    for segment in segments {
        let metrics =
            resolve_ruby_annotation_line_metrics(font_registry, fallback_registry, &segment.style);
        before_reference = before_reference.max(metrics.baseline_offset_px);
        after_reference = after_reference.max(metrics.line_height_px - metrics.baseline_offset_px);
    }
    let box_measure = (before_reference + after_reference).max(1.0);
    let baseline_offset = if before_reference > 0.0 {
        before_reference
    } else {
        box_measure * 0.5
    };
    RubyAnnotationLineBoxMetrics {
        box_measure_px: box_measure,
        baseline_offset_px: baseline_offset,
        center_offset_px: box_measure * 0.5,
    }
}

fn resolve_ruby_annotation_line_metrics(
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    style: &ResolvedStyle,
) -> LineMetrics {
    resolve_line_metrics_for_style(
        font_registry,
        fallback_registry,
        &style.font_families,
        style.font_weight,
        &style.font_style,
        style.font_size_px,
        style.line_height.or(Some(1.0)),
        style.line_height_px,
    )
}

/// Frame gap (in px) between a ruby annotation and its base text.
///
/// `JaTypesettingV1` keeps the parent character frame and ruby frame touching
/// by default. Optical overlap is intentionally separated so this value can be
/// treated as the stable layout contract.
#[must_use]
pub fn ruby_gap_px(annotation_font_size_px: f64) -> f64 {
    ruby_frame_gap_px(annotation_font_size_px)
}

/// Stable ruby frame gap for the Japanese typesetting profile.
#[must_use]
pub fn ruby_frame_gap_px(_annotation_font_size_px: f64) -> f64 {
    0.0
}

/// Visual-only ruby overlap adjustment.
///
/// Keep this at zero for v0.1. If optical overlap is reintroduced later, it
/// must be opt-in or accompanied by a visual baseline update.
#[must_use]
pub fn ruby_optical_overlap_px(_annotation_font_size_px: f64) -> f64 {
    0.0
}

/// Minimum visible separation between base ink and ruby ink when the caller
/// does not intentionally request a negative offset.
#[must_use]
pub fn ruby_min_ink_gap_px(_annotation_font_size_px: f64) -> f64 {
    1.0
}

fn build_flow_ruby_annotation(ruby: &RichRuby) -> text_flow::FlowRubyAnnotation {
    let first_level: &[RichSegment] = ruby.rt_levels.first().map_or(&[], Vec::as_slice);
    let rt_style = ruby
        .rt_levels
        .first()
        .and_then(|level| level.first())
        .map_or(&ruby.base[0].style, |segment| &segment.style);
    let levels = ruby
        .rt_levels
        .iter()
        .enumerate()
        .map(|(level_index, level)| text_flow::FlowRubyAnnotationLevel {
            text: level.iter().map(|segment| segment.text.as_str()).collect(),
            position: match ruby_side_for_level(ruby.ruby_position, level_index) {
                RubySide::Over => "over".to_string(),
                RubySide::Under => "under".to_string(),
            },
            runs: level
                .iter()
                .map(|segment| text_flow::FlowRubyAnnotationRun {
                    text: segment.text.clone(),
                    style: flow_fragment_style_from_resolved(&segment.style),
                })
                .collect(),
        })
        .collect();
    text_flow::FlowRubyAnnotation {
        text: first_level
            .iter()
            .map(|segment| segment.text.as_str())
            .collect(),
        position: match ruby_side_for_level(ruby.ruby_position, 0) {
            RubySide::Over => "over".to_string(),
            RubySide::Under => "under".to_string(),
        },
        align: match ruby.ruby_align {
            RubyAlign::Start => "start".to_string(),
            RubyAlign::Center => "center".to_string(),
            RubyAlign::SpaceBetween => "space-between".to_string(),
            RubyAlign::SpaceAround => "space-around".to_string(),
        },
        style: flow_fragment_style_from_resolved(rt_style),
        gap_px: ruby.ruby_gap_px,
        offset_px: ruby.ruby_offset_px,
        line_sizing: match ruby.ruby_line_sizing {
            RubyLineSizing::Stable => "stable".to_string(),
            RubyLineSizing::Css => "css".to_string(),
        },
        levels,
    }
}

fn flow_fragment_style_from_resolved(style: &ResolvedStyle) -> text_flow::FlowFragmentStyle {
    text_flow::FlowFragmentStyle {
        font_family: style.font_families.first().cloned().unwrap_or_default(),
        font_weight: style.font_weight,
        font_style: match style.font_style {
            FontStyle::Italic => "italic".to_string(),
            FontStyle::Normal => "normal".to_string(),
        },
        font_size_px: style.font_size_px,
        letter_spacing_px: Some(style.letter_spacing_px),
        color: style.color.clone(),
    }
}

fn shape_segment_run_horizontal(
    segments: &[RichSegment],
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    baseline_y: f64,
    start_x: f64,
) -> Option<(Vec<PositionedGlyph>, f64)> {
    let mut glyphs = Vec::new();
    let mut cursor_x = start_x;
    let mut source_cursor = 0_u32;
    for (segment_index, segment) in segments.iter().enumerate() {
        let mut shaped = shape_text(
            font_registry,
            fallback_registry,
            &segment.style,
            &segment.text,
            false,
        )?;
        if segment_index + 1 < segments.len() && segment.style.letter_spacing_px != 0.0 {
            if let Some(last_glyph) = shaped.last_mut() {
                last_glyph.x_advance = crate::font::shaping::add_inline_tracking(
                    last_glyph.x_advance,
                    segment.style.letter_spacing_px,
                );
            }
        }
        let mut positioned = position_horizontal_glyphs(
            &segment.text,
            &shaped,
            &segment.style,
            cursor_x,
            baseline_y,
        );
        for glyph in &mut positioned {
            if let Some(source_start) = glyph.source_start.as_mut() {
                *source_start += source_cursor;
            }
            if let Some(source_end) = glyph.source_end.as_mut() {
                *source_end += source_cursor;
            }
            if let Some(source_start) = glyph.decoration_source_start.as_mut() {
                *source_start += source_cursor;
            }
            if let Some(source_end) = glyph.decoration_source_end.as_mut() {
                *source_end += source_cursor;
            }
        }
        source_cursor = source_cursor
            .saturating_add(u32::try_from(grapheme_split(&segment.text).len()).unwrap_or(u32::MAX));
        cursor_x += shaped.iter().map(|glyph| glyph.x_advance).sum::<f64>();
        glyphs.extend(positioned);
    }
    Some((glyphs, cursor_x - start_x))
}

fn shape_segment_run_vertical(
    segments: &[RichSegment],
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    center_x: f64,
    start_y: f64,
) -> Option<(Vec<PositionedGlyph>, f64)> {
    let mut glyphs = Vec::new();
    let mut cursor_y = start_y;
    let mut source_cursor = 0_u32;
    for (segment_index, segment) in segments.iter().enumerate() {
        let mut shaped = shape_text(
            font_registry,
            fallback_registry,
            &segment.style,
            &segment.text,
            true,
        )?;
        if segment_index + 1 < segments.len() && segment.style.letter_spacing_px != 0.0 {
            if let Some(last_glyph) = shaped.last_mut() {
                last_glyph.y_advance = crate::font::shaping::add_vertical_inline_tracking(
                    last_glyph.y_advance,
                    segment.style.letter_spacing_px,
                );
            }
        }
        let mut positioned =
            position_vertical_glyphs(&segment.text, &shaped, &segment.style, center_x, cursor_y);
        for glyph in &mut positioned {
            if let Some(source_start) = glyph.source_start.as_mut() {
                *source_start += source_cursor;
            }
            if let Some(source_end) = glyph.source_end.as_mut() {
                *source_end += source_cursor;
            }
            if let Some(source_start) = glyph.decoration_source_start.as_mut() {
                *source_start += source_cursor;
            }
            if let Some(source_end) = glyph.decoration_source_end.as_mut() {
                *source_end += source_cursor;
            }
        }
        source_cursor = source_cursor
            .saturating_add(u32::try_from(grapheme_split(&segment.text).len()).unwrap_or(u32::MAX));
        cursor_y += shaped.iter().map(glyph_advance_in_vertical).sum::<f64>();
        glyphs.extend(positioned);
    }
    Some((glyphs, cursor_y - start_y))
}

fn shape_text(
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    style: &ResolvedStyle,
    text: &str,
    vertical: bool,
) -> Option<Vec<GlyphInfo>> {
    if text.is_empty() {
        return Some(Vec::new());
    }

    let options = ShapeOptions {
        writing_mode: if vertical {
            Some("vertical-rl".to_string())
        } else {
            None
        },
        language: style.language.clone(),
        vertical_feature_priority: None,
        text_orientation: match style.text_orientation {
            TextOrientation::Upright => Some("upright".to_string()),
            TextOrientation::Mixed => None,
        },
        font_variation_settings: style
            .font_variation_settings
            .as_deref()
            .map(parse_css_font_variation_settings)
            .unwrap_or_default(),
        font_feature_settings: style
            .font_feature_settings
            .as_deref()
            .map(parse_css_font_feature_settings)
            .unwrap_or_default(),
    };

    let font_ctx = FontContext {
        registry: font_registry,
        fallback_registry,
        families: &style.font_families,
        weight: style.font_weight,
        style: &style.font_style,
    };

    if style.font_families.len() > 1 {
        let result = shaping::shape_with_fallback_and_options(
            &font_ctx,
            text,
            style.font_size_px,
            style.letter_spacing_px,
            &options,
        );
        if !result.glyphs.is_empty() {
            return Some(result.glyphs);
        }
        if let Some(fallback) = fallback_registry {
            let fallback_ctx = FontContext {
                registry: fallback,
                fallback_registry: None,
                families: &style.font_families,
                weight: style.font_weight,
                style: &style.font_style,
            };
            let result = shaping::shape_with_fallback_and_options(
                &fallback_ctx,
                text,
                style.font_size_px,
                style.letter_spacing_px,
                &options,
            );
            if !result.glyphs.is_empty() {
                return Some(result.glyphs);
            }
        }
    }

    let entry = resolve_font(
        font_registry,
        fallback_registry,
        &style.font_families,
        style.font_weight,
        &style.font_style,
    )?;
    Some(shaping::shape_text_with_options(
        font_registry,
        entry,
        text,
        style.font_size_px,
        style.letter_spacing_px,
        &options,
    ))
}

fn resolve_font<'a>(
    font_registry: &'a FontRegistry,
    fallback_registry: Option<&'a FontRegistry>,
    aliases: &[String],
    weight: u16,
    style: &FontStyle,
) -> Option<&'a crate::font::FontEntry> {
    if let Some(entry) = font_registry.resolve_chain(aliases, weight, style) {
        return Some(entry);
    }
    if let Some(fallback) = fallback_registry {
        return fallback.resolve_chain(aliases, weight, style);
    }
    None
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "byte offsets within text strings; text length is well within u32::MAX"
)]
fn position_horizontal_glyphs(
    text: &str,
    glyphs: &[GlyphInfo],
    style: &ResolvedStyle,
    origin_x: f64,
    baseline_y: f64,
) -> Vec<PositionedGlyph> {
    let mut positioned = Vec::with_capacity(glyphs.len());
    let mut cursor_x = origin_x;

    for (index, glyph) in glyphs.iter().enumerate() {
        let (start, end) = glyph_cluster_byte_range(text, glyphs, index);
        let glyph_text = text.get(start..end).unwrap_or("").to_string();
        let source_start = grapheme_index_at_byte(text, start);
        let source_end = grapheme_index_at_byte(text, end);

        positioned.push(PositionedGlyph {
            glyph_id: glyph.glyph_id,
            text: glyph_text,
            cluster_start: start as u32,
            cluster_end: end as u32,
            source_start: Some(source_start),
            source_end: Some(source_end),
            source_role: Some("content".to_string()),
            decoration_source_start: Some(source_start),
            decoration_source_end: Some(source_end),
            decoration_level: None,
            path_decoration_owner_id: None,
            path_distance_start_px: None,
            path_distance_end_px: None,
            text_decoration_geometry: None,
            font_alias: glyph
                .font_alias
                .clone()
                .unwrap_or_else(|| style.font_families.first().cloned().unwrap_or_default()),
            font_fallback: style.font_families.iter().skip(1).cloned().collect(),
            font_weight: glyph.font_weight.unwrap_or(style.font_weight),
            font_style: glyph
                .font_style
                .clone()
                .unwrap_or_else(|| style.font_style.clone()),
            font_size_px: Some(style.font_size_px),
            font_variation_settings: style.font_variation_settings.clone(),
            font_feature_settings: style.font_feature_settings.clone(),
            fill: style.color.clone(),
            text_strokes: style.text_strokes.clone(),
            text_shadows: style.text_shadows.clone(),
            paint_range_index: None,
            origin_x: cursor_x + glyph.x_offset,
            origin_y: baseline_y + glyph.y_offset,
            x_offset: glyph.x_offset,
            y_offset: glyph.y_offset,
            x_advance: glyph.x_advance,
            y_advance: glyph.y_advance,
            rotation_deg: glyph.rotation_deg.unwrap_or(0),
            baseline_rotation_deg: None,
            inline_scale: None,
            synthetic_kind: None,
            outline_writing_mode: None,
            absolute_position: Some(true),
        });
        cursor_x += glyph.x_advance;
    }

    positioned
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "byte offsets within text strings; text length is well within u32::MAX"
)]
fn position_vertical_glyphs(
    text: &str,
    glyphs: &[GlyphInfo],
    style: &ResolvedStyle,
    center_x: f64,
    origin_y: f64,
) -> Vec<PositionedGlyph> {
    let mut positioned = Vec::with_capacity(glyphs.len());
    let mut cursor_y = origin_y;

    for (index, glyph) in glyphs.iter().enumerate() {
        let (start, end) = glyph_cluster_byte_range(text, glyphs, index);
        let glyph_text = text.get(start..end).unwrap_or("").to_string();
        let source_start = grapheme_index_at_byte(text, start);
        let source_end = grapheme_index_at_byte(text, end);

        positioned.push(PositionedGlyph {
            glyph_id: glyph.glyph_id,
            text: glyph_text,
            cluster_start: start as u32,
            cluster_end: end as u32,
            source_start: Some(source_start),
            source_end: Some(source_end),
            source_role: Some("content".to_string()),
            decoration_source_start: Some(source_start),
            decoration_source_end: Some(source_end),
            decoration_level: None,
            path_decoration_owner_id: None,
            path_distance_start_px: None,
            path_distance_end_px: None,
            text_decoration_geometry: None,
            font_alias: glyph
                .font_alias
                .clone()
                .unwrap_or_else(|| style.font_families.first().cloned().unwrap_or_default()),
            font_fallback: style.font_families.iter().skip(1).cloned().collect(),
            font_weight: glyph.font_weight.unwrap_or(style.font_weight),
            font_style: glyph
                .font_style
                .clone()
                .unwrap_or_else(|| style.font_style.clone()),
            font_size_px: Some(style.font_size_px),
            font_variation_settings: style.font_variation_settings.clone(),
            font_feature_settings: style.font_feature_settings.clone(),
            fill: style.color.clone(),
            text_strokes: style.text_strokes.clone(),
            text_shadows: style.text_shadows.clone(),
            paint_range_index: None,
            origin_x: center_x + glyph.x_offset,
            origin_y: cursor_y + glyph.y_offset,
            x_offset: glyph.x_offset,
            y_offset: glyph.y_offset,
            x_advance: glyph.x_advance,
            y_advance: glyph.y_advance,
            rotation_deg: glyph.rotation_deg.unwrap_or(0),
            baseline_rotation_deg: None,
            inline_scale: None,
            synthetic_kind: None,
            outline_writing_mode: None,
            absolute_position: Some(true),
        });
        cursor_y += glyph_advance_in_vertical(glyph);
    }

    positioned
}

fn glyph_cluster_byte_range(
    text: &str,
    glyphs: &[GlyphInfo],
    glyph_index: usize,
) -> (usize, usize) {
    let raw_start = glyphs[glyph_index].cluster as usize;
    let start = raw_start.min(text.len());
    let end = glyphs
        .iter()
        .skip(glyph_index + 1)
        .find(|next| next.cluster as usize > raw_start)
        .map_or(text.len(), |next| next.cluster as usize)
        .clamp(start, text.len());
    (start, end)
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "text grapheme count is well within u32::MAX"
)]
fn grapheme_index_at_byte(text: &str, byte_offset: usize) -> u32 {
    let graphemes = grapheme_split(text);
    let mut consumed = 0_usize;
    for (index, grapheme) in graphemes.iter().enumerate() {
        if consumed >= byte_offset {
            return index as u32;
        }
        consumed += grapheme.len();
    }
    graphemes.len() as u32
}

fn glyph_advance_in_vertical(glyph: &GlyphInfo) -> f64 {
    if glyph.y_advance == 0.0 {
        glyph.x_advance.abs()
    } else {
        // Top-to-bottom advances are negative. Negation retains the sign of
        // letter-spacing adjustments carried by otherwise zero-width glyphs.
        -glyph.y_advance
    }
}

fn shift_glyphs_x(glyphs: &mut [PositionedGlyph], dx: f64) {
    for glyph in glyphs {
        glyph.translate(dx, 0.0);
    }
}

fn shift_glyphs_y(glyphs: &mut [PositionedGlyph], dy: f64) {
    for glyph in glyphs {
        glyph.translate(0.0, dy);
    }
}

fn language_to_option_string(language: Language) -> Option<String> {
    match language {
        Language::Ja => Some("ja".to_string()),
        Language::En => Some("en".to_string()),
        Language::Auto => None,
    }
}

fn language_to_str(language: Language) -> &'static str {
    match language {
        Language::Ja => "ja",
        Language::En => "en",
        Language::Auto => "auto",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::FontRegistry;
    use crate::text::types::{InlineRectBlockSizeInput, WritingMode};

    fn test_request() -> TextLayoutRequest<'static> {
        TextLayoutRequest {
            text: "",
            spans: None,
            rich_text: None,
            font_size_px: 38.0,
            line_height: Some(1.2),
            line_height_px: None,
            letter_spacing_px: 0.0,
            text_indent: None,
            max_width: 400.0,
            max_height: Some(200.0),
            wrap: WrapMode::Char,
            white_space: WhiteSpaceMode::Normal,
            tab_size: 4,
            fit: FitMode::None,
            max_lines: None,
            ellipsis: false,
            language: Language::Ja,
            writing_mode: WritingMode::HorizontalTb,
            text_orientation: TextOrientation::Mixed,
            uax14_breaks: None,
            hanging_punctuation: false,
            font_variation_settings: Vec::new(),
            font_feature_settings: Vec::new(),
            min_font_size_px: None,
            max_font_size_px: None,
            shrink_epsilon_px: None,
            shrink_max_iterations: None,
            grow_epsilon_px: None,
            grow_max_iterations: None,
        }
    }

    #[test]
    fn default_style_preserves_outer_line_height_contract() {
        let mut request = test_request();
        request.line_height = Some(1.75);
        request.line_height_px = Some(42.0);
        let families = vec!["NotoSansJP".to_string()];
        let style = build_default_style(
            &request,
            &families,
            400,
            &FontStyle::Normal,
            request.font_size_px,
        );

        assert_eq!(style.line_height, Some(1.75));
        assert_eq!(style.line_height_px, Some(42.0));

        let mut authored = test_style(38.0, "#111");
        authored.line_height_px = Some(36.0);
        let resolved = prepare::resolve_style(&authored, &style, 0.5);
        assert_eq!(resolved.font_size_px, 19.0);
        assert_eq!(resolved.line_height_px, Some(36.0));

        let mut relative_override = test_style(19.0, "#111");
        relative_override.line_height = Some(1.0);
        let resolved = prepare::resolve_style(&relative_override, &style, 1.0);
        assert_eq!(resolved.line_height, Some(1.0));
        assert_eq!(resolved.line_height_px, None);
    }

    #[test]
    fn fit_keeps_authored_pixel_line_height_absolute() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let request = TextLayoutRequest {
            text: "あいうえおかきくけこ",
            font_size_px: 38.0,
            line_height: None,
            line_height_px: Some(36.0),
            text_indent: Some(1.0),
            max_width: 110.0,
            fit: FitMode::Shrink,
            max_lines: Some(1),
            min_font_size_px: Some(8.0),
            ..test_request()
        };

        let result = layout_rich_text(&request, &font_ctx).expect("fit rich text layout");
        assert!(result.chosen_font_size_px < request.font_size_px);
        assert_eq!(result.lines.len(), 1);
        assert!((result.bbox.h - 36.0).abs() < 1e-6);
    }

    #[test]
    fn fit_shrink_keeps_authored_inline_rect_pixels_and_resolves_line_block_size() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let rich_nodes = vec![
            RichTextNodeInput::Text {
                text: "あいうえおかきくけこ".to_string(),
            },
            test_inline_rect(
                "numeric",
                Some(InlineRectBlockSizeInput::Pixels(10.0)),
                0.0,
                "end",
            ),
            test_inline_rect("line", None, 0.0, "center"),
        ];
        let request = TextLayoutRequest {
            text: "",
            rich_text: Some(&rich_nodes),
            font_size_px: 38.0,
            max_width: 110.0,
            fit: FitMode::Shrink,
            max_lines: Some(1),
            min_font_size_px: Some(8.0),
            ..test_request()
        };

        let result = layout_rich_text(&request, &font_ctx).expect("fit inline rect layout");

        assert!(result.chosen_font_size_px < request.font_size_px);
        assert_eq!(result.lines.len(), 1);
        assert_eq!(result.inline_rects.len(), 2);
        assert_eq!(result.inline_rects[0].width, 4.0);
        assert_eq!(result.inline_rects[0].height, 10.0);
        assert_eq!(result.inline_rects[1].width, 4.0);
        assert!((result.inline_rects[1].height - result.bbox.h).abs() < 1e-6);
    }

    #[test]
    fn horizontal_rich_ellipsis_retains_subpixel_fit_tolerance() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let rich_nodes = vec![RichTextNodeInput::Text {
            text: "境界".to_string(),
        }];
        let request = TextLayoutRequest {
            rich_text: Some(&rich_nodes),
            max_width: 200.0,
            max_lines: Some(1),
            ..test_request()
        };
        let result = layout_rich_text(&request, &font_ctx).expect("horizontal rich layout");

        assert!(rich_ellipsis_candidate_fits(
            &TextLayoutRequest {
                max_width: result.bbox.w - 0.005,
                ..request.clone()
            },
            &result,
        ));
        assert!(!rich_ellipsis_candidate_fits(
            &TextLayoutRequest {
                max_width: result.bbox.w - 0.02,
                ..request.clone()
            },
            &result,
        ));

        let mut subpixel_result = result.clone();
        subpixel_result.bbox.w = 0.75;
        assert!(rich_ellipsis_candidate_fits(
            &TextLayoutRequest {
                max_width: 0.25,
                ..request
            },
            &subpixel_result,
        ));
    }

    #[test]
    fn vertical_rich_ellipsis_ends_the_last_column_and_inherits_style() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let rich_nodes = vec![
            RichTextNodeInput::Span {
                text: "青".to_string(),
                style: test_style(20.0, "#2563eb"),
            },
            RichTextNodeInput::Span {
                text: "赤赤赤赤赤赤赤赤赤赤".to_string(),
                style: test_style(20.0, "#dc2626"),
            },
        ];
        let request = TextLayoutRequest {
            rich_text: Some(&rich_nodes),
            font_size_px: 20.0,
            max_width: 120.0,
            max_height: Some(72.0),
            max_lines: Some(2),
            ellipsis: true,
            writing_mode: WritingMode::VerticalRl,
            ..test_request()
        };

        let result = layout_rich_text(&request, &font_ctx).expect("vertical rich ellipsis");

        assert_eq!(result.lines.len(), 2);
        assert!(
            result
                .lines
                .last()
                .expect("last column")
                .text
                .ends_with('\u{2026}')
        );
        let ellipsis = result
            .lines
            .iter()
            .flat_map(|line| line.positioned_glyphs.as_deref().unwrap_or_default().iter())
            .find(|glyph| glyph.text == "\u{2026}")
            .expect("ellipsis glyph");
        assert_eq!(ellipsis.fill.as_deref(), Some("#dc2626"));
        assert_eq!(result.overflow.overflow_type, "overflow");
        assert!(result.bbox.w <= request.max_width + 0.01);
        assert!(result.bbox.h <= request.max_height.expect("max height") + 0.01);
    }

    #[test]
    fn rich_ellipsis_keeps_ruby_inline_box_and_inline_rect_atomic() {
        let ruby = RichInlineNode::Ruby(RichRuby {
            ruby_position: RubyPosition::Over,
            ruby_align: RubyAlign::Center,
            ruby_gap_px: 0.0,
            ruby_offset_px: 0.0,
            ruby_line_sizing: RubyLineSizing::Stable,
            base: vec![RichSegment {
                text: "東京".to_string(),
                style: test_resolved_style(16.0),
                combine: false,
                decoration_runs: Vec::new(),
            }],
            rt_levels: vec![vec![RichSegment {
                text: "とうきょう".to_string(),
                style: test_resolved_style(8.0),
                combine: false,
                decoration_runs: Vec::new(),
            }]],
        });
        let inline_box = RichInlineNode::InlineBox(RichInlineBox {
            children: vec![RichInlineNode::Segment(RichSegment {
                text: "囲み".to_string(),
                style: test_resolved_style(16.0),
                combine: false,
                decoration_runs: Vec::new(),
            })],
            padding_inline: [2.0, 2.0],
            border_width: 1.0,
            background: Some("#eeeeee".to_string()),
            border_color: None,
            border_radius: None,
            span_key: None,
        });
        let inline_rect = RichInlineNode::InlineRect(RichInlineRect {
            input: InlineRectInput {
                fragment_id: "marker".to_string(),
                inline_size_px: 8.0,
                block_size_px: None,
                advance_px: Some(8.0),
                block_align: None,
                color: "#16a34a".to_string(),
                border_radius_px: None,
                opacity: None,
                paint_order: None,
            },
            style: test_resolved_style(16.0),
        });

        assert!(
            truncate_inline_nodes(std::slice::from_ref(&ruby), 1)
                .0
                .is_empty()
        );
        assert!(matches!(
            truncate_inline_nodes(std::slice::from_ref(&ruby), 2)
                .0
                .as_slice(),
            [RichInlineNode::Ruby(_)]
        ));
        assert!(matches!(
            truncate_inline_nodes(std::slice::from_ref(&inline_box), 1)
                .0
                .as_slice(),
            [RichInlineNode::InlineBox(_)]
        ));
        assert!(matches!(
            truncate_inline_nodes(std::slice::from_ref(&inline_rect), 1)
                .0
                .as_slice(),
            [RichInlineNode::InlineRect(_)]
        ));
    }

    #[test]
    fn vertical_rich_ellipsis_rebuilds_decorations_and_respects_kinsoku() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let decorated_nodes = vec![RichTextNodeInput::DecoratedSpan {
            style: test_style(20.0, "#111111"),
            children: vec![RichTextNodeInput::Text {
                text: "装飾付き縦書きテキスト".to_string(),
            }],
            padding_inline: Some([2.0, 2.0]),
            background: Some("#fef3c7".to_string()),
            border_color: Some("#f59e0b".to_string()),
            border_width: Some(1.0),
            border_radius: Some([3.0, 3.0, 3.0, 3.0]),
            span_key: Some("highlight".to_string()),
        }];
        let decorated_request = TextLayoutRequest {
            rich_text: Some(&decorated_nodes),
            font_size_px: 20.0,
            max_width: 80.0,
            max_height: Some(68.0),
            max_lines: Some(1),
            ellipsis: true,
            writing_mode: WritingMode::VerticalRl,
            ..test_request()
        };
        let decorated =
            layout_rich_text(&decorated_request, &font_ctx).expect("decorated ellipsis");
        assert!(decorated.lines[0].text.ends_with('\u{2026}'));
        assert!(decorated.inline_box_decorations.iter().any(|decoration| {
            decoration.span_key.as_deref() == Some("highlight")
                && decoration.background.as_deref() == Some("#fef3c7")
        }));

        let kinsoku_nodes = vec![RichTextNodeInput::Text {
            text: "天地（玄黄宇宙洪荒".to_string(),
        }];
        let mut observed_backoff = false;
        for max_height in 60..=100 {
            let request = TextLayoutRequest {
                rich_text: Some(&kinsoku_nodes),
                font_size_px: 20.0,
                max_width: 80.0,
                max_height: Some(f64::from(max_height)),
                max_lines: Some(1),
                ellipsis: true,
                language: Language::Ja,
                writing_mode: WritingMode::VerticalRl,
                ..test_request()
            };
            let result = layout_rich_text(&request, &font_ctx).expect("kinsoku ellipsis");
            let text = &result.lines[0].text;
            assert!(!text.ends_with("（\u{2026}"));
            if text == "天地\u{2026}" {
                observed_backoff = true;
            }
        }
        assert!(observed_backoff, "expected a tail-prohibition backoff case");
    }

    #[test]
    fn vertical_rich_ellipsis_handles_shrink_and_grow_fallbacks() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let rich_nodes = vec![RichTextNodeInput::Text {
            text: "天地玄黄宇宙洪荒日月盈昃辰宿列張".to_string(),
        }];

        for fit in [FitMode::Shrink, FitMode::Grow] {
            let request = TextLayoutRequest {
                rich_text: Some(&rich_nodes),
                font_size_px: if fit == FitMode::Shrink { 24.0 } else { 8.0 },
                min_font_size_px: Some(12.0),
                max_font_size_px: Some(24.0),
                max_width: 80.0,
                max_height: Some(48.0),
                max_lines: Some(1),
                ellipsis: true,
                fit,
                writing_mode: WritingMode::VerticalRl,
                ..test_request()
            };
            let result = layout_rich_text(&request, &font_ctx).expect("fit ellipsis");
            assert_eq!(result.lines.len(), 1);
            assert!(result.lines[0].text.ends_with('\u{2026}'));
            assert!(result.bbox.h <= request.max_height.expect("max height") + 0.01);
        }
    }

    #[test]
    fn horizontal_rich_ellipsis_handles_shrink_and_grow_fallbacks() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let rich_nodes = vec![RichTextNodeInput::Text {
            text: "天地玄黄宇宙洪荒日月盈昃辰宿列張".to_string(),
        }];

        for fit in [FitMode::Shrink, FitMode::Grow] {
            let request = TextLayoutRequest {
                rich_text: Some(&rich_nodes),
                font_size_px: if fit == FitMode::Shrink { 24.0 } else { 8.0 },
                min_font_size_px: Some(12.0),
                max_font_size_px: Some(24.0),
                max_width: 80.0,
                max_lines: Some(1),
                ellipsis: true,
                fit,
                ..test_request()
            };
            let result = layout_rich_text(&request, &font_ctx).expect("fit ellipsis");
            assert_eq!(result.lines.len(), 1);
            assert!(result.lines[0].text.ends_with('\u{2026}'));
            assert!(result.bbox.w <= request.max_width + 0.01);
        }
    }

    #[test]
    fn vertical_rich_non_overflow_output_is_independent_of_ellipsis() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let rich_nodes = vec![RichTextNodeInput::Text {
            text: "縦書".to_string(),
        }];
        let base_request = TextLayoutRequest {
            rich_text: Some(&rich_nodes),
            font_size_px: 20.0,
            max_width: 120.0,
            max_height: Some(160.0),
            max_lines: Some(2),
            writing_mode: WritingMode::VerticalRl,
            ..test_request()
        };
        let without = layout_rich_text(&base_request, &font_ctx).expect("plain rich layout");
        let with = layout_rich_text(
            &TextLayoutRequest {
                ellipsis: true,
                ..base_request.clone()
            },
            &font_ctx,
        )
        .expect("non-overflow ellipsis layout");

        assert_eq!(without.lines.len(), with.lines.len());
        assert_eq!(without.lines[0].text, with.lines[0].text);
        assert!((without.bbox.w - with.bbox.w).abs() < 1e-9);
        assert!((without.bbox.h - with.bbox.h).abs() < 1e-9);
        assert_eq!(with.overflow.overflow_type, "none");
    }

    #[test]
    fn rich_ellipsis_probe_count_is_logarithmically_bounded() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let ruby = RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: test_style(16.0, "#111111"),
            base: vec![RichTextNodeInput::Text {
                text: "東".to_string(),
            }],
            rt: vec![RichTextNodeInput::Text {
                text: "とう".to_string(),
            }],
            rt_levels: Vec::new(),
        };
        let inline_box = RichTextNodeInput::InlineBox {
            style: test_style(16.0, "#111111"),
            children: vec![RichTextNodeInput::Text {
                text: "箱".to_string(),
            }],
            padding_inline: None,
            background: None,
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: None,
        };

        assert_eq!(rich_ellipsis_probe_limit(64), 9);
        assert_eq!(rich_ellipsis_probe_limit(256), 11);
        assert_eq!(rich_ellipsis_probe_limit(1024), 13);

        for unit_count in [64usize, 256, 1024] {
            let cases = [
                vec![RichTextNodeInput::Text {
                    text: "縦".repeat(unit_count),
                }],
                vec![ruby.clone(); unit_count],
                vec![inline_box.clone(); unit_count],
            ];
            for rich_nodes in &cases {
                let request = TextLayoutRequest {
                    rich_text: Some(rich_nodes),
                    font_size_px: 16.0,
                    max_width: 80.0,
                    max_height: Some(48.0),
                    max_lines: Some(1),
                    ellipsis: true,
                    writing_mode: WritingMode::VerticalRl,
                    ..test_request()
                };
                let mut probe_count = 0;
                apply_rich_ellipsis_with_probe_observer(&request, &font_ctx, 16.0, &mut || {
                    probe_count += 1;
                })
                .expect("ellipsis probe result");
                assert!(probe_count <= rich_ellipsis_probe_limit(unit_count));
            }
        }
    }

    #[test]
    fn inline_language_overrides_paragraph_kinsoku_in_both_writing_modes() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let layout_lines = |writing_mode: WritingMode,
                            parent_language: Language,
                            inline_language: Option<&str>| {
            let mut style = test_style(20.0, "#1f2937");
            style.language = inline_language.map(str::to_string);
            let rich_nodes = vec![RichTextNodeInput::Span {
                text: "ABCDEFG".to_string(),
                style,
            }];
            let request = TextLayoutRequest {
                rich_text: Some(&rich_nodes),
                font_size_px: 20.0,
                line_height: Some(1.2),
                max_width: if writing_mode == WritingMode::HorizontalTb {
                    52.0
                } else {
                    300.0
                },
                max_height: Some(if writing_mode == WritingMode::HorizontalTb {
                    300.0
                } else {
                    52.0
                }),
                wrap: WrapMode::Word,
                language: parent_language,
                writing_mode,
                ..test_request()
            };
            layout_rich_text(&request, &font_ctx)
                .expect("inline language layout")
                .lines
                .into_iter()
                .map(|line| line.text)
                .collect::<Vec<_>>()
        };

        for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            let parent_en = layout_lines(writing_mode, Language::En, None);
            let parent_ja = layout_lines(writing_mode, Language::Ja, None);
            assert_eq!(parent_en, vec!["ABCDEFG"]);
            assert!(parent_ja.len() > 1);
            assert_eq!(
                layout_lines(writing_mode, Language::En, Some("ja")),
                parent_ja
            );
            assert_eq!(
                layout_lines(writing_mode, Language::Ja, Some("en")),
                parent_en
            );
            assert_eq!(
                layout_lines(writing_mode, Language::Ja, Some("auto")),
                parent_en
            );
        }
    }

    #[test]
    fn mixed_inline_language_preserves_opted_out_words_at_ja_boundaries() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let mut neutral_style = test_style(20.0, "#1f2937");
        neutral_style.language = Some("en".to_string());

        for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            for rich_nodes in [
                vec![
                    RichTextNodeInput::Span {
                        text: "API".to_string(),
                        style: neutral_style.clone(),
                    },
                    RichTextNodeInput::Text {
                        text: "。".to_string(),
                    },
                ],
                vec![
                    RichTextNodeInput::Text {
                        text: "「".to_string(),
                    },
                    RichTextNodeInput::Span {
                        text: "API".to_string(),
                        style: neutral_style.clone(),
                    },
                ],
            ] {
                let request = TextLayoutRequest {
                    rich_text: Some(&rich_nodes),
                    font_size_px: 20.0,
                    line_height: Some(1.2),
                    max_width: if writing_mode == WritingMode::HorizontalTb {
                        36.0
                    } else {
                        300.0
                    },
                    max_height: Some(if writing_mode == WritingMode::HorizontalTb {
                        300.0
                    } else {
                        36.0
                    }),
                    wrap: WrapMode::Word,
                    language: Language::Ja,
                    writing_mode,
                    ..test_request()
                };
                let result = layout_rich_text(&request, &font_ctx).expect("mixed language layout");
                assert_eq!(
                    result.lines.len(),
                    1,
                    "opted-out word must stay intact at {writing_mode:?} ja boundary: {:?}",
                    result
                        .lines
                        .iter()
                        .map(|line| line.text.as_str())
                        .collect::<Vec<_>>()
                );
            }
        }
    }

    #[test]
    fn rich_kinsoku_forced_break_reports_unresolved_in_both_writing_modes() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let rich_nodes = vec![RichTextNodeInput::Span {
            text: "。".repeat(12),
            style: test_style(20.0, "#dc2626"),
        }];

        for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            let request = TextLayoutRequest {
                rich_text: Some(&rich_nodes),
                font_size_px: 20.0,
                line_height: Some(1.2),
                max_width: if writing_mode == WritingMode::HorizontalTb {
                    40.0
                } else {
                    300.0
                },
                max_height: Some(if writing_mode == WritingMode::HorizontalTb {
                    300.0
                } else {
                    40.0
                }),
                wrap: WrapMode::Char,
                language: Language::Ja,
                writing_mode,
                ..test_request()
            };
            let result = layout_rich_text(&request, &font_ctx).expect("rich kinsoku layout");

            assert_eq!(result.overflow.overflow_type, "kinsoku_unresolved");
            assert_eq!(
                result
                    .lines
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>(),
                vec!["。。"; 6]
            );
        }
    }

    #[test]
    fn rich_ellipsis_preserves_kinsoku_diagnostic_without_constraint_overflow() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let rich_nodes = vec![RichTextNodeInput::Span {
            text: "。".repeat(12),
            style: test_style(20.0, "#dc2626"),
        }];

        for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            for fit in [FitMode::None, FitMode::Shrink] {
                let request = TextLayoutRequest {
                    rich_text: Some(&rich_nodes),
                    font_size_px: 20.0,
                    line_height: Some(1.2),
                    max_width: if writing_mode == WritingMode::HorizontalTb {
                        40.0
                    } else {
                        300.0
                    },
                    max_height: Some(if writing_mode == WritingMode::HorizontalTb {
                        300.0
                    } else {
                        40.0
                    }),
                    max_lines: Some(6),
                    wrap: WrapMode::Char,
                    fit,
                    ellipsis: true,
                    language: Language::Ja,
                    writing_mode,
                    ..test_request()
                };
                let result = layout_rich_text(&request, &font_ctx).expect("rich kinsoku layout");

                assert_eq!(result.overflow.overflow_type, "kinsoku_unresolved");
                assert_eq!(
                    result
                        .lines
                        .iter()
                        .map(|line| line.text.as_str())
                        .collect::<String>(),
                    "。".repeat(12)
                );
            }
        }
    }

    #[test]
    fn plain_and_rich_fit_share_kinsoku_constraint_semantics() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let source_text = "。".repeat(12);
        let rich_nodes = vec![RichTextNodeInput::Text {
            text: source_text.clone(),
        }];

        for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            for fit in [FitMode::Shrink, FitMode::Grow] {
                let base_request = TextLayoutRequest {
                    text: &source_text,
                    font_size_px: 20.0,
                    max_font_size_px: Some(32.0),
                    max_width: if writing_mode == WritingMode::HorizontalTb {
                        40.0
                    } else {
                        300.0
                    },
                    max_height: Some(if writing_mode == WritingMode::HorizontalTb {
                        300.0
                    } else {
                        40.0
                    }),
                    max_lines: Some(6),
                    wrap: WrapMode::Char,
                    fit,
                    ellipsis: true,
                    language: Language::Ja,
                    writing_mode,
                    ..test_request()
                };
                let plain = crate::text::engine::layout_text(&base_request, &font_ctx)
                    .expect("plain kinsoku fit");
                let rich = layout_rich_text(
                    &TextLayoutRequest {
                        text: "",
                        rich_text: Some(&rich_nodes),
                        ..base_request.clone()
                    },
                    &font_ctx,
                )
                .expect("rich kinsoku fit");

                for result in [&plain, &rich] {
                    assert_eq!(result.overflow.overflow_type, "kinsoku_unresolved");
                    assert_eq!(
                        result
                            .lines
                            .iter()
                            .map(|line| line.text.as_str())
                            .collect::<String>(),
                        source_text
                    );
                    assert!(
                        !result
                            .lines
                            .iter()
                            .any(|line| line.text.contains('\u{2026}'))
                    );
                    assert!(result.bbox.w <= base_request.max_width + 0.001);
                    assert!(result.bbox.h <= base_request.max_height.expect("max height") + 0.001);
                }
                assert_eq!(plain.lines.len(), rich.lines.len());
            }
        }
    }

    #[test]
    fn rich_ellipsis_distinguishes_kinsoku_from_max_lines_overflow() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let source_text = "。".repeat(12);
        let rich_nodes = vec![RichTextNodeInput::Span {
            text: source_text.clone(),
            style: test_style(20.0, "#dc2626"),
        }];

        for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            let base_request = TextLayoutRequest {
                rich_text: Some(&rich_nodes),
                font_size_px: 20.0,
                line_height: Some(1.2),
                max_width: if writing_mode == WritingMode::HorizontalTb {
                    40.0
                } else {
                    300.0
                },
                max_height: Some(if writing_mode == WritingMode::HorizontalTb {
                    300.0
                } else {
                    40.0
                }),
                max_lines: Some(5),
                wrap: WrapMode::Char,
                ellipsis: true,
                language: Language::Ja,
                writing_mode,
                ..test_request()
            };

            let ellipsized = layout_rich_text(&base_request, &font_ctx).expect("rich ellipsis");
            assert_eq!(ellipsized.lines.len(), 5);
            assert!(
                ellipsized
                    .lines
                    .last()
                    .expect("last line or column")
                    .text
                    .ends_with('\u{2026}')
            );
            assert_eq!(ellipsized.overflow.overflow_type, "overflow");

            let shrunk = layout_rich_text(
                &TextLayoutRequest {
                    fit: FitMode::Shrink,
                    ..base_request.clone()
                },
                &font_ctx,
            )
            .expect("rich shrink fit");
            assert!(shrunk.chosen_font_size_px < base_request.font_size_px);
            assert_eq!(
                shrunk
                    .lines
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<String>(),
                source_text
            );
            assert!(
                !shrunk
                    .lines
                    .iter()
                    .any(|line| line.text.contains('\u{2026}'))
            );
        }
    }

    fn test_style(font_size_px: f64, color: &str) -> RichTextStyleInput {
        RichTextStyleInput {
            font_family: vec!["NotoSansJP".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px,
            line_height: None,
            line_height_px: None,
            letter_spacing_px: Some(0.0),
            language: Some("ja".to_string()),
            color: Some(color.to_string()),
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_orientation: None,
            text_decoration: None,
        }
    }

    fn test_font_registry() -> FontRegistry {
        let mut registry = FontRegistry::new();
        let data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font");
        registry
            .register(data, "NotoSansJP".to_string(), 400, FontStyle::Normal)
            .expect("register font");
        registry
    }

    fn test_inline_rect(
        fragment_id: &str,
        block_size_px: Option<InlineRectBlockSizeInput>,
        advance_px: f64,
        block_align: &str,
    ) -> RichTextNodeInput {
        RichTextNodeInput::InlineRect {
            rect: InlineRectInput {
                fragment_id: fragment_id.to_string(),
                inline_size_px: 4.0,
                block_size_px,
                advance_px: Some(advance_px),
                block_align: Some(block_align.to_string()),
                color: "#2563eb".to_string(),
                border_radius_px: Some(8.0),
                opacity: Some(0.5),
                paint_order: Some("front".to_string()),
            },
        }
    }

    #[test]
    fn inline_rect_zero_advance_keeps_line_width_and_paints_at_the_pen() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let plain_nodes = vec![RichTextNodeInput::Text {
            text: "A".to_string(),
        }];
        let rect_nodes = vec![
            RichTextNodeInput::Text {
                text: "A".to_string(),
            },
            test_inline_rect("caret", None, 0.0, "center"),
        ];
        let plain_request = TextLayoutRequest {
            rich_text: Some(&plain_nodes),
            ..test_request()
        };
        let rect_request = TextLayoutRequest {
            rich_text: Some(&rect_nodes),
            ..test_request()
        };

        let plain = layout_rich_text(&plain_request, &font_ctx).expect("plain layout");
        let with_rect = layout_rich_text(&rect_request, &font_ctx).expect("rect layout");

        assert!((with_rect.bbox.w - plain.bbox.w).abs() < 1e-6);
        assert_eq!(with_rect.inline_rects.len(), 1);
        let rect = &with_rect.inline_rects[0];
        assert!((rect.x - plain.lines[0].width).abs() < 1e-6);
        assert_eq!(rect.width, 4.0);
        assert_eq!(rect.height, with_rect.bbox.h);
        assert_eq!(rect.opacity, 0.5);
    }

    #[test]
    fn inline_rect_positive_advance_participates_in_wrapping() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let nodes = vec![
            test_inline_rect("block", None, 30.0, "center"),
            RichTextNodeInput::Text {
                text: "A".to_string(),
            },
        ];
        let request = TextLayoutRequest {
            rich_text: Some(&nodes),
            max_width: 20.0,
            ..test_request()
        };

        let result = layout_rich_text(&request, &font_ctx).expect("wrapped rect layout");

        assert_eq!(result.lines.len(), 2);
        assert_eq!(result.lines[0].text, "");
        assert_eq!(result.lines[0].width, 30.0);
        assert_eq!(result.lines[1].text, "A");
        assert_eq!(result.inline_rects[0].x, 0.0);
        assert_eq!(result.inline_rects[0].y, 0.0);
    }

    #[test]
    fn inline_rect_maps_numeric_block_alignment_to_logical_axes() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        for (writing_mode, align, expected_x, expected_y, expected_width, expected_height) in [
            (WritingMode::HorizontalTb, "start", 0.0, 0.0, 4.0, 10.0),
            (WritingMode::HorizontalTb, "center", 0.0, 15.0, 4.0, 10.0),
            (WritingMode::HorizontalTb, "end", 0.0, 30.0, 4.0, 10.0),
            (WritingMode::VerticalRl, "start", 30.0, 0.0, 10.0, 4.0),
            (WritingMode::VerticalRl, "center", 15.0, 0.0, 10.0, 4.0),
            (WritingMode::VerticalRl, "end", 0.0, 0.0, 10.0, 4.0),
        ] {
            let nodes = vec![test_inline_rect(
                "caret",
                Some(InlineRectBlockSizeInput::Pixels(10.0)),
                0.0,
                align,
            )];
            let request = TextLayoutRequest {
                rich_text: Some(&nodes),
                line_height: None,
                line_height_px: Some(40.0),
                writing_mode,
                ..test_request()
            };
            let result = layout_rich_text(&request, &font_ctx).expect("aligned rect layout");
            let rect = &result.inline_rects[0];
            assert_eq!(rect.x, expected_x, "writing={writing_mode:?} align={align}");
            assert_eq!(rect.y, expected_y, "writing={writing_mode:?} align={align}");
            assert_eq!(rect.width, expected_width);
            assert_eq!(rect.height, expected_height);
        }
    }

    fn test_break_token(text: &str, advance: f64) -> LayoutToken {
        LayoutToken {
            text: text.to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance,
            cross_size: 20.0,
            reference_offset: 10.0,
            glyphs: Vec::new(),
            inline_rects: Vec::new(),
            inline_box_decoration: None,
            nested_decorations: Vec::new(),
            decoration_span_id: None,
            decoration_start_advance: 0.0,
            decoration_end_advance: 0.0,
            flow_ruby: None,
            trailing_tracking_px: 0.0,
        }
    }

    fn grapheme_break_tokens(text: &str, advance: f64) -> Vec<LayoutToken> {
        grapheme_split(text)
            .into_iter()
            .map(|part| test_break_token(&part, advance))
            .collect()
    }

    #[test]
    fn wrap_word_keeps_long_ascii_word_unbroken_when_no_normal_break_exists() {
        let tokens = grapheme_break_tokens("HELLOWORLD", 1.0);
        let lines =
            break_tokens_horizontal(&tokens, 3.0, 0.0, WrapMode::Word, None, None, &[], false)
                .expect("word layout should succeed");

        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "HELLOWORLD");
    }

    #[test]
    fn wrap_word_with_kinsoku_forces_contained_token_boundaries() {
        let tokens = grapheme_break_tokens("ABCDEFG", 1.0);
        let profile = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));
        let horizontal =
            break_tokens_horizontal(&tokens, 3.0, 0.0, WrapMode::Word, profile, None, &[], false)
                .expect("horizontal word layout should succeed");
        let vertical =
            break_tokens_vertical(&tokens, 3.0, 0.0, WrapMode::Word, profile, None, &[], false)
                .expect("vertical word layout should succeed");

        for lines in [horizontal, vertical] {
            assert_eq!(
                lines
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>(),
                ["ABC", "DEF", "G"]
            );
            assert!(lines.iter().all(|line| line.advance <= 3.0));
        }
    }

    #[test]
    fn wrap_word_with_kinsoku_does_not_carry_an_end_of_run_token() {
        let tokens = grapheme_break_tokens("ABC", 1.0);
        let profile = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));
        let end_boundary = [2];
        let horizontal = break_tokens_horizontal(
            &tokens,
            1.0,
            0.0,
            WrapMode::Word,
            profile,
            Some(&end_boundary),
            &[],
            false,
        )
        .expect("horizontal word layout should succeed");
        let vertical = break_tokens_vertical(
            &tokens,
            1.0,
            0.0,
            WrapMode::Word,
            profile,
            Some(&end_boundary),
            &[],
            false,
        )
        .expect("vertical word layout should succeed");

        for lines in [horizontal, vertical] {
            assert_eq!(
                lines
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>(),
                ["A", "B", "C"]
            );
            assert!(lines.iter().all(|line| line.advance <= 1.0));
        }
    }

    #[test]
    fn wrap_word_with_kinsoku_moves_atomic_inline_boxes_without_splitting() {
        let mut inline_box = test_break_token("box", 2.0);
        inline_box.inline_box_decoration = Some(InlineBoxDecorationInput {
            total_advance: 2.0,
            cross_size: 20.0,
            background: Some("#eee".to_string()),
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: None,
        });
        let tokens = vec![
            test_break_token("A", 1.0),
            inline_box,
            test_break_token("B", 1.0),
        ];
        let profile = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));
        let horizontal =
            break_tokens_horizontal(&tokens, 1.0, 0.0, WrapMode::Word, profile, None, &[], false)
                .expect("horizontal word layout should succeed");
        let vertical =
            break_tokens_vertical(&tokens, 1.0, 0.0, WrapMode::Word, profile, None, &[], false)
                .expect("vertical word layout should succeed");

        for lines in [horizontal, vertical] {
            assert_eq!(
                lines
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>(),
                ["A", "box", "B"]
            );
            assert_eq!(lines[1].advance, 2.0);
            assert_eq!(lines[1].decorations.len(), 1);
        }
    }

    #[test]
    fn wrap_word_with_kinsoku_matches_forced_japanese_boundaries() {
        let profile = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));

        for (text, max_advance, expected) in [
            // The single-glyph measure cannot satisfy the line-start prohibition
            // for `。`; keep rich output aligned with the plain fallback.
            ("あ。い", 1.0, vec!["あ", "。", "い"]),
            (
                "日本語、組版。天地",
                3.0,
                vec!["日本", "語、組", "版。天", "地"],
            ),
        ] {
            let tokens = grapheme_break_tokens(text, 1.0);
            let horizontal = break_tokens_horizontal(
                &tokens,
                max_advance,
                0.0,
                WrapMode::Word,
                profile,
                None,
                &[],
                false,
            )
            .expect("horizontal word layout should succeed");
            let vertical = break_tokens_vertical(
                &tokens,
                max_advance,
                0.0,
                WrapMode::Word,
                profile,
                None,
                &[],
                false,
            )
            .expect("vertical word layout should succeed");

            for lines in [horizontal, vertical] {
                assert_eq!(
                    lines
                        .iter()
                        .map(|line| line.text.as_str())
                        .collect::<Vec<_>>(),
                    expected,
                    "text={text}"
                );
            }
        }
    }

    #[test]
    fn wrap_char_falls_back_to_token_boundary_when_normal_break_is_unavailable() {
        let tokens = grapheme_break_tokens("ABCDEFG", 1.0);
        let lines =
            break_tokens_horizontal(&tokens, 3.0, 0.0, WrapMode::Char, None, None, &[], false)
                .expect("char layout should succeed");

        assert!(lines.len() > 1);
        assert_eq!(lines[0].text, "ABC");
        assert_eq!(lines[1].text, "DEF");
    }

    /// An overflowing token must not ride along on the current line when an
    /// earlier break opportunity exists (it previously did, producing lines
    /// wider than the constraint).
    #[test]
    fn wrap_word_does_not_carry_overflowing_token_past_earlier_break() {
        let tokens = grapheme_break_tokens("あいうえお", 20.0);
        let lines =
            break_tokens_horizontal(&tokens, 45.0, 0.0, WrapMode::Word, None, None, &[], false)
                .expect("word layout should succeed");

        assert_eq!(lines[0].text, "あい");
        for line in &lines {
            assert!(
                line.advance <= 45.0,
                "line {:?} overflows constraint: {}",
                line.text,
                line.advance
            );
        }
    }

    /// Same contract with a first-line indent: the indent shrinks the first
    /// line's budget and the overflowing token moves to the next line.
    #[test]
    fn wrap_word_with_indent_keeps_first_line_within_constraint() {
        let tokens = grapheme_break_tokens("あいうえお", 20.0);
        let lines =
            break_tokens_horizontal(&tokens, 65.0, 20.0, WrapMode::Word, None, None, &[], false)
                .expect("word layout should succeed");

        assert_eq!(lines[0].text, "あい");
        // Line advance already includes the first-line indent.
        assert!(
            lines[0].advance <= 65.0,
            "indented first line overflows: {}",
            lines[0].advance
        );
    }

    /// Char wrap with kinsoku must not split a 分離禁止 pair ("——") even
    /// when the forced fallback fires (parity with the plain paths).
    #[test]
    fn wrap_char_does_not_split_non_breaking_pair() {
        let tokens = grapheme_break_tokens("あ——い", 16.0);
        let profile = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));
        let lines = break_tokens_horizontal(
            &tokens,
            42.0,
            0.0,
            WrapMode::Char,
            profile,
            None,
            &[],
            false,
        )
        .expect("char layout should succeed");
        let line_texts: Vec<&str> = lines.iter().map(|line| line.text.as_str()).collect();

        assert_eq!(line_texts, vec!["あ", "——", "い"]);
    }

    #[test]
    fn vertical_wrap_char_prefers_normal_breaks_and_keeps_jsx_intact() {
        let tokens = grapheme_break_tokens("なJSXから", 1.0);
        let profile = crate::text::kinsoku::get_kinsoku_profile(Some("ja"));
        let lines =
            break_tokens_vertical(&tokens, 2.0, 0.0, WrapMode::Char, profile, None, &[], false)
                .expect("vertical char layout should succeed");
        let serialized = lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("|");

        assert!(serialized.contains("JSX"), "actual={serialized}");
        assert!(!serialized.contains("JS|X"), "actual={serialized}");
    }

    #[test]
    fn wrap_word_uses_supplied_uax14_breaks_when_provided() {
        let tokens = grapheme_break_tokens("ABCDEF", 1.0);
        let supplied_breaks = vec![3usize];
        let lines = break_tokens_horizontal(
            &tokens,
            4.0,
            0.0,
            WrapMode::Word,
            None,
            Some(&supplied_breaks),
            &[],
            false,
        )
        .expect("word layout with supplied breaks should succeed");

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "ABC");
        assert_eq!(lines[1].text, "DEF");
    }

    #[test]
    fn supplied_uax14_breaks_map_by_byte_offset_on_multibyte_tokens() {
        let tokens = grapheme_break_tokens("あBCD", 1.0);
        let supplied_breaks = vec!["あ".len()];
        let lines = break_tokens_horizontal(
            &tokens,
            2.0,
            0.0,
            WrapMode::Word,
            None,
            Some(&supplied_breaks),
            &[],
            false,
        )
        .expect("word layout with multibyte supplied breaks should succeed");

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "あ");
        assert_eq!(lines[1].text, "BCD");
    }

    #[test]
    fn preserves_ruby_annotation_style_overrides() {
        let req = test_request();
        let default_style = build_default_style(
            &req,
            &["NotoSansJP".to_string()],
            400,
            &FontStyle::Normal,
            req.font_size_px,
        );
        let rich_nodes = vec![RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: None,
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: test_style(38.0, "#f8fafc"),
            base: vec![RichTextNodeInput::Text {
                text: "京".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "きょう".to_string(),
                style: test_style(19.0, "#fca5a5"),
            }],
            rt_levels: Vec::new(),
        }];

        let mut flattened = Vec::new();
        let mut warnings = Vec::new();
        flatten_rich_nodes_with_warnings(
            &rich_nodes,
            &default_style,
            &mut flattened,
            1.0,
            &mut warnings,
        );

        match &flattened[0] {
            RichInlineNode::Ruby(ruby) => {
                assert_eq!(ruby.rt_levels[0][0].style.color.as_deref(), Some("#fca5a5"));
                assert_eq!(ruby.rt_levels[0][0].style.font_size_px, 19.0);
            }
            RichInlineNode::Segment(_)
            | RichInlineNode::InlineBox(_)
            | RichInlineNode::InlineRect(_)
            | RichInlineNode::DecoratedSpan(_) => {
                panic!("expected ruby node")
            }
        }
    }

    #[test]
    fn preserves_ruby_annotation_fill_in_positioned_glyphs() {
        let registry = test_font_registry();

        let rich_nodes = vec![
            RichTextNodeInput::Text {
                text: "東".to_string(),
            },
            RichTextNodeInput::Ruby {
                ruby_position: Some("over".to_string()),
                ruby_align: None,
                ruby_gap_px: None,
                ruby_offset_px: None,
                ruby_line_sizing: None,
                style: test_style(38.0, "#f8fafc"),
                base: vec![RichTextNodeInput::Text {
                    text: "京".to_string(),
                }],
                rt: vec![RichTextNodeInput::Span {
                    text: "きょう".to_string(),
                    style: test_style(19.0, "#fca5a5"),
                }],
                rt_levels: Vec::new(),
            },
        ];

        let req = TextLayoutRequest {
            rich_text: Some(&rich_nodes),
            ..test_request()
        };

        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let result = layout_rich_text(&req, &font_ctx).expect("rich text layout");
        let glyphs = result.lines[0]
            .positioned_glyphs
            .as_ref()
            .expect("positioned glyphs");
        let rt = glyphs
            .iter()
            .find(|glyph| glyph.text == "き")
            .expect("ruby annotation glyph");

        assert_eq!(rt.fill.as_deref(), Some("#fca5a5"));
        assert_eq!(rt.source_start, Some(1));
        assert_eq!(rt.source_end, Some(2));
        assert_eq!(rt.source_role.as_deref(), Some("rubyAnnotation"));
        let base = glyphs
            .iter()
            .find(|glyph| glyph.text == "京")
            .expect("ruby base glyph");
        assert_eq!(base.source_start, Some(1));
        assert_eq!(base.source_end, Some(2));
        assert_eq!(base.source_role.as_deref(), Some("rubyBase"));
    }

    #[test]
    fn ruby_gap_contract_uses_zero_frame_gap() {
        assert_eq!(ruby_frame_gap_px(12.0), 0.0);
        assert_eq!(ruby_optical_overlap_px(12.0), 0.0);
        assert_eq!(ruby_gap_px(12.0), 0.0);
    }

    #[test]
    fn default_ruby_align_is_space_around() {
        let req = test_request();
        let default_style = build_default_style(
            &req,
            &["NotoSansJP".to_string()],
            400,
            &FontStyle::Normal,
            req.font_size_px,
        );
        let rich_nodes = vec![RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: None,
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: test_style(38.0, "#f8fafc"),
            base: vec![RichTextNodeInput::Text {
                text: "京".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "きょう".to_string(),
                style: test_style(19.0, "#fca5a5"),
            }],
            rt_levels: Vec::new(),
        }];

        let mut flattened = Vec::new();
        let mut warnings = Vec::new();
        flatten_rich_nodes_with_warnings(
            &rich_nodes,
            &default_style,
            &mut flattened,
            1.0,
            &mut warnings,
        );

        match &flattened[0] {
            RichInlineNode::Ruby(ruby) => assert_eq!(ruby.ruby_align, RubyAlign::SpaceAround),
            RichInlineNode::Segment(_)
            | RichInlineNode::InlineBox(_)
            | RichInlineNode::InlineRect(_)
            | RichInlineNode::DecoratedSpan(_) => {
                panic!("expected ruby node")
            }
        }
    }

    #[test]
    fn default_ruby_line_sizing_is_css() {
        let req = test_request();
        let default_style = build_default_style(
            &req,
            &["NotoSansJP".to_string()],
            400,
            &FontStyle::Normal,
            req.font_size_px,
        );
        let rich_nodes = ruby_nodes("over", "京", "きょう", 38.0, 15.0);

        let mut flattened = Vec::new();
        let mut warnings = Vec::new();
        flatten_rich_nodes_with_warnings(
            &rich_nodes,
            &default_style,
            &mut flattened,
            1.0,
            &mut warnings,
        );

        match &flattened[0] {
            RichInlineNode::Ruby(ruby) => assert_eq!(ruby.ruby_line_sizing, RubyLineSizing::Css),
            RichInlineNode::Segment(_)
            | RichInlineNode::InlineBox(_)
            | RichInlineNode::InlineRect(_)
            | RichInlineNode::DecoratedSpan(_) => {
                panic!("expected ruby node")
            }
        }
    }

    #[test]
    fn ruby_over_under_physical_direction_is_stable() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let horizontal_over = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&ruby_nodes("over", "京", "きょう", 24.0, 12.0)),
                font_size_px: 24.0,
                ..test_request()
            },
            &font_ctx,
        )
        .expect("horizontal over ruby");
        let (base, rt) = find_glyph_pair(&horizontal_over, "京", "き");
        assert!(rt.origin_y < base.origin_y);

        let horizontal_under = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&ruby_nodes("under", "京", "きょう", 24.0, 12.0)),
                font_size_px: 24.0,
                ..test_request()
            },
            &font_ctx,
        )
        .expect("horizontal under ruby");
        let (base, rt) = find_glyph_pair(&horizontal_under, "京", "き");
        assert!(rt.origin_y > base.origin_y);

        let vertical_over = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&ruby_nodes("over", "都", "みやこ", 24.0, 12.0)),
                font_size_px: 24.0,
                max_height: Some(220.0),
                max_width: 200.0,
                writing_mode: WritingMode::VerticalRl,
                ..test_request()
            },
            &font_ctx,
        )
        .expect("vertical over ruby");
        let (base, rt) = find_glyph_pair(&vertical_over, "都", "み");
        assert!(rt.origin_x > base.origin_x);

        let vertical_under = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&ruby_nodes("under", "都", "みやこ", 24.0, 12.0)),
                font_size_px: 24.0,
                max_height: Some(220.0),
                max_width: 200.0,
                writing_mode: WritingMode::VerticalRl,
                ..test_request()
            },
            &font_ctx,
        )
        .expect("vertical under ruby");
        let (base, rt) = find_glyph_pair(&vertical_under, "都", "み");
        assert!(rt.origin_x < base.origin_x);
    }

    #[test]
    fn ruby_gap_and_offset_move_annotation_away_from_base() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let default_result = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&ruby_nodes("over", "京", "きょう", 38.0, 15.0)),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("default ruby layout");

        let offset_nodes = vec![RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: Some(2.0),
            ruby_line_sizing: None,
            style: test_style(38.0, "#111"),
            base: vec![RichTextNodeInput::Text {
                text: "京".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "きょう".to_string(),
                style: test_style(15.0, "#555"),
            }],
            rt_levels: Vec::new(),
        }];
        let offset_result = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&offset_nodes),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("offset ruby layout");

        let tuned_nodes = vec![RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: Some(4.0),
            ruby_offset_px: Some(3.0),
            ruby_line_sizing: None,
            style: test_style(38.0, "#111"),
            base: vec![RichTextNodeInput::Text {
                text: "京".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "きょう".to_string(),
                style: test_style(15.0, "#555"),
            }],
            rt_levels: Vec::new(),
        }];
        let tuned_result = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&tuned_nodes),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("tuned ruby layout");

        let (default_base, default_rt) = find_glyph_pair(&default_result, "京", "き");
        let (tuned_base, tuned_rt) = find_glyph_pair(&tuned_result, "京", "き");
        let default_distance = default_base.origin_y - default_rt.origin_y;
        let tuned_distance = tuned_base.origin_y - tuned_rt.origin_y;
        assert!(tuned_distance > default_distance + 6.0);

        let default_ink_gap = horizontal_ruby_ink_gap(&default_result, &registry, "京");
        let offset_ink_gap = horizontal_ruby_ink_gap(&offset_result, &registry, "京");
        let tuned_ink_gap = horizontal_ruby_ink_gap(&tuned_result, &registry, "京");
        assert!(
            default_ink_gap >= 0.99,
            "default ruby ink should keep visible clearance: gap={default_ink_gap}"
        );
        assert!(
            offset_ink_gap >= 1.99,
            "rubyOffsetPx=2 should create visible ink gap: gap={offset_ink_gap}"
        );
        assert!(
            tuned_ink_gap >= 6.99,
            "rubyGapPx=4 + rubyOffsetPx=3 should create visible ink gap: gap={tuned_ink_gap}"
        );
    }

    #[test]
    fn alternate_ruby_places_second_level_on_opposite_side() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let rich_nodes = vec![RichTextNodeInput::Ruby {
            ruby_position: Some("alternate".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: test_style(38.0, "#111"),
            base: vec![RichTextNodeInput::Text {
                text: "京".to_string(),
            }],
            rt: Vec::new(),
            rt_levels: vec![
                vec![RichTextNodeInput::Span {
                    text: "きょう".to_string(),
                    style: test_style(15.0, "#555"),
                }],
                vec![RichTextNodeInput::Span {
                    text: "訳".to_string(),
                    style: test_style(15.0, "#555"),
                }],
            ],
        }];
        let result = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&rich_nodes),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("alternate ruby layout");
        let glyphs = result.lines[0]
            .positioned_glyphs
            .as_ref()
            .expect("positioned glyphs");
        let base = glyphs
            .iter()
            .find(|glyph| glyph.text == "京")
            .expect("base");
        let first_level = glyphs
            .iter()
            .find(|glyph| glyph.text == "き")
            .expect("first ruby level");
        let second_level = glyphs
            .iter()
            .find(|glyph| glyph.text == "訳")
            .expect("second ruby level");

        assert!(first_level.origin_y < base.origin_y);
        assert!(second_level.origin_y > base.origin_y);
    }

    #[test]
    fn ruby_line_sizing_css_keeps_annotation_out_of_line_box() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let stable_nodes = vec![RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: Some("stable".to_string()),
            style: test_style(38.0, "#111"),
            base: vec![RichTextNodeInput::Text {
                text: "京".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "きょう".to_string(),
                style: test_style(15.0, "#555"),
            }],
            rt_levels: Vec::new(),
        }];
        let css_nodes = vec![RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: Some("css".to_string()),
            style: test_style(38.0, "#111"),
            base: vec![RichTextNodeInput::Text {
                text: "京".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "きょう".to_string(),
                style: test_style(15.0, "#555"),
            }],
            rt_levels: Vec::new(),
        }];
        let default_nodes = vec![RichTextNodeInput::Ruby {
            ruby_position: Some("over".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: test_style(38.0, "#111"),
            base: vec![RichTextNodeInput::Text {
                text: "京".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "きょう".to_string(),
                style: test_style(15.0, "#555"),
            }],
            rt_levels: Vec::new(),
        }];

        let stable_result = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&stable_nodes),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("stable ruby line sizing layout");
        let css_result = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&css_nodes),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("css ruby line sizing layout");
        let default_result = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&default_nodes),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("default ruby line sizing layout");

        assert!(
            stable_result.bbox.h > css_result.bbox.h + 1.0,
            "stable ruby should reserve annotation height: stable={}, css={}",
            stable_result.bbox.h,
            css_result.bbox.h
        );
        assert!((default_result.bbox.h - css_result.bbox.h).abs() < 0.01);
        let (css_base, css_rt) = find_glyph_pair(&css_result, "京", "き");
        assert!(css_rt.origin_y < css_base.origin_y);
    }

    #[test]
    fn horizontal_ruby_line_pitch_stays_uniform_when_line_height_has_room() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let plain_style = test_style_with_line_height(24.0, "#111", 2.0);
        let ruby_style = test_style_with_line_height(24.0, "#111", 2.0);
        let rt_style = test_style_with_line_height(12.0, "#555", 1.0);
        let plain_nodes = vec![RichTextNodeInput::Span {
            text: "前\n京\n後".to_string(),
            style: plain_style.clone(),
        }];
        let ruby_nodes = vec![
            RichTextNodeInput::Span {
                text: "前\n".to_string(),
                style: plain_style.clone(),
            },
            ruby_node_with_line_sizing("over", "京", "きょう", ruby_style, rt_style, None),
            RichTextNodeInput::Span {
                text: "\n後".to_string(),
                style: plain_style,
            },
        ];
        let stable_nodes = vec![
            RichTextNodeInput::Span {
                text: "前\n".to_string(),
                style: test_style_with_line_height(24.0, "#111", 2.0),
            },
            ruby_node_with_line_sizing(
                "over",
                "京",
                "きょう",
                test_style_with_line_height(24.0, "#111", 2.0),
                test_style_with_line_height(12.0, "#555", 1.0),
                Some("stable"),
            ),
            RichTextNodeInput::Span {
                text: "\n後".to_string(),
                style: test_style_with_line_height(24.0, "#111", 2.0),
            },
        ];
        let plain = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&plain_nodes),
                white_space: WhiteSpaceMode::PreWrap,
                max_width: 400.0,
                max_height: Some(400.0),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("plain horizontal layout");
        let ruby = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&ruby_nodes),
                white_space: WhiteSpaceMode::PreWrap,
                max_width: 400.0,
                max_height: Some(400.0),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("ruby horizontal layout");
        let stable = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&stable_nodes),
                white_space: WhiteSpaceMode::PreWrap,
                max_width: 400.0,
                max_height: Some(400.0),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("stable ruby horizontal layout");

        assert_eq!(plain.lines.len(), 3);
        assert_eq!(ruby.lines.len(), 3);
        assert!(
            (ruby.bbox.h - plain.bbox.h).abs() < 0.01,
            "horizontal line pitch should stay uniform: ruby={}, plain={}",
            ruby.bbox.h,
            plain.bbox.h
        );
        assert!(stable.bbox.h > plain.bbox.h + 1.0);
    }

    #[test]
    fn vertical_ruby_column_pitch_stays_uniform_when_line_height_has_room() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let plain_style = test_style_with_line_height(24.0, "#111", 2.0);
        let ruby_style = test_style_with_line_height(24.0, "#111", 2.0);
        let rt_style = test_style_with_line_height(12.0, "#555", 1.0);
        let plain_nodes = vec![RichTextNodeInput::Span {
            text: "前\n都\n後".to_string(),
            style: plain_style.clone(),
        }];
        let ruby_nodes = vec![
            RichTextNodeInput::Span {
                text: "前\n".to_string(),
                style: plain_style.clone(),
            },
            ruby_node_with_line_sizing("over", "都", "みやこ", ruby_style, rt_style, None),
            RichTextNodeInput::Span {
                text: "\n後".to_string(),
                style: plain_style,
            },
        ];
        let stable_nodes = vec![
            RichTextNodeInput::Span {
                text: "前\n".to_string(),
                style: test_style_with_line_height(24.0, "#111", 2.0),
            },
            ruby_node_with_line_sizing(
                "over",
                "都",
                "みやこ",
                test_style_with_line_height(24.0, "#111", 2.0),
                test_style_with_line_height(12.0, "#555", 1.0),
                Some("stable"),
            ),
            RichTextNodeInput::Span {
                text: "\n後".to_string(),
                style: test_style_with_line_height(24.0, "#111", 2.0),
            },
        ];
        let plain = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&plain_nodes),
                white_space: WhiteSpaceMode::PreWrap,
                writing_mode: WritingMode::VerticalRl,
                max_width: 400.0,
                max_height: Some(400.0),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("plain vertical layout");
        let ruby = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&ruby_nodes),
                white_space: WhiteSpaceMode::PreWrap,
                writing_mode: WritingMode::VerticalRl,
                max_width: 400.0,
                max_height: Some(400.0),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("ruby vertical layout");
        let stable = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&stable_nodes),
                white_space: WhiteSpaceMode::PreWrap,
                writing_mode: WritingMode::VerticalRl,
                max_width: 400.0,
                max_height: Some(400.0),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("stable ruby vertical layout");

        assert_eq!(plain.lines.len(), 3);
        assert_eq!(ruby.lines.len(), 3);
        assert!(
            (ruby.bbox.w - plain.bbox.w).abs() < 0.01,
            "vertical column pitch should stay uniform: ruby={}, plain={}",
            ruby.bbox.w,
            plain.bbox.w
        );
        assert!(stable.bbox.w > plain.bbox.w + 1.0);
    }

    #[test]
    fn ruby_line_pitch_expands_only_when_annotation_exceeds_line_height() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let plain_nodes = vec![RichTextNodeInput::Span {
            text: "京".to_string(),
            style: test_style_with_line_height(24.0, "#111", 1.0),
        }];
        let horizontal_ruby_nodes = vec![ruby_node_with_line_sizing(
            "over",
            "京",
            "きょう",
            test_style_with_line_height(24.0, "#111", 1.0),
            test_style_with_line_height(30.0, "#555", 1.0),
            None,
        )];
        let vertical_ruby_nodes = vec![ruby_node_with_line_sizing(
            "over",
            "都",
            "みやこ",
            test_style_with_line_height(24.0, "#111", 1.0),
            test_style_with_line_height(30.0, "#555", 1.0),
            None,
        )];

        let horizontal_plain = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&plain_nodes),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("horizontal plain layout");
        let horizontal_ruby = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&horizontal_ruby_nodes),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("horizontal overflow ruby layout");
        let vertical_plain = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&plain_nodes),
                writing_mode: WritingMode::VerticalRl,
                max_height: Some(400.0),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("vertical plain layout");
        let vertical_ruby = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&vertical_ruby_nodes),
                writing_mode: WritingMode::VerticalRl,
                max_height: Some(400.0),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("vertical overflow ruby layout");

        assert!(horizontal_ruby.bbox.h > horizontal_plain.bbox.h + 1.0);
        assert!(vertical_ruby.bbox.w > vertical_plain.bbox.w + 1.0);
    }

    #[test]
    fn inter_character_ruby_warns_and_falls_back_to_over() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let rich_nodes = vec![RichTextNodeInput::Ruby {
            ruby_position: Some("inter-character".to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: test_style(38.0, "#111"),
            base: vec![RichTextNodeInput::Text {
                text: "案".to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: "あん".to_string(),
                style: test_style(15.0, "#555"),
            }],
            rt_levels: Vec::new(),
        }];
        let result = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&rich_nodes),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("inter-character fallback layout");

        assert!(
            result
                .warnings
                .iter()
                .any(|warning| warning.code == "RUBY_INTER_CHARACTER_FALLBACK")
        );
        let (base, rt) = find_glyph_pair(&result, "案", "あ");
        assert!(rt.origin_y < base.origin_y);
    }

    fn ruby_nodes(
        ruby_position: &str,
        base_text: &str,
        rt_text: &str,
        base_font_size_px: f64,
        rt_font_size_px: f64,
    ) -> Vec<RichTextNodeInput> {
        vec![RichTextNodeInput::Ruby {
            ruby_position: Some(ruby_position.to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: None,
            style: test_style(base_font_size_px, "#111"),
            base: vec![RichTextNodeInput::Text {
                text: base_text.to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: rt_text.to_string(),
                style: test_style(rt_font_size_px, "#555"),
            }],
            rt_levels: Vec::new(),
        }]
    }

    fn ruby_node_with_line_sizing(
        ruby_position: &str,
        base_text: &str,
        rt_text: &str,
        base_style: RichTextStyleInput,
        rt_style: RichTextStyleInput,
        ruby_line_sizing: Option<&str>,
    ) -> RichTextNodeInput {
        RichTextNodeInput::Ruby {
            ruby_position: Some(ruby_position.to_string()),
            ruby_align: Some("center".to_string()),
            ruby_gap_px: None,
            ruby_offset_px: None,
            ruby_line_sizing: ruby_line_sizing.map(str::to_string),
            style: base_style,
            base: vec![RichTextNodeInput::Text {
                text: base_text.to_string(),
            }],
            rt: vec![RichTextNodeInput::Span {
                text: rt_text.to_string(),
                style: rt_style,
            }],
            rt_levels: Vec::new(),
        }
    }

    fn test_style_with_line_height(
        font_size_px: f64,
        color: &str,
        line_height: f64,
    ) -> RichTextStyleInput {
        let mut style = test_style(font_size_px, color);
        style.line_height = Some(line_height);
        style
    }

    fn find_glyph_pair<'a>(
        result: &'a TextLayoutResult,
        base_text: &str,
        rt_text: &str,
    ) -> (&'a PositionedGlyph, &'a PositionedGlyph) {
        let glyphs = result.lines[0]
            .positioned_glyphs
            .as_ref()
            .expect("positioned glyphs");
        let base = glyphs
            .iter()
            .find(|glyph| glyph.text == base_text)
            .expect("base glyph");
        let rt = glyphs
            .iter()
            .find(|glyph| glyph.text == rt_text)
            .expect("ruby glyph");
        (base, rt)
    }

    fn horizontal_ruby_ink_gap(
        result: &TextLayoutResult,
        registry: &FontRegistry,
        base_text: &str,
    ) -> f64 {
        let glyphs = result.lines[0]
            .positioned_glyphs
            .as_ref()
            .expect("positioned glyphs");
        let base_glyphs: Vec<PositionedGlyph> = glyphs
            .iter()
            .filter(|glyph| glyph.text == base_text)
            .cloned()
            .collect();
        let rt_glyphs: Vec<PositionedGlyph> = glyphs
            .iter()
            .filter(|glyph| glyph.text != base_text)
            .cloned()
            .collect();
        let context = RubyInkBoundsContext {
            font_registry: registry,
            fallback_registry: None,
            axis: RubyInkAxis::Horizontal,
        };
        let base_bounds = glyphs_ink_bounds(&base_glyphs, &context).expect("base bounds");
        let rt_bounds = glyphs_ink_bounds(&rt_glyphs, &context).expect("ruby bounds");
        base_bounds.min_y - rt_bounds.max_y
    }

    #[test]
    fn ruby_annotations_do_not_expand_base_inline_advance() {
        let registry = test_font_registry();

        let horizontal_plain_nodes = vec![RichTextNodeInput::Text {
            text: "東京都".to_string(),
        }];
        let horizontal_ruby_nodes = vec![
            RichTextNodeInput::Text {
                text: "東".to_string(),
            },
            RichTextNodeInput::Ruby {
                ruby_position: Some("over".to_string()),
                ruby_align: Some("start".to_string()),
                ruby_gap_px: None,
                ruby_offset_px: None,
                ruby_line_sizing: None,
                style: test_style(38.0, "#f8fafc"),
                base: vec![RichTextNodeInput::Text {
                    text: "京".to_string(),
                }],
                rt: vec![RichTextNodeInput::Span {
                    text: "きょう".to_string(),
                    style: test_style(15.0, "#fca5a5"),
                }],
                rt_levels: Vec::new(),
            },
            RichTextNodeInput::Text {
                text: "都".to_string(),
            },
        ];

        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let horizontal_plain = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&horizontal_plain_nodes),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("horizontal plain layout");
        let horizontal_ruby = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&horizontal_ruby_nodes),
                ..test_request()
            },
            &font_ctx,
        )
        .expect("horizontal ruby layout");

        let horizontal_plain_glyph = horizontal_plain.lines[0]
            .positioned_glyphs
            .as_ref()
            .expect("horizontal plain glyphs")
            .iter()
            .find(|glyph| glyph.text == "都")
            .expect("horizontal plain next glyph");
        let horizontal_ruby_glyph = horizontal_ruby.lines[0]
            .positioned_glyphs
            .as_ref()
            .expect("horizontal ruby glyphs")
            .iter()
            .find(|glyph| glyph.text == "都")
            .expect("horizontal ruby next glyph");

        assert!((horizontal_ruby.bbox.w - horizontal_plain.bbox.w).abs() < 0.01);
        assert!((horizontal_ruby_glyph.origin_x - horizontal_plain_glyph.origin_x).abs() < 0.01);

        let vertical_plain_nodes = vec![RichTextNodeInput::Text {
            text: "古都案内".to_string(),
        }];
        let vertical_ruby_nodes = vec![
            RichTextNodeInput::Text {
                text: "古".to_string(),
            },
            RichTextNodeInput::Ruby {
                ruby_position: Some("under".to_string()),
                ruby_align: Some("start".to_string()),
                ruby_gap_px: None,
                ruby_offset_px: None,
                ruby_line_sizing: None,
                style: test_style(30.0, "#fde68a"),
                base: vec![RichTextNodeInput::Text {
                    text: "都".to_string(),
                }],
                rt: vec![RichTextNodeInput::Span {
                    text: "みやこ".to_string(),
                    style: test_style(12.0, "#93c5fd"),
                }],
                rt_levels: Vec::new(),
            },
            RichTextNodeInput::Text {
                text: "案内".to_string(),
            },
        ];
        let vertical_stable_ruby_nodes = vec![
            RichTextNodeInput::Text {
                text: "古".to_string(),
            },
            RichTextNodeInput::Ruby {
                ruby_position: Some("under".to_string()),
                ruby_align: Some("start".to_string()),
                ruby_gap_px: None,
                ruby_offset_px: None,
                ruby_line_sizing: Some("stable".to_string()),
                style: test_style(30.0, "#fde68a"),
                base: vec![RichTextNodeInput::Text {
                    text: "都".to_string(),
                }],
                rt: vec![RichTextNodeInput::Span {
                    text: "みやこ".to_string(),
                    style: test_style(12.0, "#93c5fd"),
                }],
                rt_levels: Vec::new(),
            },
            RichTextNodeInput::Text {
                text: "案内".to_string(),
            },
        ];

        let vertical_plain = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&vertical_plain_nodes),
                font_size_px: 30.0,
                max_height: Some(520.0),
                max_width: 260.0,
                line_height: Some(1.4),
                writing_mode: WritingMode::VerticalRl,
                ..test_request()
            },
            &font_ctx,
        )
        .expect("vertical plain layout");
        let vertical_ruby = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&vertical_ruby_nodes),
                font_size_px: 30.0,
                max_height: Some(520.0),
                max_width: 260.0,
                line_height: Some(1.4),
                writing_mode: WritingMode::VerticalRl,
                ..test_request()
            },
            &font_ctx,
        )
        .expect("vertical ruby layout");
        let vertical_stable_ruby = layout_rich_text(
            &TextLayoutRequest {
                rich_text: Some(&vertical_stable_ruby_nodes),
                font_size_px: 30.0,
                max_height: Some(520.0),
                max_width: 260.0,
                line_height: Some(1.4),
                writing_mode: WritingMode::VerticalRl,
                ..test_request()
            },
            &font_ctx,
        )
        .expect("vertical stable ruby layout");

        let vertical_plain_glyph = vertical_plain.lines[0]
            .positioned_glyphs
            .as_ref()
            .expect("vertical plain glyphs")
            .iter()
            .find(|glyph| glyph.text == "案")
            .expect("vertical plain next glyph");
        let vertical_ruby_glyph = vertical_ruby.lines[0]
            .positioned_glyphs
            .as_ref()
            .expect("vertical ruby glyphs")
            .iter()
            .find(|glyph| glyph.text == "案")
            .expect("vertical ruby next glyph");

        assert!(
            vertical_ruby.bbox.w > vertical_plain.bbox.w + 0.01,
            "css vertical ruby should expand only when annotation exceeds the requested column pitch"
        );
        assert!(
            vertical_stable_ruby.bbox.w > vertical_ruby.bbox.w + 0.01,
            "stable vertical ruby should reserve more cross-axis space than css when both must expand"
        );
        assert!(vertical_stable_ruby.bbox.w > vertical_plain.bbox.w + 0.01);
        assert!((vertical_ruby_glyph.origin_y - vertical_plain_glyph.origin_y).abs() < 0.01);
    }

    // -----------------------------------------------------------------------
    // InlineBox tests
    // -----------------------------------------------------------------------

    fn test_resolved_style(font_size_px: f64) -> ResolvedStyle {
        ResolvedStyle {
            font_families: vec!["NotoSansJP".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px,
            line_height: None,
            line_height_px: None,
            letter_spacing_px: 0.0,
            language: Some("ja".to_string()),
            color: Some("#000".to_string()),
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_orientation: TextOrientation::Mixed,
            text_decoration: None,
        }
    }

    fn test_glyph(glyph_id: u32, cluster: u32, x_advance: f64, y_advance: f64) -> GlyphInfo {
        GlyphInfo {
            glyph_id,
            x_advance,
            y_advance,
            x_offset: 0.0,
            y_offset: 0.0,
            cluster,
            font_alias: Some("NotoSansJP".to_string()),
            font_weight: Some(400),
            font_style: Some(FontStyle::Normal),
            rotation_deg: Some(0),
        }
    }

    #[test]
    fn empty_segments_do_not_create_layout_tokens() {
        let mut style = test_resolved_style(72.0);
        style.letter_spacing_px = 12.0;
        let nodes = [RichInlineNode::Segment(RichSegment {
            text: String::new(),
            style: style.clone(),
            combine: false,
            decoration_runs: Vec::new(),
        })];
        let request = TextLayoutRequest {
            wrap: WrapMode::None,
            ..test_request()
        };
        let registry = test_font_registry();
        let (tokens, decoration_spans) =
            build_tokens(&nodes, &request, &registry, None, &style).expect("build tokens");

        assert!(tokens.is_empty());
        assert!(decoration_spans.is_empty());
    }

    #[test]
    fn contextual_cluster_distribution_keeps_ligatures_atomic() {
        let text = "AVfiX";
        let graphemes = grapheme_split(text);
        let mut style = test_resolved_style(20.0);
        style.letter_spacing_px = 1.5;
        let registry = test_font_registry();

        let horizontal_request = TextLayoutRequest {
            wrap: WrapMode::Char,
            ..test_request()
        };
        let horizontal_glyphs = vec![
            test_glyph(1, 0, 9.0, 0.0),
            test_glyph(2, 1, 8.0, 0.0),
            test_glyph(3, 2, 12.0, 0.0),
            test_glyph(4, 4, 10.0, 0.0),
        ];
        let horizontal = distribute_contextually_shaped_plain_tokens(
            text,
            &graphemes,
            &style,
            &horizontal_request,
            &registry,
            None,
            &horizontal_glyphs,
        )
        .expect("horizontal distribution");

        assert_eq!(
            horizontal
                .iter()
                .map(|token| token.text.as_str())
                .collect::<Vec<_>>(),
            ["A", "V", "f", "i", "X"]
        );
        assert_eq!(
            horizontal
                .iter()
                .map(|token| token.advance)
                .collect::<Vec<_>>(),
            [9.0, 8.0, 12.0, 0.0, 10.0]
        );
        assert_eq!(horizontal[2].glyphs[0].text, "fi");
        assert!(horizontal[3].glyphs.is_empty());
        assert_eq!(horizontal[4].trailing_tracking_px, 1.5);
        assert!(
            horizontal[..4]
                .iter()
                .all(|token| token.trailing_tracking_px == 0.0)
        );

        let horizontal_lines = break_tokens_horizontal(
            &horizontal,
            29.0,
            0.0,
            WrapMode::Char,
            None,
            None,
            &[],
            false,
        )
        .expect("horizontal lines");
        assert_eq!(
            horizontal_lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            ["AVfi", "X"]
        );

        let vertical_request = TextLayoutRequest {
            wrap: WrapMode::Char,
            writing_mode: WritingMode::VerticalRl,
            ..test_request()
        };
        let vertical_glyphs = vec![
            test_glyph(1, 0, 0.0, -9.0),
            test_glyph(2, 1, 0.0, -8.0),
            test_glyph(3, 2, 0.0, -12.0),
            test_glyph(4, 4, 0.0, -10.0),
        ];
        let vertical = distribute_contextually_shaped_plain_tokens(
            text,
            &graphemes,
            &style,
            &vertical_request,
            &registry,
            None,
            &vertical_glyphs,
        )
        .expect("vertical distribution");
        assert_eq!(
            vertical
                .iter()
                .map(|token| token.advance)
                .collect::<Vec<_>>(),
            [9.0, 8.0, 12.0, 0.0, 10.0]
        );
        assert_eq!(vertical[2].glyphs[0].text, "fi");
        assert!(vertical[3].glyphs.is_empty());

        let vertical_lines =
            break_tokens_vertical(&vertical, 29.0, 0.0, WrapMode::Char, None, None, &[], false)
                .expect("vertical lines");
        assert_eq!(
            vertical_lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            ["AVfi", "X"]
        );
    }

    #[test]
    fn contextual_cluster_distribution_keeps_tracking_after_terminal_ligature() {
        let text = "AVfi";
        let graphemes = grapheme_split(text);
        let mut style = test_resolved_style(20.0);
        style.letter_spacing_px = 1.5;
        let registry = test_font_registry();
        let request = TextLayoutRequest {
            wrap: WrapMode::Char,
            ..test_request()
        };
        let glyphs = vec![
            test_glyph(1, 0, 9.0, 0.0),
            test_glyph(2, 1, 8.0, 0.0),
            test_glyph(3, 2, 12.0, 0.0),
        ];

        let tokens = distribute_contextually_shaped_plain_tokens(
            text, &graphemes, &style, &request, &registry, None, &glyphs,
        )
        .expect("terminal ligature distribution");

        assert_eq!(
            tokens.iter().map(|token| token.advance).collect::<Vec<_>>(),
            [9.0, 8.0, 12.0, 0.0]
        );
        assert_eq!(tokens[2].glyphs[0].text, "fi");
        assert!(tokens[3].glyphs.is_empty());
        assert_eq!(tokens[3].text, "i");
        assert_eq!(tokens[3].trailing_tracking_px, 1.5);
        assert!(
            tokens[..3]
                .iter()
                .all(|token| token.trailing_tracking_px == 0.0)
        );
    }

    #[test]
    fn positioned_glyphs_share_the_full_range_of_a_multi_glyph_cluster() {
        let text = "A\u{fe0f}B";
        let glyphs = vec![
            test_glyph(1, 0, 10.0, -10.0),
            test_glyph(2, 0, 0.0, 0.0),
            test_glyph(3, 4, 10.0, -10.0),
        ];
        let style = test_resolved_style(20.0);
        let first_cluster_end =
            u32::try_from(grapheme_split("A\u{fe0f}").len()).expect("test grapheme count fits u32");

        for positioned in [
            position_horizontal_glyphs(text, &glyphs, &style, 0.0, 0.0),
            position_vertical_glyphs(text, &glyphs, &style, 0.0, 0.0),
        ] {
            assert_eq!(positioned[0].text, "A\u{fe0f}");
            assert_eq!(positioned[1].text, "A\u{fe0f}");
            assert_eq!(positioned[0].cluster_start, 0);
            assert_eq!(positioned[0].cluster_end, 4);
            assert_eq!(positioned[1].cluster_start, 0);
            assert_eq!(positioned[1].cluster_end, 4);
            assert_eq!(positioned[0].source_start, Some(0));
            assert_eq!(positioned[0].source_end, Some(first_cluster_end));
            assert_eq!(positioned[1].source_start, Some(0));
            assert_eq!(positioned[1].source_end, Some(first_cluster_end));
            assert_eq!(positioned[2].source_start, Some(first_cluster_end));
            assert_eq!(positioned[2].source_end, Some(first_cluster_end + 1));
            assert!(
                positioned
                    .iter()
                    .all(|glyph| glyph.source_role.as_deref() == Some("content"))
            );
            assert_eq!(positioned[2].text, "B");
            assert_eq!(positioned[2].cluster_start, 4);
            assert_eq!(positioned[2].cluster_end, 5);
        }
    }

    #[test]
    fn vertical_glyph_advance_preserves_tracking_adjustment_sign() {
        let positive_tracking = test_glyph(1, 0, 0.0, -2.0);
        let negative_tracking = test_glyph(1, 0, 0.0, 2.0);

        assert_eq!(glyph_advance_in_vertical(&positive_tracking), 2.0);
        assert_eq!(glyph_advance_in_vertical(&negative_tracking), -2.0);
    }

    #[test]
    fn ruby_alignment_moves_all_glyphs_in_one_cluster_together() {
        let text = "A\u{fe0f}B";
        let glyphs = vec![
            test_glyph(1, 0, 10.0, -10.0),
            test_glyph(2, 0, 0.0, 0.0),
            test_glyph(3, 4, 10.0, -10.0),
        ];
        let style = test_resolved_style(20.0);

        let mut horizontal = position_horizontal_glyphs(text, &glyphs, &style, 0.0, 0.0);
        let before_x: Vec<f64> = horizontal.iter().map(|glyph| glyph.origin_x).collect();
        align_ruby_glyphs_horizontal(&mut horizontal, 20.0, 40.0, RubyAlign::SpaceBetween);
        assert_eq!(
            horizontal[0].origin_x - before_x[0],
            horizontal[1].origin_x - before_x[1]
        );
        assert!(horizontal[2].origin_x - before_x[2] > 19.9);

        let mut vertical = position_vertical_glyphs(text, &glyphs, &style, 0.0, 0.0);
        let before_y: Vec<f64> = vertical.iter().map(|glyph| glyph.origin_y).collect();
        align_ruby_glyphs_vertical(&mut vertical, 20.0, 40.0, RubyAlign::SpaceBetween);
        assert_eq!(
            vertical[0].origin_y - before_y[0],
            vertical[1].origin_y - before_y[1]
        );
        assert!(vertical[2].origin_y - before_y[2] > 19.9);
    }

    #[test]
    fn ruby_segment_boundaries_keep_tracking_in_both_writing_modes() {
        let registry = test_font_registry();
        let mut tracked_style = test_resolved_style(20.0);
        tracked_style.letter_spacing_px = 4.0;
        let plain_style = test_resolved_style(20.0);
        let make_segments = |style: &ResolvedStyle| {
            vec![
                RichSegment {
                    text: "A".to_string(),
                    style: style.clone(),
                    combine: false,
                    decoration_runs: Vec::new(),
                },
                RichSegment {
                    text: "B".to_string(),
                    style: style.clone(),
                    combine: false,
                    decoration_runs: Vec::new(),
                },
            ]
        };

        let (_, horizontal_plain) =
            shape_segment_run_horizontal(&make_segments(&plain_style), &registry, None, 0.0, 0.0)
                .expect("horizontal plain ruby run");
        let (_, horizontal_tracked) =
            shape_segment_run_horizontal(&make_segments(&tracked_style), &registry, None, 0.0, 0.0)
                .expect("horizontal tracked ruby run");
        assert!((horizontal_tracked - horizontal_plain - 4.0).abs() < 0.01);

        let (_, vertical_plain) =
            shape_segment_run_vertical(&make_segments(&plain_style), &registry, None, 0.0, 0.0)
                .expect("vertical plain ruby run");
        let (_, vertical_tracked) =
            shape_segment_run_vertical(&make_segments(&tracked_style), &registry, None, 0.0, 0.0)
                .expect("vertical tracked ruby run");
        assert!((vertical_tracked - vertical_plain - 4.0).abs() < 0.01);
    }

    #[test]
    fn vertical_combine_keeps_tracking_at_its_outer_boundary() {
        let registry = test_font_registry();
        let default_style = test_resolved_style(20.0);
        let mut combine_style = default_style.clone();
        combine_style.letter_spacing_px = 3.0;
        let segment = RichSegment {
            text: "12".to_string(),
            style: combine_style,
            combine: true,
            decoration_runs: Vec::new(),
        };
        let request = TextLayoutRequest {
            writing_mode: WritingMode::VerticalRl,
            ..test_request()
        };

        let token =
            build_vertical_combine_token(&segment, &request, &registry, None, &default_style)
                .expect("vertical combine token");
        assert_eq!(token.trailing_tracking_px, 3.0);
    }

    fn test_rich_style(font_size_px: f64) -> RichTextStyleInput {
        RichTextStyleInput {
            font_family: vec!["NotoSansJP".to_string()],
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px,
            line_height: None,
            line_height_px: None,
            letter_spacing_px: Some(0.0),
            language: Some("ja".to_string()),
            color: Some("#000".to_string()),
            text_strokes: None,
            text_shadows: None,
            font_variation_settings: None,
            font_feature_settings: None,
            text_orientation: None,
            text_decoration: None,
        }
    }

    #[test]
    fn atomic_tokens_preserve_distinct_leading_and_trailing_kinsoku_languages() {
        let registry = test_font_registry();
        let request = TextLayoutRequest {
            font_size_px: 20.0,
            ..test_request()
        };
        let default_style = build_default_style(
            &request,
            &["NotoSansJP".to_string()],
            400,
            &FontStyle::Normal,
            20.0,
        );
        let mut neutral_style = test_resolved_style(20.0);
        neutral_style.language = Some("en".to_string());
        let ja_style = test_resolved_style(20.0);
        let mixed_segments = || {
            vec![
                RichSegment {
                    text: "A".to_string(),
                    style: neutral_style.clone(),
                    combine: false,
                    decoration_runs: Vec::new(),
                },
                RichSegment {
                    text: "」".to_string(),
                    style: ja_style.clone(),
                    combine: false,
                    decoration_runs: Vec::new(),
                },
            ]
        };

        let inline_box = RichInlineBox {
            children: mixed_segments()
                .into_iter()
                .map(RichInlineNode::Segment)
                .collect(),
            padding_inline: [0.0, 0.0],
            border_width: 0.0,
            background: None,
            border_color: None,
            border_radius: None,
            span_key: None,
        };
        let inline_box_token = build_horizontal_inline_box_token(
            &inline_box,
            &request,
            &registry,
            None,
            &default_style,
        )
        .expect("mixed-language inline box token");
        assert_eq!(inline_box_token.kinsoku_start, Some(false));
        assert_eq!(inline_box_token.kinsoku_end, Some(true));

        let ruby = RichRuby {
            ruby_position: RubyPosition::Over,
            ruby_align: RubyAlign::Center,
            ruby_gap_px: 0.0,
            ruby_offset_px: 0.0,
            ruby_line_sizing: RubyLineSizing::Css,
            base: mixed_segments(),
            rt_levels: Vec::new(),
        };
        let ruby_token =
            build_horizontal_ruby_token(&ruby, &request, &registry, None, &default_style)
                .expect("mixed-language ruby token");
        assert_eq!(ruby_token.kinsoku_start, Some(false));
        assert_eq!(ruby_token.kinsoku_end, Some(true));
    }

    #[test]
    fn inline_box_reserved_advance_calculation() {
        let padding_start = 4.0;
        let padding_end = 6.0;
        let border_width = 2.0;

        let ibox = RichInlineBox {
            children: vec![RichInlineNode::Segment(RichSegment {
                text: "test".to_string(),
                style: test_resolved_style(16.0),
                combine: false,
                decoration_runs: Vec::new(),
            })],
            padding_inline: [padding_start, padding_end],
            border_width,
            background: Some("#eee".to_string()),
            border_color: Some("#ccc".to_string()),
            border_radius: Some(4.0),
            span_key: None,
        };

        let reserved = ibox.padding_inline[0] + ibox.padding_inline[1] + ibox.border_width * 2.0;
        assert!((reserved - 14.0).abs() < f64::EPSILON);
    }

    #[test]
    fn inline_box_stays_atomic_across_lines() {
        // Create tokens where the inline box token is wider than max_width
        // so it must stay on its own line (not be split)
        let tokens = vec![
            test_break_token("hello ", 30.0),
            LayoutToken {
                text: "world".to_string(),
                kinsoku_start: None,
                kinsoku_end: None,
                advance: 80.0,
                cross_size: 20.0,
                reference_offset: 10.0,
                glyphs: Vec::new(),
                inline_rects: Vec::new(),
                inline_box_decoration: Some(InlineBoxDecorationInput {
                    total_advance: 80.0,
                    cross_size: 20.0,
                    background: Some("#eee".to_string()),
                    border_color: None,
                    border_width: None,
                    border_radius: None,
                    span_key: None,
                }),
                nested_decorations: Vec::new(),
                decoration_span_id: None,
                decoration_start_advance: 0.0,
                decoration_end_advance: 0.0,
                flow_ruby: None,
                trailing_tracking_px: 0.0,
            },
            test_break_token("!", 5.0),
        ];
        let max_width = 100.0;
        let lines = break_tokens_horizontal(
            &tokens,
            max_width,
            0.0,
            WrapMode::Char,
            None,
            None,
            &[],
            false,
        )
        .expect("should produce lines");

        // The inline box token (80px) should not be split
        // It should be placed on the same line as "hello " (30+80=110 > 100)
        // so it wraps to the next line
        assert!(
            lines.len() >= 2,
            "Expected at least 2 lines but got {}",
            lines.len()
        );
        // Second line should contain the inline box text
        assert!(lines[1].text.contains("world"));
        // The decoration should be present on the second line
        assert_eq!(lines[1].decorations.len(), 1);
    }

    #[test]
    fn inline_box_decoration_has_correct_position() {
        let tokens = vec![
            test_break_token("ab", 20.0),
            LayoutToken {
                text: "box".to_string(),
                kinsoku_start: None,
                kinsoku_end: None,
                advance: 40.0,
                cross_size: 20.0,
                reference_offset: 10.0,
                glyphs: Vec::new(),
                inline_rects: Vec::new(),
                inline_box_decoration: Some(InlineBoxDecorationInput {
                    total_advance: 40.0,
                    cross_size: 20.0,
                    background: Some("#ff0".to_string()),
                    border_color: Some("#000".to_string()),
                    border_width: Some(1.0),
                    border_radius: Some([3.0, 3.0, 3.0, 3.0]),
                    span_key: None,
                }),
                nested_decorations: Vec::new(),
                decoration_span_id: None,
                decoration_start_advance: 0.0,
                decoration_end_advance: 0.0,
                flow_ruby: None,
                trailing_tracking_px: 0.0,
            },
        ];

        let lines =
            break_tokens_horizontal(&tokens, 200.0, 0.0, WrapMode::Char, None, None, &[], false)
                .expect("should produce lines");

        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].decorations.len(), 1);

        let deco = &lines[0].decorations[0];
        assert!(
            (deco.offset - 20.0).abs() < 0.01,
            "x_offset should be after 'ab' (20px)"
        );
        assert!((deco.advance - 40.0).abs() < 0.01, "advance should be 40px");
        assert_eq!(deco.background.as_deref(), Some("#ff0"));
        assert_eq!(deco.border_color.as_deref(), Some("#000"));
        assert_eq!(deco.border_width, Some(1.0));
        assert_eq!(deco.border_radius, Some([3.0, 3.0, 3.0, 3.0]));
    }

    #[test]
    fn flatten_inline_box_accepts_ruby_and_nested_inline_box() {
        use crate::text::types::RichTextNodeInput;
        let nodes = vec![RichTextNodeInput::InlineBox {
            style: test_rich_style(16.0),
            children: vec![
                RichTextNodeInput::Text {
                    text: "valid".to_string(),
                },
                // Ruby is allowed inside InlineBox
                RichTextNodeInput::Ruby {
                    ruby_position: None,
                    ruby_align: None,
                    ruby_gap_px: None,
                    ruby_offset_px: None,
                    ruby_line_sizing: None,
                    style: test_rich_style(10.0),
                    base: vec![RichTextNodeInput::Text {
                        text: "base".to_string(),
                    }],
                    rt: vec![RichTextNodeInput::Text {
                        text: "rt".to_string(),
                    }],
                    rt_levels: Vec::new(),
                },
                // Nested InlineBox is now accepted
                RichTextNodeInput::InlineBox {
                    style: test_rich_style(16.0),
                    children: vec![RichTextNodeInput::Text {
                        text: "nested".to_string(),
                    }],
                    padding_inline: None,
                    background: None,
                    border_color: None,
                    border_width: None,
                    border_radius: None,
                    span_key: None,
                },
            ],
            padding_inline: Some([4.0, 4.0]),
            background: Some("#eee".to_string()),
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: None,
        }];

        let default_style = test_resolved_style(16.0);
        let mut inline_nodes = Vec::new();
        let mut warnings = Vec::new();
        flatten_rich_nodes_with_warnings(
            &nodes,
            &default_style,
            &mut inline_nodes,
            1.0,
            &mut warnings,
        );

        assert_eq!(inline_nodes.len(), 1);
        if let RichInlineNode::InlineBox(ref ibox) = inline_nodes[0] {
            // "valid" (Segment) + Ruby + nested InlineBox all accepted
            assert_eq!(ibox.children.len(), 3);
            if let RichInlineNode::Segment(ref seg) = ibox.children[0] {
                assert_eq!(seg.text, "valid");
            } else {
                panic!("Expected Segment, got {:?}", ibox.children[0]);
            }
            assert!(
                matches!(ibox.children[1], RichInlineNode::Ruby(_)),
                "Expected Ruby, got {:?}",
                ibox.children[1]
            );
            assert!(
                matches!(ibox.children[2], RichInlineNode::InlineBox(_)),
                "Expected nested InlineBox, got {:?}",
                ibox.children[2]
            );
        } else {
            panic!("Expected InlineBox, got {:?}", inline_nodes[0]);
        }

        // No warnings — nested InlineBox is now accepted
        assert_eq!(warnings.len(), 0);
    }

    // ── Vertical InlineBox tests ──────────────────────────────────

    #[test]
    fn vertical_inline_box_advance_includes_padding_and_border() {
        let padding_start = 4.0;
        let padding_end = 6.0;
        let border_width = 2.0;
        let child_advance = 50.0;

        let ibox_token = LayoutToken {
            text: "vert".to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance: child_advance + padding_start + padding_end + border_width * 2.0,
            cross_size: 20.0,
            reference_offset: 10.0,
            glyphs: Vec::new(),
            inline_rects: Vec::new(),
            inline_box_decoration: Some(InlineBoxDecorationInput {
                total_advance: child_advance + padding_start + padding_end + border_width * 2.0,
                cross_size: 20.0,
                background: Some("#eee".to_string()),
                border_color: Some("#ccc".to_string()),
                border_width: Some(border_width),
                border_radius: Some([4.0, 4.0, 4.0, 4.0]),
                span_key: None,
            }),
            nested_decorations: Vec::new(),
            decoration_span_id: None,
            decoration_start_advance: 0.0,
            decoration_end_advance: 0.0,
            flow_ruby: None,
            trailing_tracking_px: 0.0,
        };

        let expected_advance = child_advance + padding_start + padding_end + border_width * 2.0;
        assert!(
            (ibox_token.advance - expected_advance).abs() < f64::EPSILON,
            "vertical InlineBox advance should include padding + border"
        );
    }

    #[test]
    fn vertical_inline_box_stays_atomic_across_columns() {
        let tokens = vec![
            test_break_token("A", 30.0),
            LayoutToken {
                text: "box".to_string(),
                kinsoku_start: None,
                kinsoku_end: None,
                advance: 80.0,
                cross_size: 20.0,
                reference_offset: 10.0,
                glyphs: Vec::new(),
                inline_rects: Vec::new(),
                inline_box_decoration: Some(InlineBoxDecorationInput {
                    total_advance: 80.0,
                    cross_size: 20.0,
                    background: Some("#eee".to_string()),
                    border_color: None,
                    border_width: None,
                    border_radius: None,
                    span_key: None,
                }),
                nested_decorations: Vec::new(),
                decoration_span_id: None,
                decoration_start_advance: 0.0,
                decoration_end_advance: 0.0,
                flow_ruby: None,
                trailing_tracking_px: 0.0,
            },
            test_break_token("!", 5.0),
        ];
        let max_height = 100.0;
        let columns = break_tokens_vertical(
            &tokens,
            max_height,
            0.0,
            WrapMode::Char,
            None,
            None,
            &[],
            false,
        )
        .expect("should produce columns");

        assert!(
            columns.len() >= 2,
            "Expected at least 2 columns but got {}",
            columns.len()
        );
        assert!(columns[1].text.contains("box"));
        assert_eq!(columns[1].decorations.len(), 1);
    }

    #[test]
    fn vertical_inline_box_decoration_has_correct_offset() {
        let tokens = vec![
            test_break_token("ab", 20.0),
            LayoutToken {
                text: "box".to_string(),
                kinsoku_start: None,
                kinsoku_end: None,
                advance: 40.0,
                cross_size: 20.0,
                reference_offset: 10.0,
                glyphs: Vec::new(),
                inline_rects: Vec::new(),
                inline_box_decoration: Some(InlineBoxDecorationInput {
                    total_advance: 40.0,
                    cross_size: 20.0,
                    background: Some("#ff0".to_string()),
                    border_color: Some("#000".to_string()),
                    border_width: Some(1.0),
                    border_radius: Some([3.0, 3.0, 3.0, 3.0]),
                    span_key: None,
                }),
                nested_decorations: Vec::new(),
                decoration_span_id: None,
                decoration_start_advance: 0.0,
                decoration_end_advance: 0.0,
                flow_ruby: None,
                trailing_tracking_px: 0.0,
            },
        ];

        let columns =
            break_tokens_vertical(&tokens, 200.0, 0.0, WrapMode::Char, None, None, &[], false)
                .expect("should produce columns");

        assert_eq!(columns.len(), 1);
        assert_eq!(columns[0].decorations.len(), 1);

        let deco = &columns[0].decorations[0];
        assert!(
            (deco.offset - 20.0).abs() < 0.01,
            "offset should be after 'ab' (20px), got {}",
            deco.offset
        );
        assert!((deco.advance - 40.0).abs() < 0.01);
        assert_eq!(deco.background.as_deref(), Some("#ff0"));
        assert_eq!(deco.border_color.as_deref(), Some("#000"));
        assert_eq!(deco.border_width, Some(1.0));
        assert_eq!(deco.border_radius, Some([3.0, 3.0, 3.0, 3.0]));
    }

    #[test]
    fn vertical_inline_box_mixed_cross_size_alignment() {
        // When tokens with different cross_size share a column,
        // decorations and glyphs must align to the same reference_offset.
        let narrow_token = test_break_token("A", 10.0);
        let wide_token = LayoutToken {
            text: "box".to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance: 30.0,
            cross_size: 40.0, // wider than default (20.0)
            reference_offset: 20.0,
            glyphs: Vec::new(),
            inline_rects: Vec::new(),
            inline_box_decoration: Some(InlineBoxDecorationInput {
                total_advance: 30.0,
                cross_size: 40.0,
                background: Some("#eee".to_string()),
                border_color: None,
                border_width: None,
                border_radius: None,
                span_key: None,
            }),
            nested_decorations: Vec::new(),
            decoration_span_id: None,
            decoration_start_advance: 0.0,
            decoration_end_advance: 0.0,
            flow_ruby: None,
            trailing_tracking_px: 0.0,
        };

        let column = assemble_vertical_line(&[narrow_token, wide_token], 0.0, &[]);

        // reference_offset should be max of all tokens' reference_offset
        assert!(
            (column.reference_offset - 20.0).abs() < f64::EPSILON,
            "column reference_offset should be max(10, 20) = 20"
        );
        // cross_size = reference_offset + max(cross_size - reference_offset)
        // = 20 + max(20-10, 40-20) = 20 + 20 = 40
        assert!(
            (column.cross_size - 40.0).abs() < f64::EPSILON,
            "column cross_size should accommodate the widest token"
        );

        assert_eq!(column.decorations.len(), 1);
        let deco = &column.decorations[0];
        // Decoration offset should be after the first token's advance (10.0)
        assert!(
            (deco.offset - 10.0).abs() < 0.01,
            "decoration offset should be 10.0, got {}",
            deco.offset
        );
        // cross_offset = line reference_offset (20) - token reference_offset (20) = 0
        // The wide token's reference_offset matches the column's, so no shift.
        assert!(
            deco.cross_offset.abs() < f64::EPSILON,
            "wide token cross_offset should be 0, got {}",
            deco.cross_offset
        );
    }

    #[test]
    fn vertical_inline_box_narrow_token_gets_cross_offset() {
        // A narrow InlineBox in a column with a wider token must receive
        // cross_offset > 0 so its decoration aligns with glyphs.
        let wide_plain = LayoutToken {
            text: "W".to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance: 10.0,
            cross_size: 40.0,
            reference_offset: 20.0,
            glyphs: Vec::new(),
            inline_rects: Vec::new(),
            inline_box_decoration: None,
            nested_decorations: Vec::new(),
            decoration_span_id: None,
            decoration_start_advance: 0.0,
            decoration_end_advance: 0.0,
            flow_ruby: None,
            trailing_tracking_px: 0.0,
        };
        let narrow_ibox = LayoutToken {
            text: "box".to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance: 30.0,
            cross_size: 20.0, // narrower
            reference_offset: 10.0,
            glyphs: Vec::new(),
            inline_rects: Vec::new(),
            inline_box_decoration: Some(InlineBoxDecorationInput {
                total_advance: 30.0,
                cross_size: 20.0,
                background: Some("#eee".to_string()),
                border_color: None,
                border_width: None,
                border_radius: None,
                span_key: None,
            }),
            nested_decorations: Vec::new(),
            decoration_span_id: None,
            decoration_start_advance: 0.0,
            decoration_end_advance: 0.0,
            flow_ruby: None,
            trailing_tracking_px: 0.0,
        };

        let column = assemble_vertical_line(&[wide_plain, narrow_ibox], 0.0, &[]);

        // Column reference_offset = max(20, 10) = 20
        assert_eq!(column.decorations.len(), 1);
        let deco = &column.decorations[0];
        // cross_offset = column reference_offset (20) - token reference_offset (10) = 10
        assert!(
            (deco.cross_offset - 10.0).abs() < f64::EPSILON,
            "narrow InlineBox cross_offset should be 10.0, got {}",
            deco.cross_offset
        );
    }

    #[test]
    fn layout_vertical_tokens_emits_screen_space_decorations() {
        use crate::text::types::{FitMode, Language, TextOrientation, WritingMode};

        let tokens = vec![
            test_break_token("A", 10.0),
            LayoutToken {
                text: "box".to_string(),
                kinsoku_start: None,
                kinsoku_end: None,
                advance: 30.0,
                cross_size: 20.0,
                reference_offset: 10.0,
                glyphs: Vec::new(),
                inline_rects: Vec::new(),
                inline_box_decoration: Some(InlineBoxDecorationInput {
                    total_advance: 30.0,
                    cross_size: 20.0,
                    background: Some("#eee".to_string()),
                    border_color: None,
                    border_width: None,
                    border_radius: None,
                    span_key: None,
                }),
                nested_decorations: Vec::new(),
                decoration_span_id: None,
                decoration_start_advance: 0.0,
                decoration_end_advance: 0.0,
                flow_ruby: None,
                trailing_tracking_px: 0.0,
            },
        ];

        let req = TextLayoutRequest {
            text: "Abox",
            spans: None,
            rich_text: None,
            font_size_px: 16.0,
            line_height: None,
            line_height_px: None,
            letter_spacing_px: 0.0,
            text_indent: None,
            max_width: 100.0,
            max_height: Some(200.0),
            wrap: WrapMode::Char,
            white_space: WhiteSpaceMode::Normal,
            tab_size: 4,
            fit: FitMode::None,
            max_lines: None,
            ellipsis: false,
            language: Language::Auto,
            writing_mode: WritingMode::VerticalRl,
            text_orientation: TextOrientation::Mixed,
            uax14_breaks: None,
            hanging_punctuation: false,
            font_variation_settings: Vec::new(),
            font_feature_settings: Vec::new(),
            min_font_size_px: None,
            shrink_epsilon_px: None,
            shrink_max_iterations: None,
            max_font_size_px: None,
            grow_epsilon_px: None,
            grow_max_iterations: None,
        };

        let result = layout_vertical_tokens(&req, &tokens, &[], 16.0, Vec::new())
            .expect("should produce result");

        assert_eq!(result.inline_box_decorations.len(), 1);
        let deco = &result.inline_box_decorations[0];
        // y = decoration offset along the column (after "A" = 10px)
        assert!(
            (deco.y - 10.0).abs() < 0.01,
            "deco.y should be 10.0, got {}",
            deco.y
        );
        // width = cross_size (column width)
        assert!(
            (deco.width - 20.0).abs() < 0.01,
            "deco.width should be column cross_size"
        );
        // height = advance along the column
        assert!(
            (deco.height - 30.0).abs() < 0.01,
            "deco.height should be decoration advance"
        );
    }

    #[test]
    fn layout_vertical_tokens_decoration_x_includes_cross_offset() {
        use crate::text::types::{FitMode, Language, TextOrientation, WritingMode};

        // Wide plain token (cross_size=40, ref=20) followed by narrow InlineBox
        // (cross_size=20, ref=10). The InlineBox decoration.x must include
        // the cross_offset so it aligns with its glyphs.
        let wide_plain = LayoutToken {
            text: "W".to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance: 10.0,
            cross_size: 40.0,
            reference_offset: 20.0,
            glyphs: Vec::new(),
            inline_rects: Vec::new(),
            inline_box_decoration: None,
            nested_decorations: Vec::new(),
            decoration_span_id: None,
            decoration_start_advance: 0.0,
            decoration_end_advance: 0.0,
            flow_ruby: None,
            trailing_tracking_px: 0.0,
        };
        let narrow_ibox = LayoutToken {
            text: "box".to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance: 30.0,
            cross_size: 20.0,
            reference_offset: 10.0,
            glyphs: Vec::new(),
            inline_rects: Vec::new(),
            inline_box_decoration: Some(InlineBoxDecorationInput {
                total_advance: 30.0,
                cross_size: 20.0,
                background: Some("#eee".to_string()),
                border_color: None,
                border_width: None,
                border_radius: None,
                span_key: None,
            }),
            nested_decorations: Vec::new(),
            decoration_span_id: None,
            decoration_start_advance: 0.0,
            decoration_end_advance: 0.0,
            flow_ruby: None,
            trailing_tracking_px: 0.0,
        };

        let req = TextLayoutRequest {
            text: "Wbox",
            spans: None,
            rich_text: None,
            font_size_px: 16.0,
            line_height: None,
            line_height_px: None,
            letter_spacing_px: 0.0,
            text_indent: None,
            max_width: 100.0,
            max_height: Some(200.0),
            wrap: WrapMode::Char,
            white_space: WhiteSpaceMode::Normal,
            tab_size: 4,
            fit: FitMode::None,
            max_lines: None,
            ellipsis: false,
            language: Language::Auto,
            writing_mode: WritingMode::VerticalRl,
            text_orientation: TextOrientation::Mixed,
            uax14_breaks: None,
            hanging_punctuation: false,
            font_variation_settings: Vec::new(),
            font_feature_settings: Vec::new(),
            min_font_size_px: None,
            shrink_epsilon_px: None,
            shrink_max_iterations: None,
            max_font_size_px: None,
            grow_epsilon_px: None,
            grow_max_iterations: None,
        };

        let tokens = vec![wide_plain, narrow_ibox];
        let result = layout_vertical_tokens(&req, &tokens, &[], 16.0, Vec::new())
            .expect("should produce result");

        assert_eq!(result.inline_box_decorations.len(), 1);
        let deco = &result.inline_box_decorations[0];

        // Single column: cross_size = max(40, 20) = 40, so x_cursor starts at 40
        // then decrements by column cross_size (40), giving x_cursor = 0.
        // cross_offset for the narrow token = line ref (20) - token ref (10) = 10.
        // Final deco.x = x_cursor (0) + cross_offset (10) = 10.
        assert!(
            (deco.x - 10.0).abs() < 0.01,
            "deco.x should be x_cursor + cross_offset = 10, got {}",
            deco.x
        );
    }

    #[test]
    fn build_vertical_inline_box_token_real_shaping() {
        use crate::font::registry::{FontRegistry, FontStyle};

        let mut registry = FontRegistry::new();
        let data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font");
        registry
            .register(data, "NotoSansJP".to_string(), 400, FontStyle::Normal)
            .expect("register font");

        let padding_start = 4.0;
        let padding_end = 6.0;
        let border_width = 2.0;
        let ibox = RichInlineBox {
            children: vec![RichInlineNode::Segment(RichSegment {
                text: "東京".to_string(),
                style: test_resolved_style(16.0),
                combine: false,
                decoration_runs: Vec::new(),
            })],
            padding_inline: [padding_start, padding_end],
            border_width,
            background: Some("#eee".to_string()),
            border_color: Some("#ccc".to_string()),
            border_radius: Some(4.0),
            span_key: None,
        };

        let req = TextLayoutRequest {
            writing_mode: WritingMode::VerticalRl,
            ..test_request()
        };
        let default_style = test_resolved_style(req.font_size_px);

        let token = build_vertical_inline_box_token(&ibox, &req, &registry, None, &default_style)
            .expect("should build token");

        // advance = children vertical advance + padding + border*2
        let reserved = padding_start + padding_end + border_width * 2.0;
        assert!(
            token.advance > reserved,
            "advance ({}) should exceed reserved ({})",
            token.advance,
            reserved
        );
        // cross_size = lane width (line height)
        let lane_width = resolve_style_line_metrics(&registry, None, &default_style).line_height_px;
        assert!(
            (token.cross_size - lane_width).abs() < f64::EPSILON,
            "cross_size should be lane width"
        );
        // reference_offset = center of lane
        assert!(
            (token.reference_offset - lane_width * 0.5).abs() < f64::EPSILON,
            "reference_offset should be lane center"
        );
        // decoration metadata present
        let deco = token.inline_box_decoration.as_ref().expect("decoration");
        assert!((deco.total_advance - token.advance).abs() < f64::EPSILON);
        assert_eq!(deco.background.as_deref(), Some("#eee"));
        assert_eq!(deco.border_color.as_deref(), Some("#ccc"));
        assert_eq!(deco.border_width, Some(border_width));
        assert_eq!(deco.border_radius, Some([4.0, 4.0, 4.0, 4.0]));
        // glyphs present and positioned with content_offset
        assert!(
            !token.glyphs.is_empty(),
            "should have positioned glyphs from shaping"
        );
    }

    #[test]
    fn build_vertical_inline_box_token_honors_combined_segment() {
        let registry = test_font_registry();
        let font_size_px = 32.0;
        let padding_inline = [3.0, 3.0];
        let border_width = 1.0;
        let make_inline_box = |combine| RichInlineBox {
            children: vec![RichInlineNode::Segment(RichSegment {
                text: "12".to_string(),
                style: test_resolved_style(font_size_px),
                combine,
                decoration_runs: Vec::new(),
            })],
            padding_inline,
            border_width,
            background: None,
            border_color: None,
            border_radius: None,
            span_key: None,
        };
        let request = TextLayoutRequest {
            font_size_px,
            writing_mode: WritingMode::VerticalRl,
            ..test_request()
        };
        let default_style = test_resolved_style(font_size_px);

        let plain = build_vertical_inline_box_token(
            &make_inline_box(false),
            &request,
            &registry,
            None,
            &default_style,
        )
        .expect("plain inline box token");
        let combined = build_vertical_inline_box_token(
            &make_inline_box(true),
            &request,
            &registry,
            None,
            &default_style,
        )
        .expect("combined inline box token");
        let reserved = padding_inline[0] + padding_inline[1] + border_width * 2.0;

        assert!(combined.advance < plain.advance);
        assert!((combined.advance - (font_size_px + reserved)).abs() < 0.01);
        assert_eq!(combined.glyphs.len(), 2);
        assert!(
            combined
                .glyphs
                .iter()
                .all(|glyph| glyph.outline_writing_mode.as_deref() == Some("horizontal-tb"))
        );
        assert!((combined.glyphs[0].origin_y - combined.glyphs[1].origin_y).abs() < 0.01);
    }

    #[test]
    fn build_horizontal_inline_box_with_ruby_real_shaping() {
        use crate::font::registry::{FontRegistry, FontStyle};

        let mut registry = FontRegistry::new();
        let data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font");
        registry
            .register(data, "NotoSansJP".to_string(), 400, FontStyle::Normal)
            .expect("register font");

        let style = test_resolved_style(38.0);
        let rt_style = ResolvedStyle {
            font_size_px: 19.0,
            ..style.clone()
        };
        let ibox = RichInlineBox {
            children: vec![
                RichInlineNode::Segment(RichSegment {
                    text: "東".to_string(),
                    style: style.clone(),
                    combine: false,
                    decoration_runs: Vec::new(),
                }),
                RichInlineNode::Ruby(RichRuby {
                    ruby_position: RubyPosition::Over,
                    ruby_align: RubyAlign::Center,
                    ruby_gap_px: 0.0,
                    ruby_offset_px: 0.0,
                    ruby_line_sizing: RubyLineSizing::Stable,
                    base: vec![RichSegment {
                        text: "京".to_string(),
                        style: style.clone(),
                        combine: false,
                        decoration_runs: Vec::new(),
                    }],
                    rt_levels: vec![vec![RichSegment {
                        text: "きょう".to_string(),
                        style: rt_style,
                        combine: false,
                        decoration_runs: Vec::new(),
                    }]],
                }),
            ],
            padding_inline: [4.0, 4.0],
            border_width: 1.0,
            background: Some("#eee".to_string()),
            border_color: Some("#ccc".to_string()),
            border_radius: Some(4.0),
            span_key: None,
        };

        let req = test_request();
        let default_style = test_resolved_style(req.font_size_px);

        let token = build_horizontal_inline_box_token(&ibox, &req, &registry, None, &default_style)
            .expect("should build token");

        // cross_size must exceed base line height due to ruby annotation
        let base_metrics = resolve_style_line_metrics(&registry, None, &default_style);
        let base_lh = base_metrics.line_height_px;
        assert!(
            token.cross_size > base_lh,
            "cross_size ({}) should exceed base line height ({}) due to over-ruby",
            token.cross_size,
            base_lh
        );

        // reference_offset must be larger than base baseline (ruby pushes it down)
        let base_baseline = base_metrics.baseline_offset_px;
        assert!(
            token.reference_offset > base_baseline,
            "reference_offset ({}) should exceed base baseline ({}) due to over-ruby",
            token.reference_offset,
            base_baseline
        );

        // advance = segment advance + ruby base advance + padding + border*2
        let reserved = 4.0 + 4.0 + 1.0 * 2.0;
        assert!(
            token.advance > reserved,
            "advance ({}) should exceed reserved ({})",
            token.advance,
            reserved
        );

        // All glyphs should share the same baseline (re-aligned)
        let segment_glyph = token
            .glyphs
            .iter()
            .find(|g| g.text == "東")
            .expect("segment glyph");
        let ruby_base_glyph = token
            .glyphs
            .iter()
            .find(|g| g.text == "京")
            .expect("ruby base glyph");
        assert!(
            (segment_glyph.origin_y - ruby_base_glyph.origin_y).abs() < 0.01,
            "segment and ruby base glyphs should share baseline: {} vs {}",
            segment_glyph.origin_y,
            ruby_base_glyph.origin_y
        );

        // Ruby annotation glyph should be above the base
        let rt_glyph = token
            .glyphs
            .iter()
            .find(|g| g.text == "き")
            .expect("ruby annotation glyph");
        assert!(
            rt_glyph.origin_y < ruby_base_glyph.origin_y,
            "over-ruby annotation ({}) should be above base ({})",
            rt_glyph.origin_y,
            ruby_base_glyph.origin_y
        );

        // decoration present
        let deco = token.inline_box_decoration.as_ref().expect("decoration");
        assert!((deco.cross_size - token.cross_size).abs() < f64::EPSILON);
    }

    // ── DecoratedSpan tests ──────────────────────────────────────

    fn make_decorated_span_tokens(
        texts: &[&str],
        advance_each: f64,
        span_id: u32,
        padding: [f64; 2],
        border_width: f64,
    ) -> (Vec<LayoutToken>, Vec<DecorationSpanMeta>) {
        let meta = DecorationSpanMeta {
            background: Some("#eef".to_string()),
            border_color: Some("#ccc".to_string()),
            border_width,
            border_radius: Some([4.0, 4.0, 4.0, 4.0]),
            span_key: None,
        };
        let start_extra = padding[0] + border_width;
        let end_extra = padding[1] + border_width;
        let tokens: Vec<LayoutToken> = texts
            .iter()
            .enumerate()
            .map(|(i, &t)| {
                let is_first = i == 0;
                let is_last = i == texts.len() - 1;
                LayoutToken {
                    text: t.to_string(),
                    kinsoku_start: None,
                    kinsoku_end: None,
                    advance: advance_each,
                    cross_size: 20.0,
                    reference_offset: 10.0,
                    glyphs: Vec::new(),
                    inline_rects: Vec::new(),
                    inline_box_decoration: None,
                    nested_decorations: Vec::new(),
                    decoration_span_id: Some(span_id),
                    decoration_start_advance: if is_first { start_extra } else { 0.0 },
                    decoration_end_advance: if is_last { end_extra } else { 0.0 },
                    flow_ruby: None,
                    trailing_tracking_px: 0.0,
                }
            })
            .collect();
        (tokens, vec![meta])
    }

    fn logical_glyph_origin(glyph: &PositionedGlyph, writing_mode: WritingMode) -> f64 {
        if writing_mode == WritingMode::HorizontalTb {
            glyph.origin_x
        } else {
            glyph.origin_y
        }
    }

    fn logical_glyph_advance(glyph: &PositionedGlyph, writing_mode: WritingMode) -> f64 {
        if writing_mode == WritingMode::HorizontalTb {
            glyph.x_advance
        } else {
            -glyph.y_advance
        }
    }

    #[test]
    fn effective_line_width_includes_decoration_advance() {
        let (tokens, _meta) =
            make_decorated_span_tokens(&["A", "B", "C"], 10.0, 0, [4.0, 6.0], 1.0);
        // glyph advance: 3 * 10 = 30
        // decoration: start = 4 + 1 = 5, end = 6 + 1 = 7
        // total = 30 + 5 + 7 = 42
        let width = effective_line_width(&tokens, 0, 3, 0.0);
        assert!(
            (width - 42.0).abs() < 0.01,
            "effective width should be 42, got {width}"
        );
    }

    #[test]
    fn effective_line_width_includes_internal_decorated_span_advance() {
        let plain_a = LayoutToken {
            text: "A".to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance: 10.0,
            cross_size: 20.0,
            reference_offset: 10.0,
            glyphs: Vec::new(),
            inline_rects: Vec::new(),
            inline_box_decoration: None,
            nested_decorations: Vec::new(),
            decoration_span_id: None,
            decoration_start_advance: 0.0,
            decoration_end_advance: 0.0,
            flow_ruby: None,
            trailing_tracking_px: 0.0,
        };
        let decorated_b = LayoutToken {
            text: "B".to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance: 10.0,
            cross_size: 20.0,
            reference_offset: 10.0,
            glyphs: Vec::new(),
            inline_rects: Vec::new(),
            inline_box_decoration: None,
            nested_decorations: Vec::new(),
            decoration_span_id: Some(0),
            decoration_start_advance: 5.0,
            decoration_end_advance: 5.0,
            flow_ruby: None,
            trailing_tracking_px: 0.0,
        };
        let plain_c = LayoutToken {
            text: "C".to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance: 10.0,
            cross_size: 20.0,
            reference_offset: 10.0,
            glyphs: Vec::new(),
            inline_rects: Vec::new(),
            inline_box_decoration: None,
            nested_decorations: Vec::new(),
            decoration_span_id: None,
            decoration_start_advance: 0.0,
            decoration_end_advance: 0.0,
            flow_ruby: None,
            trailing_tracking_px: 0.0,
        };

        let width = effective_line_width(&[plain_a, decorated_b, plain_c], 0, 3, 0.0);
        assert!(
            (width - 40.0).abs() < 0.01,
            "effective width should include internal decorated span padding/border: got {width}"
        );
    }

    #[test]
    fn paint_free_decorated_span_padding_offsets_inline_and_following_glyphs() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            let rich_nodes = vec![
                RichTextNodeInput::Text {
                    text: "前".to_string(),
                },
                RichTextNodeInput::DecoratedSpan {
                    style: test_style(20.0, "#111"),
                    children: vec![RichTextNodeInput::Text {
                        text: "天地".to_string(),
                    }],
                    padding_inline: Some([5.0, 9.0]),
                    background: None,
                    border_color: None,
                    border_width: None,
                    border_radius: None,
                    span_key: None,
                },
                RichTextNodeInput::Text {
                    text: "後".to_string(),
                },
            ];
            let request = TextLayoutRequest {
                rich_text: Some(&rich_nodes),
                font_size_px: 20.0,
                max_width: 400.0,
                max_height: Some(400.0),
                writing_mode,
                ..test_request()
            };

            let result = layout_rich_text(&request, &font_ctx).expect("paint-free padding layout");
            assert_eq!(result.lines.len(), 1);
            let glyphs = result.lines[0]
                .positioned_glyphs
                .as_ref()
                .expect("positioned rich glyphs");
            let preceding = glyphs
                .iter()
                .find(|glyph| glyph.text == "前")
                .expect("preceding glyph");
            let first_inline = glyphs
                .iter()
                .find(|glyph| glyph.text == "天")
                .expect("first inline glyph");
            let last_inline = glyphs
                .iter()
                .find(|glyph| glyph.text == "地")
                .expect("last inline glyph");
            let following = glyphs
                .iter()
                .find(|glyph| glyph.text == "後")
                .expect("following glyph");

            let start_gap = logical_glyph_origin(first_inline, writing_mode)
                - (logical_glyph_origin(preceding, writing_mode)
                    + logical_glyph_advance(preceding, writing_mode));
            let end_gap = logical_glyph_origin(following, writing_mode)
                - (logical_glyph_origin(last_inline, writing_mode)
                    + logical_glyph_advance(last_inline, writing_mode));

            assert!(
                (start_gap - 5.0).abs() < 0.01,
                "{writing_mode:?} inline-start gap should be 5px, got {start_gap}"
            );
            assert!(
                (end_gap - 9.0).abs() < 0.01,
                "{writing_mode:?} inline-end gap should be 9px, got {end_gap}"
            );
            assert!(
                result.inline_box_decorations.iter().all(|decoration| {
                    decoration.background.is_none() && decoration.border_color.is_none()
                }),
                "paint-free padding must not synthesize decoration paint"
            );
        }
    }

    #[test]
    fn wrapped_decorated_span_applies_padding_only_at_true_boundaries() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            let rich_nodes = vec![RichTextNodeInput::DecoratedSpan {
                style: test_style(20.0, "#111"),
                children: vec![RichTextNodeInput::Text {
                    text: "天地玄黄".to_string(),
                }],
                padding_inline: Some([5.0, 9.0]),
                background: None,
                border_color: None,
                border_width: None,
                border_radius: None,
                span_key: None,
            }];
            let request = TextLayoutRequest {
                rich_text: Some(&rich_nodes),
                font_size_px: 20.0,
                max_width: if writing_mode == WritingMode::HorizontalTb {
                    55.0
                } else {
                    200.0
                },
                max_height: Some(if writing_mode == WritingMode::VerticalRl {
                    55.0
                } else {
                    200.0
                }),
                writing_mode,
                ..test_request()
            };

            let result = layout_rich_text(&request, &font_ctx).expect("wrapped padding layout");
            assert_eq!(
                result
                    .lines
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>(),
                ["天地", "玄黄"]
            );
            let first_fragment_glyph = result.lines[0]
                .positioned_glyphs
                .as_ref()
                .and_then(|glyphs| glyphs.first())
                .expect("first fragment glyph");
            let continuation_glyph = result.lines[1]
                .positioned_glyphs
                .as_ref()
                .and_then(|glyphs| glyphs.first())
                .expect("continuation glyph");
            let start_padding_delta = logical_glyph_origin(first_fragment_glyph, writing_mode)
                - logical_glyph_origin(continuation_glyph, writing_mode);

            assert!(
                (start_padding_delta - 5.0).abs() < 0.01,
                "{writing_mode:?} continuation must not repeat inline-start padding, got delta {start_padding_delta}"
            );
            assert!((result.lines[0].width - 45.0).abs() < 0.01);
            assert!((result.lines[1].width - 49.0).abs() < 0.01);
        }
    }

    #[test]
    fn adjacent_decorated_spans_reserve_both_boundary_paddings() {
        let registry = test_font_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        for writing_mode in [WritingMode::HorizontalTb, WritingMode::VerticalRl] {
            let rich_nodes = vec![
                RichTextNodeInput::DecoratedSpan {
                    style: test_style(20.0, "#111"),
                    children: vec![RichTextNodeInput::Text {
                        text: "天".to_string(),
                    }],
                    padding_inline: Some([5.0, 7.0]),
                    background: None,
                    border_color: None,
                    border_width: None,
                    border_radius: None,
                    span_key: None,
                },
                RichTextNodeInput::DecoratedSpan {
                    style: test_style(20.0, "#111"),
                    children: vec![RichTextNodeInput::Text {
                        text: "地".to_string(),
                    }],
                    padding_inline: Some([11.0, 13.0]),
                    background: None,
                    border_color: None,
                    border_width: None,
                    border_radius: None,
                    span_key: None,
                },
            ];
            let request = TextLayoutRequest {
                rich_text: Some(&rich_nodes),
                font_size_px: 20.0,
                max_width: 400.0,
                max_height: Some(400.0),
                writing_mode,
                ..test_request()
            };

            let result = layout_rich_text(&request, &font_ctx).expect("adjacent padding layout");
            let glyphs = result.lines[0]
                .positioned_glyphs
                .as_ref()
                .expect("positioned adjacent glyphs");
            let first = glyphs.first().expect("first decorated glyph");
            let second = glyphs.get(1).expect("second decorated glyph");
            let boundary_gap = logical_glyph_origin(second, writing_mode)
                - (logical_glyph_origin(first, writing_mode)
                    + logical_glyph_advance(first, writing_mode));

            assert!(
                (boundary_gap - 18.0).abs() < 0.01,
                "{writing_mode:?} adjacent span gap should include 7px + 11px, got {boundary_gap}"
            );
        }
    }

    #[test]
    fn break_tokens_vertical_accounts_for_internal_decorated_span_advance() {
        let meta = vec![DecorationSpanMeta {
            background: Some("#eef".to_string()),
            border_color: Some("#ccc".to_string()),
            border_width: 1.0,
            border_radius: Some([4.0, 4.0, 4.0, 4.0]),
            span_key: None,
        }];
        let tokens = vec![
            LayoutToken {
                text: "A".to_string(),
                kinsoku_start: None,
                kinsoku_end: None,
                advance: 10.0,
                cross_size: 20.0,
                reference_offset: 10.0,
                glyphs: Vec::new(),
                inline_rects: Vec::new(),
                inline_box_decoration: None,
                nested_decorations: Vec::new(),
                decoration_span_id: None,
                decoration_start_advance: 0.0,
                decoration_end_advance: 0.0,
                flow_ruby: None,
                trailing_tracking_px: 0.0,
            },
            LayoutToken {
                text: "B".to_string(),
                kinsoku_start: None,
                kinsoku_end: None,
                advance: 10.0,
                cross_size: 20.0,
                reference_offset: 10.0,
                glyphs: Vec::new(),
                inline_rects: Vec::new(),
                inline_box_decoration: None,
                nested_decorations: Vec::new(),
                decoration_span_id: Some(0),
                decoration_start_advance: 5.0,
                decoration_end_advance: 5.0,
                flow_ruby: None,
                trailing_tracking_px: 0.0,
            },
            LayoutToken {
                text: "C".to_string(),
                kinsoku_start: None,
                kinsoku_end: None,
                advance: 10.0,
                cross_size: 20.0,
                reference_offset: 10.0,
                glyphs: Vec::new(),
                inline_rects: Vec::new(),
                inline_box_decoration: None,
                nested_decorations: Vec::new(),
                decoration_span_id: None,
                decoration_start_advance: 0.0,
                decoration_end_advance: 0.0,
                flow_ruby: None,
                trailing_tracking_px: 0.0,
            },
        ];

        let columns =
            break_tokens_vertical(&tokens, 35.0, 0.0, WrapMode::Char, None, None, &meta, false)
                .expect("should produce columns");

        assert_eq!(
            columns.len(),
            2,
            "internal decorated span advance should force a column break"
        );
        assert_eq!(columns[0].text, "AB");
        assert_eq!(columns[1].text, "C");
    }

    #[test]
    fn single_line_decorated_span_has_full_border_radius() {
        let (tokens, meta) = make_decorated_span_tokens(&["A", "B"], 10.0, 0, [4.0, 4.0], 1.0);
        let lines = break_tokens_horizontal(
            &tokens,
            200.0,
            0.0,
            WrapMode::Char,
            None,
            None,
            &meta,
            false,
        )
        .expect("should produce lines");

        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].decorations.len(), 1);

        let deco = &lines[0].decorations[0];
        assert_eq!(deco.span_id, Some(0));
        assert_eq!(deco.background.as_deref(), Some("#eef"));
        // Single-line: full border radius
        assert_eq!(deco.border_radius, Some([4.0, 4.0, 4.0, 4.0]));
    }

    #[test]
    fn multi_line_decorated_span_resolves_fragment_border_radius() {
        use crate::text::types::{FitMode, Language, TextOrientation, WritingMode};

        // Create tokens: 5 tokens * 10px = 50px glyph advance + 10px decoration
        // max_width = 35px → should break into 2 lines
        let (tokens, meta) =
            make_decorated_span_tokens(&["A", "B", "C", "D", "E"], 10.0, 0, [4.0, 4.0], 1.0);

        let req = TextLayoutRequest {
            text: "ABCDE",
            spans: None,
            rich_text: None,
            font_size_px: 16.0,
            line_height: None,
            line_height_px: None,
            letter_spacing_px: 0.0,
            text_indent: None,
            max_width: 35.0,
            max_height: None,
            wrap: WrapMode::Char,
            white_space: WhiteSpaceMode::Normal,
            tab_size: 4,
            fit: FitMode::None,
            max_lines: None,
            ellipsis: false,
            language: Language::Auto,
            writing_mode: WritingMode::HorizontalTb,
            text_orientation: TextOrientation::Mixed,
            uax14_breaks: None,
            hanging_punctuation: false,
            font_variation_settings: Vec::new(),
            font_feature_settings: Vec::new(),
            min_font_size_px: None,
            shrink_epsilon_px: None,
            shrink_max_iterations: None,
            max_font_size_px: None,
            grow_epsilon_px: None,
            grow_max_iterations: None,
        };

        let result = layout_horizontal_tokens(&req, &tokens, &meta, 16.0, Vec::new())
            .expect("should produce result");

        assert!(
            result.inline_box_decorations.len() >= 2,
            "Expected at least 2 decoration fragments, got {}",
            result.inline_box_decorations.len()
        );

        let first = &result.inline_box_decorations[0];
        let last = result.inline_box_decorations.last().unwrap();

        // Start fragment: left corners preserved, right corners zeroed
        assert_eq!(
            first.border_radius,
            Some([4.0, 0.0, 0.0, 4.0]),
            "start fragment should have left corners only"
        );
        // End fragment: right corners preserved, left corners zeroed
        assert_eq!(
            last.border_radius,
            Some([0.0, 4.0, 4.0, 0.0]),
            "end fragment should have right corners only"
        );
    }

    #[test]
    fn multi_column_decorated_span_resolves_vertical_fragment_border_radius() {
        use crate::text::types::{FitMode, Language, TextOrientation, WritingMode};

        let (tokens, meta) =
            make_decorated_span_tokens(&["A", "B", "C", "D", "E"], 10.0, 0, [4.0, 4.0], 1.0);

        let req = TextLayoutRequest {
            text: "ABCDE",
            spans: None,
            rich_text: None,
            font_size_px: 16.0,
            line_height: None,
            line_height_px: None,
            letter_spacing_px: 0.0,
            text_indent: None,
            max_width: 100.0,
            max_height: Some(25.0),
            wrap: WrapMode::Char,
            white_space: WhiteSpaceMode::Normal,
            tab_size: 4,
            fit: FitMode::None,
            max_lines: None,
            ellipsis: false,
            language: Language::Auto,
            writing_mode: WritingMode::VerticalRl,
            text_orientation: TextOrientation::Mixed,
            uax14_breaks: None,
            hanging_punctuation: false,
            font_variation_settings: Vec::new(),
            font_feature_settings: Vec::new(),
            min_font_size_px: None,
            shrink_epsilon_px: None,
            shrink_max_iterations: None,
            max_font_size_px: None,
            grow_epsilon_px: None,
            grow_max_iterations: None,
        };

        let result = layout_vertical_tokens(&req, &tokens, &meta, 16.0, Vec::new())
            .expect("vertical result");

        assert!(
            result.inline_box_decorations.len() >= 2,
            "Expected at least 2 vertical decoration fragments, got {}",
            result.inline_box_decorations.len()
        );

        let first = &result.inline_box_decorations[0];
        let last = result.inline_box_decorations.last().unwrap();
        assert_eq!(
            first.border_radius,
            Some([4.0, 4.0, 0.0, 0.0]),
            "start column should preserve top corners"
        );
        assert_eq!(
            last.border_radius,
            Some([0.0, 0.0, 4.0, 4.0]),
            "end column should preserve bottom corners"
        );
    }

    #[test]
    fn decorated_span_and_inline_box_coexist() {
        let dspan_meta = vec![DecorationSpanMeta {
            background: Some("#eef".to_string()),
            border_color: None,
            border_width: 0.0,
            border_radius: None,
            span_key: None,
        }];
        let tokens = vec![
            // decorated span token
            LayoutToken {
                text: "A".to_string(),
                kinsoku_start: None,
                kinsoku_end: None,
                advance: 10.0,
                cross_size: 20.0,
                reference_offset: 10.0,
                glyphs: Vec::new(),
                inline_rects: Vec::new(),
                inline_box_decoration: None,
                nested_decorations: Vec::new(),
                decoration_span_id: Some(0),
                decoration_start_advance: 0.0,
                decoration_end_advance: 0.0,
                flow_ruby: None,
                trailing_tracking_px: 0.0,
            },
            // atomic InlineBox token
            LayoutToken {
                text: "box".to_string(),
                kinsoku_start: None,
                kinsoku_end: None,
                advance: 30.0,
                cross_size: 20.0,
                reference_offset: 10.0,
                glyphs: Vec::new(),
                inline_rects: Vec::new(),
                inline_box_decoration: Some(InlineBoxDecorationInput {
                    total_advance: 30.0,
                    cross_size: 20.0,
                    background: Some("#ff0".to_string()),
                    border_color: None,
                    border_width: None,
                    border_radius: None,
                    span_key: None,
                }),
                nested_decorations: Vec::new(),
                decoration_span_id: None,
                decoration_start_advance: 0.0,
                decoration_end_advance: 0.0,
                flow_ruby: None,
                trailing_tracking_px: 0.0,
            },
        ];

        let lines = break_tokens_horizontal(
            &tokens,
            200.0,
            0.0,
            WrapMode::Char,
            None,
            None,
            &dspan_meta,
            false,
        )
        .expect("should produce lines");

        assert_eq!(lines.len(), 1);
        // Should have 2 decorations: one from DecoratedSpan, one from InlineBox
        assert_eq!(
            lines[0].decorations.len(),
            2,
            "should have decorations from both DecoratedSpan and InlineBox"
        );
        // First decoration is from DecoratedSpan (span_id = Some(0))
        assert_eq!(lines[0].decorations[0].span_id, Some(0));
        // Second decoration is from InlineBox (span_id = None)
        assert_eq!(lines[0].decorations[1].span_id, None);
    }

    #[test]
    fn decorated_span_allows_ruby_child() {
        let mut registry = FontRegistry::new();
        let data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font");
        registry
            .register(data, "NotoSansJP".to_string(), 400, FontStyle::Normal)
            .expect("register font");

        let rich_nodes = vec![RichTextNodeInput::DecoratedSpan {
            style: test_style(38.0, "#f8fafc"),
            children: vec![RichTextNodeInput::Ruby {
                ruby_position: Some("over".to_string()),
                ruby_align: Some("center".to_string()),
                ruby_gap_px: None,
                ruby_offset_px: None,
                ruby_line_sizing: None,
                style: test_style(38.0, "#f8fafc"),
                base: vec![RichTextNodeInput::Text {
                    text: "春".to_string(),
                }],
                rt: vec![RichTextNodeInput::Span {
                    text: "はる".to_string(),
                    style: test_style(18.0, "#fca5a5"),
                }],
                rt_levels: Vec::new(),
            }],
            padding_inline: Some([4.0, 4.0]),
            background: Some("#eef".to_string()),
            border_color: Some("#ccc".to_string()),
            border_width: Some(1.0),
            border_radius: Some([4.0, 4.0, 4.0, 4.0]),
            span_key: None,
        }];

        let req = TextLayoutRequest {
            rich_text: Some(&rich_nodes),
            ..test_request()
        };
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let result = layout_rich_text(&req, &font_ctx).expect("decorated ruby layout");
        assert!(
            result
                .warnings
                .iter()
                .all(|warning| warning.code != "UNSUPPORTED_DECORATED_SPAN_CHILD"),
            "decorated span ruby child should not be rejected: {:?}",
            result.warnings
        );
        assert!(
            result
                .inline_box_decorations
                .iter()
                .any(|deco| deco.background.as_deref() == Some("#eef")),
            "outer decorated span decoration should be emitted"
        );
    }

    #[test]
    fn decorated_span_allows_inline_box_child_vertical() {
        let mut registry = FontRegistry::new();
        let data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font");
        registry
            .register(data, "NotoSansJP".to_string(), 400, FontStyle::Normal)
            .expect("register font");

        let rich_nodes = vec![RichTextNodeInput::DecoratedSpan {
            style: test_style(24.0, "#f8fafc"),
            children: vec![RichTextNodeInput::InlineBox {
                style: test_style(24.0, "#fde68a"),
                children: vec![RichTextNodeInput::Text {
                    text: "囲み".to_string(),
                }],
                padding_inline: Some([4.0, 4.0]),
                background: Some("#1f2937".to_string()),
                border_color: Some("#93c5fd".to_string()),
                border_width: Some(1.0),
                border_radius: Some(4.0),
                span_key: None,
            }],
            padding_inline: Some([4.0, 4.0]),
            background: Some("#eef".to_string()),
            border_color: Some("#ccc".to_string()),
            border_width: Some(1.0),
            border_radius: Some([4.0, 4.0, 4.0, 4.0]),
            span_key: None,
        }];

        let req = TextLayoutRequest {
            rich_text: Some(&rich_nodes),
            writing_mode: WritingMode::VerticalRl,
            text_orientation: TextOrientation::Mixed,
            max_width: 140.0,
            max_height: Some(120.0),
            ..test_request()
        };
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let result = layout_rich_text(&req, &font_ctx).expect("vertical decorated inline box");
        assert!(
            result
                .warnings
                .iter()
                .all(|warning| warning.code != "UNSUPPORTED_DECORATED_SPAN_CHILD"),
            "decorated span inline-box child should not be rejected: {:?}",
            result.warnings
        );
        assert!(
            result.inline_box_decorations.len() >= 2,
            "outer decorated span and inner inline box decorations should both be emitted"
        );
    }

    #[test]
    fn inline_box_allows_decorated_span_child() {
        let mut registry = FontRegistry::new();
        let data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font");
        registry
            .register(data, "NotoSansJP".to_string(), 400, FontStyle::Normal)
            .expect("register font");

        let rich_nodes = vec![RichTextNodeInput::InlineBox {
            style: test_style(24.0, "#f8fafc"),
            children: vec![RichTextNodeInput::DecoratedSpan {
                style: test_style(24.0, "#fde68a"),
                children: vec![
                    RichTextNodeInput::Text {
                        text: "内".to_string(),
                    },
                    RichTextNodeInput::Ruby {
                        ruby_position: Some("over".to_string()),
                        ruby_align: Some("center".to_string()),
                        ruby_gap_px: None,
                        ruby_offset_px: None,
                        ruby_line_sizing: None,
                        style: test_style(24.0, "#fde68a"),
                        base: vec![RichTextNodeInput::Text {
                            text: "包".to_string(),
                        }],
                        rt: vec![RichTextNodeInput::Span {
                            text: "ほう".to_string(),
                            style: test_style(12.0, "#fca5a5"),
                        }],
                        rt_levels: Vec::new(),
                    },
                ],
                padding_inline: Some([4.0, 4.0]),
                background: Some("#eef".to_string()),
                border_color: Some("#ccc".to_string()),
                border_width: Some(1.0),
                border_radius: Some([4.0, 4.0, 4.0, 4.0]),
                span_key: None,
            }],
            padding_inline: Some([4.0, 4.0]),
            background: Some("#1f2937".to_string()),
            border_color: Some("#93c5fd".to_string()),
            border_width: Some(1.0),
            border_radius: Some(4.0),
            span_key: None,
        }];

        let req = TextLayoutRequest {
            rich_text: Some(&rich_nodes),
            ..test_request()
        };
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let result = layout_rich_text(&req, &font_ctx).expect("inline-box decorated span layout");
        assert!(
            result
                .warnings
                .iter()
                .all(|warning| warning.code != "UNSUPPORTED_INLINE_BOX_CHILD"),
            "inline box decorated-span child should not be rejected: {:?}",
            result.warnings
        );
        assert!(
            result.inline_box_decorations.len() >= 2,
            "outer inline box and inner decorated span decorations should both be emitted"
        );
    }

    #[test]
    fn decorated_span_allows_nested_decorated_span() {
        let mut registry = FontRegistry::new();
        let data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font");
        registry
            .register(data, "NotoSansJP".to_string(), 400, FontStyle::Normal)
            .expect("register font");

        let rich_nodes = vec![RichTextNodeInput::DecoratedSpan {
            style: test_style(24.0, "#f8fafc"),
            children: vec![
                RichTextNodeInput::Text {
                    text: "外".to_string(),
                },
                RichTextNodeInput::DecoratedSpan {
                    style: test_style(24.0, "#fde68a"),
                    children: vec![RichTextNodeInput::Text {
                        text: "内".to_string(),
                    }],
                    padding_inline: Some([4.0, 4.0]),
                    background: Some("#fde68a".to_string()),
                    border_color: Some("#ca8a04".to_string()),
                    border_width: Some(1.0),
                    border_radius: Some([4.0, 4.0, 4.0, 4.0]),
                    span_key: None,
                },
                RichTextNodeInput::Text {
                    text: "側".to_string(),
                },
            ],
            padding_inline: Some([4.0, 4.0]),
            background: Some("#eef".to_string()),
            border_color: Some("#ccc".to_string()),
            border_width: Some(1.0),
            border_radius: Some([4.0, 4.0, 4.0, 4.0]),
            span_key: None,
        }];

        let req = TextLayoutRequest {
            rich_text: Some(&rich_nodes),
            ..test_request()
        };
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };

        let result = layout_rich_text(&req, &font_ctx).expect("nested decorated span layout");
        assert!(
            result
                .warnings
                .iter()
                .all(|warning| warning.code != "UNSUPPORTED_DECORATED_SPAN_CHILD"),
            "nested decorated span should not be rejected: {:?}",
            result.warnings
        );
        assert!(
            result.inline_box_decorations.len() >= 2,
            "outer and nested decorated span decorations should both be emitted"
        );
    }

    #[test]
    fn resolve_fragment_border_radius_cases() {
        let r = Some([4.0, 4.0, 4.0, 4.0]);
        // Only fragment: all corners
        assert_eq!(
            resolve_fragment_border_radius(r, true, true),
            Some([4.0, 4.0, 4.0, 4.0])
        );
        // Start fragment: left corners only
        assert_eq!(
            resolve_fragment_border_radius(r, true, false),
            Some([4.0, 0.0, 0.0, 4.0])
        );
        // End fragment: right corners only
        assert_eq!(
            resolve_fragment_border_radius(r, false, true),
            Some([0.0, 4.0, 4.0, 0.0])
        );
        // Middle fragment: no corners
        assert_eq!(resolve_fragment_border_radius(r, false, false), None);
        // None input: always None
        assert_eq!(resolve_fragment_border_radius(None, true, true), None);
    }

    // -----------------------------------------------------------------------
    // WhiteSpace / PreWrap tests
    // -----------------------------------------------------------------------

    #[test]
    fn nowrap_produces_single_line() {
        let tokens = vec![
            test_break_token("A", 20.0),
            test_break_token("B", 20.0),
            test_break_token("C", 20.0),
        ];
        let meta: Vec<DecorationSpanMeta> = vec![];
        let lines =
            break_tokens_horizontal(&tokens, 30.0, 0.0, WrapMode::None, None, None, &meta, false);
        assert_eq!(lines.as_ref().map(std::vec::Vec::len), Some(1));
    }

    #[test]
    fn pre_wrap_forces_break_at_newline() {
        let tokens = vec![
            test_break_token("A", 10.0),
            test_break_token("\n", 0.0),
            test_break_token("B", 10.0),
        ];
        let meta: Vec<DecorationSpanMeta> = vec![];
        let lines =
            break_tokens_horizontal(&tokens, 999.0, 0.0, WrapMode::Char, None, None, &meta, true)
                .expect("should produce lines");
        assert_eq!(lines.len(), 2, "newline should produce 2 lines");
        assert_eq!(lines[0].text, "A");
        assert_eq!(lines[1].text, "B");
    }

    #[test]
    fn pre_wrap_preserves_leading_consecutive_and_trailing_empty_lines() {
        let tokens = vec![
            test_break_token("\n", 0.0),
            test_break_token("\n", 0.0),
            test_break_token("A", 10.0),
            test_break_token("\n", 0.0),
        ];
        let meta: Vec<DecorationSpanMeta> = vec![];
        let horizontal = break_tokens_horizontal(
            &tokens,
            999.0,
            12.0,
            WrapMode::Char,
            None,
            None,
            &meta,
            true,
        )
        .expect("horizontal pre-wrap lines");
        let vertical = break_tokens_vertical(
            &tokens,
            999.0,
            12.0,
            WrapMode::Char,
            None,
            None,
            &meta,
            true,
        )
        .expect("vertical pre-wrap columns");

        for lines in [&horizontal, &vertical] {
            assert_eq!(
                lines
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>(),
                vec!["", "", "A", ""]
            );
            assert_eq!(lines[0].advance, 12.0);
            assert!(lines.iter().all(|line| line.cross_size > 0.0));
        }
    }

    #[test]
    fn pre_wrap_with_wrap_none_only_breaks_at_newline() {
        let tokens = vec![
            test_break_token("A", 50.0),
            test_break_token("B", 50.0),
            test_break_token("\n", 0.0),
            test_break_token("C", 10.0),
        ];
        let meta: Vec<DecorationSpanMeta> = vec![];
        // max_width=30 would normally force breaks, but wrap=None means only \n breaks
        let lines =
            break_tokens_horizontal(&tokens, 30.0, 0.0, WrapMode::None, None, None, &meta, true)
                .expect("should produce lines");
        assert_eq!(lines.len(), 2, "only newline should break");
        assert_eq!(lines[0].text, "AB");
        assert_eq!(lines[1].text, "C");
    }

    #[test]
    fn expand_tabs_in_segments() {
        let mut nodes = vec![RichInlineNode::Segment(RichSegment {
            text: "a\tb".to_string(),
            style: test_resolved_style(16.0),
            combine: false,
            decoration_runs: Vec::new(),
        })];
        expand_tabs_in_nodes(&mut nodes, 4);
        if let RichInlineNode::Segment(seg) = &nodes[0] {
            assert_eq!(seg.text, "a    b");
        } else {
            panic!("expected Segment");
        }
    }

    // -----------------------------------------------------------------------
    // InlineBox nesting
    // -----------------------------------------------------------------------

    #[test]
    fn inline_box_max_depth_emits_warning() {
        use crate::text::types::RichTextNodeInput;
        // Build 4-level deep nesting (exceeds MAX_INLINE_BOX_DEPTH=3)
        let deepest = RichTextNodeInput::InlineBox {
            style: test_rich_style(16.0),
            children: vec![RichTextNodeInput::Text {
                text: "deep".to_string(),
            }],
            padding_inline: None,
            background: None,
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: None,
        };
        let level3 = RichTextNodeInput::InlineBox {
            style: test_rich_style(16.0),
            children: vec![deepest],
            padding_inline: None,
            background: None,
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: None,
        };
        let level2 = RichTextNodeInput::InlineBox {
            style: test_rich_style(16.0),
            children: vec![level3],
            padding_inline: None,
            background: None,
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: None,
        };
        let root = RichTextNodeInput::InlineBox {
            style: test_rich_style(16.0),
            children: vec![level2],
            padding_inline: None,
            background: None,
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: None,
        };

        let default_style = test_resolved_style(16.0);
        let mut inline_nodes = Vec::new();
        let mut warnings = Vec::new();
        flatten_rich_nodes_with_warnings(
            &[root],
            &default_style,
            &mut inline_nodes,
            1.0,
            &mut warnings,
        );

        // depth 0 (root) → depth 1 (level2) → depth 2 (level3) → depth 3 (deepest) → rejected
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "INLINE_BOX_MAX_DEPTH");
    }

    #[test]
    fn nested_inline_box_decoration_appears_in_line() {
        // Outer InlineBox token with one nested InlineBox decoration
        let nested_deco = NestedInlineBoxDecoration {
            offset: 5.0,
            decoration: InlineBoxDecorationInput {
                total_advance: 20.0,
                cross_size: 16.0,
                background: Some("#inner".to_string()),
                border_color: None,
                border_width: None,
                border_radius: None,
                span_key: None,
            },
        };
        let outer_token = LayoutToken {
            text: "outerinner".to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance: 50.0,
            cross_size: 20.0,
            reference_offset: 10.0,
            glyphs: Vec::new(),
            inline_rects: Vec::new(),
            inline_box_decoration: Some(InlineBoxDecorationInput {
                total_advance: 50.0,
                cross_size: 20.0,
                background: Some("#outer".to_string()),
                border_color: None,
                border_width: None,
                border_radius: None,
                span_key: None,
            }),
            nested_decorations: vec![nested_deco],
            decoration_span_id: None,
            decoration_start_advance: 0.0,
            decoration_end_advance: 0.0,
            flow_ruby: None,
            trailing_tracking_px: 0.0,
        };

        let line = assemble_horizontal_line(&[outer_token], 0.0, &[]);

        // Outer decoration + nested decoration = 2 decorations
        assert_eq!(line.decorations.len(), 2);
        assert_eq!(line.decorations[0].background.as_deref(), Some("#outer"));
        assert_eq!(line.decorations[1].background.as_deref(), Some("#inner"));
        // Nested decoration offset = token start (0) + nested offset (5)
        assert!((line.decorations[1].offset - 5.0).abs() < 0.01);
    }
}
