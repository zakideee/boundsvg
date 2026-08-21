use std::collections::HashMap;
use taffy::prelude::*;

use crate::error::EngineError;
use crate::font::line_metrics::resolve_line_metrics_for_style;
use crate::font::shaping;
use crate::text::decoration::MAX_TEXT_DECORATION_RANGES;
use crate::text::types::{
    InlineRectBlockSizeInput, InlineRectInput, MAX_INLINE_RECTS, MAX_RICH_TEXT_DEPTH,
    first_excess_rich_text_depth,
};
use crate::text::types::{
    RichTextDecorationRunInput, RichTextNodeInput, TextDecorationInput, TextDecorationLine,
    TextDecorationSkipInk, TextSpanInput,
};
use taffy::{Overflow, Point, TaffyTree};

use super::MAX_LAYOUT_TREE_DEPTH;
use super::measure::{MeasureContext, measure_text_node, resolve_font_from_registries};
use super::types::{
    ImageInput, LayoutInput, LayoutNodeInput, LayoutNodeOutput, LayoutOutput, PreferredFrame,
    TaffyStyleInput, TextInput, TextLayoutOutput, TextPathInput, parse_feature_settings_opt,
    parse_variation_settings_opt,
};

pub(super) fn compute_layout_core(
    input: &LayoutInput,
    mut context: MeasureContext,
) -> Result<LayoutOutput, EngineError> {
    #[cfg(test)]
    crate::pipeline_phase_trace::record_layout();
    validate_layout_tree_depth(&input.root)?;

    let mut tree: TaffyTree<String> = TaffyTree::new();

    let mut node_id_map: HashMap<NodeId, String> = HashMap::new();

    let root = build_taffy_node(&mut tree, &input.root, &mut context, &mut node_id_map)?;

    tree.compute_layout_with_measure(
        root,
        Size {
            width: AvailableSpace::Definite(input.root.style.width.unwrap_or(1280.0)),
            height: AvailableSpace::Definite(input.root.style.height.unwrap_or(720.0)),
        },
        |known_dimensions, available_space, node_id, _node_context, _style| {
            context.measure_call_count += 1;

            if let Some(text_input) = context.text_inputs.get(&node_id) {
                return measure_text_node(
                    text_input,
                    context.font_registry,
                    context.fallback_registry,
                    known_dimensions,
                    available_space,
                    &mut context.measure_cache,
                    &mut context.measure_cache_hits,
                    &mut context.shaped_cache,
                    node_id,
                    &mut context.text_results,
                );
            }

            if context.text_path_inputs.contains_key(&node_id) {
                return Size {
                    width: known_dimensions.width.unwrap_or(0.0),
                    height: known_dimensions.height.unwrap_or(0.0),
                };
            }

            if let Some(image_input) = context.image_inputs.get(&node_id) {
                return Size {
                    width: known_dimensions.width.unwrap_or(image_input.width),
                    height: known_dimensions.height.unwrap_or(image_input.height),
                };
            }

            Size::ZERO
        },
    )
    .map_err(|e| EngineError::Layout(format!("Layout computation failed: {e:?}")))?;

    // Collect results
    let mut nodes = Vec::new();
    collect_layout_results(&tree, root, 0.0, 0.0, &node_id_map, &context, &mut nodes)?;

    Ok(LayoutOutput {
        nodes,
        measure_call_count: context.measure_call_count,
        measure_cache_hits: context.measure_cache_hits,
    })
}

fn validate_layout_tree_depth(root: &LayoutNodeInput) -> Result<(), EngineError> {
    let mut pending = vec![(root, 0_usize)];
    while let Some((node, depth)) = pending.pop() {
        if depth > MAX_LAYOUT_TREE_DEPTH {
            return Err(EngineError::Validation(format!(
                "layout tree exceeds max depth ({MAX_LAYOUT_TREE_DEPTH}) at node \"{}\"",
                node.node_id
            )));
        }
        if let Some(text) = &node.text
            && let Some(actual_depth) = text
                .rich_text
                .as_deref()
                .and_then(first_excess_rich_text_depth)
        {
            return Err(EngineError::Validation(format!(
                "rich text exceeds max depth ({MAX_RICH_TEXT_DEPTH}) at node \"{}\" (actual depth {actual_depth})",
                node.node_id
            )));
        }
        if let Some(text) = &node.text {
            validate_text_decorations(text, node.visual.as_ref(), &node.node_id)?;
            validate_inline_rects(text.rich_text.as_deref().unwrap_or_default(), &node.node_id)?;
        }
        if let Some(text_path) = &node.text_path {
            validate_text_path_input(node, text_path)?;
        }
        pending.extend(node.children.iter().map(|child| (child, depth + 1)));
    }
    Ok(())
}

fn text_path_error(code: &str, node_id: &str, message: impl Into<String>) -> EngineError {
    EngineError::Structured {
        code: code.to_string(),
        message: message.into(),
        stage: Some("validate".to_string()),
        node_id: Some(node_id.to_string()),
    }
}

