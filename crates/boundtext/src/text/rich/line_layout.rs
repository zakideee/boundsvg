use std::collections::HashSet;

use crate::text::kinsoku::{
    KinsokuProfile, apply_kinsoku_by_boundary, avoid_non_breaking_pair_split_by_boundary,
    get_kinsoku_profile,
};
use crate::text::types::{
    InlineBoxDecoration, InlineRectBlockSizeInput, InlineRectFragment, Line, TextBBox,
    TextLayoutResult, TextOverflow, TextWarning, WrapMode,
};

use super::{
    DecorationSpanMeta, LayoutLine, LayoutToken, LineInlineBoxDecoration, LineInlineRect,
    TextLayoutRequest, shift_glyphs_x, shift_glyphs_y,
};

pub(super) fn token_uses_ja_kinsoku(
    token: &LayoutToken,
    fallback: Option<&KinsokuProfile>,
) -> bool {
    let fallback_enabled = fallback.is_some();
    token.kinsoku_start.unwrap_or(fallback_enabled) || token.kinsoku_end.unwrap_or(fallback_enabled)
}

pub(super) fn kinsoku_profile_at_boundary<'a>(
    tokens: &[LayoutToken],
    boundary: usize,
    fallback: Option<&'a KinsokuProfile>,
) -> Option<&'a KinsokuProfile> {
    let fallback_enabled = fallback.is_some();
    let left_enabled = boundary
        .checked_sub(1)
        .and_then(|index| tokens.get(index))
        .is_some_and(|token| token.kinsoku_end.unwrap_or(fallback_enabled));
    let right_enabled = tokens
        .get(boundary)
        .is_some_and(|token| token.kinsoku_start.unwrap_or(fallback_enabled));
    if left_enabled || right_enabled {
        // Inline language carries no strictness setting, so a local ja edge
        // inside a neutral paragraph uses the standard Japanese profile.
        fallback.or_else(|| get_kinsoku_profile(Some("ja")))
    } else {
        None
    }
}

