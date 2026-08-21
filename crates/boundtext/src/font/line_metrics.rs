use super::{FontEntry, FontRegistry, FontStyle};

/// Last-resort fallback for fonts with unusable metrics.
pub const FALLBACK_NORMAL_LINE_HEIGHT_FACTOR: f64 = 1.2;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LineMetrics {
    pub font_size_px: f64,
    pub line_height_px: f64,
    pub ascent_px: f64,
    pub descent_px: f64,
    pub line_gap_px: f64,
    pub half_leading_px: f64,
    pub baseline_offset_px: f64,
}

#[must_use]
pub fn resolve_font_entry<'a>(
    registry: &'a FontRegistry,
    fallback_registry: Option<&'a FontRegistry>,
    families: &[String],
    weight: u16,
    style: &FontStyle,
) -> Option<&'a FontEntry> {
    registry.resolve_chain(families, weight, style).or_else(|| {
        fallback_registry.and_then(|fallback| fallback.resolve_chain(families, weight, style))
    })
}

#[must_use]
pub fn resolve_line_metrics(
    font_entry: Option<&FontEntry>,
    font_size_px: f64,
    line_height: Option<f64>,
    line_height_px: Option<f64>,
) -> LineMetrics {
    let fallback_line_height_px = font_size_px * FALLBACK_NORMAL_LINE_HEIGHT_FACTOR;
    let (ascent_px, descent_px, line_gap_px, normal_line_height_px) = font_entry.map_or(
        (
            font_size_px * 0.8,
            font_size_px * 0.2,
            0.0,
            fallback_line_height_px,
        ),
        |entry| {
            let scale = font_size_px / f64::from(entry.units_per_em.max(1));
            let has_typographic_vertical_extent =
                entry.typographic_ascender != 0 || entry.typographic_descender != 0;
            let ascent_units = if has_typographic_vertical_extent {
                entry.typographic_ascender
            } else {
                entry.ascender
            };
            let descender_units = if has_typographic_vertical_extent {
                entry.typographic_descender
            } else {
                entry.descender
            };
            let line_gap_units = if has_typographic_vertical_extent {
                entry.typographic_line_gap
            } else {
                entry.line_gap
            };

            let ascent = f64::from(ascent_units).max(0.0) * scale;
            let descent = f64::from(-descender_units).max(0.0) * scale;
            let line_gap = f64::from(line_gap_units).max(0.0) * scale;
            // Keep glyph placement on typographic metrics, but avoid the old
            // 1.0em normal line box by applying the CSS-like 1.2em floor.
            // Using raw hhea/win extents here makes CJK fonts push baselines
            // down too far in absolute-positioned text and ruby samples.
            let typographic_normal = ascent + descent + line_gap;
            let normal = typographic_normal.max(fallback_line_height_px);
            if normal > 0.0 && ascent > 0.0 {
                (ascent, descent, line_gap, normal)
            } else {
                (
                    font_size_px * 0.8,
                    font_size_px * 0.2,
                    0.0,
                    fallback_line_height_px,
                )
            }
        },
    );

    let used_line_height_px = line_height_px
        .or_else(|| line_height.map(|factor| font_size_px * factor))
        .unwrap_or(normal_line_height_px);
    let content_height_px = ascent_px + descent_px;
    let half_leading_px = (used_line_height_px - content_height_px) * 0.5;
    let baseline_offset_px = half_leading_px + ascent_px;

    LineMetrics {
        font_size_px,
        line_height_px: used_line_height_px,
        ascent_px,
        descent_px,
        line_gap_px,
        half_leading_px,
        baseline_offset_px,
    }
}

#[must_use]
pub fn resolve_line_metrics_for_style(
    registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    families: &[String],
    weight: u16,
    style: &FontStyle,
    font_size_px: f64,
    line_height: Option<f64>,
    line_height_px: Option<f64>,
) -> LineMetrics {
    resolve_line_metrics(
        resolve_font_entry(registry, fallback_registry, families, weight, style),
        font_size_px,
        line_height,
        line_height_px,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::FontRegistry;

    fn test_registry() -> FontRegistry {
        let mut registry = FontRegistry::new();
        registry
            .register(
                std::fs::read(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
                ))
                .expect("font"),
                "NotoSansJP".to_string(),
                400,
                FontStyle::Normal,
            )
            .expect("register font");
        registry
    }

    #[test]
    fn normal_line_height_uses_typographic_metrics_with_floor() {
        let registry = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let metrics = resolve_line_metrics_for_style(
            &registry,
            None,
            &families,
            400,
            &FontStyle::Normal,
            20.0,
            None,
            None,
        );

        assert!(metrics.line_height_px > 0.0);
        assert!(metrics.baseline_offset_px > 0.0);
        assert!(metrics.baseline_offset_px < metrics.line_height_px);
        assert!((metrics.line_height_px - 24.0).abs() < 0.01);
        assert!((metrics.baseline_offset_px - 19.6).abs() < 0.01);
    }

    #[test]
    fn explicit_line_height_keeps_typographic_baseline() {
        let registry = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let metrics = resolve_line_metrics_for_style(
            &registry,
            None,
            &families,
            400,
            &FontStyle::Normal,
            20.0,
            Some(1.5),
            None,
        );

        assert!((metrics.line_height_px - 30.0).abs() < 0.01);
        assert!((metrics.baseline_offset_px - 22.6).abs() < 0.01);
    }

    #[test]
    fn explicit_line_height_uses_font_baseline_with_half_leading() {
        let metrics = resolve_line_metrics(None, 20.0, Some(1.5), None);

        assert_eq!(metrics.line_height_px, 30.0);
        assert_eq!(metrics.ascent_px, 16.0);
        assert_eq!(metrics.descent_px, 4.0);
        assert_eq!(metrics.half_leading_px, 5.0);
        assert_eq!(metrics.baseline_offset_px, 21.0);
    }
}