fn validate_text_path_input(
    node: &LayoutNodeInput,
    text_path: &TextPathInput,
) -> Result<(), EngineError> {
    const MAX_TEXT_PATH_SOURCE_ITEMS: usize = 65_536;
    const MAX_TEXT_PATH_INLINE_CONTAINERS: usize = 4_096;

    if text_path.source_item_count == 0
        || text_path.source_item_count > MAX_TEXT_PATH_SOURCE_ITEMS
        || text_path.source_item_count < text_path.spans.len()
        || text_path.inline_count > MAX_TEXT_PATH_INLINE_CONTAINERS
        || text_path.inline_count > text_path.source_item_count
    {
        return Err(text_path_error(
            "TEXT_PATH_SOURCE_LIMIT",
            &node.node_id,
            "TextOnPath source or Inline container count exceeds its limit.",
        ));
    }
    if text_path.spans.is_empty() {
        return Err(text_path_error(
            "TEXT_PATH_EMPTY_TEXT",
            &node.node_id,
            "TextOnPath children must contain a non-empty string.",
        ));
    }
    if text_path.decoration_owner_ids.len() != text_path.spans.len() {
        return Err(text_path_error(
            "TEXT_PATH_INVALID",
            &node.node_id,
            "TextOnPath decoration owner metadata must mirror every span.",
        ));
    }
    let mut decorations_by_owner = HashMap::<u32, &TextDecorationInput>::new();
    for (span, owner_id) in text_path.spans.iter().zip(&text_path.decoration_owner_ids) {
        if span.text_decoration.is_some() != owner_id.is_some() {
            return Err(text_path_error(
                "TEXT_PATH_INVALID",
                &node.node_id,
                "TextOnPath decoration owner metadata is inconsistent.",
            ));
        }
        if let Some(decoration) = &span.text_decoration {
            validate_text_decoration_value(decoration, &node.node_id)?;
            let owner_id = owner_id.ok_or_else(|| {
                text_path_error(
                    "TEXT_PATH_INVALID",
                    &node.node_id,
                    "TextOnPath decoration owner metadata is missing.",
                )
            })?;
            if span.text.is_empty() {
                continue;
            }
            if let Some(previous) = decorations_by_owner.insert(owner_id, decoration)
                && previous != decoration
            {
                return Err(text_path_error(
                    "TEXT_PATH_INVALID",
                    &node.node_id,
                    "TextOnPath decoration owner changes value within one range.",
                ));
            }
        }
    }
    let resolved_decoration_range_count = decorations_by_owner.len();
    let wire_decoration_range_count = text_path
        .text_decoration_range_count
        .unwrap_or(0)
        .max(resolved_decoration_range_count);
    if wire_decoration_range_count > MAX_TEXT_DECORATION_RANGES {
        return Err(text_path_error(
            "TEXT_DECORATION_RANGE_LIMIT",
            &node.node_id,
            format!(
                "Text decoration range count {wire_decoration_range_count} exceeds the limit {MAX_TEXT_DECORATION_RANGES}."
            ),
        ));
    }
    if resolved_decoration_range_count > 0
        && node
            .visual
            .as_ref()
            .and_then(|visual| visual.unit_animation.as_ref())
            .is_some()
    {
        return Err(text_path_error(
            "TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED",
            &node.node_id,
            "textDecoration cannot be combined with animateUnits.",
        ));
    }
    let mut content_byte_length: usize = 0;
    for span in &text_path.spans {
        let Some(next_byte_length) = content_byte_length.checked_add(span.text.len()) else {
            return Err(text_path_error(
                "TEXT_PATH_SOURCE_LIMIT",
                &node.node_id,
                "TextOnPath text exceeds the source byte limit.",
            ));
        };
        content_byte_length = next_byte_length;
    }
    if content_byte_length == 0 {
        return Err(text_path_error(
            "TEXT_PATH_EMPTY_TEXT",
            &node.node_id,
            "TextOnPath children must contain a non-empty string.",
        ));
    }
    if content_byte_length > crate::text::path::TEXT_PATH_SOURCE_BYTE_LIMIT {
        return Err(text_path_error(
            "TEXT_PATH_SOURCE_LIMIT",
            &node.node_id,
            "TextOnPath text exceeds the source byte limit.",
        ));
    }
    if text_path.spans.iter().any(|span| {
        span.text
            .chars()
            .any(|character| matches!(character, '\t' | '\n' | '\r' | '\u{2028}' | '\u{2029}'))
    }) {
        return Err(text_path_error(
            "TEXT_PATH_MULTILINE_UNSUPPORTED",
            &node.node_id,
            "TextOnPath does not support newlines or tabs.",
        ));
    }
    for span in &text_path.spans {
        if span.font_family.is_empty()
            || span.font_family.iter().any(|alias| alias.trim().is_empty())
            || !(1..=1_000).contains(&span.font_weight)
            || !span.font_size_px.is_finite()
            || span.font_size_px <= 0.0
            || !span.letter_spacing_px.unwrap_or(0.0).is_finite()
            || span
                .language
                .as_deref()
                .is_some_and(|language| !matches!(language, "ja" | "en" | "auto"))
        {
            return Err(text_path_error(
                "TEXT_PATH_INVALID",
                &node.node_id,
                "TextOnPath span shaping style is invalid.",
            ));
        }
        if span.text_orientation.is_some() || span.decoration_transport_only {
            return Err(text_path_error(
                "TEXT_PATH_INLINE_PROP_UNSUPPORTED",
                &node.node_id,
                "TextOnPath span contains an unsupported property.",
            ));
        }
        validate_text_path_span_paint(span, &node.node_id)?;
    }
    for (name, value) in [
        ("width", node.style.width.map(f64::from)),
        ("height", node.style.height.map(f64::from)),
        ("fontSizePx", Some(text_path.font_size_px)),
    ] {
        if !value.is_some_and(|number| number.is_finite() && number > 0.0) {
            return Err(text_path_error(
                "TEXT_PATH_INVALID",
                &node.node_id,
                format!("TextOnPath {name} must be positive and finite."),
            ));
        }
    }
    if !text_path.letter_spacing_px.unwrap_or(0.0).is_finite()
        || !text_path.start_offset_px.unwrap_or(0.0).is_finite()
        || !text_path.path_offset_px.unwrap_or(0.0).is_finite()
        || text_path.path_offset_px.unwrap_or(0.0) < 0.0
    {
        return Err(text_path_error(
            "TEXT_PATH_INVALID",
            &node.node_id,
            "TextOnPath pathOffsetPx must be non-negative; all offsets and spacing must be finite.",
        ));
    }
    if text_path.start_offset_px.unwrap_or(0.0).abs()
        > crate::text::path::TEXT_PATH_OFFSET_ABSOLUTE_LIMIT_PX
    {
        return Err(text_path_error(
            "TEXT_PATH_OFFSET_LIMIT",
            &node.node_id,
            "TextOnPath startOffsetPx exceeds the absolute limit.",
        ));
    }
    if text_path
        .text_anchor
        .as_deref()
        .is_some_and(|anchor| !matches!(anchor, "start" | "middle" | "end"))
        || text_path
            .path_direction
            .as_deref()
            .is_some_and(|direction| !matches!(direction, "forward" | "reverse"))
        || text_path
            .path_normal
            .as_deref()
            .is_some_and(|normal| !matches!(normal, "left" | "right"))
        || text_path
            .path_fit
            .as_deref()
            .is_some_and(|fit| !matches!(fit, "none" | "spacing" | "scale" | "shrink"))
        || text_path
            .path_overflow
            .as_deref()
            .is_some_and(|overflow| !matches!(overflow, "hidden" | "error" | "ellipsis"))
    {
        return Err(text_path_error(
            "TEXT_PATH_INVALID",
            &node.node_id,
            "TextOnPath textAnchor, pathDirection, pathNormal, pathFit, or pathOverflow is invalid.",
        ));
    }
    Ok(())
}

