use crate::font::FontContext;
use crate::text::kinsoku::{
    add_bounded_intentional_overflow_px, get_hanging_chars, get_kinsoku_profile,
    intentional_hanging_overflow_px, is_single_hanging_grapheme, is_valid_break_boundary,
};
use crate::text::paragraph::LayoutOverflowReason;
use crate::text::types::{FitMode, TextLayoutRequest, TextWarning, WrapMode};

use super::TextOrientation;
use super::line_layout::{
    build_uax14_break_set_for_tokens, effective_line_width, kinsoku_profile_at_boundary,
    resolve_break_pos_for_rich, token_uses_ja_kinsoku, update_last_normal_break,
};
use super::{prepare::prepare_rich_text, text_flow};
use crate::text::flow::FLOW_BOTTOM_EPSILON;

pub(crate) fn layout_rich_flow_with_regions(
    req: &text_flow::FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    regions_source: &impl text_flow::FlowRegionSource,
) -> Result<text_flow::FlowLayoutResult, String> {
    let (settled_font_size, fit_overflow) = match req.fit {
        Some("shrink") => {
            let min_size = req
                .min_font_size_px
                .unwrap_or(text_flow::DEFAULT_MIN_FONT_SIZE);
            let epsilon = req.fit_epsilon_px.unwrap_or(text_flow::DEFAULT_FIT_EPSILON);
            let max_iter = req
                .fit_max_iterations
                .unwrap_or(text_flow::DEFAULT_FIT_MAX_ITERATIONS);
            text_flow::fit_shrink_with(req.font_size_px, min_size, epsilon, max_iter, |candidate| {
                layout_rich_flow_at_font_size(req, font_ctx, regions_source, candidate).is_some_and(
                    |result| result.exhausted && text_flow::flow_layout_is_contained(&result),
                )
            })
        }
        Some("grow") => {
            let max_size = req
                .max_font_size_px
                .unwrap_or(req.font_size_px * text_flow::DEFAULT_GROW_MULTIPLIER);
            let epsilon = req.fit_epsilon_px.unwrap_or(text_flow::DEFAULT_FIT_EPSILON);
            let max_iter = req
                .fit_max_iterations
                .unwrap_or(text_flow::DEFAULT_FIT_MAX_ITERATIONS);
            text_flow::fit_grow_with(req.font_size_px, max_size, epsilon, max_iter, |candidate| {
                layout_rich_flow_at_font_size(req, font_ctx, regions_source, candidate).is_some_and(
                    |result| result.exhausted && text_flow::flow_layout_is_contained(&result),
                )
            })
        }
        _ => (req.font_size_px, None),
    };

    let mut result =
        layout_rich_flow_at_font_size(req, font_ctx, regions_source, settled_font_size)
            .ok_or_else(|| "Failed to prepare rich-text flow layout".to_string())?;
    result.chosen_font_size_px = if req.fit.is_some() {
        Some(settled_font_size)
    } else {
        None
    };
    result.overflow_reason = fit_overflow.or(result.overflow_reason);
    Ok(result)
}

fn layout_rich_flow_at_font_size(
    req: &text_flow::FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    regions_source: &impl text_flow::FlowRegionSource,
    chosen_font_size_px: f64,
) -> Option<text_flow::FlowLayoutResult> {
    let text_req = TextLayoutRequest {
        text: req.text,
        spans: None,
        rich_text: req.rich_text,
        font_size_px: req.font_size_px,
        line_height: req.line_height,
        line_height_px: req.line_height_px,
        letter_spacing_px: req.letter_spacing_px,
        text_indent: None,
        max_width: req.flow_bounds.width.max(1.0),
        max_height: Some(req.flow_bounds.height.max(1.0)),
        wrap: req.wrap,
        white_space: req.white_space,
        tab_size: req.tab_size,
        fit: FitMode::None,
        max_lines: req.max_lines,
        ellipsis: false,
        language: req.language,
        writing_mode: req.writing_mode,
        text_orientation: TextOrientation::from_option(req.text_orientation),
        uax14_breaks: None,
        hanging_punctuation: req.hanging_punctuation,
        font_variation_settings: req.shape_options.font_variation_settings.clone(),
        font_feature_settings: req.shape_options.font_feature_settings.clone(),
        min_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
    };

    let prepared = prepare_rich_text(&text_req, font_ctx, chosen_font_size_px)?;
    let min_region = req.min_region_width.unwrap_or(chosen_font_size_px);
    let result = layout_prepared_rich_flow(
        req,
        font_ctx,
        regions_source,
        &prepared.tokens,
        &prepared.warnings,
        min_region,
        chosen_font_size_px,
    );
    if req.ellipsis && !result.exhausted && !result.lines.is_empty() {
        apply_rich_flow_ellipsis(
            req,
            &text_req,
            font_ctx,
            regions_source,
            min_region,
            chosen_font_size_px,
            result.overflow_reason,
        )
        .or(Some(result))
    } else {
        Some(result)
    }
}

