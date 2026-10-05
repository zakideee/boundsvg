//! Validate text coordinate frames and resolve offsets from the final layout box.

use crate::diagnostics::PipelineStage;
use crate::error::EngineError;
use crate::ir::types::{BBox, IrTextAlign};
use crate::layout::types::{TextInput, TextLayoutOutput, TextPathInput};
use crate::text::types::{Line, TextBBox, TextPlacementSpace, WritingMode};

/// Translation applied to one line when placing text in the final layout box.
#[derive(Clone, Copy)]
pub(super) struct LineOffset {
    pub x: f64,
    pub y: f64,
}

/// Validated coordinate frame and per-line translations consumed by IR construction.
pub(super) struct TextPlacement {
    pub space: TextPlacementSpace,
    pub offsets: Vec<LineOffset>,
}

/// Node inputs, measured text, and final layout geometry needed to validate placement.
#[derive(Clone, Copy)]
pub(super) struct TextPlacementContext<'a> {
    pub node_id: &'a str,
    pub node_type: &'a str,
    pub text_input: Option<&'a TextInput>,
    pub path_input: Option<&'a TextPathInput>,
    pub layout: &'a TextLayoutOutput,
    pub lines: &'a [Line],
    pub measured: &'a TextBBox,
    pub layout_box: BBox,
    pub align: IrTextAlign,
}

fn invalid(node_id: &str, reason: &str) -> EngineError {
    EngineError::Structured {
        code: "TEXT_PLACEMENT_INVALID".to_string(),
        message: format!("Text placement for node \"{node_id}\" is invalid: {reason}."),
        stage: Some(PipelineStage::Ir),
        node_id: Some(node_id.to_string()),
    }
}

/// Resolve a horizontal line origin, preserving overflow for center and end alignment.
pub(crate) fn horizontal_start(layout_box: BBox, line_width: f64, align: IrTextAlign) -> f64 {
    match align {
        IrTextAlign::Center => {
            layout_box.x + horizontal_align_offset(layout_box.w - line_width, align)
        }
        IrTextAlign::End => layout_box.x + layout_box.w - line_width,
        IrTextAlign::Start => layout_box.x,
    }
}

fn horizontal_align_offset(available: f64, align: IrTextAlign) -> f64 {
    match align {
        IrTextAlign::Center => available / 2.0,
        IrTextAlign::End => available,
        IrTextAlign::Start => 0.0,
    }
}

/// Resolve vertical inline alignment, leaving overflowing content at its starting origin.
pub(crate) fn vertical_align_offset(available: f64, align: IrTextAlign) -> f64 {
    if available <= 0.0 {
        return 0.0;
    }
    match align {
        IrTextAlign::Center => available / 2.0,
        IrTextAlign::End => available,
        IrTextAlign::Start => 0.0,
    }
}

/// Validate text coordinate ownership and compute translations from the final layout box.
///
/// # Errors
///
/// Returns `TEXT_PLACEMENT_INVALID` for missing or contradictory coordinate frames,
/// glyph position flags, or decoration line ownership.
pub(super) fn resolve(context: TextPlacementContext<'_>) -> Result<TextPlacement, EngineError> {
    let TextPlacementContext {
        node_id,
        node_type,
        text_input,
        path_input,
        layout,
        lines,
        measured,
        layout_box,
        align,
    } = context;
    let space = layout
        .placement_space
        .ok_or_else(|| invalid(node_id, "missing placement space"))?;
    let requested_mode =
        WritingMode::from_option(text_input.and_then(|input| input.writing_mode.as_deref()));
    match space {
        TextPlacementSpace::LineRelative { writing_mode }
        | TextPlacementSpace::BlockLocal { writing_mode } => {
            if node_type != "text"
                || text_input.is_none()
                || path_input.is_some()
                || writing_mode != requested_mode
            {
                return Err(invalid(
                    node_id,
                    "node kind or writing mode contradicts the placement space",
                ));
            }
        }
        TextPlacementSpace::FlowFrame => {
            if node_type != "text"
                || text_input.and_then(|input| input.flow.as_ref()).is_none()
                || path_input.is_some()
            {
                return Err(invalid(
                    node_id,
                    "flow frame requires text flow input without path input",
                ));
            }
        }
        TextPlacementSpace::PathFrame => {
            if node_type != "textonpath" || path_input.is_none() || text_input.is_some() {
                return Err(invalid(node_id, "path frame has no path input"));
            }
        }
    }
    let is_absolute = !matches!(space, TextPlacementSpace::LineRelative { .. });
    for line in lines {
        if is_absolute && line.positioned_glyphs.is_none() {
            return Err(invalid(
                node_id,
                "absolute line has no positioned glyph array",
            ));
        }
        if line.positioned_glyphs.as_ref().is_some_and(|glyphs| {
            glyphs.iter().any(|glyph| {
                if is_absolute {
                    glyph.absolute_position != Some(true)
                } else {
                    glyph.absolute_position == Some(true)
                }
            })
        }) {
            return Err(invalid(
                node_id,
                "glyph position flag contradicts the placement space",
            ));
        }
    }
    for decoration in &layout.inline_box_decorations {
        if matches!(space, TextPlacementSpace::LineRelative { .. })
            || lines.get(decoration.line_index as usize).is_none()
        {
            return Err(invalid(
                node_id,
                "inline box decoration has invalid line ownership",
            ));
        }
    }
    for rectangle in &layout.inline_rects {
        if matches!(space, TextPlacementSpace::LineRelative { .. })
            || lines.get(rectangle.line_index as usize).is_none()
        {
            return Err(invalid(
                node_id,
                "inline rectangle has invalid line ownership",
            ));
        }
    }
    for path in layout
        .text_decorations
        .iter()
        .flat_map(|fragment| &fragment.paths)
    {
        if lines.get(path.line_index as usize).is_none() {
            return Err(invalid(
                node_id,
                "text decoration path has invalid line ownership",
            ));
        }
    }
    let offsets = lines
        .iter()
        .map(|line| match space {
            TextPlacementSpace::BlockLocal {
                writing_mode: WritingMode::HorizontalTb,
            } => LineOffset {
                x: horizontal_align_offset(layout_box.w - line.width, align),
                y: 0.0,
            },
            TextPlacementSpace::BlockLocal {
                writing_mode: WritingMode::VerticalRl,
            } => LineOffset {
                x: layout_box.w - measured.w,
                y: vertical_align_offset(layout_box.h - line.width, align),
            },
            _ => LineOffset { x: 0.0, y: 0.0 },
        })
        .collect();
    Ok(TextPlacement { space, offsets })
}