fn validate_text_path_span_paint(span: &TextSpanInput, node_id: &str) -> Result<(), EngineError> {
    const MAX_TEXT_EFFECT_LAYERS: usize = 8;
    let Some(fill) = span.color.as_deref() else {
        return Err(text_path_error(
            "TEXT_PATH_INVALID",
            node_id,
            "TextOnPath schema 17 spans require an effective fill color.",
        ));
    };
    let (Some(strokes), Some(shadows)) = (&span.text_strokes, &span.text_shadows) else {
        return Err(text_path_error(
            "TEXT_PATH_INVALID",
            node_id,
            "TextOnPath schema 17 spans require effective stroke and shadow categories.",
        ));
    };
    let valid_strokes = strokes.len() <= MAX_TEXT_EFFECT_LAYERS
        && strokes.iter().all(|layer| {
            crate::ir::gradient::is_valid_color(&layer.color)
                && layer.width_px.is_finite()
                && layer.width_px > 0.0
                && layer
                    .linejoin
                    .as_deref()
                    .is_none_or(|value| matches!(value, "miter" | "round" | "bevel"))
                && layer
                    .linecap
                    .as_deref()
                    .is_none_or(|value| matches!(value, "butt" | "round" | "square"))
                && layer
                    .miterlimit
                    .is_none_or(|value| value.is_finite() && value > 0.0)
        });
    let valid_shadows = shadows.len() <= MAX_TEXT_EFFECT_LAYERS
        && shadows.iter().all(|layer| {
            crate::ir::gradient::is_valid_color(&layer.color)
                && layer.dx.is_finite()
                && layer.dy.is_finite()
                && layer
                    .blur_px
                    .is_none_or(|value| value.is_finite() && value >= 0.0)
        });
    if !crate::ir::gradient::is_valid_color(fill) || !valid_strokes || !valid_shadows {
        return Err(text_path_error(
            "TEXT_PATH_INVALID",
            node_id,
            "TextOnPath span fill, stroke, or shadow paint is invalid.",
        ));
    }
    Ok(())
}

fn inline_rect_error(code: &str, node_id: &str, message: impl Into<String>) -> EngineError {
    EngineError::Structured {
        code: code.to_string(),
        message: message.into(),
        stage: Some("validate".to_string()),
        node_id: Some(node_id.to_string()),
    }
}

fn validate_inline_rects(nodes: &[RichTextNodeInput], node_id: &str) -> Result<(), EngineError> {
    let mut count = 0_usize;
    let mut pending = nodes.iter().map(|node| (node, true)).collect::<Vec<_>>();
    while let Some((node, parent_is_supported)) = pending.pop() {
        match node {
            RichTextNodeInput::InlineRect { rect } => {
                if !parent_is_supported {
                    return Err(inline_rect_error(
                        "INLINE_RECT_INVALID_PARENT",
                        node_id,
                        "InlineRect is only allowed inside Text, Inline, or InlineBox.",
                    ));
                }
                count = count.saturating_add(1);
                if count > MAX_INLINE_RECTS {
                    return Err(inline_rect_error(
                        "INLINE_RECT_COMPLEXITY_LIMIT",
                        node_id,
                        format!("InlineRect count {count} exceeds the limit {MAX_INLINE_RECTS}."),
                    ));
                }
                validate_inline_rect_value(rect, node_id)?;
            }
            RichTextNodeInput::Ruby {
                base,
                rt,
                rt_levels,
                ..
            } => {
                pending.extend(base.iter().map(|child| (child, false)));
                pending.extend(rt.iter().map(|child| (child, false)));
                for level in rt_levels {
                    pending.extend(level.iter().map(|child| (child, false)));
                }
            }
            RichTextNodeInput::InlineBox { children, .. }
            | RichTextNodeInput::DecoratedSpan { children, .. } => {
                pending.extend(children.iter().map(|child| (child, parent_is_supported)));
            }
            RichTextNodeInput::Text { .. }
            | RichTextNodeInput::Span { .. }
            | RichTextNodeInput::Combine { .. } => {}
        }
    }
    Ok(())
}

fn validate_inline_rect_value(rect: &InlineRectInput, node_id: &str) -> Result<(), EngineError> {
    let invalid = |message: &str| inline_rect_error("INLINE_RECT_INVALID", node_id, message);
    if rect.fragment_id.is_empty() {
        return Err(invalid("InlineRect fragmentId must not be empty."));
    }
    if !rect.inline_size_px.is_finite() || rect.inline_size_px <= 0.0 {
        return Err(invalid(
            "InlineRect inlineSizePx must be a positive finite number.",
        ));
    }
    match rect.block_size_px.as_ref() {
        Some(InlineRectBlockSizeInput::Pixels(value)) if !value.is_finite() || *value <= 0.0 => {
            return Err(invalid(
                "InlineRect blockSizePx must be \"line\" or a positive finite number.",
            ));
        }
        Some(InlineRectBlockSizeInput::Line(value)) if value != "line" => {
            return Err(invalid(
                "InlineRect blockSizePx must be \"line\" or a positive finite number.",
            ));
        }
        _ => {}
    }
    if rect
        .advance_px
        .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        return Err(invalid(
            "InlineRect advancePx must be a non-negative finite number.",
        ));
    }
    if rect
        .block_align
        .as_deref()
        .is_some_and(|value| !matches!(value, "start" | "center" | "end"))
    {
        return Err(invalid(
            "InlineRect blockAlign must be start, center, or end.",
        ));
    }
    if !crate::ir::gradient::is_valid_color(&rect.color) {
        return Err(invalid("InlineRect color must be a valid color."));
    }
    if rect
        .border_radius_px
        .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        return Err(invalid(
            "InlineRect borderRadiusPx must be a non-negative finite number.",
        ));
    }
    if rect
        .opacity
        .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
    {
        return Err(invalid("InlineRect opacity must be between 0 and 1."));
    }
    if rect
        .paint_order
        .as_deref()
        .is_some_and(|value| !matches!(value, "behind" | "front"))
    {
        return Err(invalid("InlineRect paintOrder must be behind or front."));
    }
    Ok(())
}

fn text_decoration_error(node_id: &str, message: impl Into<String>) -> EngineError {
    EngineError::Structured {
        code: "TEXT_DECORATION_INVALID".to_string(),
        message: message.into(),
        stage: Some("validate".to_string()),
        node_id: Some(node_id.to_string()),
    }
}