fn layout_prepared_rich_flow(
    req: &text_flow::FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    regions_source: &impl text_flow::FlowRegionSource,
    tokens: &[super::LayoutToken],
    warnings: &[TextWarning],
    min_region: f64,
    chosen_font_size_px: f64,
) -> text_flow::FlowLayoutResult {
    if req.writing_mode == crate::text::types::WritingMode::VerticalRl {
        layout_rich_flow_vertical(
            req,
            font_ctx,
            regions_source,
            tokens,
            warnings,
            min_region,
            chosen_font_size_px,
        )
    } else {
        layout_rich_flow_horizontal(
            req,
            font_ctx,
            regions_source,
            tokens,
            warnings,
            min_region,
            chosen_font_size_px,
        )
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "rich flow ellipsis needs the original request, prepared style context, and regions"
)]
fn apply_rich_flow_ellipsis(
    req: &text_flow::FlowLayoutRequest<'_>,
    text_req: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    regions_source: &impl text_flow::FlowRegionSource,
    min_region: f64,
    chosen_font_size_px: f64,
    overflow_reason: Option<text_flow::FlowOverflowReason>,
) -> Option<text_flow::FlowLayoutResult> {
    let (inline_nodes, default_style, _) =
        super::build_inline_nodes(text_req, font_ctx, chosen_font_size_px);
    let total = super::count_inline_graphemes(&inline_nodes);
    if total == 0 {
        return None;
    }

    let probe = |keep: usize| -> Option<text_flow::FlowLayoutResult> {
        let ellipsis_style = super::first_omitted_style(&inline_nodes, keep)
            .or_else(|| super::last_segment_style(&inline_nodes))
            .unwrap_or_else(|| default_style.clone());
        let truncated = super::project_inline_nodes_with_ellipsis(
            &inline_nodes,
            keep,
            super::RichSegment {
                text: "\u{2026}".to_string(),
                style: ellipsis_style,
                combine: false,
                decoration_runs: Vec::new(),
            },
        );
        let (mut tokens, _) = super::build_tokens(
            &truncated,
            text_req,
            font_ctx.registry,
            font_ctx.fallback_registry,
            &default_style,
        )?;
        super::mark_last_token_as_synthetic_ellipsis(&mut tokens);
        let candidate_warnings = super::collect_notdef_warnings_from_tokens(&tokens);
        Some(layout_prepared_rich_flow(
            req,
            font_ctx,
            regions_source,
            &tokens,
            &candidate_warnings,
            min_region,
            chosen_font_size_px,
        ))
    };
    let fits = |result: &text_flow::FlowLayoutResult| {
        result.exhausted && text_flow::flow_layout_is_contained(result)
    };

    let graphemes = super::collect_inline_graphemes(&inline_nodes);
    let grapheme_refs = graphemes.iter().map(String::as_str).collect::<Vec<_>>();
    let profile =
        crate::text::kinsoku::get_kinsoku_profile(Some(super::language_to_str(req.language)));
    let legal_prefixes = super::legal_ellipsis_prefixes(&inline_nodes)
        .into_iter()
        .filter(|keep| *keep < total)
        .filter(|keep| {
            profile.is_none_or(|active_profile| {
                crate::text::kinsoku::is_valid_ellipsis_boundary(
                    &grapheme_refs,
                    *keep,
                    active_profile,
                )
            })
        });
    let selected = crate::text::ellipsis_plan::select_longest_fitting(legal_prefixes, &probe, fits);
    let mut result = match selected {
        Some((_, selected)) => selected,
        None => {
            let mut empty = probe(0)?;
            empty.lines.clear();
            empty.used_line_count = 0;
            empty.warnings.clear();
            empty
        }
    };

    result.exhausted = false;
    result.overflow_reason = overflow_reason;
    Some(result)
}

