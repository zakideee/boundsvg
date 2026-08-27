use serde::{Deserialize, Serialize};

use boundtext::font::FontContext;
use boundtext::font::shaping::VariationSetting;
use boundtext::font::{FontRegistry, FontStyle};
use boundtext::text::engine::layout_text;
use boundtext::text::grapheme::full_grapheme_split;
use boundtext::text::kinsoku::{
    get_kinsoku_profile, is_head_prohibit, is_non_breaking_pair, is_tail_prohibit,
};
use boundtext::text::types::{
    FitMode, Language, PositionedGlyph, RichTextNodeInput, TextLayoutRequest, TextOrientation,
    TextWarning, WhiteSpaceMode, WrapMode, WritingMode,
};

// ---------------------------------------------------------------------------
// CLI Input (deserialized from fixture JSON)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[expect(
    dead_code,
    reason = "fields read by serde Deserialize, not accessed directly"
)]
pub struct CliInput {
    pub id: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub request: LayoutRequest,
    #[serde(default)]
    pub expected: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[expect(
    dead_code,
    reason = "fields read by serde Deserialize, not accessed directly"
)]
pub struct LayoutRequest {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub rich_text: Option<Vec<RichTextNodeInput>>,
    pub font_family: String,
    pub font_size_px: f64,
    pub max_width: f64,
    #[serde(default)]
    pub max_height: Option<f64>,
    #[serde(default = "default_wrap")]
    pub wrap: String,
    #[serde(default = "default_fit")]
    pub fit: String,
    #[serde(default)]
    pub max_lines: Option<usize>,
    #[serde(default)]
    pub ellipsis: bool,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_writing_mode")]
    pub writing_mode: String,
    #[serde(default = "default_line_height")]
    pub line_height: Option<f64>,
    #[serde(default)]
    pub line_height_px: Option<f64>,
    #[serde(default)]
    pub letter_spacing_px: f64,
    #[serde(default)]
    pub hanging_punctuation: bool,
    #[serde(default = "default_font_weight")]
    pub font_weight: u16,
    #[serde(default = "default_font_style")]
    pub font_style: String,
    #[serde(default)]
    pub font_features: Vec<String>,
    #[serde(default)]
    pub font_variation_settings: serde_json::Map<String, serde_json::Value>,
    // Fit params
    #[serde(default)]
    pub min_font_size_px: Option<f64>,
    #[serde(default)]
    pub max_font_size_px: Option<f64>,
}

// serde `default = "..."` callbacks for `LayoutRequest`. They are live in
// the normal bin target (invoked by the derived Deserialize) but dead in the
// bin's test target, which never constructs a deserializer - so this must be
// `allow`, not `expect` (an expectation would be unfulfilled in the live
// target).
#[allow(
    dead_code,
    reason = "used via serde attribute; dead only in the test target"
)]
fn default_wrap() -> String {
    "Word".to_string()
}
#[allow(
    dead_code,
    reason = "used via serde attribute; dead only in the test target"
)]
fn default_fit() -> String {
    "None".to_string()
}
#[allow(
    dead_code,
    reason = "used via serde attribute; dead only in the test target"
)]
fn default_language() -> String {
    "Auto".to_string()
}
#[allow(
    dead_code,
    reason = "used via serde attribute; dead only in the test target"
)]
fn default_writing_mode() -> String {
    "HorizontalTb".to_string()
}
#[allow(
    dead_code,
    reason = "used via serde attribute; dead only in the test target"
)]
fn default_line_height() -> Option<f64> {
    None
}
#[allow(
    dead_code,
    reason = "used via serde attribute; dead only in the test target"
)]
fn default_font_weight() -> u16 {
    400
}
#[allow(
    dead_code,
    reason = "used via serde attribute; dead only in the test target"
)]
fn default_font_style() -> String {
    "Normal".to_string()
}

// ---------------------------------------------------------------------------
// CLI Output (serialized to JSON)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct CliOutput {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<LayoutResult>,
}

