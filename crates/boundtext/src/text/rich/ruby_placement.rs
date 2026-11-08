//! Reserve ruby cells without compressing shaped clusters or borrowing across a range boundary.

use super::{
    GlyphInkBounds, LayoutToken, PositionedGlyph, RichLayoutResult, RubyInkAxis,
    RubyInkBoundsContext, RubySide, glyphs_ink_bounds, rich_preparation_error,
};

/// Retain annotation demand until the final line or region selects its neighbors.
#[derive(Debug, Clone, Default)]
pub(super) struct Placement {
    levels: Vec<Level>,
    isolated_advance: f64,
    leading: f64,
    trailing: f64,
    leading_with_neighbor: f64,
    trailing_with_neighbor: f64,
}

#[derive(Debug, Clone)]
struct Level {
    leading: f64,
    trailing: f64,
    leading_font_size: f64,
    trailing_font_size: f64,
    cross_ink: Option<(f64, f64)>,
    outward_direction: OutwardDirection,
}

/// Select the cross-axis half-line away from the base for one annotation level.
#[derive(Debug, Clone, Copy)]
enum OutwardDirection {
    /// Horizontal over and vertical under occupy smaller cross-axis coordinates.
    Before,
    /// Horizontal under and vertical over occupy larger cross-axis coordinates.
    After,
}

impl OutwardDirection {
    fn from_axis_and_side(axis: RubyInkAxis, side: RubySide) -> Self {
        match (axis, side) {
            (RubyInkAxis::Horizontal, RubySide::Over)
            | (RubyInkAxis::Vertical, RubySide::Under) => Self::Before,
            (RubyInkAxis::Horizontal, RubySide::Under)
            | (RubyInkAxis::Vertical, RubySide::Over) => Self::After,
        }
    }

    fn is_annotation_outward(self, annotation: (f64, f64), lender: (f64, f64)) -> bool {
        match self {
            Self::Before => annotation.1 <= lender.0,
            Self::After => lender.1 <= annotation.0,
        }
    }
}

/// Resolve one token's cell width and the offset of its unchanged base block.
#[derive(Debug, Clone, Copy)]
pub(super) struct Cell {
    /// Consume this much inline space, including both remaining reservations.
    pub(super) advance: f64,
    /// Translate the whole shaped block from the reserved cell's leading edge.
    pub(super) base_offset: f64,
}

fn ensure_finite(number: f64) -> RichLayoutResult<f64> {
    if number.is_finite() {
        Ok(number)
    } else {
        Err(rich_preparation_error())
    }
}

fn ensure_nonnegative(number: f64) -> RichLayoutResult<f64> {
    let number = ensure_finite(number)?;
    if number >= 0.0 {
        Ok(number)
    } else {
        Err(rich_preparation_error())
    }
}

fn resolve_inline_frame(
    glyph: &PositionedGlyph,
    axis: RubyInkAxis,
) -> RichLayoutResult<(f64, f64)> {
    let (start, advance) = match axis {
        RubyInkAxis::Horizontal => (glyph.origin_x - glyph.x_offset, glyph.x_advance),
        RubyInkAxis::Vertical => (
            glyph.origin_y - glyph.y_offset,
            if glyph.y_advance == 0.0 {
                glyph.x_advance
            } else {
                glyph.y_advance.abs()
            },
        ),
    };
    let end = ensure_finite(ensure_finite(start)? + ensure_finite(advance)?)?;
    Ok((start.min(end), start.max(end)))
}

fn resolve_cross_ink(
    bounds: Option<GlyphInkBounds>,
    reference: f64,
    axis: RubyInkAxis,
) -> RichLayoutResult<Option<(f64, f64)>> {
    bounds
        .map(|bounds| {
            let (start, end) = match axis {
                RubyInkAxis::Horizontal => (bounds.min_y, bounds.max_y),
                RubyInkAxis::Vertical => (bounds.min_x, bounds.max_x),
            };
            Ok((
                ensure_finite(start - reference)?,
                ensure_finite(end - reference)?,
            ))
        })
        .transpose()
}