fn layout_rich_flow_horizontal(
    req: &text_flow::FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    regions_source: &impl text_flow::FlowRegionSource,
    tokens: &[super::LayoutToken],
    warnings: &[TextWarning],
    min_region_width: f64,
    chosen_font_size_px: f64,
) -> text_flow::FlowLayoutResult {
    let line_height_px = text_flow::resolve_flow_line_height_px(
        font_ctx,
        chosen_font_size_px,
        req.line_height,
        req.line_height_px,
    );
    let profile = get_kinsoku_profile(Some(super::language_to_str(req.language)));
    let hanging_chars = get_hanging_chars(req.hanging_punctuation);
    let break_set = build_uax14_break_set_for_tokens(tokens, None);
    let token_texts = kinsoku_token_texts(tokens);

    let mut cursor = 0usize;
    let mut lines = Vec::new();
    let mut line_index = 0usize;
    // Lines advance by their ACTUAL cross size (ruby, inline boxes, and
    // mixed font sizes make a line taller than the base line height), so the
    // cross position is accumulated rather than derived from the line index.
    let mut cross_cursor = req.flow_bounds.y;
    let mut pending_trailing_line = false;

    loop {
        if let Some(max_lines) = req.max_lines
            && lines.len() >= max_lines
        {
            break;
        }

        let line_top = cross_cursor;
        let line_bottom = line_top + line_height_px;
        // Same containment rule as the plain flow band loop: the line's
        // bottom must fit inside the flow box.
        if line_bottom > req.flow_bounds.y + req.flow_bounds.height + FLOW_BOTTOM_EPSILON {
            break;
        }

        if cursor >= tokens.len() {
            if !pending_trailing_line {
                break;
            }
            let regions = regions_source.line_regions(line_top, line_bottom, min_region_width);
            if regions.is_empty() {
                line_index += 1;
                cross_cursor += line_height_px;
                continue;
            }
            lines.push(text_flow::FlowLine {
                fragments: Vec::new(),
                line_index,
                cross_size: line_height_px,
            });
            pending_trailing_line = false;
            break;
        }

        let saved_cursor = cursor;
        let mut probe_cross_size = line_height_px;
        let mut resolved_line = None;
        for _ in 0..tokens.len() + 2 {
            cursor = saved_cursor;
            let regions = regions_source.line_regions(
                line_top,
                line_top + probe_cross_size,
                min_region_width,
            );
            if regions.is_empty() {
                resolved_line = None;
                break;
            }
            let Some((fragments, cross_size, ended_with_hard_break)) = layout_next_rich_flow_line(
                tokens,
                &token_texts,
                break_set.as_deref(),
                profile,
                hanging_chars,
                req.wrap,
                &mut cursor,
                &regions,
                line_top,
            ) else {
                resolved_line = None;
                break;
            };
            let line_cross_size = if cross_size > 0.0 {
                cross_size
            } else {
                line_height_px
            };
            resolved_line = Some((fragments, line_cross_size, ended_with_hard_break));
            let next_cross_size = probe_cross_size.max(line_cross_size);
            let expanded =
                regions_source.line_regions(line_top, line_top + next_cross_size, min_region_width);
            if text_flow::regions_approx_eq(&regions, &expanded) {
                break;
            }
            probe_cross_size = next_cross_size;
        }

        let Some((fragments, line_cross_size, ended_with_hard_break)) = resolved_line else {
            cursor = saved_cursor;
            line_index += 1;
            cross_cursor += line_height_px;
            continue;
        };

        // Re-check containment with the line's real height (the check above
        // used the base line height) and roll back if it does not fit.
        if line_top + line_cross_size
            > req.flow_bounds.y + req.flow_bounds.height + FLOW_BOTTOM_EPSILON
        {
            cursor = saved_cursor;
            break;
        }

        lines.push(text_flow::FlowLine {
            fragments,
            line_index,
            cross_size: line_cross_size,
        });
        pending_trailing_line = ended_with_hard_break;
        line_index += 1;
        cross_cursor += line_cross_size;
    }

    let exhausted = cursor >= tokens.len() && !pending_trailing_line;
    text_flow::FlowLayoutResult {
        used_line_count: lines.len(),
        exhausted,
        overflow_reason: if exhausted {
            None
        } else if req.max_lines.is_some_and(|max| lines.len() >= max) {
            Some(text_flow::FlowOverflowReason::MaxLinesTruncated)
        } else {
            Some(text_flow::FlowOverflowReason::FlowBoxExhausted)
        },
        chosen_font_size_px: None,
        lines,
        warnings: warnings.to_vec(),
    }
}

fn layout_rich_flow_vertical(
    req: &text_flow::FlowLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    regions_source: &impl text_flow::FlowRegionSource,
    tokens: &[super::LayoutToken],
    warnings: &[TextWarning],
    min_region_height: f64,
    chosen_font_size_px: f64,
) -> text_flow::FlowLayoutResult {
    let column_width = text_flow::resolve_flow_line_height_px(
        font_ctx,
        chosen_font_size_px,
        req.line_height,
        req.line_height_px,
    );
    let profile = get_kinsoku_profile(Some(super::language_to_str(req.language)));
    let hanging_chars = get_hanging_chars(req.hanging_punctuation);
    let break_set = build_uax14_break_set_for_tokens(tokens, None);
    let token_texts = kinsoku_token_texts(tokens);

    let mut cursor = 0usize;
    let mut columns = Vec::new();
    let mut column_index = 0usize;
    let mut cross_cursor = req.flow_bounds.x + req.flow_bounds.width;
    let mut pending_trailing_column = false;

    loop {
        if let Some(max_lines) = req.max_lines
            && columns.len() >= max_lines
        {
            break;
        }

        let column_right = cross_cursor;
        let column_left = column_right - column_width;
        if column_left < req.flow_bounds.x - FLOW_BOTTOM_EPSILON {
            break;
        }

        if cursor >= tokens.len() {
            if !pending_trailing_column {
                break;
            }
            let regions =
                regions_source.column_regions(column_left, column_right, min_region_height);
            if regions.is_empty() {
                column_index += 1;
                cross_cursor -= column_width;
                continue;
            }
            columns.push(text_flow::FlowLine {
                fragments: Vec::new(),
                line_index: column_index,
                cross_size: column_width,
            });
            pending_trailing_column = false;
            break;
        }

        let saved_cursor = cursor;
        let mut probe_cross_size = column_width;
        let mut resolved_column = None;
        for _ in 0..tokens.len() + 2 {
            cursor = saved_cursor;
            let probe_left = column_right - probe_cross_size;
            let regions =
                regions_source.column_regions(probe_left, column_right, min_region_height);
            if regions.is_empty() {
                resolved_column = None;
                break;
            }
            let Some((mut fragments, cross_size, ended_with_hard_break)) =
                layout_next_rich_flow_column(
                    tokens,
                    &token_texts,
                    break_set.as_deref(),
                    profile,
                    hanging_chars,
                    req.wrap,
                    &mut cursor,
                    &regions,
                    probe_left,
                )
            else {
                resolved_column = None;
                break;
            };
            let column_cross_size = if cross_size > 0.0 {
                cross_size
            } else {
                column_width
            };
            let actual_left = column_right - column_cross_size;
            for fragment in &mut fragments {
                fragment.x = actual_left;
            }
            resolved_column = Some((fragments, column_cross_size, ended_with_hard_break));
            let next_cross_size = probe_cross_size.max(column_cross_size);
            let expanded = regions_source.column_regions(
                column_right - next_cross_size,
                column_right,
                min_region_height,
            );
            if text_flow::regions_approx_eq(&regions, &expanded) {
                break;
            }
            probe_cross_size = next_cross_size;
        }

        let Some((fragments, column_cross_size, ended_with_hard_break)) = resolved_column else {
            cursor = saved_cursor;
            column_index += 1;
            cross_cursor -= column_width;
            continue;
        };
        if column_right - column_cross_size < req.flow_bounds.x - FLOW_BOTTOM_EPSILON {
            cursor = saved_cursor;
            break;
        }

        columns.push(text_flow::FlowLine {
            fragments,
            line_index: column_index,
            cross_size: column_cross_size,
        });
        pending_trailing_column = ended_with_hard_break;
        column_index += 1;
        cross_cursor -= column_cross_size;
    }

    let exhausted = cursor >= tokens.len() && !pending_trailing_column;
    text_flow::FlowLayoutResult {
        used_line_count: columns.len(),
        exhausted,
        overflow_reason: if exhausted {
            None
        } else if req.max_lines.is_some_and(|max| columns.len() >= max) {
            Some(text_flow::FlowOverflowReason::MaxLinesTruncated)
        } else {
            Some(text_flow::FlowOverflowReason::FlowBoxExhausted)
        },
        chosen_font_size_px: None,
        lines: columns,
        warnings: warnings.to_vec(),
    }
}