#[derive(Debug, Serialize)]
pub struct LayoutResult {
    pub chosen_font_size_px: f64,
    pub bbox: BBox,
    pub overflow: OverflowInfo,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<TextWarning>,
    pub line_count: usize,
    pub column_count: usize,
    pub break_indices: Vec<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ellipsis_index: Option<usize>,
    pub kinsoku_violations: Vec<KinsokuViolation>,
    pub rotated_glyph_count: usize,
    pub lines: Vec<LineOutput>,
}

#[derive(Debug, Serialize)]
pub struct BBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Serialize)]
pub struct OverflowInfo {
    #[serde(rename = "type")]
    pub overflow_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct KinsokuViolation {
    pub line_index: usize,
    pub violation_type: String,
    pub character: String,
    pub position: String,
}

#[derive(Debug, Serialize)]
pub struct LineOutput {
    pub index: usize,
    pub text: String,
    pub start_grapheme: usize,
    pub end_grapheme: usize,
    pub width: f64,
    pub baseline_y: f64,
    pub glyphs: Vec<GlyphOutput>,
}

#[derive(Debug, Serialize)]
pub struct GlyphOutput {
    pub glyph_id: u32,
    pub cluster: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_end: Option<u32>,
    pub x_advance: f64,
    pub y_advance: f64,
    pub x_offset: f64,
    pub y_offset: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation_deg: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_writing_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub absolute_position: Option<bool>,
}

// ---------------------------------------------------------------------------
// Layout execution
// ---------------------------------------------------------------------------

#[expect(
    clippy::cast_possible_truncation,
    reason = "f64 JSON values converted to f32 for VariationSetting; precision loss is acceptable for font axis values"
)]
#[expect(
    clippy::too_many_lines,
    reason = "CLI layout runner maps input DTOs to output DTOs in one place for fixture stability"
)]
pub fn run_layout(input: &CliInput, font_registry: &FontRegistry) -> CliOutput {
    let req = &input.request;

    // Parse enums
    let wrap = match req.wrap.to_lowercase().as_str() {
        "none" => WrapMode::None,
        "char" => WrapMode::Char,
        _ => WrapMode::Word,
    };

    let fit = match req.fit.to_lowercase().as_str() {
        "shrink" => FitMode::Shrink,
        "grow" => FitMode::Grow,
        _ => FitMode::None,
    };

    let language = match req.language.to_lowercase().as_str() {
        "ja" => Language::Ja,
        "en" => Language::En,
        _ => Language::Auto,
    };

    let writing_mode = match req.writing_mode.as_str() {
        "VerticalRl" | "vertical-rl" => WritingMode::VerticalRl,
        _ => WritingMode::HorizontalTb,
    };

    let text_orientation = TextOrientation::Mixed;

    let font_style = match req.font_style.to_lowercase().as_str() {
        "italic" => FontStyle::Italic,
        _ => FontStyle::Normal,
    };

    let font_families = vec![req.font_family.clone()];
    let rich_text = req.rich_text.as_deref();

    // Convert font_variation_settings JSON map to Vec<VariationSetting>
    let font_variation_settings: Vec<VariationSetting> = req
        .font_variation_settings
        .iter()
        .filter_map(|(tag, value)| {
            let variation_value = value.as_f64()? as f32;
            Some(VariationSetting {
                tag: tag.clone(),
                value: variation_value,
            })
        })
        .collect();

    // Build layout request
    let layout_req = TextLayoutRequest {
        text: &req.text,
        spans: None,
        rich_text,
        font_size_px: req.font_size_px,
        line_height: req.line_height,
        line_height_px: req.line_height_px,
        letter_spacing_px: req.letter_spacing_px,
        text_indent: None,
        max_width: req.max_width,
        max_height: req.max_height,
        wrap,
        white_space: WhiteSpaceMode::Normal,
        tab_size: 4,
        fit,
        max_lines: req.max_lines,
        ellipsis: req.ellipsis,
        language,
        writing_mode,
        text_orientation,
        uax14_breaks: None,
        hanging_punctuation: req.hanging_punctuation,
        font_variation_settings,
        font_feature_settings: Vec::new(),
        min_font_size_px: req.min_font_size_px,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: req.max_font_size_px,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        fit_max_probes: None,
    };

    // Run layout
    let font_ctx = FontContext {
        registry: font_registry,
        fallback_registry: None,
        families: &font_families,
        weight: req.font_weight,
        style: &font_style,
    };
    match layout_text(&layout_req, &font_ctx) {
        Ok(result) => {
            let is_vertical = writing_mode == WritingMode::VerticalRl;

            // Compute break indices (grapheme-cluster based)
            let break_indices = compute_break_indices(&result.lines);

            // Detect kinsoku violations
            let kinsoku_violations = detect_kinsoku_violations(&result.lines, language);

            // Detect ellipsis
            let ellipsis_index = detect_ellipsis_index(&result.lines);

            // Column count for vertical
            let column_count = if is_vertical { result.lines.len() } else { 0 };

            // Count rotated glyphs (rotation_deg == 90) for vertical validation
            let rotated_glyph_count = result
                .lines
                .iter()
                .flat_map(|line| {
                    if let Some(positioned_glyphs) = line.positioned_glyphs.as_ref() {
                        positioned_glyphs
                            .iter()
                            .map(|glyph| glyph.rotation_deg)
                            .collect::<Vec<_>>()
                    } else {
                        line.glyphs
                            .iter()
                            .map(|glyph| glyph.rotation_deg.unwrap_or(0))
                            .collect::<Vec<_>>()
                    }
                })
                .filter(|rotation_deg| *rotation_deg == 90)
                .count();

            // Build line outputs
            let mut grapheme_offset = 0;
            let lines: Vec<LineOutput> = result
                .lines
                .iter()
                .enumerate()
                .map(|(i, line)| {
                    let grapheme_count = full_grapheme_split(&line.text).len();
                    let start = grapheme_offset;
                    let end = grapheme_offset + grapheme_count;
                    grapheme_offset = end;

                    LineOutput {
                        index: i,
                        text: line.text.clone(),
                        start_grapheme: start,
                        end_grapheme: end,
                        width: line.width,
                        baseline_y: line.baseline_y,
                        glyphs: line_glyph_outputs(line),
                    }
                })
                .collect();

            CliOutput {
                id: input.id.clone(),
                category: input.category.clone(),
                status: "ok".to_string(),
                error: None,
                result: Some(LayoutResult {
                    chosen_font_size_px: result.chosen_font_size_px,
                    bbox: BBox {
                        x: result.bbox.x,
                        y: result.bbox.y,
                        w: result.bbox.w,
                        h: result.bbox.h,
                    },
                    overflow: OverflowInfo {
                        overflow_type: result.overflow.overflow_type,
                        reason: result.overflow.reason,
                    },
                    warnings: result.warnings,
                    line_count: result.lines.len(),
                    column_count,
                    break_indices,
                    ellipsis_index,
                    kinsoku_violations,
                    rotated_glyph_count,
                    lines,
                }),
            }
        }
        Err(error) => CliOutput {
            id: input.id.clone(),
            category: input.category.clone(),
            status: "error".to_string(),
            error: Some(error.to_string()),
            result: None,
        },
    }
}