fn validate_text_decorations(
    text: &TextInput,
    visual: Option<&super::types::VisualInput>,
    node_id: &str,
) -> Result<(), EngineError> {
    let span_range_count =
        effective_span_decoration_range_count(text.spans.as_deref().unwrap_or_default());
    let rich_text = text.rich_text.as_deref().unwrap_or_default();
    let annotation_range_count = count_ruby_annotation_decoration_ranges(rich_text);
    let base_rich_range_count = count_base_rich_text_decoration_ranges(rich_text);
    let resolved_range_count = span_range_count
        .max(base_rich_range_count)
        .saturating_add(annotation_range_count);
    let wire_range_count = text
        .text_decoration_range_count
        .unwrap_or(0)
        .max(resolved_range_count);
    if wire_range_count > MAX_TEXT_DECORATION_RANGES {
        return Err(EngineError::Structured {
            code: "TEXT_DECORATION_RANGE_LIMIT".to_string(),
            message: format!(
                "Text decoration range count {wire_range_count} exceeds the limit {MAX_TEXT_DECORATION_RANGES}."
            ),
            stage: Some("validate".to_string()),
            node_id: Some(node_id.to_string()),
        });
    }
    if wire_range_count > 0
        && visual
            .and_then(|value| value.unit_animation.as_ref())
            .is_some()
    {
        return Err(EngineError::Structured {
            code: "TEXT_DECORATION_UNIT_ANIMATION_UNSUPPORTED".to_string(),
            message: "textDecoration cannot be combined with animateUnits.".to_string(),
            stage: Some("validate".to_string()),
            node_id: Some(node_id.to_string()),
        });
    }
    for span in text.spans.as_deref().unwrap_or_default() {
        if let Some(decoration) = &span.text_decoration {
            validate_text_decoration_value(decoration, node_id)?;
        }
    }
    validate_rich_text_decoration_values(text.rich_text.as_deref().unwrap_or_default(), node_id)
}

fn effective_span_decoration_range_count(spans: &[TextSpanInput]) -> usize {
    let mut count = 0_usize;
    let mut previous: Option<&TextDecorationInput> = None;
    for span in spans.iter().filter(|span| !span.text.is_empty()) {
        match span.text_decoration.as_ref() {
            Some(decoration) => {
                if previous != Some(decoration) {
                    count = count.saturating_add(1);
                }
                previous = Some(decoration);
            }
            None => previous = None,
        }
    }
    count
}

fn effective_decoration_run_count(runs: &[RichTextDecorationRunInput]) -> usize {
    let mut count = 0_usize;
    let mut previous: Option<&TextDecorationInput> = None;
    for run in runs.iter().filter(|run| !run.text.is_empty()) {
        match run.text_decoration.as_ref() {
            Some(decoration) => {
                if previous != Some(decoration) {
                    count = count.saturating_add(1);
                }
                previous = Some(decoration);
            }
            None => previous = None,
        }
    }
    count
}

fn combine_decoration_range_count(
    text: &str,
    style: &crate::text::types::RichTextStyleInput,
    decoration_runs: &[RichTextDecorationRunInput],
) -> usize {
    let mut remaining_text = text;
    let runs_match_text = !decoration_runs.is_empty()
        && decoration_runs.iter().all(|run| {
            let Some(suffix) = remaining_text.strip_prefix(&run.text) else {
                return false;
            };
            remaining_text = suffix;
            true
        })
        && remaining_text.is_empty();
    if runs_match_text {
        effective_decoration_run_count(decoration_runs)
    } else {
        usize::from(style.text_decoration.is_some() && !text.is_empty())
    }
}

fn count_ruby_annotation_decoration_ranges(nodes: &[RichTextNodeInput]) -> usize {
    nodes.iter().fold(0_usize, |count, node| {
        let node_count = match node {
            RichTextNodeInput::Ruby {
                base,
                rt,
                rt_levels,
                ..
            } => {
                let annotation_count = if rt_levels.is_empty() {
                    count_styled_decoration_ranges(rt)
                } else {
                    rt_levels
                        .iter()
                        .map(|level| count_styled_decoration_ranges(level))
                        .sum()
                };
                annotation_count + count_ruby_annotation_decoration_ranges(base)
            }
            RichTextNodeInput::InlineBox { children, .. }
            | RichTextNodeInput::DecoratedSpan { children, .. } => {
                count_ruby_annotation_decoration_ranges(children)
            }
            RichTextNodeInput::Text { .. }
            | RichTextNodeInput::Span { .. }
            | RichTextNodeInput::Combine { .. }
            | RichTextNodeInput::InlineRect { .. } => 0,
        };
        count.saturating_add(node_count)
    })
}

fn count_base_rich_text_decoration_ranges(nodes: &[RichTextNodeInput]) -> usize {
    nodes.iter().fold(0_usize, |count, node| {
        let node_count = match node {
            RichTextNodeInput::Text { .. } | RichTextNodeInput::InlineRect { .. } => 0,
            RichTextNodeInput::Span { text, style } => {
                usize::from(style.text_decoration.is_some() && !text.is_empty())
            }
            RichTextNodeInput::Combine {
                text,
                style,
                decoration_runs,
            } => combine_decoration_range_count(text, style, decoration_runs),
            RichTextNodeInput::Ruby { style, base, .. } => {
                usize::from(style.text_decoration.is_some() && rich_text_nodes_have_text(base))
                    .saturating_add(count_base_rich_text_decoration_ranges(base))
            }
            RichTextNodeInput::InlineBox {
                style, children, ..
            }
            | RichTextNodeInput::DecoratedSpan {
                style, children, ..
            } => {
                usize::from(style.text_decoration.is_some() && rich_text_nodes_have_text(children))
                    .saturating_add(count_base_rich_text_decoration_ranges(children))
            }
        };
        count.saturating_add(node_count)
    })
}

fn rich_text_nodes_have_text(nodes: &[RichTextNodeInput]) -> bool {
    nodes.iter().any(|node| match node {
        RichTextNodeInput::Text { text }
        | RichTextNodeInput::Span { text, .. }
        | RichTextNodeInput::Combine { text, .. } => !text.is_empty(),
        RichTextNodeInput::Ruby { base, .. } => rich_text_nodes_have_text(base),
        RichTextNodeInput::InlineBox { children, .. }
        | RichTextNodeInput::DecoratedSpan { children, .. } => rich_text_nodes_have_text(children),
        RichTextNodeInput::InlineRect { .. } => false,
    })
}

fn count_styled_decoration_ranges(nodes: &[RichTextNodeInput]) -> usize {
    nodes.iter().fold(0_usize, |count, node| {
        let node_count = match node {
            RichTextNodeInput::Text { .. } | RichTextNodeInput::InlineRect { .. } => 0,
            RichTextNodeInput::Span { style, .. } => usize::from(style.text_decoration.is_some()),
            RichTextNodeInput::Combine {
                text,
                style,
                decoration_runs,
            } => combine_decoration_range_count(text, style, decoration_runs),
            RichTextNodeInput::InlineBox {
                style, children, ..
            }
            | RichTextNodeInput::DecoratedSpan {
                style, children, ..
            } => usize::from(style.text_decoration.is_some())
                .saturating_add(count_styled_decoration_ranges(children)),
            RichTextNodeInput::Ruby { base, .. } => count_styled_decoration_ranges(base),
        };
        count.saturating_add(node_count)
    })
}