fn layout_next_rich_flow_line(
    tokens: &[super::LayoutToken],
    token_texts: &[&str],
    break_set: Option<&[bool]>,
    profile: Option<&super::KinsokuProfile>,
    hanging_chars: Option<&[char]>,
    wrap: WrapMode,
    cursor: &mut usize,
    regions: &[(f64, f64)],
    line_top: f64,
) -> Option<(Vec<text_flow::FlowFragment>, f64, bool)> {
    if *cursor >= tokens.len() {
        return None;
    }
    if tokens[*cursor].text == "\n" {
        *cursor += 1;
        return Some((Vec::new(), 0.0, true));
    }

    let mut fragments = Vec::new();
    let mut line_reference_offset = 0.0_f64;
    let mut line_after_reference = 0.0_f64;
    let mut ended_with_hard_break = false;

    for (region_index, &(region_x, region_width)) in regions.iter().enumerate() {
        if *cursor >= tokens.len() {
            break;
        }
        if tokens[*cursor].text == "\n" {
            *cursor += 1;
            break;
        }

        let allow_hanging = region_index + 1 == regions.len();
        let boundary_profile = if allow_hanging { profile } else { None };
        let boundary_break_set = if !allow_hanging && wrap == WrapMode::Char {
            // Non-last regions mirror plain/spans char wrap by cutting at the
            // first overflowing token; the last region applies UAX14/kinsoku.
            None
        } else {
            break_set
        };
        let initial_end = resolve_rich_region_end(
            tokens,
            token_texts,
            boundary_break_set,
            boundary_profile,
            hanging_chars,
            allow_hanging,
            wrap,
            *cursor,
            region_width,
        );
        let start = *cursor;
        let resolution = resolve_rich_region_overflow(
            tokens,
            token_texts,
            boundary_profile,
            hanging_chars,
            allow_hanging,
            wrap,
            start,
            initial_end,
            region_width,
        );
        let end = resolution.end;
        if end <= start {
            continue;
        }

        line_reference_offset = line_reference_offset.max(
            tokens[start..end]
                .iter()
                .map(|token| token.reference_offset)
                .fold(0.0_f64, f64::max),
        );
        line_after_reference = line_after_reference.max(
            tokens[start..end]
                .iter()
                .map(|token| token.cross_size - token.reference_offset)
                .fold(0.0_f64, f64::max),
        );

        let mut offset = 0.0_f64;
        for index in start..end {
            let token = &tokens[index];
            let width = flow_token_advance(tokens, index, end);
            fragments.push(text_flow::FlowFragment {
                text: token.text.clone(),
                char_start: index,
                char_end: index + 1,
                x: region_x + offset,
                y: line_top,
                inline_advance_px: width,
                available_inline_size_px: region_width,
                region_index,
                baseline_offset: 0.0,
                overflow_reason: (index + 1 == end)
                    .then_some(resolution.overflow_reason)
                    .flatten()
                    .map(text_flow::layout_overflow_reason_name),
                intentional_overflow_px: if index + 1 == end {
                    resolution.intentional_overflow_px
                } else {
                    0.0
                },
                style: None,
                ruby: token.flow_ruby.clone(),
                positioned_glyphs: Vec::new(),
                inline_rects: token
                    .inline_rects
                    .iter()
                    .map(|inline_rect| text_flow::FlowInlineRect {
                        inline_offset: token.decoration_start_advance + inline_rect.offset,
                        rect: inline_rect.rect.clone(),
                    })
                    .collect(),
            });
            offset += width;
        }
        *cursor = end;
        if *cursor < tokens.len() && tokens[*cursor].text == "\n" {
            *cursor += 1;
            ended_with_hard_break = true;
            break;
        }
    }

    if fragments.is_empty() {
        None
    } else {
        for fragment in &mut fragments {
            fragment.baseline_offset = line_reference_offset;
            let token = &tokens[fragment.char_start];
            let mut positioned_glyphs = token.glyphs.clone();
            super::shift_glyphs_x(
                &mut positioned_glyphs,
                fragment.x + token.decoration_start_advance,
            );
            super::shift_glyphs_y(
                &mut positioned_glyphs,
                line_top + line_reference_offset - token.reference_offset,
            );
            for glyph in &mut positioned_glyphs {
                glyph.absolute_position = Some(true);
            }
            fragment.positioned_glyphs = positioned_glyphs;
        }
        Some((
            fragments,
            line_reference_offset + line_after_reference,
            ended_with_hard_break,
        ))
    }
}