fn line_glyph_outputs(line: &boundtext::text::types::Line) -> Vec<GlyphOutput> {
    if let Some(positioned_glyphs) = line.positioned_glyphs.as_ref() {
        return positioned_glyphs
            .iter()
            .map(positioned_glyph_output)
            .collect();
    }

    line.glyphs
        .iter()
        .map(|g| GlyphOutput {
            glyph_id: g.glyph_id,
            cluster: g.cluster,
            text: None,
            cluster_start: None,
            cluster_end: None,
            x_advance: g.x_advance,
            y_advance: g.y_advance,
            x_offset: g.x_offset,
            y_offset: g.y_offset,
            font_family: g.font_alias.clone(),
            font_size_px: None,
            fill: None,
            origin_x: None,
            origin_y: None,
            rotation_deg: g.rotation_deg,
            outline_writing_mode: None,
            absolute_position: None,
        })
        .collect()
}

fn positioned_glyph_output(glyph: &PositionedGlyph) -> GlyphOutput {
    GlyphOutput {
        glyph_id: glyph.glyph_id,
        cluster: glyph.cluster_start,
        text: Some(glyph.text.clone()),
        cluster_start: Some(glyph.cluster_start),
        cluster_end: Some(glyph.cluster_end),
        x_advance: glyph.x_advance,
        y_advance: glyph.y_advance,
        x_offset: glyph.x_offset,
        y_offset: glyph.y_offset,
        font_family: Some(glyph.font_alias.clone()),
        font_size_px: glyph.font_size_px,
        fill: glyph.fill.clone(),
        origin_x: Some(glyph.origin_x),
        origin_y: Some(glyph.origin_y),
        rotation_deg: Some(glyph.rotation_deg),
        outline_writing_mode: glyph.outline_writing_mode.clone(),
        absolute_position: glyph.absolute_position,
    }
}

