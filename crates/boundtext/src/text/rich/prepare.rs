use crate::font::FontStyle;
use crate::font::shaping::{format_css_font_feature_settings, format_css_font_variation_settings};
use crate::text::fit::selected_font_size_scale;
use crate::text::grapheme::grapheme_split;
use crate::text::types::{RichTextNodeInput, RichTextStyleInput, TextWarning};

use super::{
    LayoutToken, PreparedRichText, ResolvedStyle, RichDecoratedSpan, RichInlineBox, RichInlineNode,
    RichInlineRect, RichRuby, RichSegment, RubyAlign, RubyLineSizing, RubyPosition,
    TextLayoutRequest,
};

pub(super) fn prepare_rich_text(
    req: &TextLayoutRequest,
    font_ctx: &crate::font::FontContext<'_>,
    chosen_font_size_px: f64,
) -> Option<PreparedRichText> {
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
            selected_font_size_scale(req.font_size_px, chosen_font_size_px),
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
        collapse_whitespace_in_nodes(&mut inline_nodes);
    }
    if request_has_text_decoration(req) {
        coalesce_shaping_segments(&mut inline_nodes);
    }

    if inline_nodes.is_empty() {
        return Some(PreparedRichText {
            tokens: Vec::new(),
            decoration_spans: Vec::new(),
            warnings: flatten_warnings,
        });
    }

    let (tokens, decoration_spans) = super::build_tokens(
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

/// Merge adjacent segments whose shaping styles are identical. Text decoration
/// is retained as paint metadata but deliberately excluded from this equality,
/// so decoration-only authored boundaries do not split contextual shaping or
/// ligatures.
pub(super) fn coalesce_shaping_segments(nodes: &mut Vec<RichInlineNode>) {
    for node in nodes.iter_mut() {
        match node {
            RichInlineNode::Segment(_) | RichInlineNode::InlineRect(_) => {}
            RichInlineNode::Ruby(ruby) => {
                coalesce_rich_segments(&mut ruby.base);
                for level in &mut ruby.rt_levels {
                    coalesce_rich_segments(level);
                }
            }
            RichInlineNode::InlineBox(inline_box) => {
                coalesce_shaping_segments(&mut inline_box.children);
            }
            RichInlineNode::DecoratedSpan(span) => {
                coalesce_shaping_segments(&mut span.children);
            }
        }
    }

    let mut merged = Vec::with_capacity(nodes.len());
    for node in nodes.drain(..) {
        if let RichInlineNode::Segment(segment) = &node
            && let Some(RichInlineNode::Segment(previous)) = merged.last_mut()
            && previous.combine == segment.combine
            && resolved_styles_have_equal_layout(&previous.style, &segment.style)
        {
            previous.text.push_str(&segment.text);
            previous
                .decoration_runs
                .extend(segment.decoration_runs.iter().cloned());
            continue;
        }
        merged.push(node);
    }
    *nodes = merged;
}

pub(super) fn request_has_text_decoration(req: &TextLayoutRequest<'_>) -> bool {
    req.spans
        .is_some_and(|spans| spans.iter().any(|span| span.text_decoration.is_some()))
        || req.rich_text.is_some_and(rich_nodes_have_text_decoration)
}

fn rich_nodes_have_text_decoration(nodes: &[RichTextNodeInput]) -> bool {
    nodes.iter().any(|node| match node {
        RichTextNodeInput::Text { .. } | RichTextNodeInput::InlineRect { .. } => false,
        RichTextNodeInput::Span { style, .. } => style.text_decoration.is_some(),
        RichTextNodeInput::Combine {
            style,
            decoration_runs,
            ..
        } => {
            style.text_decoration.is_some()
                || decoration_runs
                    .iter()
                    .any(|run| run.text_decoration.is_some())
        }
        RichTextNodeInput::Ruby {
            style,
            base,
            rt,
            rt_levels,
            ..
        } => {
            style.text_decoration.is_some()
                || rich_nodes_have_text_decoration(base)
                || rich_nodes_have_text_decoration(rt)
                || rt_levels
                    .iter()
                    .any(|level| rich_nodes_have_text_decoration(level))
        }
        RichTextNodeInput::InlineBox {
            style, children, ..
        }
        | RichTextNodeInput::DecoratedSpan {
            style, children, ..
        } => style.text_decoration.is_some() || rich_nodes_have_text_decoration(children),
    })
}

fn coalesce_rich_segments(segments: &mut Vec<RichSegment>) {
    let mut merged: Vec<RichSegment> = Vec::with_capacity(segments.len());
    for segment in segments.drain(..) {
        if let Some(previous) = merged.last_mut()
            && previous.combine == segment.combine
            && resolved_styles_have_equal_layout(&previous.style, &segment.style)
        {
            previous.text.push_str(&segment.text);
            previous.decoration_runs.extend(segment.decoration_runs);
        } else {
            merged.push(segment);
        }
    }
    *segments = merged;
}

fn resolved_styles_have_equal_layout(left: &ResolvedStyle, right: &ResolvedStyle) -> bool {
    left.font_families == right.font_families
        && left.font_weight == right.font_weight
        && left.font_style == right.font_style
        && left.font_size_px == right.font_size_px
        && left.line_height == right.line_height
        && left.line_height_px == right.line_height_px
        && left.letter_spacing_px == right.letter_spacing_px
        && left.language == right.language
        && left.color == right.color
        && left.text_strokes == right.text_strokes
        && left.text_shadows == right.text_shadows
        && left.font_variation_settings == right.font_variation_settings
        && left.font_feature_settings == right.font_feature_settings
        && left.text_orientation == right.text_orientation
}

/// Determine whether two resolved styles share one `HarfBuzz` shaping run.
/// Paint fields are deliberately excluded; the glyph cluster that starts at a
/// paint boundary keeps the paint of its source-start grapheme after the
/// shared run is distributed.
pub(super) fn are_resolved_styles_shaping_equivalent(
    left: &ResolvedStyle,
    right: &ResolvedStyle,
) -> bool {
    left.font_families == right.font_families
        && left.font_weight == right.font_weight
        && left.font_style == right.font_style
        && left.font_size_px == right.font_size_px
        && left.letter_spacing_px == right.letter_spacing_px
        && left.language == right.language
        && left.font_variation_settings == right.font_variation_settings
        && left.font_feature_settings == right.font_feature_settings
        && left.text_orientation == right.text_orientation
}

pub(super) fn build_default_style(
    req: &TextLayoutRequest,
    default_font_families: &[String],
    default_font_weight: u16,
    default_font_style: &FontStyle,
    chosen_font_size_px: f64,
) -> ResolvedStyle {
    let scale = selected_font_size_scale(req.font_size_px, chosen_font_size_px);
    ResolvedStyle {
        font_families: if default_font_families.is_empty() {
            vec!["default".to_string()]
        } else {
            default_font_families.to_vec()
        },
        font_weight: default_font_weight,
        font_style: default_font_style.clone(),
        font_size_px: chosen_font_size_px,
        line_height: req.line_height,
        line_height_px: req.line_height_px,
        letter_spacing_px: req.letter_spacing_px * scale,
        language: super::language_to_option_string(req.language),
        color: None,
        text_strokes: None,
        text_shadows: None,
        font_variation_settings: format_css_font_variation_settings(&req.font_variation_settings),
        font_feature_settings: format_css_font_feature_settings(&req.font_feature_settings),
        text_orientation: req.text_orientation,
        text_decoration: None,
    }
}

pub(super) fn resolve_style(
    input: &RichTextStyleInput,
    fallback: &ResolvedStyle,
    scale: f64,
) -> ResolvedStyle {
    let line_height_px = if input.line_height_px.is_some() {
        input.line_height_px
    } else if input.line_height.is_some() {
        None
    } else {
        fallback.line_height_px
    };
    ResolvedStyle {
        font_families: if input.font_family.is_empty() {
            fallback.font_families.clone()
        } else {
            input.font_family.clone()
        },
        font_weight: input.font_weight,
        font_style: input.font_style.clone(),
        font_size_px: input.font_size_px * scale,
        line_height: input.line_height.or(fallback.line_height),
        // Pixel line height is an absolute authored constraint, matching the
        // plain-text fit path. Font-size fitting scales fontSizePx and tracking,
        // but does not silently rewrite explicit lineHeightPx.
        line_height_px,
        letter_spacing_px: input
            .letter_spacing_px
            .unwrap_or(fallback.letter_spacing_px / scale.max(0.0001))
            * scale,
        language: input.language.clone().or_else(|| fallback.language.clone()),
        color: input.color.clone().or_else(|| fallback.color.clone()),
        text_strokes: input
            .text_strokes
            .clone()
            .or_else(|| fallback.text_strokes.clone()),
        text_shadows: input
            .text_shadows
            .clone()
            .or_else(|| fallback.text_shadows.clone()),
        font_variation_settings: input
            .font_variation_settings
            .clone()
            .or_else(|| fallback.font_variation_settings.clone()),
        font_feature_settings: input
            .font_feature_settings
            .clone()
            .or_else(|| fallback.font_feature_settings.clone()),
        text_orientation: super::TextOrientation::from_option(input.text_orientation.as_deref()),
        text_decoration: input.text_decoration.clone(),
    }
}

/// Collapse whitespace runs across `Segment` text (white-space normal /
/// nowrap), matching the plain-text collapse. Collapse state carries across
/// segment and decorated-span boundaries; ruby and inline boxes are atomic
/// inline content (they count as non-whitespace, and an inline box collapses
/// its children in a fresh inner context).
pub(super) fn collapse_whitespace_in_nodes(nodes: &mut [RichInlineNode]) {
    let mut in_ws = false;
    let mut seen_non_ws = false;
    collapse_whitespace_walk(nodes, &mut in_ws, &mut seen_non_ws);
    trim_trailing_collapsed_space(nodes);
}

fn collapse_whitespace_walk(
    nodes: &mut [RichInlineNode],
    in_ws: &mut bool,
    seen_non_ws: &mut bool,
) {
    for node in nodes {
        match node {
            RichInlineNode::Segment(seg) => {
                if decoration_runs_match_text(seg) {
                    let mut collapsed = String::with_capacity(seg.text.len());
                    for run in &mut seg.decoration_runs {
                        let mut collapsed_run = String::with_capacity(run.text.len());
                        for ch in run.text.chars() {
                            if matches!(ch, ' ' | '\t' | '\n' | '\r') {
                                if !*in_ws && *seen_non_ws {
                                    collapsed_run.push(' ');
                                }
                                *in_ws = true;
                            } else {
                                *in_ws = false;
                                *seen_non_ws = true;
                                collapsed_run.push(ch);
                            }
                        }
                        collapsed.push_str(&collapsed_run);
                        run.text = collapsed_run;
                    }
                    seg.text = collapsed;
                } else {
                    let mut collapsed = String::with_capacity(seg.text.len());
                    for ch in seg.text.chars() {
                        if matches!(ch, ' ' | '\t' | '\n' | '\r') {
                            if !*in_ws && *seen_non_ws {
                                collapsed.push(' ');
                            }
                            *in_ws = true;
                        } else {
                            *in_ws = false;
                            *seen_non_ws = true;
                            collapsed.push(ch);
                        }
                    }
                    seg.text = collapsed;
                }
            }
            RichInlineNode::InlineRect(_) | RichInlineNode::Ruby(_) => {
                *in_ws = false;
                *seen_non_ws = true;
            }
            RichInlineNode::InlineBox(ibox) => {
                collapse_whitespace_in_nodes(&mut ibox.children);
                *in_ws = false;
                *seen_non_ws = true;
            }
            RichInlineNode::DecoratedSpan(span) => {
                collapse_whitespace_walk(&mut span.children, in_ws, seen_non_ws);
            }
        }
    }
}

/// Remove a single trailing collapsed space from the last text content in
/// document order. Returns `true` once the trailing content was found.
fn trim_trailing_collapsed_space(nodes: &mut [RichInlineNode]) -> bool {
    for node in nodes.iter_mut().rev() {
        match node {
            RichInlineNode::Segment(seg) => {
                if seg.text.is_empty() {
                    continue;
                }
                if seg.text.ends_with(' ') {
                    seg.text.pop();
                    if decoration_runs_match_text_with_trailing_space(seg) {
                        for run in seg.decoration_runs.iter_mut().rev() {
                            if run.text.ends_with(' ') {
                                run.text.pop();
                                break;
                            }
                            if !run.text.is_empty() {
                                break;
                            }
                        }
                    }
                }
                return true;
            }
            RichInlineNode::DecoratedSpan(span) => {
                if trim_trailing_collapsed_space(&mut span.children) {
                    return true;
                }
            }
            RichInlineNode::InlineBox(_)
            | RichInlineNode::InlineRect(_)
            | RichInlineNode::Ruby(_) => {
                return true;
            }
        }
    }
    false
}

/// Normalize pre-wrap hard breaks and expand tabs in all `Segment` text.
pub(super) fn expand_tabs_in_nodes(nodes: &mut [RichInlineNode], tab_size: u32) {
    use crate::text::types::expand_tabs;
    for node in nodes {
        match node {
            RichInlineNode::Segment(seg) => {
                if seg.text.contains('\t') || seg.text.contains('\r') {
                    if decoration_runs_match_text(seg) {
                        expand_tabs_in_decoration_runs(seg, tab_size);
                    } else {
                        seg.text = expand_tabs(&seg.text, tab_size);
                    }
                }
            }
            RichInlineNode::InlineBox(ibox) => {
                expand_tabs_in_nodes(&mut ibox.children, tab_size);
            }
            RichInlineNode::DecoratedSpan(span) => {
                expand_tabs_in_nodes(&mut span.children, tab_size);
            }
            RichInlineNode::Ruby(_) | RichInlineNode::InlineRect(_) => {}
        }
    }
}

fn decoration_runs_match_text(segment: &RichSegment) -> bool {
    decoration_runs_match_value(&segment.decoration_runs, &segment.text)
}

fn decoration_runs_match_text_with_trailing_space(segment: &RichSegment) -> bool {
    let mut text_with_space = segment.text.clone();
    text_with_space.push(' ');
    decoration_runs_match_value(&segment.decoration_runs, &text_with_space)
}

fn decoration_runs_match_value(
    runs: &[crate::text::types::RichTextDecorationRunInput],
    text: &str,
) -> bool {
    let mut remaining_text = text;
    !runs.is_empty()
        && runs.iter().all(|run| {
            let Some(suffix) = remaining_text.strip_prefix(&run.text) else {
                return false;
            };
            remaining_text = suffix;
            true
        })
        && remaining_text.is_empty()
}

fn expand_tabs_in_decoration_runs(segment: &mut RichSegment, tab_size: u32) {
    let tab_spaces = " ".repeat(tab_size as usize);
    let mut normalized_runs = vec![String::new(); segment.decoration_runs.len()];
    let mut pending_carriage_return: Option<usize> = None;
    for (run_index, run) in segment.decoration_runs.iter().enumerate() {
        for ch in run.text.chars() {
            if let Some(owner_index) = pending_carriage_return.take() {
                normalized_runs[owner_index].push('\n');
                if ch == '\n' {
                    continue;
                }
            }
            match ch {
                '\r' => pending_carriage_return = Some(run_index),
                '\t' => normalized_runs[run_index].push_str(&tab_spaces),
                _ => normalized_runs[run_index].push(ch),
            }
        }
    }
    if let Some(owner_index) = pending_carriage_return {
        normalized_runs[owner_index].push('\n');
    }
    segment.text = normalized_runs.concat();
    for (run, normalized) in segment.decoration_runs.iter_mut().zip(normalized_runs) {
        run.text = normalized;
    }
}

pub(super) fn flatten_rich_nodes_with_warnings(
    nodes: &[RichTextNodeInput],
    current_style: &ResolvedStyle,
    out: &mut Vec<RichInlineNode>,
    scale: f64,
    warnings: &mut Vec<TextWarning>,
) {
    for node in nodes {
        match node {
            RichTextNodeInput::Text { text } => {
                if !text.is_empty() {
                    out.push(RichInlineNode::Segment(RichSegment {
                        text: text.clone(),
                        style: current_style.clone(),
                        combine: false,
                        decoration_runs: Vec::new(),
                    }));
                }
            }
            RichTextNodeInput::Span { text, style } => {
                if !text.is_empty() {
                    out.push(RichInlineNode::Segment(RichSegment {
                        text: text.clone(),
                        style: resolve_style(style, current_style, scale),
                        combine: false,
                        decoration_runs: Vec::new(),
                    }));
                }
            }
            RichTextNodeInput::Combine {
                text,
                style,
                decoration_runs,
            } => {
                if !text.is_empty() {
                    out.push(RichInlineNode::Segment(RichSegment {
                        text: text.clone(),
                        style: resolve_style(style, current_style, scale),
                        combine: true,
                        decoration_runs: decoration_runs.clone(),
                    }));
                }
            }
            RichTextNodeInput::Ruby {
                ruby_position,
                ruby_align,
                ruby_gap_px,
                ruby_offset_px,
                ruby_line_sizing,
                style,
                base,
                rt,
                rt_levels,
            } => {
                let ruby_style = resolve_style(style, current_style, scale);
                let mut base_nodes = Vec::new();
                flatten_ruby_segments(base, &ruby_style, &mut base_nodes, scale);
                let rt_level_nodes = flatten_ruby_levels(rt, rt_levels, &ruby_style, scale);
                if !base_nodes.is_empty() && !rt_level_nodes.is_empty() {
                    let warning_start = warnings.len();
                    for rt_nodes in &rt_level_nodes {
                        push_long_ruby_annotation_warning(&base_nodes, rt_nodes, warnings);
                    }
                    let resolved_position = resolve_ruby_position(ruby_position.as_deref());
                    if resolved_position == RubyPosition::InterCharacter {
                        push_inter_character_fallback_warning(warnings);
                    }
                    out.push(RichInlineNode::Ruby(RichRuby {
                        ruby_position: resolved_position,
                        ruby_align: resolve_ruby_align(ruby_align.as_deref()),
                        ruby_gap_px: ruby_gap_px.unwrap_or(0.0) * scale,
                        ruby_offset_px: ruby_offset_px.unwrap_or(0.0) * scale,
                        ruby_line_sizing: resolve_ruby_line_sizing(ruby_line_sizing.as_deref()),
                        base: base_nodes,
                        rt_levels: rt_level_nodes,
                        warnings: warnings[warning_start..].to_vec(),
                    }));
                }
            }
            RichTextNodeInput::InlineBox {
                style,
                children,
                padding_inline,
                background,
                border_color,
                border_width,
                border_radius,
                span_key,
            } => {
                let box_style = resolve_style(style, current_style, scale);
                let mut child_nodes = Vec::new();
                let warning_start = warnings.len();
                flatten_inline_box_children(
                    children,
                    &box_style,
                    &mut child_nodes,
                    scale,
                    warnings,
                    1,
                );
                out.push(RichInlineNode::InlineBox(RichInlineBox {
                    children: child_nodes,
                    padding_inline: padding_inline.unwrap_or([0.0, 0.0]),
                    border_width: border_width.unwrap_or(0.0),
                    background: background.clone(),
                    border_color: border_color.clone(),
                    border_radius: *border_radius,
                    span_key: span_key.clone(),
                    warnings: warnings[warning_start..].to_vec(),
                }));
            }
            RichTextNodeInput::InlineRect { rect } => {
                out.push(RichInlineNode::InlineRect(RichInlineRect {
                    input: rect.clone(),
                    style: current_style.clone(),
                }));
            }
            RichTextNodeInput::DecoratedSpan {
                style,
                children,
                padding_inline,
                background,
                border_color,
                border_width,
                border_radius,
                span_key,
            } => {
                let span_style = resolve_style(style, current_style, scale);
                let mut child_nodes = Vec::new();
                flatten_decorated_span_children(
                    children,
                    &span_style,
                    &mut child_nodes,
                    scale,
                    warnings,
                );
                out.push(RichInlineNode::DecoratedSpan(RichDecoratedSpan {
                    children: child_nodes,
                    padding_inline: padding_inline.unwrap_or([0.0, 0.0]),
                    border_width: border_width.unwrap_or(0.0),
                    background: background.clone(),
                    border_color: border_color.clone(),
                    border_radius: *border_radius,
                    span_key: span_key.clone(),
                }));
            }
        }
    }
}

/// Flatten `InlineBox` children. Ruby and nested `InlineBox` (up to depth limit) are allowed.
fn flatten_inline_box_children(
    nodes: &[RichTextNodeInput],
    current_style: &ResolvedStyle,
    out: &mut Vec<RichInlineNode>,
    scale: f64,
    warnings: &mut Vec<TextWarning>,
    depth: u32,
) {
    for node in nodes {
        match node {
            RichTextNodeInput::Text { text } => {
                if !text.is_empty() {
                    out.push(RichInlineNode::Segment(RichSegment {
                        text: text.clone(),
                        style: current_style.clone(),
                        combine: false,
                        decoration_runs: Vec::new(),
                    }));
                }
            }
            RichTextNodeInput::Span { text, style } => {
                if !text.is_empty() {
                    out.push(RichInlineNode::Segment(RichSegment {
                        text: text.clone(),
                        style: resolve_style(style, current_style, scale),
                        combine: false,
                        decoration_runs: Vec::new(),
                    }));
                }
            }
            RichTextNodeInput::Combine {
                text,
                style,
                decoration_runs,
            } => {
                if !text.is_empty() {
                    out.push(RichInlineNode::Segment(RichSegment {
                        text: text.clone(),
                        style: resolve_style(style, current_style, scale),
                        combine: true,
                        decoration_runs: decoration_runs.clone(),
                    }));
                }
            }
            RichTextNodeInput::Ruby {
                ruby_position,
                ruby_align,
                ruby_gap_px,
                ruby_offset_px,
                ruby_line_sizing,
                style,
                base,
                rt,
                rt_levels,
            } => {
                let ruby_style = resolve_style(style, current_style, scale);
                let mut base_nodes = Vec::new();
                flatten_ruby_segments(base, &ruby_style, &mut base_nodes, scale);
                let rt_level_nodes = flatten_ruby_levels(rt, rt_levels, &ruby_style, scale);
                if !base_nodes.is_empty() && !rt_level_nodes.is_empty() {
                    let warning_start = warnings.len();
                    for rt_nodes in &rt_level_nodes {
                        push_long_ruby_annotation_warning(&base_nodes, rt_nodes, warnings);
                    }
                    let resolved_position = resolve_ruby_position(ruby_position.as_deref());
                    if resolved_position == RubyPosition::InterCharacter {
                        push_inter_character_fallback_warning(warnings);
                    }
                    out.push(RichInlineNode::Ruby(RichRuby {
                        ruby_position: resolved_position,
                        ruby_align: resolve_ruby_align(ruby_align.as_deref()),
                        ruby_gap_px: ruby_gap_px.unwrap_or(0.0) * scale,
                        ruby_offset_px: ruby_offset_px.unwrap_or(0.0) * scale,
                        ruby_line_sizing: resolve_ruby_line_sizing(ruby_line_sizing.as_deref()),
                        base: base_nodes,
                        rt_levels: rt_level_nodes,
                        warnings: warnings[warning_start..].to_vec(),
                    }));
                }
            }
            RichTextNodeInput::InlineBox {
                style,
                children,
                padding_inline,
                background,
                border_color,
                border_width,
                border_radius,
                span_key,
            } => {
                if depth >= super::MAX_INLINE_BOX_DEPTH {
                    warnings.push(TextWarning {
                        code: "INLINE_BOX_MAX_DEPTH".to_string(),
                        message: format!(
                            "InlineBox nesting exceeds max depth ({}) and was skipped",
                            super::MAX_INLINE_BOX_DEPTH
                        ),
                        fallback: Some("skipped".to_string()),
                    });
                } else {
                    let box_style = resolve_style(style, current_style, scale);
                    let mut child_nodes = Vec::new();
                    let warning_start = warnings.len();
                    flatten_inline_box_children(
                        children,
                        &box_style,
                        &mut child_nodes,
                        scale,
                        warnings,
                        depth + 1,
                    );
                    out.push(RichInlineNode::InlineBox(RichInlineBox {
                        children: child_nodes,
                        padding_inline: padding_inline.unwrap_or([0.0, 0.0]),
                        border_width: border_width.unwrap_or(0.0),
                        background: background.clone(),
                        border_color: border_color.clone(),
                        border_radius: *border_radius,
                        span_key: span_key.clone(),
                        warnings: warnings[warning_start..].to_vec(),
                    }));
                }
            }
            RichTextNodeInput::InlineRect { rect } => {
                out.push(RichInlineNode::InlineRect(RichInlineRect {
                    input: rect.clone(),
                    style: current_style.clone(),
                }));
            }
            RichTextNodeInput::DecoratedSpan {
                style,
                children,
                padding_inline,
                background,
                border_color,
                border_width,
                border_radius,
                span_key,
            } => {
                let span_style = resolve_style(style, current_style, scale);
                let mut child_nodes = Vec::new();
                flatten_decorated_span_children(
                    children,
                    &span_style,
                    &mut child_nodes,
                    scale,
                    warnings,
                );
                out.push(RichInlineNode::DecoratedSpan(RichDecoratedSpan {
                    children: child_nodes,
                    padding_inline: padding_inline.unwrap_or([0.0, 0.0]),
                    border_width: border_width.unwrap_or(0.0),
                    background: background.clone(),
                    border_color: border_color.clone(),
                    border_radius: *border_radius,
                    span_key: span_key.clone(),
                }));
            }
        }
    }
}

/// Flatten `DecoratedSpan` children.
/// Ruby and `InlineBox` retain their atomic semantics. Nested `DecoratedSpan`
/// nodes remain fragmentable and carry their complete decoration ancestry.
///
/// The match body is identical to `flatten_rich_nodes_with_warnings`; this
/// function exists to keep call-site semantics clear.
fn flatten_decorated_span_children(
    nodes: &[RichTextNodeInput],
    current_style: &ResolvedStyle,
    out: &mut Vec<RichInlineNode>,
    scale: f64,
    warnings: &mut Vec<TextWarning>,
) {
    flatten_rich_nodes_with_warnings(nodes, current_style, out, scale, warnings);
}

fn resolve_ruby_position(value: Option<&str>) -> RubyPosition {
    match value {
        Some("over") => RubyPosition::Over,
        Some("under") => RubyPosition::Under,
        Some("inter-character") => RubyPosition::InterCharacter,
        _ => RubyPosition::Alternate,
    }
}

fn resolve_ruby_align(value: Option<&str>) -> RubyAlign {
    match value {
        Some("start") => RubyAlign::Start,
        Some("center") => RubyAlign::Center,
        Some("space-between") => RubyAlign::SpaceBetween,
        _ => RubyAlign::SpaceAround,
    }
}

fn resolve_ruby_line_sizing(value: Option<&str>) -> RubyLineSizing {
    match value {
        Some("stable") => RubyLineSizing::Stable,
        _ => RubyLineSizing::Css,
    }
}

fn flatten_ruby_levels(
    legacy_rt: &[RichTextNodeInput],
    rt_levels: &[Vec<RichTextNodeInput>],
    ruby_style: &ResolvedStyle,
    scale: f64,
) -> Vec<Vec<RichSegment>> {
    let mut result = Vec::new();
    if rt_levels.is_empty() {
        let mut level = Vec::new();
        flatten_ruby_segments(legacy_rt, ruby_style, &mut level, scale);
        if !level.is_empty() {
            result.push(level);
        }
        return result;
    }

    for rt_level in rt_levels {
        let mut level = Vec::new();
        flatten_ruby_segments(rt_level, ruby_style, &mut level, scale);
        if !level.is_empty() {
            result.push(level);
        }
    }
    result
}

fn flatten_ruby_segments(
    nodes: &[RichTextNodeInput],
    current_style: &ResolvedStyle,
    out: &mut Vec<RichSegment>,
    scale: f64,
) {
    for node in nodes {
        match node {
            RichTextNodeInput::Text { text } => {
                if !text.is_empty() {
                    out.push(RichSegment {
                        text: text.clone(),
                        style: current_style.clone(),
                        combine: false,
                        decoration_runs: Vec::new(),
                    });
                }
            }
            RichTextNodeInput::Span { text, style } => {
                if !text.is_empty() {
                    out.push(RichSegment {
                        text: text.clone(),
                        style: resolve_style(style, current_style, scale),
                        combine: false,
                        decoration_runs: Vec::new(),
                    });
                }
            }
            RichTextNodeInput::Combine {
                text,
                style,
                decoration_runs,
            } => {
                if !text.is_empty() {
                    out.push(RichSegment {
                        text: text.clone(),
                        style: resolve_style(style, current_style, scale),
                        combine: true,
                        decoration_runs: decoration_runs.clone(),
                    });
                }
            }
            RichTextNodeInput::Ruby { .. }
            | RichTextNodeInput::InlineBox { .. }
            | RichTextNodeInput::InlineRect { .. }
            | RichTextNodeInput::DecoratedSpan { .. } => {}
        }
    }
}

fn push_long_ruby_annotation_warning(
    base_nodes: &[RichSegment],
    rt_nodes: &[RichSegment],
    warnings: &mut Vec<TextWarning>,
) {
    let base_advance = estimate_ruby_inline_advance(base_nodes);
    let rt_advance = estimate_ruby_inline_advance(rt_nodes);
    if rt_advance <= base_advance + 0.01 {
        return;
    }

    let base_text: String = base_nodes
        .iter()
        .map(|segment| segment.text.as_str())
        .collect();
    let rt_text: String = rt_nodes
        .iter()
        .map(|segment| segment.text.as_str())
        .collect();

    warnings.push(TextWarning {
        code: "LONG_RUBY_ANNOTATION".to_string(),
        message: format!(
            "Ruby annotation \"{rt_text}\" is wider than base text \"{base_text}\"; long ruby overhang is experimental"
        ),
        fallback: Some("rendered-without-jlreq-overhang-adjustment".to_string()),
    });
}

fn push_inter_character_fallback_warning(warnings: &mut Vec<TextWarning>) {
    warnings.push(TextWarning {
        code: "RUBY_INTER_CHARACTER_FALLBACK".to_string(),
        message: "rubyPosition=\"inter-character\" is not implemented yet; rendering as over ruby"
            .to_string(),
        fallback: Some("ruby-position-over".to_string()),
    });
}

fn estimate_ruby_inline_advance(segments: &[RichSegment]) -> f64 {
    segments
        .iter()
        .map(|segment| grapheme_split(&segment.text).len() as f64 * segment.style.font_size_px)
        .sum()
}

/// Collect notdef warnings from all positioned glyphs across layout tokens.
pub(super) fn collect_notdef_warnings_from_tokens(tokens: &[LayoutToken]) -> Vec<TextWarning> {
    let mut all_notdef = Vec::new();
    for token in tokens {
        all_notdef.extend(crate::text::types::collect_notdef_from_positioned_glyphs(
            &token.glyphs,
        ));
    }
    crate::text::types::build_notdef_warnings(&all_notdef)
}

/// Collect recoverable diagnostics from the authored nodes retained by one
/// canonical display projection.
///
/// Ruby and inline boxes are atomic. An inline box stores the diagnostics of
/// its complete subtree, so the collector deliberately does not descend into
/// its children and cannot duplicate nested warnings. Decorated spans remain
/// fragmentable and are traversed in authored order.
pub(super) fn collect_owned_warnings(nodes: &[RichInlineNode]) -> Vec<TextWarning> {
    fn append(nodes: &[RichInlineNode], output: &mut Vec<TextWarning>) {
        for node in nodes {
            match node {
                RichInlineNode::Segment(_) | RichInlineNode::InlineRect(_) => {}
                RichInlineNode::Ruby(ruby) => output.extend(ruby.warnings.iter().cloned()),
                RichInlineNode::InlineBox(inline_box) => {
                    output.extend(inline_box.warnings.iter().cloned());
                }
                RichInlineNode::DecoratedSpan(span) => append(&span.children, output),
            }
        }
    }

    let mut warnings = Vec::new();
    append(nodes, &mut warnings);
    warnings
}