fn layout_next_rich_flow_column(
    tokens: &[super::LayoutToken],
    token_texts: &[&str],
    break_set: Option<&[bool]>,
    profile: Option<&super::KinsokuProfile>,
    hanging_chars: Option<&[char]>,
    wrap: WrapMode,
    cursor: &mut usize,
    regions: &[(f64, f64)],
    column_left: f64,
) -> Option<(Vec<text_flow::FlowFragment>, f64, bool)> {
    if *cursor >= tokens.len() {
        return None;
    }
    if tokens[*cursor].text == "\n" {
        *cursor += 1;
        return Some((Vec::new(), 0.0, true));
    }

    let mut fragments = Vec::new();
    let mut reference_offset = 0.0_f64;
    let mut after_reference = 0.0_f64;
    let mut ended_with_hard_break = false;

    for (region_index, &(region_y, region_height)) in regions.iter().enumerate() {
        if *cursor >= tokens.len() {
            break;
        }
        if tokens[*cursor].text == "\n" {
            *cursor += 1;
            break;
        }

        let allow_hanging = region_index + 1 == regions.len();
        let boundary_profile = if allow_hanging { profile } else { None };
        let boundary_break_set = if !allow_hanging && wrap == WrapMode::Char {
            // Non-last regions mirror plain/spans char wrap by cutting at the
            // first overflowing token; the last region applies UAX14/kinsoku.
            None
        } else {
            break_set
        };
        let initial_end = resolve_rich_region_end(
            tokens,
            token_texts,
            boundary_break_set,
            boundary_profile,
            hanging_chars,
            allow_hanging,
            wrap,
            *cursor,
            region_height,
        );
        let start = *cursor;
        let resolution = resolve_rich_region_overflow(
            tokens,
            token_texts,
            boundary_profile,
            hanging_chars,
            allow_hanging,
            wrap,
            start,
            initial_end,
            region_height,
        );
        let end = resolution.end;
        if end <= start {
            continue;
        }

        reference_offset = reference_offset.max(
            tokens[start..end]
                .iter()
                .map(|token| token.reference_offset)
                .fold(0.0_f64, f64::max),
        );
        after_reference = after_reference.max(
            tokens[start..end]
                .iter()
                .map(|token| token.cross_size - token.reference_offset)
                .fold(0.0_f64, f64::max),
        );

        let mut offset = 0.0_f64;
        for index in start..end {
            let token = &tokens[index];
            let height = flow_token_advance(tokens, index, end);
            fragments.push(text_flow::FlowFragment {
                text: token.text.clone(),
                char_start: index,
                char_end: index + 1,
                x: column_left,
                y: region_y + offset,
                inline_advance_px: height,
                available_inline_size_px: region_height,
                region_index,
                baseline_offset: 0.0,
                overflow_reason: (index + 1 == end)
                    .then_some(resolution.overflow_reason)
                    .flatten()
                    .map(text_flow::layout_overflow_reason_name),
                intentional_overflow_px: if index + 1 == end {
                    resolution.intentional_overflow_px
                } else {
                    0.0
                },
                style: None,
                ruby: token.flow_ruby.clone(),
                positioned_glyphs: Vec::new(),
                inline_rects: token
                    .inline_rects
                    .iter()
                    .map(|inline_rect| text_flow::FlowInlineRect {
                        inline_offset: token.decoration_start_advance + inline_rect.offset,
                        rect: inline_rect.rect.clone(),
                    })
                    .collect(),
            });
            offset += height;
        }
        *cursor = end;
        if *cursor < tokens.len() && tokens[*cursor].text == "\n" {
            *cursor += 1;
            ended_with_hard_break = true;
            break;
        }
    }

    if fragments.is_empty() {
        None
    } else {
        for fragment in &mut fragments {
            fragment.baseline_offset = reference_offset;
            let token = &tokens[fragment.char_start];
            let mut positioned_glyphs = token.glyphs.clone();
            super::shift_glyphs_x(
                &mut positioned_glyphs,
                column_left + reference_offset - token.reference_offset,
            );
            super::shift_glyphs_y(
                &mut positioned_glyphs,
                fragment.y + token.decoration_start_advance,
            );
            for glyph in &mut positioned_glyphs {
                glyph.absolute_position = Some(true);
            }
            fragment.positioned_glyphs = positioned_glyphs;
        }
        Some((
            fragments,
            reference_offset + after_reference,
            ended_with_hard_break,
        ))
    }
}