pub(super) fn layout_horizontal_tokens(
    req: &TextLayoutRequest,
    tokens: &[LayoutToken],
    decoration_spans: &[DecorationSpanMeta],
    chosen_font_size_px: f64,
    warnings: Vec<TextWarning>,
) -> Option<TextLayoutResult> {
    let max_width = req.max_width.max(1.0);
    let indent = req.text_indent.unwrap_or(0.0);
    let profile = get_kinsoku_profile(Some(super::language_to_str(req.language)));

    let mut lines = break_tokens_horizontal(
        tokens,
        max_width,
        indent,
        req.effective_wrap(),
        profile,
        req.uax14_breaks,
        decoration_spans,
        req.has_forced_newline_breaks(),
    )?;
    let kinsoku_unresolved = lines.iter().any(|line| line.kinsoku_unresolved);
    let total_count = lines.len();
    if let Some(max_lines) = req.max_lines
        && lines.len() > max_lines
    {
        lines.truncate(max_lines);
    }

    let max_line_width = lines
        .iter()
        .map(|line| line.advance)
        .fold(0.0_f64, f64::max);
    // Collect per-span occurrence counts to determine fragment positions.
    let mut span_line_count = std::collections::HashMap::new();
    for line in &lines {
        for decoration in &line.decorations {
            if let Some(span_id) = decoration.span_id {
                *span_line_count.entry(span_id).or_insert(0) += 1;
            }
        }
    }

    let mut y = 0.0;
    let mut result_lines = Vec::with_capacity(lines.len());
    let mut all_decorations = Vec::new();
    let mut all_inline_rects = Vec::new();
    let mut span_seen_count = std::collections::HashMap::new();
    for line in lines {
        let mut glyphs = line.glyphs;
        shift_glyphs_x(&mut glyphs, 0.0);
        shift_glyphs_y(&mut glyphs, y);
        for decoration in &line.decorations {
            // Resolve per-corner border-radius for fragmentable span decorations
            let resolved_radius = if let Some(span_id) = decoration.span_id {
                let total = *span_line_count.get(&span_id).unwrap_or(&1);
                let seen = span_seen_count.entry(span_id).or_insert(0);
                *seen += 1;
                resolve_fragment_border_radius(decoration.border_radius, *seen == 1, *seen == total)
            } else {
                decoration.border_radius
            };

            all_decorations.push(InlineBoxDecoration {
                x: decoration.offset,
                y,
                width: decoration.advance,
                height: decoration.cross_size,
                background: decoration.background.clone(),
                border_color: decoration.border_color.clone(),
                border_width: decoration.border_width,
                border_radius: resolved_radius,
                span_key: decoration.span_key.clone(),
            });
        }
        for inline_rect in &line.inline_rects {
            let block_size = resolve_inline_rect_block_size(&inline_rect.rect, line.cross_size);
            all_inline_rects.push(InlineRectFragment {
                fragment_id: inline_rect.rect.fragment_id.clone(),
                x: inline_rect.offset,
                y: y + horizontal_inline_rect_block_offset(
                    &inline_rect.rect,
                    line.cross_size,
                    block_size,
                ),
                width: inline_rect.rect.inline_size_px,
                height: block_size,
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
        result_lines.push(Line {
            text: line.text,
            glyphs: Vec::new(),
            width: line.advance,
            baseline_y: y + line.reference_offset,
            fragments: None,
            positioned_glyphs: Some(glyphs),
        });
        y += line.cross_size;
    }

    Some(TextLayoutResult {
        lines: result_lines,
        bbox: TextBBox {
            x: 0.0,
            y: 0.0,
            w: max_line_width,
            h: y,
        },
        chosen_font_size_px,
        overflow: if kinsoku_unresolved {
            TextOverflow::kinsoku_unresolved()
        } else if total_count > req.max_lines.unwrap_or(total_count) {
            TextOverflow::overflow("lines truncated by maxLines")
        } else {
            TextOverflow::none()
        },
        source_text: None,
        display_text: None,
        unit_map: None,
        warnings,
        inline_box_decorations: all_decorations,
        text_decorations: Vec::new(),
        inline_rects: all_inline_rects,
    })
}

pub(super) fn layout_vertical_tokens(
    req: &TextLayoutRequest,
    tokens: &[LayoutToken],
    decoration_spans: &[DecorationSpanMeta],
    chosen_font_size_px: f64,
    warnings: Vec<TextWarning>,
) -> Option<TextLayoutResult> {
    let max_height = req.max_height.unwrap_or(req.max_width.max(1.0)).max(1.0);
    let indent = req.text_indent.unwrap_or(0.0);
    let profile = get_kinsoku_profile(Some(super::language_to_str(req.language)));

    let mut columns = break_tokens_vertical(
        tokens,
        max_height,
        indent,
        req.effective_wrap(),
        profile,
        req.uax14_breaks,
        decoration_spans,
        req.has_forced_newline_breaks(),
    )?;
    let kinsoku_unresolved = columns.iter().any(|column| column.kinsoku_unresolved);
    let total_count = columns.len();
    if let Some(max_lines) = req.max_lines
        && columns.len() > max_lines
    {
        columns.truncate(max_lines);
    }

    let max_column_height = columns
        .iter()
        .map(|column| column.advance)
        .fold(0.0_f64, f64::max);
    let total_width = columns.iter().map(|column| column.cross_size).sum::<f64>();

    let mut span_line_count = std::collections::HashMap::new();
    for column in &columns {
        for decoration in &column.decorations {
            if let Some(span_id) = decoration.span_id {
                *span_line_count.entry(span_id).or_insert(0) += 1;
            }
        }
    }

    let mut x_cursor = total_width;
    let mut result_lines = Vec::with_capacity(columns.len());
    let mut all_decorations = Vec::new();
    let mut all_inline_rects = Vec::new();
    let mut span_seen_count = std::collections::HashMap::new();
    for column in &columns {
        x_cursor -= column.cross_size;
        let mut glyphs = column.glyphs.clone();
        shift_glyphs_x(&mut glyphs, x_cursor);
        // Map column decorations to screen-space coordinates.
        // In vertical-rl: x = column x position + cross-axis alignment shift,
        // y = advance-direction offset. cross_offset aligns the decoration
        // with glyphs when tokens have different cross_size in the same column.
        for decoration in &column.decorations {
            let resolved_radius = if let Some(span_id) = decoration.span_id {
                let total = *span_line_count.get(&span_id).unwrap_or(&1);
                let seen = span_seen_count.entry(span_id).or_insert(0);
                *seen += 1;
                resolve_fragment_border_radius_vertical(
                    decoration.border_radius,
                    *seen == 1,
                    *seen == total,
                )
            } else {
                decoration.border_radius
            };
            all_decorations.push(InlineBoxDecoration {
                x: x_cursor + decoration.cross_offset,
                y: decoration.offset,
                width: decoration.cross_size,
                height: decoration.advance,
                background: decoration.background.clone(),
                border_color: decoration.border_color.clone(),
                border_width: decoration.border_width,
                border_radius: resolved_radius,
                span_key: decoration.span_key.clone(),
            });
        }
        for inline_rect in &column.inline_rects {
            let block_size = resolve_inline_rect_block_size(&inline_rect.rect, column.cross_size);
            all_inline_rects.push(InlineRectFragment {
                fragment_id: inline_rect.rect.fragment_id.clone(),
                x: x_cursor
                    + vertical_inline_rect_block_offset(
                        &inline_rect.rect,
                        column.cross_size,
                        block_size,
                    ),
                y: inline_rect.offset,
                width: block_size,
                height: inline_rect.rect.inline_size_px,
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
        result_lines.push(Line {
            text: column.text.clone(),
            glyphs: Vec::new(),
            width: column.advance,
            baseline_y: x_cursor + column.reference_offset,
            fragments: None,
            positioned_glyphs: Some(glyphs),
        });
    }

    Some(TextLayoutResult {
        lines: result_lines,
        bbox: TextBBox {
            x: 0.0,
            y: 0.0,
            w: total_width,
            h: max_column_height,
        },
        chosen_font_size_px,
        overflow: if kinsoku_unresolved {
            TextOverflow::kinsoku_unresolved()
        } else if total_count > req.max_lines.unwrap_or(total_count) {
            TextOverflow::overflow("columns truncated by maxLines")
        } else {
            TextOverflow::none()
        },
        source_text: None,
        display_text: None,
        unit_map: None,
        warnings,
        inline_box_decorations: all_decorations,
        text_decorations: Vec::new(),
        inline_rects: all_inline_rects,
    })
}

fn resolve_inline_rect_block_size(
    rect: &crate::text::types::InlineRectInput,
    line_cross_size: f64,
) -> f64 {
    match rect.block_size_px.as_ref() {
        Some(InlineRectBlockSizeInput::Pixels(size)) => *size,
        Some(InlineRectBlockSizeInput::Line(_)) | None => line_cross_size,
    }
}

fn horizontal_inline_rect_block_offset(
    rect: &crate::text::types::InlineRectInput,
    line_cross_size: f64,
    block_size: f64,
) -> f64 {
    match rect.block_align.as_deref().unwrap_or("center") {
        "start" => 0.0,
        "end" => line_cross_size - block_size,
        _ => (line_cross_size - block_size) * 0.5,
    }
}

fn vertical_inline_rect_block_offset(
    rect: &crate::text::types::InlineRectInput,
    line_cross_size: f64,
    block_size: f64,
) -> f64 {
    match rect.block_align.as_deref().unwrap_or("center") {
        "start" => line_cross_size - block_size,
        "end" => 0.0,
        _ => (line_cross_size - block_size) * 0.5,
    }
}

/// Resolve per-corner border-radius for a decoration fragment.
/// In horizontal mode: start side = left (tl, bl), end side = right (tr, br).
/// - Only fragment: all corners preserved.
/// - Start fragment (multi-line): zero right corners.
/// - Middle fragment: all corners zeroed.
/// - End fragment: zero left corners.
pub(super) fn resolve_fragment_border_radius(
    radius: Option<[f64; 4]>,
    is_first: bool,
    is_last: bool,
) -> Option<[f64; 4]> {
    let [tl, tr, br, bl] = radius?;
    let resolved = [
        if is_first { tl } else { 0.0 },
        if is_last { tr } else { 0.0 },
        if is_last { br } else { 0.0 },
        if is_first { bl } else { 0.0 },
    ];
    if resolved == [0.0; 4] {
        None
    } else {
        Some(resolved)
    }
}

pub(super) fn resolve_fragment_border_radius_vertical(
    radius: Option<[f64; 4]>,
    is_first: bool,
    is_last: bool,
) -> Option<[f64; 4]> {
    let [tl, tr, br, bl] = radius?;
    let resolved = [
        if is_first { tl } else { 0.0 },
        if is_first { tr } else { 0.0 },
        if is_last { br } else { 0.0 },
        if is_last { bl } else { 0.0 },
    ];
    if resolved == [0.0; 4] {
        None
    } else {
        Some(resolved)
    }
}

/// Compute the effective line width for a token range, including decoration
/// start/end advance for every decorated span that appears inside the range.
///
/// This is used by line/column breaking and by final `LayoutLine.advance`, so it
/// must count not only spans that align with the outer line boundaries but also
/// decorated spans that start or end in the middle of an otherwise plain range.
pub(super) fn effective_line_width(
    tokens: &[LayoutToken],
    start: usize,
    end: usize,
    indent: f64,
) -> f64 {
    let mut width = if start == 0 { indent } else { 0.0 };
    for index in start..end {
        let token = &tokens[index];
        width += super::token_decoration_start_advance(token) + token.advance;
        for membership in &token.decoration_memberships {
            if index + 1 == end
                || !super::token_has_decoration_span(&tokens[index + 1], membership.span_id)
            {
                width += membership.end_advance;
            }
        }
    }
    width
}

#[derive(Debug)]
struct ActiveDecoration {
    span_id: u32,
    start: f64,
}

fn common_decoration_prefix(
    active: &[ActiveDecoration],
    memberships: &[super::DecorationMembership],
) -> usize {
    active
        .iter()
        .zip(memberships)
        .take_while(|(open, current)| open.span_id == current.span_id)
        .count()
}

fn close_decoration(
    output: &mut Vec<LineInlineBoxDecoration>,
    coordinate: &mut f64,
    active: &ActiveDecoration,
    previous_token: &LayoutToken,
    cross_size: f64,
    decoration_spans: &[DecorationSpanMeta],
) {
    let end_advance = super::token_decoration_membership(previous_token, active.span_id)
        .map_or(0.0, |membership| membership.end_advance);
    let meta = &decoration_spans[active.span_id as usize];
    output.push(LineInlineBoxDecoration {
        offset: active.start,
        advance: *coordinate + end_advance - active.start,
        cross_size,
        cross_offset: 0.0,
        background: meta.background.clone(),
        border_color: meta.border_color.clone(),
        border_width: (meta.border_width > 0.0).then_some(meta.border_width),
        border_radius: meta.border_radius,
        span_id: Some(active.span_id),
        span_key: meta.span_key.clone(),
    });
    *coordinate += end_advance;
}

fn assemble_empty_line(newline_token: &LayoutToken, indent: f64) -> LayoutLine {
    LayoutLine {
        text: String::new(),
        advance: indent,
        cross_size: newline_token.cross_size,
        reference_offset: newline_token.reference_offset,
        glyphs: Vec::new(),
        decorations: Vec::new(),
        inline_rects: Vec::new(),
        kinsoku_unresolved: false,
    }
}

#[expect(
    clippy::unnecessary_wraps,
    reason = "rich flow callers use Option to share the same break-helper contract"
)]
pub(super) fn break_tokens_horizontal(
    tokens: &[LayoutToken],
    max_width: f64,
    indent: f64,
    wrap: WrapMode,
    profile: Option<&KinsokuProfile>,
    uax14_breaks: Option<&[usize]>,
    decoration_spans: &[DecorationSpanMeta],
    force_newline_breaks: bool,
) -> Option<Vec<LayoutLine>> {
    if tokens.is_empty() {
        return Some(vec![LayoutLine {
            text: String::new(),
            advance: 0.0,
            cross_size: 0.0,
            reference_offset: 0.0,
            glyphs: Vec::new(),
            decorations: Vec::new(),
            inline_rects: Vec::new(),
            kinsoku_unresolved: false,
        }]);
    }
    if wrap == WrapMode::None && !force_newline_breaks {
        return Some(vec![assemble_horizontal_line(
            tokens,
            indent,
            decoration_spans,
        )]);
    }

    let mut lines = Vec::new();
    let mut start = 0usize;
    let mut last_normal_break = None;
    let token_texts: Vec<&str> = tokens.iter().map(|token| token.text.as_str()).collect();
    let normal_break_set = build_uax14_break_set_for_tokens(tokens, uax14_breaks);

    for index in 0..tokens.len() {
        // PreWrap: `\n` token forces a mandatory line break
        if force_newline_breaks && tokens[index].text == "\n" {
            let line_indent = if start == 0 { indent } else { 0.0 };
            lines.push(if index > start {
                assemble_horizontal_line(&tokens[start..index], line_indent, decoration_spans)
            } else {
                assemble_empty_line(&tokens[index], line_indent)
            });
            start = index + 1;
            last_normal_break = None;
            continue;
        }

        // wrap=None with forced newline breaks: only break at \n, not at width
        if wrap == WrapMode::None {
            continue;
        }

        // Register the boundary BEFORE the current token; registering
        // index + 1 here would let an overflowing token ride along on the
        // current line even when an earlier break opportunity existed.
        last_normal_break =
            update_last_normal_break(normal_break_set.as_deref(), index, last_normal_break);
        let width = effective_line_width(tokens, start, index + 1, indent);
        if width <= max_width || index == start {
            continue;
        }

        let end_of_run_break = normal_break_set
            .as_deref()
            .is_some_and(|flags| flags.get(index + 1).copied().unwrap_or(false));
        let Some(resolution) = resolve_break_for_rich(
            wrap,
            start,
            index,
            last_normal_break,
            end_of_run_break,
            true,
            tokens,
            &token_texts,
            profile,
        ) else {
            continue;
        };
        let break_pos = resolution.position;

        let mut line = assemble_horizontal_line(
            &tokens[start..break_pos],
            if start == 0 { indent } else { 0.0 },
            decoration_spans,
        );
        line.kinsoku_unresolved = resolution.kinsoku_unresolved;
        lines.push(line);
        start = break_pos;
        last_normal_break = None;
    }

    if start < tokens.len() {
        lines.push(assemble_horizontal_line(
            &tokens[start..],
            if start == 0 { indent } else { 0.0 },
            decoration_spans,
        ));
    } else if force_newline_breaks
        && let Some(newline_token) = tokens.last().filter(|token| token.text == "\n")
    {
        lines.push(assemble_empty_line(newline_token, 0.0));
    }
    Some(lines)
}

#[expect(
    clippy::unnecessary_wraps,
    reason = "rich flow callers use Option to share the same break-helper contract"
)]
pub(super) fn break_tokens_vertical(
    tokens: &[LayoutToken],
    max_height: f64,
    indent: f64,
    wrap: WrapMode,
    profile: Option<&KinsokuProfile>,
    uax14_breaks: Option<&[usize]>,
    decoration_spans: &[DecorationSpanMeta],
    force_newline_breaks: bool,
) -> Option<Vec<LayoutLine>> {
    if tokens.is_empty() {
        return Some(vec![LayoutLine {
            text: String::new(),
            advance: 0.0,
            cross_size: 0.0,
            reference_offset: 0.0,
            glyphs: Vec::new(),
            decorations: Vec::new(),
            inline_rects: Vec::new(),
            kinsoku_unresolved: false,
        }]);
    }
    if wrap == WrapMode::None && !force_newline_breaks {
        return Some(vec![assemble_vertical_line(
            tokens,
            indent,
            decoration_spans,
        )]);
    }

    let mut columns = Vec::new();
    let mut start = 0usize;
    let mut last_normal_break = None;
    let token_texts: Vec<&str> = tokens.iter().map(|token| token.text.as_str()).collect();
    let normal_break_set = build_uax14_break_set_for_tokens(tokens, uax14_breaks);

    for index in 0..tokens.len() {
        // PreWrap: `\n` token forces a mandatory column break
        if force_newline_breaks && tokens[index].text == "\n" {
            let column_indent = if start == 0 { indent } else { 0.0 };
            columns.push(if index > start {
                assemble_vertical_line(&tokens[start..index], column_indent, decoration_spans)
            } else {
                assemble_empty_line(&tokens[index], column_indent)
            });
            start = index + 1;
            last_normal_break = None;
            continue;
        }

        // wrap=None with forced newline breaks: only break at \n
        if wrap == WrapMode::None {
            continue;
        }

        // Same boundary ordering as the horizontal path: register the
        // boundary before the current token so an overflowing token does
        // not ride along past an earlier break opportunity.
        last_normal_break =
            update_last_normal_break(normal_break_set.as_deref(), index, last_normal_break);
        let height = effective_line_width(tokens, start, index + 1, indent);
        if height <= max_height || index == start {
            continue;
        }

        let end_of_run_break = normal_break_set
            .as_deref()
            .is_some_and(|flags| flags.get(index + 1).copied().unwrap_or(false));
        let Some(resolution) = resolve_break_for_rich(
            wrap,
            start,
            index,
            last_normal_break,
            end_of_run_break,
            true,
            tokens,
            &token_texts,
            profile,
        ) else {
            continue;
        };
        let break_pos = resolution.position;

        let mut column = assemble_vertical_line(
            &tokens[start..break_pos],
            if start == 0 { indent } else { 0.0 },
            decoration_spans,
        );
        column.kinsoku_unresolved = resolution.kinsoku_unresolved;
        columns.push(column);
        start = break_pos;
        last_normal_break = None;
    }

    if start < tokens.len() {
        columns.push(assemble_vertical_line(
            &tokens[start..],
            if start == 0 { indent } else { 0.0 },
            decoration_spans,
        ));
    } else if force_newline_breaks
        && let Some(newline_token) = tokens.last().filter(|token| token.text == "\n")
    {
        columns.push(assemble_empty_line(newline_token, 0.0));
    }
    Some(columns)
}

pub(super) fn assemble_horizontal_line(
    tokens: &[LayoutToken],
    indent: f64,
    decoration_spans: &[DecorationSpanMeta],
) -> LayoutLine {
    let reference_offset = tokens
        .iter()
        .map(|t| t.reference_offset)
        .fold(0.0_f64, f64::max);
    let after_reference = tokens
        .iter()
        .map(|t| t.cross_size - t.reference_offset)
        .fold(0.0_f64, f64::max);
    let cross_size = reference_offset + after_reference;
    let mut glyphs = Vec::new();
    let mut span_decorations = Vec::new();
    let mut atomic_decorations = Vec::new();
    let mut inline_rects = Vec::new();
    let mut x = indent;
    let mut text = String::new();
    let mut active_decorations: Vec<ActiveDecoration> = Vec::new();

    for (index, token) in tokens.iter().enumerate() {
        let common_prefix =
            common_decoration_prefix(&active_decorations, &token.decoration_memberships);
        if index > 0 {
            for active in active_decorations[common_prefix..].iter().rev() {
                close_decoration(
                    &mut span_decorations,
                    &mut x,
                    active,
                    &tokens[index - 1],
                    cross_size,
                    decoration_spans,
                );
            }
        }
        active_decorations.truncate(common_prefix);

        for membership in &token.decoration_memberships[common_prefix..] {
            active_decorations.push(ActiveDecoration {
                span_id: membership.span_id,
                start: x,
            });
            x += membership.start_advance;
        }

        let mut token_glyphs = token.glyphs.clone();
        shift_glyphs_x(&mut token_glyphs, x);
        shift_glyphs_y(&mut token_glyphs, reference_offset - token.reference_offset);
        glyphs.extend(token_glyphs);

        // InlineBox decorations (atomic)
        if let Some(ref decoration) = token.inline_box_decoration {
            atomic_decorations.push(LineInlineBoxDecoration {
                offset: x,
                advance: decoration.total_advance,
                cross_size: decoration.cross_size,
                cross_offset: 0.0,
                background: decoration.background.clone(),
                border_color: decoration.border_color.clone(),
                border_width: decoration.border_width,
                border_radius: decoration.border_radius,
                span_id: None,
                span_key: decoration.span_key.clone(),
            });
        }
        // Nested InlineBox decorations (z-order: inner overlays outer)
        for decoration in &token.nested_decorations {
            atomic_decorations.push(LineInlineBoxDecoration {
                offset: x + decoration.offset,
                advance: decoration.decoration.total_advance,
                cross_size: decoration.decoration.cross_size,
                cross_offset: 0.0,
                background: decoration.decoration.background.clone(),
                border_color: decoration.decoration.border_color.clone(),
                border_width: decoration.decoration.border_width,
                border_radius: decoration.decoration.border_radius,
                span_id: None,
                span_key: decoration.decoration.span_key.clone(),
            });
        }
        for inline_rect in &token.inline_rects {
            inline_rects.push(LineInlineRect {
                offset: x + inline_rect.offset,
                rect: inline_rect.rect.clone(),
            });
        }
        x += token.advance;
        text.push_str(&token.text);
    }

    if let Some(last_token) = tokens.last() {
        for active in active_decorations.iter().rev() {
            close_decoration(
                &mut span_decorations,
                &mut x,
                active,
                last_token,
                cross_size,
                decoration_spans,
            );
        }
    }
    span_decorations.sort_by_key(|decoration| decoration.span_id);
    span_decorations.extend(atomic_decorations);

    LayoutLine {
        text,
        advance: effective_line_width(tokens, 0, tokens.len(), indent),
        cross_size,
        reference_offset,
        glyphs,
        decorations: span_decorations,
        inline_rects,
        kinsoku_unresolved: false,
    }
}

pub(super) fn assemble_vertical_line(
    tokens: &[LayoutToken],
    indent: f64,
    decoration_spans: &[DecorationSpanMeta],
) -> LayoutLine {
    let reference_offset = tokens
        .iter()
        .map(|t| t.reference_offset)
        .fold(0.0_f64, f64::max);
    let after_reference = tokens
        .iter()
        .map(|t| t.cross_size - t.reference_offset)
        .fold(0.0_f64, f64::max);
    let mut glyphs = Vec::new();
    let mut span_decorations = Vec::new();
    let mut atomic_decorations = Vec::new();
    let mut inline_rects = Vec::new();
    let mut y = indent;
    let mut text = String::new();
    let mut active_decorations: Vec<ActiveDecoration> = Vec::new();

    for (index, token) in tokens.iter().enumerate() {
        let common_prefix =
            common_decoration_prefix(&active_decorations, &token.decoration_memberships);
        if index > 0 {
            for active in active_decorations[common_prefix..].iter().rev() {
                close_decoration(
                    &mut span_decorations,
                    &mut y,
                    active,
                    &tokens[index - 1],
                    reference_offset + after_reference,
                    decoration_spans,
                );
            }
        }
        active_decorations.truncate(common_prefix);

        for membership in &token.decoration_memberships[common_prefix..] {
            active_decorations.push(ActiveDecoration {
                span_id: membership.span_id,
                start: y,
            });
            y += membership.start_advance;
        }

        let x_shift = reference_offset - token.reference_offset;
        let mut token_glyphs = token.glyphs.clone();
        shift_glyphs_y(&mut token_glyphs, y);
        shift_glyphs_x(&mut token_glyphs, x_shift);
        glyphs.extend(token_glyphs);

        if let Some(ref decoration) = token.inline_box_decoration {
            atomic_decorations.push(LineInlineBoxDecoration {
                offset: y,
                advance: decoration.total_advance,
                cross_size: decoration.cross_size,
                cross_offset: x_shift,
                background: decoration.background.clone(),
                border_color: decoration.border_color.clone(),
                border_width: decoration.border_width,
                border_radius: decoration.border_radius,
                span_id: None,
                span_key: decoration.span_key.clone(),
            });
        }
        // Nested InlineBox decorations
        for decoration in &token.nested_decorations {
            atomic_decorations.push(LineInlineBoxDecoration {
                offset: y + decoration.offset,
                advance: decoration.decoration.total_advance,
                cross_size: decoration.decoration.cross_size,
                cross_offset: x_shift,
                background: decoration.decoration.background.clone(),
                border_color: decoration.decoration.border_color.clone(),
                border_width: decoration.decoration.border_width,
                border_radius: decoration.decoration.border_radius,
                span_id: None,
                span_key: decoration.decoration.span_key.clone(),
            });
        }
        for inline_rect in &token.inline_rects {
            inline_rects.push(LineInlineRect {
                offset: y + inline_rect.offset,
                rect: inline_rect.rect.clone(),
            });
        }
        y += token.advance;
        text.push_str(&token.text);
    }

    if let Some(last_token) = tokens.last() {
        for active in active_decorations.iter().rev() {
            close_decoration(
                &mut span_decorations,
                &mut y,
                active,
                last_token,
                reference_offset + after_reference,
                decoration_spans,
            );
        }
    }
    span_decorations.sort_by_key(|decoration| decoration.span_id);
    span_decorations.extend(atomic_decorations);

    LayoutLine {
        text,
        advance: effective_line_width(tokens, 0, tokens.len(), indent),
        cross_size: reference_offset + after_reference,
        reference_offset,
        glyphs,
        decorations: span_decorations,
        inline_rects,
        kinsoku_unresolved: false,
    }
}

pub(super) fn build_uax14_break_set_for_tokens(
    tokens: &[LayoutToken],
    uax14_breaks: Option<&[usize]>,
) -> Option<Vec<bool>> {
    if tokens.len() < 2 {
        return None;
    }
    let text: String = tokens.iter().map(|token| token.text.as_str()).collect();
    if text.is_empty() {
        return None;
    }

    let breaks: Vec<usize> = match uax14_breaks {
        Some(breaks) if !breaks.is_empty() => breaks.to_vec(),
        _ => crate::text::linebreak::uax14_break_opportunities(&text),
    };
    if breaks.is_empty() {
        return None;
    }
    let break_set: HashSet<usize> = breaks.into_iter().collect();

    let mut boundary_offsets = Vec::with_capacity(tokens.len() + 1);
    boundary_offsets.push(0usize);
    let mut byte_offset = 0usize;
    for token in tokens {
        byte_offset += token.text.len();
        boundary_offsets.push(byte_offset);
    }

    let mut break_flags = vec![false; tokens.len() + 1];
    for boundary_index in 1..tokens.len() {
        let boundary_offset = boundary_offsets[boundary_index];
        if break_set.contains(&boundary_offset) {
            break_flags[boundary_index] = true;
        }
    }

    if break_flags.iter().any(|flag| *flag) {
        Some(break_flags)
    } else {
        None
    }
}

pub(super) fn update_last_normal_break(
    break_set: Option<&[bool]>,
    boundary_index: usize,
    last_normal_break: Option<usize>,
) -> Option<usize> {
    if let Some(flags) = break_set
        && flags.get(boundary_index).copied().unwrap_or(false)
    {
        return Some(boundary_index);
    }
    last_normal_break
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RichBreakResolution {
    position: usize,
    kinsoku_unresolved: bool,
}

pub(super) fn resolve_break_pos_for_rich(
    wrap: WrapMode,
    start: usize,
    current_index: usize,
    last_normal_break: Option<usize>,
    end_of_run_break: bool,
    local_kinsoku_enabled: bool,
    tokens: &[LayoutToken],
    token_texts: &[&str],
    fallback_profile: Option<&KinsokuProfile>,
) -> Option<usize> {
    resolve_break_for_rich(
        wrap,
        start,
        current_index,
        last_normal_break,
        end_of_run_break,
        local_kinsoku_enabled,
        tokens,
        token_texts,
        fallback_profile,
    )
    .map(|resolution| resolution.position)
}

fn resolve_break_for_rich(
    wrap: WrapMode,
    start: usize,
    current_index: usize,
    last_normal_break: Option<usize>,
    end_of_run_break: bool,
    local_kinsoku_enabled: bool,
    tokens: &[LayoutToken],
    token_texts: &[&str],
    fallback_profile: Option<&KinsokuProfile>,
) -> Option<RichBreakResolution> {
    let profile_at_boundary = |boundary| {
        if local_kinsoku_enabled {
            kinsoku_profile_at_boundary(tokens, boundary, fallback_profile)
        } else {
            fallback_profile
        }
    };
    // Prefer a break opportunity at or before the overflowing token; the
    // end-of-run boundary (which lets an unbreakable run such as a Latin
    // word overflow intact) is only a fallback when no earlier one exists.
    let mut break_pos = if let Some(pos) = last_normal_break.filter(|pos| *pos > start) {
        pos
    } else if wrap == WrapMode::Char && end_of_run_break {
        // Character wrapping may use the boundary after the current token to
        // preserve a shaped cluster such as an atomic JSX token.
        current_index + 1
    } else if wrap == WrapMode::Char
        || (local_kinsoku_enabled
            && token_uses_ja_kinsoku(&tokens[current_index], fallback_profile))
        || profile_at_boundary(current_index).is_some()
    {
        // Japanese word wrapping needs a forced candidate so kinsoku can
        // adjust the boundary without carrying the overflowing token. This
        // mirrors the plain/spans paragraph breaker; profile-free word wrap
        // still keeps an unbreakable run intact.
        current_index
    } else if end_of_run_break {
        current_index + 1
    } else {
        return None;
    };

    let adjusted = apply_kinsoku_by_boundary(token_texts, break_pos, start, profile_at_boundary);
    let mut kinsoku_unresolved = false;
    if adjusted > start {
        break_pos = adjusted;
    } else if current_index > start {
        let contains_neutral_word_token = tokens[start..=current_index]
            .iter()
            .any(|token| !token_uses_ja_kinsoku(token, fallback_profile));
        if wrap == WrapMode::Word && contains_neutral_word_token {
            // The active ja boundary could not be repaired without crossing
            // into an opted-out word. Preserve that word and let the caller
            // carry/overflow the complete run instead of inventing a split.
            return None;
        }
        kinsoku_unresolved = true;
        // Forced char/kinsoku break: still refuse to split a
        // non-breaking pair under the language active at each boundary.
        break_pos = avoid_non_breaking_pair_split_by_boundary(
            token_texts,
            current_index,
            start,
            profile_at_boundary,
        );
        if break_pos <= start {
            return None;
        }
    } else {
        return None;
    }

    if break_pos > start {
        Some(RichBreakResolution {
            position: break_pos,
            kinsoku_unresolved,
        })
    } else {
        None
    }
}