fn validate_rich_text_decoration_values(
    nodes: &[RichTextNodeInput],
    node_id: &str,
) -> Result<(), EngineError> {
    for node in nodes {
        match node {
            RichTextNodeInput::Text { .. } | RichTextNodeInput::InlineRect { .. } => {}
            RichTextNodeInput::Span { style, .. } => {
                if let Some(decoration) = &style.text_decoration {
                    validate_text_decoration_value(decoration, node_id)?;
                }
            }
            RichTextNodeInput::Combine {
                style,
                decoration_runs,
                ..
            } => {
                if let Some(decoration) = &style.text_decoration {
                    validate_text_decoration_value(decoration, node_id)?;
                }
                for run in decoration_runs {
                    if let Some(decoration) = &run.text_decoration {
                        validate_text_decoration_value(decoration, node_id)?;
                    }
                }
            }
            RichTextNodeInput::Ruby {
                style,
                base,
                rt,
                rt_levels,
                ..
            } => {
                if let Some(decoration) = &style.text_decoration {
                    validate_text_decoration_value(decoration, node_id)?;
                }
                validate_rich_text_decoration_values(base, node_id)?;
                validate_rich_text_decoration_values(rt, node_id)?;
                for level in rt_levels {
                    validate_rich_text_decoration_values(level, node_id)?;
                }
            }
            RichTextNodeInput::InlineBox {
                style, children, ..
            }
            | RichTextNodeInput::DecoratedSpan {
                style, children, ..
            } => {
                if let Some(decoration) = &style.text_decoration {
                    validate_text_decoration_value(decoration, node_id)?;
                }
                validate_rich_text_decoration_values(children, node_id)?;
            }
        }
    }
    Ok(())
}