fn resolve_rich_region_end(
    tokens: &[super::LayoutToken],
    token_texts: &[&str],
    break_set: Option<&[bool]>,
    profile: Option<&super::KinsokuProfile>,
    hanging_chars: Option<&[char]>,
    allow_hanging: bool,
    wrap: WrapMode,
    start: usize,
    max_advance: f64,
) -> usize {
    if start >= tokens.len() {
        return start;
    }
    if wrap == WrapMode::None {
        if !allow_hanging {
            return start;
        }
        let mut end = start;
        while end < tokens.len() && tokens[end].text != "\n" {
            end += 1;
        }
        return end.max(start + 1);
    }

    let mut last_normal_break = None;
    for index in start..tokens.len() {
        if tokens[index].text == "\n" {
            return index;
        }

        let preserve_unbreakable_word = allow_hanging
            && wrap == WrapMode::Word
            && !token_uses_ja_kinsoku(&tokens[index], profile);

        // In a final, non-kinsoku word-wrap region, match the regular rich
        // line breaker by registering the boundary before the current token.
        // Every other route retains the existing flow behavior below.
        if preserve_unbreakable_word {
            last_normal_break = update_last_normal_break(break_set, index, last_normal_break);
        }
        let width = effective_line_width(tokens, start, index + 1, 0.0);
        if width <= max_advance + text_flow::INLINE_CONTAINMENT_EPSILON
            || (allow_hanging && index == start)
        {
            if !preserve_unbreakable_word {
                last_normal_break =
                    update_last_normal_break(break_set, index + 1, last_normal_break);
            }
            continue;
        }
        if allow_hanging && is_single_hanging_grapheme(token_texts[index], hanging_chars) {
            if !preserve_unbreakable_word {
                last_normal_break =
                    update_last_normal_break(break_set, index + 1, last_normal_break);
            }
            continue;
        }

        if let Some(break_pos) = resolve_break_pos_for_rich(
            wrap,
            start,
            index,
            last_normal_break,
            false,
            allow_hanging,
            tokens,
            token_texts,
            profile,
        ) {
            return break_pos;
        }

        if !allow_hanging {
            return start;
        }
        if preserve_unbreakable_word {
            // Keep an unbreakable word/atomic run intact, even when that means
            // overflowing the final region. Continue until a legal boundary
            // or the end of the run instead of forcing a character boundary.
            continue;
        }

        return super::super::kinsoku::avoid_non_breaking_pair_split_by_boundary(
            token_texts,
            index + 1,
            start,
            |boundary| kinsoku_profile_at_boundary(tokens, boundary, profile),
        )
        .max(start + 1);
    }

    tokens.len()
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct RichRegionResolution {
    end: usize,
    overflow_reason: Option<LayoutOverflowReason>,
    intentional_overflow_px: f64,
}

#[expect(
    clippy::too_many_arguments,
    reason = "the helper mirrors the region-breaking inputs and keeps horizontal/vertical flow symmetric"
)]
fn resolve_rich_region_overflow(
    tokens: &[super::LayoutToken],
    token_texts: &[&str],
    profile: Option<&super::KinsokuProfile>,
    hanging_chars: Option<&[char]>,
    allow_hanging: bool,
    wrap: WrapMode,
    start: usize,
    initial_end: usize,
    capacity: f64,
) -> RichRegionResolution {
    if initial_end <= start {
        return RichRegionResolution {
            end: initial_end,
            overflow_reason: None,
            intentional_overflow_px: 0.0,
        };
    }

    let hanging_overflow_px = if allow_hanging && wrap != WrapMode::None {
        rich_region_hanging_overflow_px(
            tokens,
            token_texts,
            start,
            initial_end,
            capacity,
            hanging_chars,
        )
    } else {
        0.0
    };
    let mut end = initial_end;
    let mut intentional_overflow_px = hanging_overflow_px;
    let mut current_advance = effective_line_width(tokens, start, end, 0.0);

    if allow_hanging && wrap != WrapMode::None {
        // When backward kinsoku adjustment cannot produce a legal boundary,
        // absorb complete rich tokens until the boundary is legal. This is
        // the rich-text equivalent of the plain/spans flow forward pass.
        while end < tokens.len()
            && tokens[end].text != "\n"
            && kinsoku_profile_at_boundary(tokens, end, profile).is_some_and(|boundary_profile| {
                !is_valid_break_boundary(token_texts, end, boundary_profile)
            })
        {
            let next_advance = effective_line_width(tokens, start, end + 1, 0.0);
            let absorbed_advance = (next_advance - current_advance).max(0.0);
            intentional_overflow_px = add_bounded_intentional_overflow_px(
                intentional_overflow_px,
                absorbed_advance,
                capacity,
            );
            current_advance = next_advance;
            end += 1;
        }
    }

    RichRegionResolution {
        end,
        overflow_reason: if end > initial_end {
            Some(LayoutOverflowReason::KinsokuAbsorb)
        } else if hanging_overflow_px > 0.0 {
            Some(LayoutOverflowReason::HangingPunctuation)
        } else {
            None
        },
        intentional_overflow_px,
    }
}

fn kinsoku_token_texts(tokens: &[super::LayoutToken]) -> Vec<&str> {
    tokens
        .iter()
        .map(|token| {
            if token.inline_box_decoration.is_some() {
                // Inline boxes are opaque atomic objects for line breaking,
                // matching the UAX14 and ellipsis object-replacement model.
                "\u{FFFC}"
            } else {
                token.text.as_str()
            }
        })
        .collect()
}

fn rich_region_hanging_overflow_px(
    tokens: &[super::LayoutToken],
    token_texts: &[&str],
    start: usize,
    end: usize,
    capacity: f64,
    hanging_chars: Option<&[char]>,
) -> f64 {
    if end <= start + 1 || end > tokens.len() {
        return 0.0;
    }
    let advances = (start..end)
        .map(|index| flow_token_advance(tokens, index, end))
        .collect::<Vec<_>>();
    intentional_hanging_overflow_px(
        0,
        advances.len(),
        &advances,
        capacity,
        &token_texts[start..end],
        hanging_chars,
    )
}