/// Measure aligned annotation frames and control bounds in the base's natural coordinate system.
///
/// # Errors
///
/// Return a preparation or font error when extents, sizes, or bounds cannot be resolved finitely.
pub(super) fn build_placement(
    glyphs: &[PositionedGlyph],
    base_advance: f64,
    reference: f64,
    level_ranges: &[(RubySide, usize, usize)],
    context: RubyInkBoundsContext<'_>,
) -> RichLayoutResult<Placement> {
    ensure_finite(base_advance)?;
    let mut placement = Placement::default();
    let mut annotation_extent: Option<(f64, f64)> = None;
    for &(side, start, end) in level_ranges {
        let level_glyphs = glyphs.get(start..end).ok_or_else(rich_preparation_error)?;
        let Some(first) = level_glyphs.first() else {
            continue;
        };
        let mut frame = resolve_inline_frame(first, context.axis)?;
        let mut leading_font_size =
            ensure_nonnegative(first.font_size_px.ok_or_else(rich_preparation_error)?)?;
        let mut trailing_font_size = leading_font_size;
        for glyph in &level_glyphs[1..] {
            let extent = resolve_inline_frame(glyph, context.axis)?;
            let font_size =
                ensure_nonnegative(glyph.font_size_px.ok_or_else(rich_preparation_error)?)?;
            if extent.0 < frame.0 {
                frame.0 = extent.0;
                leading_font_size = font_size;
            }
            if extent.1 > frame.1 {
                frame.1 = extent.1;
                trailing_font_size = font_size;
            }
        }
        let bounds = glyphs_ink_bounds(level_glyphs, &context)?;
        if let Some(bounds) = bounds {
            let extent = match context.axis {
                RubyInkAxis::Horizontal => (bounds.min_x, bounds.max_x),
                RubyInkAxis::Vertical => (bounds.min_y, bounds.max_y),
            };
            frame.0 = frame.0.min(ensure_finite(extent.0)?);
            frame.1 = frame.1.max(ensure_finite(extent.1)?);
        }
        let leading = ensure_nonnegative(-frame.0.min(0.0))?;
        let trailing = ensure_nonnegative(ensure_finite(frame.1 - base_advance)?.max(0.0))?;
        annotation_extent = Some(annotation_extent.map_or(frame, |extent| {
            (extent.0.min(frame.0), extent.1.max(frame.1))
        }));
        placement.leading = placement.leading.max(leading);
        placement.trailing = placement.trailing.max(trailing);
        placement.levels.push(Level {
            leading,
            trailing,
            leading_font_size,
            trailing_font_size,
            cross_ink: resolve_cross_ink(bounds, reference, context.axis)?,
            outward_direction: OutwardDirection::from_axis_and_side(context.axis, side),
        });
    }
    placement.leading_with_neighbor = placement.leading;
    placement.trailing_with_neighbor = placement.trailing;
    if let Some((start, end)) = annotation_extent {
        // The authored cursor may move backwards. Measure the reserved extent
        // directly instead of rejecting that cursor or cancelling it in a sum.
        placement.isolated_advance = ensure_nonnegative(end.max(base_advance) - start.min(0.0))?;
    }
    Ok(placement)
}

fn is_lending_grapheme(text: &str, hanging: bool) -> bool {
    let mut scalars = text.chars();
    let Some(first) = scalars.next() else {
        return false;
    };
    if matches!(first, '、' | '。' | '，' | '．' | '・') {
        return !crate::text::kinsoku::is_hanging_char(
            first,
            crate::text::kinsoku::get_hanging_chars(hanging),
        ) && scalars.next().is_none();
    }
    matches!(first as u32, 0x3041..=0x3096 | 0x30a1..=0x30fa | 0x31f0..=0x31ff | 0xff66..=0xff9d | 0x30fc)
        && scalars.all(|scalar| matches!(scalar as u32, 0x3099 | 0x309a | 0xff9e | 0xff9f))
}

fn resolve_lending_capacity(
    ruby: &LayoutToken,
    neighbor: &LayoutToken,
    hanging: bool,
    context: RubyInkBoundsContext<'_>,
) -> RichLayoutResult<Option<(f64, (f64, f64))>> {
    if neighbor.ruby_placement.is_some()
        || neighbor.inline_box_decoration.is_some()
        || !neighbor.inline_rects.is_empty()
        || !is_lending_grapheme(&neighbor.text, hanging)
        || ruby
            .decoration_memberships
            .iter()
            .map(|entry| entry.span_id)
            .ne(neighbor
                .decoration_memberships
                .iter()
                .map(|entry| entry.span_id))
        || neighbor.glyphs.iter().any(|glyph| {
            glyph.rotation_deg != 0
                || glyph.baseline_rotation_deg.is_some()
                || glyph.inline_scale.is_some()
                || glyph.synthetic_kind.is_some()
        })
    {
        return Ok(None);
    }
    let Some(natural_advance) = neighbor.lending_advance else {
        return Ok(None);
    };
    // Positive tracking never increases the loan. Negative tracking may reduce
    // the actual interval, whose two halves must still remain disjoint.
    let capacity = ensure_finite(natural_advance.min(ensure_finite(neighbor.advance)?) * 0.5)?;
    if capacity <= 0.0 {
        return Ok(None);
    }
    let bounds = glyphs_ink_bounds(&neighbor.glyphs, &context)?;
    Ok(
        resolve_cross_ink(bounds, neighbor.reference_offset, context.axis)?
            .map(|bounds| (capacity, bounds)),
    )
}