/// Compute break indices as grapheme-cluster positions where line breaks occur.
fn compute_break_indices(lines: &[boundtext::text::types::Line]) -> Vec<usize> {
    if lines.len() <= 1 {
        return Vec::new();
    }

    let mut indices = Vec::new();
    let mut offset = 0;
    for line in lines.iter().take(lines.len() - 1) {
        offset += full_grapheme_split(&line.text).len();
        indices.push(offset);
    }
    indices
}

/// Detect kinsoku violations by checking line start/end characters.
fn detect_kinsoku_violations(
    lines: &[boundtext::text::types::Line],
    language: Language,
) -> Vec<KinsokuViolation> {
    let profile = match language {
        Language::Ja => get_kinsoku_profile(Some("ja")),
        Language::En | Language::Auto => None,
    };
    let Some(profile) = profile else {
        return Vec::new();
    };

    let mut violations = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        if i == 0 {
            continue; // First line has no line-start constraint
        }

        // Check line-start character
        if let Some(first_char) = line.text.chars().next() {
            if is_head_prohibit(first_char, profile) {
                violations.push(KinsokuViolation {
                    line_index: i,
                    violation_type: "head_prohibit".to_string(),
                    character: first_char.to_string(),
                    position: "line_start".to_string(),
                });
            }
        }
    }

    for (i, line) in lines.iter().enumerate() {
        if i == lines.len() - 1 {
            continue; // Last line has no line-end constraint
        }

        // Check line-end character
        if let Some(last_char) = line.text.chars().last() {
            if is_tail_prohibit(last_char, profile) {
                violations.push(KinsokuViolation {
                    line_index: i,
                    violation_type: "tail_prohibit".to_string(),
                    character: last_char.to_string(),
                    position: "line_end".to_string(),
                });
            }
        }
    }

    for i in 0..lines.len().saturating_sub(1) {
        if let (Some(last_char), Some(first_char)) = (
            lines[i].text.chars().last(),
            lines[i + 1].text.chars().next(),
        ) {
            if is_non_breaking_pair(last_char, first_char, profile) {
                violations.push(KinsokuViolation {
                    line_index: i,
                    violation_type: "non_break_pair".to_string(),
                    character: format!("{last_char}{first_char}"),
                    position: "line_boundary".to_string(),
                });
            }
        }
    }

    violations
}

/// Detect if the last line ends with an ellipsis character.
fn detect_ellipsis_index(lines: &[boundtext::text::types::Line]) -> Option<usize> {
    let last_line = lines.last()?;
    if last_line.text.ends_with('…') {
        let total_graphemes: usize = lines
            .iter()
            .map(|l| full_grapheme_split(&l.text).len())
            .sum();
        Some(total_graphemes.saturating_sub(1))
    } else {
        None
    }
}