fn flow_token_advance(tokens: &[super::LayoutToken], index: usize, region_end: usize) -> f64 {
    let token = &tokens[index];
    let mut advance = token.advance + token.decoration_start_advance;
    if token.decoration_span_id.is_some()
        && (index + 1 == region_end
            || tokens[index + 1].decoration_span_id != token.decoration_span_id)
    {
        advance += token.decoration_end_advance;
    }
    advance
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flow_test_token(text: &str) -> super::super::LayoutToken {
        super::super::LayoutToken {
            text: text.to_string(),
            kinsoku_start: None,
            kinsoku_end: None,
            advance: 1.0,
            cross_size: 1.0,
            reference_offset: 0.5,
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

    fn flow_test_tokens(text: &str) -> Vec<super::super::LayoutToken> {
        text.chars()
            .map(|character| flow_test_token(&character.to_string()))
            .collect()
    }

    #[test]
    fn final_word_region_keeps_an_unbreakable_run_intact() {
        let tokens = flow_test_tokens("HELLOWORLD");
        let token_texts = tokens
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>();

        let end = resolve_rich_region_end(
            &tokens,
            &token_texts,
            None,
            None,
            None,
            true,
            WrapMode::Word,
            0,
            3.0,
        );

        assert_eq!(end, tokens.len());
    }

    #[test]
    fn final_word_region_honors_local_kinsoku_opt_in_and_opt_out() {
        let mut local_ja = flow_test_tokens("ABCDEFG");
        for token in &mut local_ja {
            token.kinsoku_start = Some(true);
            token.kinsoku_end = Some(true);
        }
        let local_ja_texts = local_ja
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            resolve_rich_region_end(
                &local_ja,
                &local_ja_texts,
                None,
                None,
                None,
                true,
                WrapMode::Word,
                0,
                3.0,
            ),
            3
        );

        let mut local_en = flow_test_tokens("ABCDEFG");
        for token in &mut local_en {
            token.kinsoku_start = Some(false);
            token.kinsoku_end = Some(false);
        }
        let local_en_texts = local_en
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            resolve_rich_region_end(
                &local_en,
                &local_en_texts,
                None,
                get_kinsoku_profile(Some("ja")),
                None,
                true,
                WrapMode::Word,
                0,
                3.0,
            ),
            local_en.len()
        );

        let mut neutral_word_then_ja_punctuation = flow_test_tokens("API。");
        for token in &mut neutral_word_then_ja_punctuation[..3] {
            token.kinsoku_start = Some(false);
            token.kinsoku_end = Some(false);
        }
        neutral_word_then_ja_punctuation[3].kinsoku_start = Some(true);
        neutral_word_then_ja_punctuation[3].kinsoku_end = Some(true);
        let mixed_texts = neutral_word_then_ja_punctuation
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            resolve_rich_region_end(
                &neutral_word_then_ja_punctuation,
                &mixed_texts,
                None,
                get_kinsoku_profile(Some("ja")),
                None,
                true,
                WrapMode::Word,
                0,
                3.0,
            ),
            neutral_word_then_ja_punctuation.len()
        );

        let mut ja_open_then_neutral_word = flow_test_tokens("「API");
        ja_open_then_neutral_word[0].kinsoku_start = Some(true);
        ja_open_then_neutral_word[0].kinsoku_end = Some(true);
        for token in &mut ja_open_then_neutral_word[1..] {
            token.kinsoku_start = Some(false);
            token.kinsoku_end = Some(false);
        }
        let mixed_texts = ja_open_then_neutral_word
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            resolve_rich_region_end(
                &ja_open_then_neutral_word,
                &mixed_texts,
                None,
                get_kinsoku_profile(Some("ja")),
                None,
                true,
                WrapMode::Word,
                0,
                1.0,
            ),
            ja_open_then_neutral_word.len()
        );
    }

    #[test]
    fn final_word_region_with_kinsoku_repairs_the_forced_boundary() {
        let tokens = flow_test_tokens("あ。い");
        let token_texts = tokens
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>();

        let initial_end = resolve_rich_region_end(
            &tokens,
            &token_texts,
            None,
            get_kinsoku_profile(Some("ja")),
            None,
            true,
            WrapMode::Word,
            0,
            1.0,
        );

        assert_eq!(initial_end, 1);

        let resolution = resolve_rich_region_overflow(
            &tokens,
            &token_texts,
            get_kinsoku_profile(Some("ja")),
            None,
            true,
            WrapMode::Word,
            0,
            initial_end,
            1.0,
        );

        assert_eq!(resolution.end, 2);
        assert_eq!(
            resolution.overflow_reason,
            Some(LayoutOverflowReason::KinsokuAbsorb)
        );
        assert_eq!(resolution.intentional_overflow_px, 1.0);
    }

    #[test]
    fn final_word_region_stops_at_the_first_boundary_after_an_oversized_run() {
        let tokens = flow_test_tokens("HELLOWORLD ok");
        let token_texts = tokens
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>();
        let mut break_set = vec![false; tokens.len() + 1];
        break_set[11] = true;

        let end = resolve_rich_region_end(
            &tokens,
            &token_texts,
            Some(&break_set),
            None,
            None,
            true,
            WrapMode::Word,
            0,
            3.0,
        );

        assert_eq!(end, 11);
    }

    #[test]
    fn non_final_word_region_defers_an_unbreakable_run() {
        let tokens = flow_test_tokens("HELLOWORLD");
        let token_texts = tokens
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>();

        let end = resolve_rich_region_end(
            &tokens,
            &token_texts,
            None,
            None,
            None,
            false,
            WrapMode::Word,
            0,
            3.0,
        );

        assert_eq!(end, 0);
    }

    #[test]
    fn final_char_region_does_not_carry_an_overflowing_space() {
        let tokens = flow_test_tokens("abc defgh");
        let token_texts = tokens
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>();
        let mut break_set = vec![false; tokens.len() + 1];
        break_set[4] = true;

        let end = resolve_rich_region_end(
            &tokens,
            &token_texts,
            Some(&break_set),
            None,
            None,
            true,
            WrapMode::Char,
            0,
            3.0,
        );

        assert_eq!(end, 3);
    }

    #[test]
    fn final_rich_flow_region_absorbs_head_prohibited_punctuation() {
        let tokens = flow_test_tokens("日。");
        let token_texts = tokens
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>();
        let profile = get_kinsoku_profile(Some("ja"));
        let break_set = build_uax14_break_set_for_tokens(&tokens, None);

        let mut horizontal_cursor = 0;
        let (horizontal_fragments, _, _) = layout_next_rich_flow_line(
            &tokens,
            &token_texts,
            break_set.as_deref(),
            profile,
            None,
            WrapMode::Char,
            &mut horizontal_cursor,
            &[(0.0, 1.0)],
            0.0,
        )
        .expect("horizontal rich flow line");
        let mut vertical_cursor = 0;
        let (vertical_fragments, _, _) = layout_next_rich_flow_column(
            &tokens,
            &token_texts,
            break_set.as_deref(),
            profile,
            None,
            WrapMode::Char,
            &mut vertical_cursor,
            &[(0.0, 1.0)],
            0.0,
        )
        .expect("vertical rich flow column");

        for (cursor, fragments) in [
            (horizontal_cursor, horizontal_fragments),
            (vertical_cursor, vertical_fragments),
        ] {
            assert_eq!(cursor, tokens.len());
            assert_eq!(
                fragments
                    .iter()
                    .map(|fragment| fragment.text.as_str())
                    .collect::<String>(),
                "日。"
            );
            assert_eq!(
                fragments
                    .last()
                    .and_then(|fragment| fragment.overflow_reason.as_deref()),
                Some("kinsokuAbsorb")
            );
            assert_eq!(
                fragments
                    .last()
                    .map(|fragment| fragment.intentional_overflow_px),
                Some(1.0)
            );
        }
    }

    #[test]
    fn rich_kinsoku_absorption_allowance_is_bounded_to_one_region() {
        let tokens = flow_test_tokens("日！？");
        let token_texts = tokens
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>();
        let resolution = resolve_rich_region_overflow(
            &tokens,
            &token_texts,
            get_kinsoku_profile(Some("ja")),
            None,
            true,
            WrapMode::Char,
            0,
            1,
            1.0,
        );

        assert_eq!(resolution.end, tokens.len());
        assert_eq!(
            resolution.overflow_reason,
            Some(LayoutOverflowReason::KinsokuAbsorb)
        );
        assert_eq!(resolution.intentional_overflow_px, 1.0);
    }

    #[test]
    fn rich_kinsoku_keeps_atomic_edge_semantics_and_opaque_inline_boxes() {
        let mut inline_box = flow_test_token("「注」");
        inline_box.inline_box_decoration = Some(super::super::InlineBoxDecorationInput {
            total_advance: 1.0,
            cross_size: 1.0,
            background: None,
            border_color: None,
            border_width: None,
            border_radius: None,
            span_key: None,
        });
        let profile = get_kinsoku_profile(Some("ja"));

        for tokens in [
            vec![inline_box, flow_test_token("本")],
            vec![flow_test_token("「都」"), flow_test_token("本")],
            vec![flow_test_token("2026"), flow_test_token("A")],
        ] {
            let token_texts = kinsoku_token_texts(&tokens);
            let resolution = resolve_rich_region_overflow(
                &tokens,
                &token_texts,
                profile,
                None,
                true,
                WrapMode::Char,
                0,
                1,
                1.0,
            );

            assert_eq!(resolution.end, 1, "texts={token_texts:?}");
            assert_eq!(resolution.overflow_reason, None, "texts={token_texts:?}");
            assert_eq!(
                resolution.intentional_overflow_px, 0.0,
                "texts={token_texts:?}"
            );
        }
    }

    #[test]
    fn rich_forward_absorption_applies_to_wrapping_modes() {
        for text in ["日。", "日、", "日・"] {
            let tokens = flow_test_tokens(text);
            let token_texts = kinsoku_token_texts(&tokens);
            for wrap in [WrapMode::Char, WrapMode::Word] {
                let resolution = resolve_rich_region_overflow(
                    &tokens,
                    &token_texts,
                    get_kinsoku_profile(Some("ja")),
                    None,
                    true,
                    wrap,
                    0,
                    1,
                    1.0,
                );

                assert_eq!(resolution.end, 2, "text={text} wrap={wrap:?}");
                assert_eq!(
                    resolution.overflow_reason,
                    Some(LayoutOverflowReason::KinsokuAbsorb),
                    "text={text} wrap={wrap:?}"
                );
                assert_eq!(
                    resolution.intentional_overflow_px, 1.0,
                    "text={text} wrap={wrap:?}"
                );
            }
        }
    }
}