fn validate_text_decoration_value(
    decoration: &TextDecorationInput,
    node_id: &str,
) -> Result<(), EngineError> {
    if decoration.line.is_empty() {
        return Err(text_decoration_error(
            node_id,
            "textDecoration.line must not be empty.",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    if decoration.line.iter().any(|line| !seen.insert(*line)) {
        return Err(text_decoration_error(
            node_id,
            "textDecoration.line must not contain duplicates.",
        ));
    }
    if decoration.skip_ink == TextDecorationSkipInk::All
        && !decoration.line.contains(&TextDecorationLine::Underline)
        && !decoration.line.contains(&TextDecorationLine::Overline)
    {
        return Err(EngineError::Structured {
            code: "TEXT_DECORATION_SKIP_INK_UNSUPPORTED".to_string(),
            message: "textDecoration.skipInk=\"all\" requires underline or overline.".to_string(),
            stage: Some("validate".to_string()),
            node_id: Some(node_id.to_string()),
        });
    }
    if decoration
        .thickness_px
        .is_some_and(|value| !value.is_finite() || value <= 0.0)
    {
        return Err(text_decoration_error(
            node_id,
            "textDecoration.thicknessPx must be a positive finite number.",
        ));
    }
    if !decoration.offset_px.is_finite() {
        return Err(text_decoration_error(
            node_id,
            "textDecoration.offsetPx must be a finite number.",
        ));
    }
    if !crate::ir::gradient::is_valid_color(&decoration.color) {
        return Err(text_decoration_error(
            node_id,
            "textDecoration.color must be a valid color.",
        ));
    }
    Ok(())
}

/// Recursively build a Taffy node tree from the declarative layout input.
/// Leaf nodes (text / image) are registered in `context` for measure callbacks.
fn build_taffy_node(
    tree: &mut TaffyTree<String>,
    input: &LayoutNodeInput,
    context: &mut MeasureContext,
    node_id_map: &mut HashMap<NodeId, String>,
) -> Result<NodeId, EngineError> {
    let style = map_style(&input.style);
    let is_leaf = input.text.is_some() || input.text_path.is_some() || input.image.is_some();

    let node_id = if is_leaf {
        tree.new_leaf_with_context(style, input.node_id.clone())
            .map_err(|e| EngineError::Layout(format!("Failed to create leaf node: {e:?}")))?
    } else {
        let mut child_ids = Vec::new();
        for child in &input.children {
            let child_id = build_taffy_node(tree, child, context, node_id_map)?;
            child_ids.push(child_id);
        }
        tree.new_with_children(style, &child_ids)
            .map_err(|e| EngineError::Layout(format!("Failed to create node: {e:?}")))?
    };

    node_id_map.insert(node_id, input.node_id.clone());

    if let Some(text) = &input.text {
        context.text_inputs.insert(
            node_id,
            TextInput {
                content: text.content.clone(),
                spans: text.spans.as_ref().map(|spans| {
                    spans
                        .iter()
                        .map(|span| TextSpanInput {
                            text: span.text.clone(),
                            font_family: span.font_family.clone(),
                            font_weight: span.font_weight,
                            font_style: span.font_style.clone(),
                            font_size_px: span.font_size_px,
                            letter_spacing_px: span.letter_spacing_px,
                            language: span.language.clone(),
                            text_orientation: span.text_orientation.clone(),
                            color: span.color.clone(),
                            text_strokes: span.text_strokes.clone(),
                            text_shadows: span.text_shadows.clone(),
                            font_variation_settings: span.font_variation_settings.clone(),
                            font_feature_settings: span.font_feature_settings.clone(),
                            text_decoration: span.text_decoration.clone(),
                            decoration_transport_only: span.decoration_transport_only,
                        })
                        .collect()
                }),
                rich_text: text.rich_text.clone(),
                font_size_px: text.font_size_px,
                line_height: text.line_height,
                line_height_px: text.line_height_px,
                letter_spacing_px: text.letter_spacing_px,
                text_indent: text.text_indent,
                font_family: text.font_family.clone(),
                font_weight: text.font_weight,
                font_style: text.font_style.clone(),
                wrap: text.wrap.clone(),
                white_space: text.white_space.clone(),
                tab_size: text.tab_size,
                flow: text.flow.clone(),
                max_lines: text.max_lines,
                preferred_frame: text
                    .preferred_frame
                    .as_ref()
                    .map(|pf| PreferredFrame { w: pf.w, h: pf.h }),
                writing_mode: text.writing_mode.clone(),
                language: text.language.clone(),
                text_orientation: text.text_orientation.clone(),
                fit: text.fit.clone(),
                min_font_size_px: text.min_font_size_px,
                shrink_epsilon_px: text.shrink_epsilon_px,
                shrink_max_iterations: text.shrink_max_iterations,
                max_font_size_px: text.max_font_size_px,
                grow_epsilon_px: text.grow_epsilon_px,
                grow_max_iterations: text.grow_max_iterations,
                ellipsis: text.ellipsis,
                hanging_punctuation: text.hanging_punctuation,
                font_variation_settings: text.font_variation_settings.clone(),
                font_feature_settings: text.font_feature_settings.clone(),
                unit_map: text.unit_map,
                text_decoration_range_count: text.text_decoration_range_count,
            },
        );
    }

    if let Some(image) = &input.image {
        context.image_inputs.insert(
            node_id,
            ImageInput {
                width: image.width,
                height: image.height,
            },
        );
    }

    if let Some(text_path) = &input.text_path {
        context.text_path_inputs.insert(node_id, text_path.clone());
    }

    Ok(node_id)
}

fn map_style(input: &TaffyStyleInput) -> Style {
    let mut style = Style::default();

    if let Some(ref d) = input.display {
        style.display = match d.as_str() {
            "none" => Display::None,
            "grid" => Display::Grid,
            _ => Display::Flex,
        };
    }

    if let Some(ref d) = input.flex_direction {
        style.flex_direction = match d.as_str() {
            "row" => FlexDirection::Row,
            "row-reverse" => FlexDirection::RowReverse,
            "column-reverse" => FlexDirection::ColumnReverse,
            _ => FlexDirection::Column,
        };
    }

    if let Some(ref w) = input.flex_wrap {
        style.flex_wrap = match w.as_str() {
            "wrap" => FlexWrap::Wrap,
            "wrap-reverse" => FlexWrap::WrapReverse,
            _ => FlexWrap::NoWrap,
        };
    }

    if let Some(ref a) = input.align_items {
        style.align_items = Some(match a.as_str() {
            "flex-start" | "start" => AlignItems::FlexStart,
            "flex-end" | "end" => AlignItems::FlexEnd,
            "center" => AlignItems::Center,
            "baseline" => AlignItems::Baseline,
            _ => AlignItems::Stretch,
        });
    }

    if let Some(ref j) = input.justify_content {
        style.justify_content = Some(match j.as_str() {
            "flex-end" | "end" => JustifyContent::FlexEnd,
            "center" => JustifyContent::Center,
            "space-between" => JustifyContent::SpaceBetween,
            "space-around" => JustifyContent::SpaceAround,
            "space-evenly" => JustifyContent::SpaceEvenly,
            _ => JustifyContent::FlexStart,
        });
    }

    if let Some(ref a) = input.align_self {
        style.align_self = Some(match a.as_str() {
            "flex-start" | "start" => AlignSelf::FlexStart,
            "flex-end" | "end" => AlignSelf::FlexEnd,
            "center" => AlignSelf::Center,
            "baseline" => AlignSelf::Baseline,
            "stretch" => AlignSelf::Stretch,
            _ => AlignSelf::Start,
        });
    }

    if let Some(fg) = input.flex_grow {
        style.flex_grow = fg;
    }
    if let Some(fs) = input.flex_shrink {
        style.flex_shrink = fs;
    }
    if let Some(fb) = input.flex_basis {
        style.flex_basis = Dimension::length(fb);
    }

    {
        let gap_val = input.gap.unwrap_or(0.0);
        let row_gap = input.row_gap.unwrap_or(gap_val);
        let col_gap = input.column_gap.unwrap_or(gap_val);
        if row_gap > 0.0 || col_gap > 0.0 {
            style.gap = Size {
                width: LengthPercentage::length(col_gap),
                height: LengthPercentage::length(row_gap),
            };
        }
    }

    if let Some(w) = input.width {
        style.size.width = Dimension::length(w);
    }
    if let Some(h) = input.height {
        style.size.height = Dimension::length(h);
    }
    if let Some(w) = input.min_width {
        style.min_size.width = Dimension::length(w);
    }
    if let Some(h) = input.min_height {
        style.min_size.height = Dimension::length(h);
    }
    if let Some(w) = input.max_width {
        style.max_size.width = Dimension::length(w);
    }
    if let Some(h) = input.max_height {
        style.max_size.height = Dimension::length(h);
    }

    if let Some(ref p) = input.padding {
        style.padding = Rect {
            top: LengthPercentage::length(p[0]),
            right: LengthPercentage::length(p[1]),
            bottom: LengthPercentage::length(p[2]),
            left: LengthPercentage::length(p[3]),
        };
    }

    if let Some(ref m) = input.margin {
        style.margin = Rect {
            top: LengthPercentageAuto::length(m[0]),
            right: LengthPercentageAuto::length(m[1]),
            bottom: LengthPercentageAuto::length(m[2]),
            left: LengthPercentageAuto::length(m[3]),
        };
    }

    if let Some(ref o) = input.overflow {
        let ov = match o.as_str() {
            "hidden" | "clip" => Overflow::Hidden,
            "scroll" => Overflow::Scroll,
            _ => Overflow::Visible,
        };
        style.overflow = Point { x: ov, y: ov };
    }

    // Grid template columns
    if let Some(ref cols) = input.grid_template_columns {
        style.grid_template_columns = cols
            .iter()
            .map(|s| GridTemplateComponent::Single(parse_track_sizing(s)))
            .collect();
    }

    // Grid template rows
    if let Some(ref rows) = input.grid_template_rows {
        style.grid_template_rows = rows
            .iter()
            .map(|s| GridTemplateComponent::Single(parse_track_sizing(s)))
            .collect();
    }

    // Grid item placement
    if let Some(start) = input.grid_column_start {
        style.grid_column = Line {
            start: GridPlacement::from_line_index(start),
            end: input
                .grid_column_end
                .map_or(GridPlacement::AUTO, GridPlacement::from_line_index),
        };
    }
    if let Some(start) = input.grid_row_start {
        style.grid_row = Line {
            start: GridPlacement::from_line_index(start),
            end: input
                .grid_row_end
                .map_or(GridPlacement::AUTO, GridPlacement::from_line_index),
        };
    }

    // justify_items (for grid)
    if let Some(ref j) = input.justify_items {
        style.justify_items = Some(match j.as_str() {
            "start" | "flex-start" => AlignItems::Start,
            "end" | "flex-end" => AlignItems::End,
            "center" => AlignItems::Center,
            _ => AlignItems::Stretch,
        });
    }

    // Position (relative / absolute)
    if let Some(ref p) = input.position {
        style.position = match p.as_str() {
            "absolute" => Position::Absolute,
            _ => Position::Relative,
        };
    }

    // Inset (top, right, bottom, left) for positioned elements. Unspecified
    // sides must stay AUTO: a 0 there would win the constraint against the
    // opposite side and make a lone `right`/`bottom` inert.
    if let Some(ref inset) = input.inset {
        let side = |value: Option<f32>| {
            value.map_or(LengthPercentageAuto::AUTO, LengthPercentageAuto::length)
        };
        style.inset = Rect {
            top: side(inset[0]),
            right: side(inset[1]),
            bottom: side(inset[2]),
            left: side(inset[3]),
        };
    }

    // Aspect ratio
    if let Some(ar) = input.aspect_ratio {
        style.aspect_ratio = Some(ar);
    }

    style
}

/// Parse a track sizing function from a string like "100px", "1fr", "auto", "minmax(100px, 1fr)"
fn parse_track_sizing(value: &str) -> TrackSizingFunction {
    let trimmed = value.trim();

    if trimmed == "auto" {
        return taffy::prelude::auto();
    }

    if let Some(fr_str) = trimmed.strip_suffix("fr") {
        if let Ok(fr) = fr_str.trim().parse::<f32>() {
            return taffy::prelude::fr(fr);
        }
    }

    if let Some(px_str) = trimmed.strip_suffix("px") {
        if let Ok(px) = px_str.trim().parse::<f32>() {
            return taffy::prelude::length(px);
        }
    }

    // Try parsing as a plain number (treat as px)
    if let Ok(px) = trimmed.parse::<f32>() {
        return taffy::prelude::length(px);
    }

    // Default: auto
    taffy::prelude::auto()
}

/// Walk the computed Taffy layout tree and collect absolute positions into flat output.
fn collect_layout_results(
    tree: &TaffyTree<String>,
    node_id: NodeId,
    parent_x: f32,
    parent_y: f32,
    node_id_map: &HashMap<NodeId, String>,
    context: &MeasureContext,
    results: &mut Vec<LayoutNodeOutput>,
) -> Result<(), EngineError> {
    let layout = tree
        .layout(node_id)
        .map_err(|e| EngineError::Layout(format!("Failed to read computed layout: {e:?}")))?;
    let x = parent_x + layout.location.x;
    let y = parent_y + layout.location.y;
    let width = layout.size.width;
    let height = layout.size.height;

    let string_id = node_id_map.get(&node_id).cloned().unwrap_or_default();

    let text_layout = if let Some(text_input) = context.text_inputs.get(&node_id) {
        let letter_spacing = text_input.letter_spacing_px.unwrap_or(0.0);
        let font_families: Vec<String> = if text_input.font_family.is_empty() {
            vec!["default".to_string()]
        } else {
            text_input.font_family.clone()
        };
        let rust_result = context.text_results.get(&node_id);
        let unit_map_unavailable_error = || EngineError::Structured {
            code: "TEXT_UNIT_MAP_UNAVAILABLE".to_string(),
            message: format!(
                "Text unit metadata was requested for node \"{string_id}\", but resolved positioned glyphs are unavailable.",
            ),
            stage: Some("text".to_string()),
            node_id: Some(string_id.clone()),
        };
        if text_input.unit_map.is_some() && rust_result.is_none() {
            return Err(unit_map_unavailable_error());
        }
        if let Some(font_entry) = resolve_font_from_registries(
            context.font_registry,
            context.fallback_registry,
            &font_families,
            text_input.font_weight,
            &text_input.font_style,
        ) {
            let shape_options = shaping::ShapeOptions {
                writing_mode: text_input.writing_mode.clone(),
                language: text_input.language.clone(),
                vertical_feature_priority: None,
                text_orientation: text_input.text_orientation.clone(),
                font_variation_settings: parse_variation_settings_opt(
                    text_input.font_variation_settings.as_deref(),
                ),
                font_feature_settings: parse_feature_settings_opt(
                    text_input.font_feature_settings.as_deref(),
                ),
            };
            let glyphs = shaping::shape_text_with_options(
                context.font_registry,
                font_entry,
                &text_input.content,
                text_input.font_size_px,
                letter_spacing,
                &shape_options,
            );
            let measured_width = shaping::measure_width(&glyphs);

            let unit_map = if let Some(request) = text_input.unit_map {
                let result = rust_result.ok_or_else(unit_map_unavailable_error)?;
                Some(
                    crate::text::unit_map::build_text_unit_map(
                        &result.lines,
                        request.kind,
                        request.ruby,
                        if text_input.writing_mode.as_deref() == Some("vertical-rl") {
                            crate::text::types::WritingMode::VerticalRl
                        } else {
                            crate::text::types::WritingMode::HorizontalTb
                        },
                    )
                    .map_err(|error| EngineError::Structured {
                        code: "TEXT_UNIT_MAP_INVALID".to_string(),
                        message: error.to_string(),
                        stage: Some("text".to_string()),
                        node_id: Some(string_id.clone()),
                    })?,
                )
            } else {
                None
            };
            let line_height_px = rust_result.map_or_else(
                || {
                    resolve_line_metrics_for_style(
                        context.font_registry,
                        context.fallback_registry,
                        &font_families,
                        text_input.font_weight,
                        &text_input.font_style,
                        text_input.font_size_px,
                        text_input.line_height,
                        text_input.line_height_px,
                    )
                    .line_height_px
                },
                |result| {
                    let line_count = result.lines.len().max(1) as f64;
                    if text_input.writing_mode.as_deref() == Some("vertical-rl") {
                        result.bbox.w / line_count
                    } else {
                        result.bbox.h / line_count
                    }
                },
            );
            Some(TextLayoutOutput {
                glyphs,
                measured_width,
                measured_height: line_height_px,
                lines: rust_result.map(|r| r.lines.clone()),
                bbox: rust_result.map(|r| r.bbox.clone()),
                chosen_font_size_px: rust_result.map(|r| r.chosen_font_size_px),
                overflow: rust_result.map(|r| r.overflow.clone()),
                source_text: rust_result.and_then(|r| r.source_text.clone()),
                display_text: rust_result.and_then(|r| r.display_text.clone()),
                unit_map,
                warnings: rust_result.map(|r| r.warnings.clone()).unwrap_or_default(),
                inline_box_decorations: rust_result
                    .map(|r| r.inline_box_decorations.clone())
                    .unwrap_or_default(),
                text_decorations: rust_result
                    .map(|r| r.text_decorations.clone())
                    .unwrap_or_default(),
                inline_rects: rust_result
                    .map(|r| r.inline_rects.clone())
                    .unwrap_or_default(),
            })
        } else if text_input.unit_map.is_some() {
            return Err(unit_map_unavailable_error());
        } else {
            None
        }
    } else if let Some(text_path_input) = context.text_path_inputs.get(&node_id) {
        Some(build_text_path_layout_output(
            text_path_input,
            context,
            &string_id,
        )?)
    } else {
        None
    };

    results.push(LayoutNodeOutput {
        node_id: string_id,
        x,
        y,
        width,
        height,
        text_layout,
    });

    for child in tree.children(node_id).unwrap_or_default() {
        collect_layout_results(tree, child, x, y, node_id_map, context, results)?;
    }

    Ok(())
}

fn build_text_path_layout_output(
    input: &TextPathInput,
    context: &MeasureContext<'_>,
    node_id: &str,
) -> Result<TextLayoutOutput, EngineError> {
    use crate::text::path::{
        TextOnPathRequest, TextOnPathUnitMapRequest, TextPathAnchor, TextPathDirection,
        TextPathFit, TextPathNormal, TextPathOverflow, layout_text_on_path,
    };
    use crate::text::types::{
        FitMode, Language, TextLayoutRequest, TextOrientation, WhiteSpaceMode, WrapMode,
        WritingMode,
    };

    let font_families = if input.font_family.is_empty() {
        vec!["default".to_string()]
    } else {
        input.font_family.clone()
    };
    let font_context = crate::font::FontContext {
        registry: context.font_registry,
        fallback_registry: context.fallback_registry,
        families: &font_families,
        weight: input.font_weight,
        style: &input.font_style,
    };
    let content = input
        .spans
        .iter()
        .map(|span| span.text.as_str())
        .collect::<String>();
    let text_request = TextLayoutRequest {
        text: &content,
        spans: Some(&input.spans),
        rich_text: None,
        font_size_px: input.font_size_px,
        line_height: None,
        line_height_px: None,
        letter_spacing_px: input.letter_spacing_px.unwrap_or(0.0),
        text_indent: None,
        max_width: f64::MAX,
        max_height: None,
        wrap: WrapMode::None,
        white_space: WhiteSpaceMode::PreWrap,
        tab_size: 4,
        fit: FitMode::None,
        max_lines: Some(1),
        ellipsis: false,
        language: Language::from_option(input.language.as_deref()),
        writing_mode: WritingMode::HorizontalTb,
        text_orientation: TextOrientation::Mixed,
        uax14_breaks: None,
        hanging_punctuation: false,
        font_variation_settings: parse_variation_settings_opt(
            input.font_variation_settings.as_deref(),
        ),
        font_feature_settings: parse_feature_settings_opt(input.font_feature_settings.as_deref()),
        min_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
    };
    let path_request = TextOnPathRequest {
        d: &input.d,
        text: text_request,
        start_offset_px: input.start_offset_px.unwrap_or(0.0),
        text_anchor: match input.text_anchor.as_deref() {
            Some("middle") => TextPathAnchor::Middle,
            Some("end") => TextPathAnchor::End,
            _ => TextPathAnchor::Start,
        },
        path_direction: if input.path_direction.as_deref() == Some("reverse") {
            TextPathDirection::Reverse
        } else {
            TextPathDirection::Forward
        },
        path_normal: if input.path_normal.as_deref() == Some("right") {
            TextPathNormal::Right
        } else {
            TextPathNormal::Left
        },
        path_offset_px: input.path_offset_px.unwrap_or(0.0),
        path_fit: match input.path_fit.as_deref() {
            Some("spacing") => TextPathFit::Spacing,
            Some("scale") => TextPathFit::Scale,
            Some("shrink") => TextPathFit::Shrink,
            _ => TextPathFit::None,
        },
        path_overflow: match input.path_overflow.as_deref() {
            Some("error") => TextPathOverflow::Error,
            Some("ellipsis") => TextPathOverflow::Ellipsis,
            _ => TextPathOverflow::Hidden,
        },
        decoration_owner_ids: &input.decoration_owner_ids,
        unit_map: input.unit_map.map(|unit_request| TextOnPathUnitMapRequest {
            kind: unit_request.kind,
            ruby: unit_request.ruby,
        }),
    };
    let mut result = layout_text_on_path(&path_request, &font_context)
        .map_err(|error| map_text_path_layout_error(error, node_id))?;
    let unit_map = result.unit_map.take();
    let text_decorations = std::mem::take(&mut result.text_decorations);
    let glyphs = result
        .lines
        .first()
        .map(|line| line.glyphs.clone())
        .unwrap_or_default();
    let measured_width = result.lines.first().map_or(0.0, |line| line.width);
    let measured_height = resolve_line_metrics_for_style(
        context.font_registry,
        context.fallback_registry,
        &font_families,
        input.font_weight,
        &input.font_style,
        input.font_size_px,
        None,
        None,
    )
    .line_height_px;
    Ok(TextLayoutOutput {
        glyphs,
        measured_width,
        measured_height,
        lines: Some(result.lines),
        bbox: Some(result.bbox),
        chosen_font_size_px: Some(result.chosen_font_size_px),
        overflow: Some(result.overflow),
        source_text: result.source_text,
        display_text: result.display_text,
        unit_map,
        warnings: result.warnings,
        inline_box_decorations: Vec::new(),
        text_decorations,
        inline_rects: Vec::new(),
    })
}

fn map_text_path_layout_error(
    error: crate::text::path::TextOnPathError,
    node_id: &str,
) -> EngineError {
    use crate::text::path::TextOnPathError;

    let code = match error {
        TextOnPathError::Invalid => "TEXT_PATH_INVALID",
        TextOnPathError::InvalidData => "TEXT_PATH_INVALID_DATA",
        TextOnPathError::MultipleSubpathsUnsupported => "TEXT_PATH_MULTIPLE_SUBPATHS_UNSUPPORTED",
        TextOnPathError::ZeroLength => "TEXT_PATH_ZERO_LENGTH",
        TextOnPathError::SourceLimit => "TEXT_PATH_SOURCE_LIMIT",
        TextOnPathError::OffsetLimit => "TEXT_PATH_OFFSET_LIMIT",
        TextOnPathError::ComplexityLimit => "TEXT_PATH_COMPLEXITY_LIMIT",
        TextOnPathError::Overflow => "TEXT_PATH_OVERFLOW",
        TextOnPathError::ClusterLimit => "TEXT_PATH_CLUSTER_LIMIT",
        TextOnPathError::RunLimit => "TEXT_PATH_RUN_LIMIT",
        TextOnPathError::PaintLimit => "TEXT_PATH_PAINT_LIMIT",
        TextOnPathError::DecorationRangeLimit => "TEXT_DECORATION_RANGE_LIMIT",
        TextOnPathError::DecorationLimit => "TEXT_PATH_DECORATION_LIMIT",
        TextOnPathError::DecorationPatternLimit => "TEXT_DECORATION_PATTERN_LIMIT",
        TextOnPathError::DecorationGeometry => "TEXT_DECORATION_GEOMETRY",
        TextOnPathError::InlineClusterSplit => "TEXT_PATH_INLINE_CLUSTER_SPLIT",
        TextOnPathError::FitUnsatisfiable => "TEXT_PATH_FIT_UNSATISFIABLE",
        TextOnPathError::LayoutUnavailable => "TEXT_NO_LAYOUT",
        TextOnPathError::UnitMapInvalid => "TEXT_UNIT_MAP_INVALID",
    };
    EngineError::Structured {
        code: code.to_string(),
        message: error.to_string(),
        stage: Some("text".to_string()),
        node_id: Some(node_id.to_string()),
    }
}
