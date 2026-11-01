//! Shared box contours for border surfaces, content clipping, and outline strokes.

use super::types::{BBox, BorderRadius, BoxClip, BoxContour, CornerRadius};
use crate::error::EngineError;
use crate::svg_emit::num_format::format_js_number;

/// Resolve circular outer corners once, treating finite negative radii as square corners.
pub(crate) fn outer_contour(bbox: BBox, radius: Option<BorderRadius>) -> BoxContour {
    let normalize_radius = |radius: f64| {
        if radius.is_finite() {
            radius.max(0.0)
        } else {
            radius
        }
    };
    let radii = match radius {
        None => [0.0; 4],
        Some(BorderRadius::Uniform(radius)) => [normalize_radius(radius); 4],
        Some(BorderRadius::PerCorner(radii)) => {
            [radii.tl, radii.tr, radii.br, radii.bl].map(normalize_radius)
        }
    };
    BoxContour {
        bbox,
        corners: radii.map(|radius| CornerRadius {
            rx: radius,
            ry: radius,
        }),
    }
}

/// Derive the inset candidate; the owner's outer clip completes the intersection.
pub(crate) fn inset_clip(outer: &BoxContour, widths: [f32; 4]) -> BoxClip {
    let [top, right, bottom, left] = widths.map(f64::from);
    let bbox = BBox::new(
        outer.bbox.x + left,
        outer.bbox.y + top,
        outer.bbox.w - left - right,
        outer.bbox.h - top - bottom,
    );
    if bbox.w <= 0.0 || bbox.h <= 0.0 {
        return BoxClip::Empty;
    }
    let horizontal = [left, right, right, left];
    let vertical = [top, top, bottom, bottom];
    let corners = std::array::from_fn(|index| CornerRadius {
        rx: (outer.corners[index].rx - horizontal[index])
            .max(0.0)
            .min(bbox.w / 2.0),
        ry: (outer.corners[index].ry - vertical[index])
            .max(0.0)
            .min(bbox.h / 2.0),
    });
    BoxClip::BoxContour(BoxContour { bbox, corners })
}

/// Serialize the same resolved contour used by clipping and inspection.
///
/// # Errors
///
/// Returns a structured numeric error if a contour coordinate is not finite.
pub(crate) fn contour_path(contour: &BoxContour) -> Result<String, EngineError> {
    let BBox { x, y, w, h } = contour.bbox;
    let [tl, tr, br, bl] = contour.corners;
    // Preserve the shared resolved contour rather than quantizing each arc endpoint independently.
    let number = |value: f64| {
        if value.is_finite() {
            Ok(format_js_number(value))
        } else {
            Err(EngineError::Structured {
                code: "INVALID_NUMBER".to_string(),
                message: "Non-finite resolved box contour".to_string(),
                stage: Some(crate::diagnostics::PipelineStage::Ir),
                node_id: None,
            })
        }
    };
    let corner = |radius: CornerRadius, end_x, end_y| -> Result<String, EngineError> {
        if radius.rx > 0.0 && radius.ry > 0.0 {
            Ok(format!(
                "A{},{} 0 0 1 {},{}",
                number(radius.rx)?,
                number(radius.ry)?,
                number(end_x)?,
                number(end_y)?
            ))
        } else {
            Ok(format!("L{},{}", number(end_x)?, number(end_y)?))
        }
    };
    // A zero axis collapses the entire corner, matching SVG elliptical-arc semantics.
    let collapsed = |radius: CornerRadius| {
        if radius.rx > 0.0 && radius.ry > 0.0 {
            radius
        } else {
            CornerRadius { rx: 0.0, ry: 0.0 }
        }
    };
    let [tl, tr, br, bl] = [tl, tr, br, bl].map(collapsed);
    Ok([
        format!("M{},{}", number(x + tl.rx)?, number(y)?),
        format!("H{}", number(x + w - tr.rx)?),
        corner(tr, x + w, y + tr.ry)?,
        format!("V{}", number(y + h - br.ry)?),
        corner(br, x + w - br.rx, y + h)?,
        format!("H{}", number(x + bl.rx)?),
        corner(bl, x, y + h - bl.ry)?,
        format!("V{}", number(y + tl.ry)?),
        corner(tl, x + tl.rx, y)?,
        "Z".to_string(),
    ]
    .join(" "))
}

/// Place a contour in a Path's local coordinate system without changing its shape.
pub(crate) fn local_contour(contour: &BoxContour, origin: BBox) -> BoxContour {
    BoxContour {
        bbox: BBox::new(
            contour.bbox.x - origin.x,
            contour.bbox.y - origin.y,
            contour.bbox.w,
            contour.bbox.h,
        ),
        corners: contour.corners,
    }
}