fn resolve_neighbor_reserve(
    levels: &[Level],
    capacity: Option<(f64, (f64, f64))>,
    leading: bool,
) -> RichLayoutResult<f64> {
    let mut reserve = 0.0_f64;
    for level in levels {
        let demand = if leading {
            level.leading
        } else {
            level.trailing
        };
        let edge_size = if leading {
            level.leading_font_size
        } else {
            level.trailing_font_size
        };
        let loan = match (capacity, level.cross_ink) {
            (Some((capacity, neighbor)), Some(annotation))
                if level
                    .outward_direction
                    .is_annotation_outward(annotation, neighbor) =>
            {
                demand.min(edge_size).min(capacity)
            }
            _ => 0.0,
        };
        reserve = reserve.max(ensure_nonnegative(demand - loan)?);
    }
    Ok(reserve)
}

/// Prepare bounded neighbor loans once; selection still removes loans outside the final slice.
///
/// # Errors
///
/// Return font errors or preparation failure for unresolved or nonfinite geometry.
pub(super) fn prepare_neighbor_loans(
    tokens: &mut [LayoutToken],
    hanging: bool,
    context: RubyInkBoundsContext<'_>,
) -> RichLayoutResult<()> {
    for index in 0..tokens.len() {
        let Some(placement) = tokens[index].ruby_placement.as_ref() else {
            continue;
        };
        let leading = index
            .checked_sub(1)
            .map(|neighbor| {
                resolve_lending_capacity(&tokens[index], &tokens[neighbor], hanging, context)
            })
            .transpose()?
            .flatten();
        let trailing = tokens
            .get(index + 1)
            .map(|neighbor| resolve_lending_capacity(&tokens[index], neighbor, hanging, context))
            .transpose()?
            .flatten();
        let leading_reserve = resolve_neighbor_reserve(&placement.levels, leading, true)?;
        let trailing_reserve = resolve_neighbor_reserve(&placement.levels, trailing, false)?;
        let placement = tokens[index]
            .ruby_placement
            .as_mut()
            .ok_or_else(rich_preparation_error)?;
        placement.leading_with_neighbor = leading_reserve;
        placement.trailing_with_neighbor = trailing_reserve;
    }
    Ok(())
}

/// Resolve a token's reserved cell using only neighbors present in this exact candidate range.
///
/// # Errors
///
/// Return preparation failure when the reserved width is not finitely representable.
pub(super) fn resolve_cell(
    token: &LayoutToken,
    has_leading_neighbor: bool,
    has_trailing_neighbor: bool,
) -> RichLayoutResult<Cell> {
    let Some(placement) = &token.ruby_placement else {
        return Ok(Cell {
            advance: ensure_finite(token.advance)?,
            base_offset: 0.0,
        });
    };
    if placement.levels.is_empty() {
        return Ok(Cell {
            advance: ensure_finite(token.advance)?,
            base_offset: 0.0,
        });
    }
    let leading = if has_leading_neighbor {
        placement.leading_with_neighbor
    } else {
        placement.leading
    };
    let trailing = if has_trailing_neighbor {
        placement.trailing_with_neighbor
    } else {
        placement.trailing
    };
    let mut leading_loan = ensure_nonnegative(placement.leading - leading)?;
    let mut trailing_loan = ensure_nonnegative(placement.trailing - trailing)?;
    let half_extent = placement.isolated_advance * 0.5;
    // Backwards authored tracking can make the annotation narrower than the
    // two available loans together. Keep their allocation reflection-symmetric
    // and disjoint instead of moving neighboring cells backwards.
    if leading_loan > half_extent && trailing_loan > half_extent {
        leading_loan = half_extent;
        trailing_loan = half_extent;
    } else if leading_loan > half_extent {
        leading_loan = leading_loan.min(ensure_nonnegative(
            placement.isolated_advance - trailing_loan,
        )?);
    }
    let after_leading_loan = ensure_nonnegative(placement.isolated_advance - leading_loan)?;
    trailing_loan = trailing_loan.min(after_leading_loan);
    Ok(Cell {
        advance: ensure_nonnegative(after_leading_loan - trailing_loan)?,
        base_offset: ensure_nonnegative(placement.leading - leading_loan)?,
    })
}
