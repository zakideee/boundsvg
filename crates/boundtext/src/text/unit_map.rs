//! Stable paint-unit metadata derived from resolved text layout.
//!
//! Unit identity belongs to boundtext because only the text engine knows the
//! relationship between shaping clusters, logical source ranges, ruby roles,
//! and resolved lines. Consumers must treat `unit_id` as opaque.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::{Deserialize, Deserializer, Serialize};

use crate::font::FontContext;

use super::grapheme::grapheme_split;
use super::types::{
    Line, PositionedGlyph, TextLayoutRequest, TextLayoutResult, WritingMode,
    preprocess_span_texts_for_white_space, preprocess_text_for_white_space,
};

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextUnitKind {
    Cluster,
    Line,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextUnitRubyMode {
    WithBase,
    Separate,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextUnitSourceRole {
    Content,
    RubyBase,
    RubyAnnotation,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextUnitGlyphMember {
    #[serde(deserialize_with = "deserialize_text_unit_member_index")]
    pub line_index: u32,
    #[serde(deserialize_with = "deserialize_text_unit_member_index")]
    pub glyph_index: u32,
    pub source_role: TextUnitSourceRole,
}

/// Preserve semantic index-space validation for JSON integers wider than the
/// internal representation. The saturated value cannot name a realizable
/// glyph vector and is rejected by the outline owner with its stable error.
fn deserialize_text_unit_member_index<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: Deserializer<'de>,
{
    let index = u64::deserialize(deserializer)?;
    Ok(u32::try_from(index).unwrap_or(u32::MAX))
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextUnitMapEntry {
    /// Deterministic but opaque. Consumers must not parse this representation.
    pub unit_id: String,
    pub kind: TextUnitKind,
    /// Logical source range in the base text's segmentation space. Ruby
    /// annotations retain the range of the base text they annotate.
    pub source_start: u32,
    pub source_end: u32,
    /// Layout-local line/column identity. It may change after reflow.
    pub line_id: String,
    pub logical_order: u32,
    pub visual_order: u32,
    pub members: Vec<TextUnitGlyphMember>,
}

#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextUnitMap {
    pub kind: TextUnitKind,
    pub ruby: TextUnitRubyMode,
    pub units: Vec<TextUnitMapEntry>,
}

/// Canonical authored unit retained independently from the selected display
/// projection. This is internal transport for omitted-unit materialization;
/// callers must treat its ordering and IDs as implementation details.
#[derive(Debug, Clone, PartialEq, Eq)]
#[doc(hidden)]
pub(crate) struct TextSourceUnit {
    pub(crate) source_start: u32,
    pub(crate) source_end: u32,
    pub(crate) cluster_start: u32,
    pub(crate) cluster_end: u32,
    pub(crate) source_role: TextUnitSourceRole,
    pub(crate) authored_order: u32,
}

/// Immutable logical source projection for a text layout.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[doc(hidden)]
pub(crate) struct TextSourceProjection {
    pub(crate) units: Vec<TextSourceUnit>,
}

impl TextSourceProjection {
    /// Build one canonical content unit per extended grapheme cluster.
    #[must_use]
    pub(crate) fn from_content(text: &str) -> Self {
        let mut byte_cursor = 0_u32;
        let units = grapheme_split(text)
            .into_iter()
            .enumerate()
            .map(|(index, grapheme)| {
                let cluster_start = byte_cursor;
                byte_cursor =
                    byte_cursor.saturating_add(u32::try_from(grapheme.len()).unwrap_or(u32::MAX));
                let source_start = u32::try_from(index).unwrap_or(u32::MAX);
                TextSourceUnit {
                    source_start,
                    source_end: source_start.saturating_add(1),
                    cluster_start,
                    cluster_end: byte_cursor,
                    source_role: TextUnitSourceRole::Content,
                    authored_order: source_start,
                }
            })
            .collect();
        Self { units }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextUnitMapError {
    pub line_index: usize,
    pub glyph_index: usize,
    pub reason: &'static str,
}

impl fmt::Display for TextUnitMapError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "cannot build text unit map for line {}, glyph {}: {}",
            self.line_index, self.glyph_index, self.reason
        )
    }
}

impl std::error::Error for TextUnitMapError {}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct ClusterSignature {
    role: TextUnitSourceRole,
    source_start: u32,
    source_end: u32,
    cluster_start: u32,
    cluster_end: u32,
}

#[derive(Debug, Clone)]
struct GlyphCandidate {
    member: TextUnitGlyphMember,
    signature: ClusterSignature,
    inline_position: f64,
    paint_order: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct LogicalKey {
    group_start: u32,
    group_end: u32,
    role_rank: u8,
    local_start: u32,
    local_end: u32,
    occurrence: u32,
    unit_id: String,
}

#[derive(Debug, Clone, Copy)]
struct VisualKey {
    line_index: usize,
    inline_position: f64,
    paint_order: usize,
}

#[derive(Debug, Clone)]
struct UnitDraft {
    entry: TextUnitMapEntry,
    signature: ClusterSignature,
    occurrence: u32,
    logical_key: LogicalKey,
    visual_key: VisualKey,
    ruby_group: Option<(u32, u32)>,
    first_paint_order: usize,
}

/// Build additive unit metadata from a completed boundtext layout.
///
/// The caller opts in after layout is resolved. Existing layouts do not pay
/// this allocation cost and keep their serialized representation unchanged.
///
/// # Errors
///
/// Returns [`TextUnitMapError`] when a positioned glyph lacks the logical
/// source metadata required to derive deterministic unit membership.
pub fn build_text_unit_map(
    lines: &[Line],
    kind: TextUnitKind,
    ruby: TextUnitRubyMode,
    writing_mode: WritingMode,
) -> Result<TextUnitMap, TextUnitMapError> {
    build_text_unit_map_internal(lines, None, kind, ruby, writing_mode)
}

/// Build unit metadata from a completed layout and the request's canonical
/// normalized authored projection. Units omitted from display are retained
/// with no glyph members.
///
/// # Errors
///
/// Returns [`TextUnitMapError`] when a visible authored glyph lacks required
/// source metadata.
pub fn build_text_unit_map_for_request(
    result: &TextLayoutResult,
    request: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    kind: TextUnitKind,
    ruby: TextUnitRubyMode,
) -> Result<TextUnitMap, TextUnitMapError> {
    let projection = source_projection_for_request(request, font_ctx, result.chosen_font_size_px);
    build_text_unit_map_internal(
        &result.lines,
        Some(&projection),
        kind,
        ruby,
        request.writing_mode,
    )
}

fn source_projection_for_request(
    request: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    chosen_font_size_px: f64,
) -> TextSourceProjection {
    if request.has_rich_text() || request.text_indent.unwrap_or(0.0) != 0.0 {
        return super::rich::build_source_projection(request, font_ctx, chosen_font_size_px);
    }

    let normalized_source = if let Some(spans) = request.spans.filter(|spans| !spans.is_empty()) {
        let span_texts = spans
            .iter()
            .map(|span| span.text.as_str())
            .collect::<Vec<_>>();
        preprocess_span_texts_for_white_space(&span_texts, request.white_space, request.tab_size)
            .map_or_else(
                || span_texts.concat(),
                |normalized| normalized.into_iter().collect(),
            )
    } else {
        preprocess_text_for_white_space(request.text, request.white_space, request.tab_size)
    };
    TextSourceProjection::from_content(&normalized_source)
}

fn build_text_unit_map_internal(
    lines: &[Line],
    source_projection: Option<&TextSourceProjection>,
    kind: TextUnitKind,
    ruby: TextUnitRubyMode,
    writing_mode: WritingMode,
) -> Result<TextUnitMap, TextUnitMapError> {
    let candidates = collect_candidates(lines, writing_mode)?;
    let line_ids = build_line_ids(lines.len(), &candidates, writing_mode);
    let mut units = match kind {
        TextUnitKind::Cluster => {
            let mut drafts = build_cluster_drafts(&candidates, &line_ids);
            if let Some(projection) = source_projection {
                append_omitted_cluster_drafts(&mut drafts, projection, lines.len());
            }
            finalize_cluster_units(drafts, ruby)
        }
        TextUnitKind::Line => build_line_units(candidates, &line_ids),
    };
    assign_orders(&mut units);
    Ok(TextUnitMap {
        kind,
        ruby,
        units: units.into_iter().map(|draft| draft.entry).collect(),
    })
}

fn collect_candidates(
    lines: &[Line],
    writing_mode: WritingMode,
) -> Result<Vec<GlyphCandidate>, TextUnitMapError> {
    let mut candidates = Vec::new();
    let mut paint_order = 0_usize;
    for (line_index, line) in lines.iter().enumerate() {
        let Some(positioned_glyphs) = &line.positioned_glyphs else {
            if !line.text.is_empty() {
                return Err(TextUnitMapError {
                    line_index,
                    glyph_index: 0,
                    reason: "positionedGlyphs are missing for a visible line",
                });
            }
            continue;
        };
        if positioned_glyphs.is_empty() && !line.text.is_empty() {
            return Err(TextUnitMapError {
                line_index,
                glyph_index: 0,
                reason: "positionedGlyphs are empty for a visible line",
            });
        }
        for (glyph_index, glyph) in positioned_glyphs.iter().enumerate() {
            if glyph.synthetic_kind.as_deref() == Some("ellipsis") {
                paint_order += 1;
                continue;
            }
            let source_start = required_source_offset(
                glyph.source_start,
                line_index,
                glyph_index,
                "sourceStart is missing",
            )?;
            let source_end = required_source_offset(
                glyph.source_end,
                line_index,
                glyph_index,
                "sourceEnd is missing",
            )?;
            if source_end < source_start {
                return Err(TextUnitMapError {
                    line_index,
                    glyph_index,
                    reason: "sourceEnd precedes sourceStart",
                });
            }
            let role = parse_source_role(glyph, line_index, glyph_index)?;
            candidates.push(GlyphCandidate {
                member: TextUnitGlyphMember {
                    line_index: usize_to_u32(line_index),
                    glyph_index: usize_to_u32(glyph_index),
                    source_role: role,
                },
                signature: ClusterSignature {
                    role,
                    source_start,
                    source_end,
                    cluster_start: glyph.cluster_start,
                    cluster_end: glyph.cluster_end,
                },
                inline_position: match writing_mode {
                    WritingMode::HorizontalTb => glyph.origin_x,
                    WritingMode::VerticalRl => glyph.origin_y,
                },
                paint_order,
            });
            paint_order += 1;
        }
    }
    Ok(candidates)
}

fn required_source_offset(
    value: Option<u32>,
    line_index: usize,
    glyph_index: usize,
    reason: &'static str,
) -> Result<u32, TextUnitMapError> {
    value.ok_or(TextUnitMapError {
        line_index,
        glyph_index,
        reason,
    })
}

fn parse_source_role(
    glyph: &PositionedGlyph,
    line_index: usize,
    glyph_index: usize,
) -> Result<TextUnitSourceRole, TextUnitMapError> {
    match glyph.source_role.as_deref() {
        Some("content") => Ok(TextUnitSourceRole::Content),
        Some("rubyBase") => Ok(TextUnitSourceRole::RubyBase),
        Some("rubyAnnotation") => Ok(TextUnitSourceRole::RubyAnnotation),
        Some(_) => Err(TextUnitMapError {
            line_index,
            glyph_index,
            reason: "sourceRole is unknown",
        }),
        None => Err(TextUnitMapError {
            line_index,
            glyph_index,
            reason: "sourceRole is missing",
        }),
    }
}

fn build_line_ids(
    line_count: usize,
    candidates: &[GlyphCandidate],
    writing_mode: WritingMode,
) -> Vec<Option<String>> {
    let mut coverages = vec![None::<(u32, u32)>; line_count];
    for candidate in candidates {
        let line_index = candidate.member.line_index as usize;
        let coverage = &mut coverages[line_index];
        *coverage = Some(match *coverage {
            Some((start, end)) => (
                start.min(candidate.signature.source_start),
                end.max(candidate.signature.source_end),
            ),
            None => (
                candidate.signature.source_start,
                candidate.signature.source_end,
            ),
        });
    }

    let axis = match writing_mode {
        WritingMode::HorizontalTb => "h",
        WritingMode::VerticalRl => "v",
    };
    let mut occurrences = BTreeMap::<(u32, u32), u32>::new();
    coverages
        .into_iter()
        .map(|coverage| {
            coverage.map(|(start, end)| {
                let occurrence = occurrences.entry((start, end)).or_default();
                let line_id = format!("line:{axis}:{start}:{end}:{}", *occurrence);
                *occurrence += 1;
                line_id
            })
        })
        .collect()
}

fn build_cluster_drafts(
    candidates: &[GlyphCandidate],
    line_ids: &[Option<String>],
) -> Vec<UnitDraft> {
    let mut occurrence_by_signature = BTreeMap::<ClusterSignature, u32>::new();
    let mut drafts = Vec::<UnitDraft>::new();
    let mut candidate_index = 0_usize;
    while candidate_index < candidates.len() {
        let first = &candidates[candidate_index];
        let signature = first.signature.clone();
        let line_index = first.member.line_index as usize;
        let mut end = candidate_index + 1;
        while end < candidates.len()
            && candidates[end].member.line_index as usize == line_index
            && candidates[end].signature == signature
        {
            end += 1;
        }
        let occurrence = occurrence_by_signature
            .entry(signature.clone())
            .or_default();
        let occurrence_value = *occurrence;
        *occurrence += 1;
        // Ruby association is assigned after all annotation ranges are known,
        // so this identity is replaced by `assign_cluster_identities` below.
        let unit_id = cluster_unit_id(&signature, occurrence_value, None);
        let line_id = line_ids[line_index].clone().unwrap_or_default();
        let visual_key = candidates[candidate_index..end]
            .iter()
            .map(candidate_visual_key)
            .min_by(compare_visual_keys)
            .unwrap_or(VisualKey {
                line_index,
                inline_position: 0.0,
                paint_order: first.paint_order,
            });
        let members = candidates[candidate_index..end]
            .iter()
            .map(|candidate| candidate.member.clone())
            .collect();
        drafts.push(UnitDraft {
            entry: TextUnitMapEntry {
                unit_id: unit_id.clone(),
                kind: TextUnitKind::Cluster,
                source_start: signature.source_start,
                source_end: signature.source_end,
                line_id,
                logical_order: 0,
                visual_order: 0,
                members,
            },
            logical_key: standalone_logical_key(&signature, occurrence_value, &unit_id),
            visual_key,
            ruby_group: None,
            first_paint_order: first.paint_order,
            signature,
            occurrence: occurrence_value,
        });
        candidate_index = end;
    }

    drafts
}

fn finalize_cluster_units(mut drafts: Vec<UnitDraft>, ruby: TextUnitRubyMode) -> Vec<UnitDraft> {
    assign_ruby_groups(&mut drafts);
    assign_cluster_identities(&mut drafts);
    match ruby {
        TextUnitRubyMode::WithBase => combine_ruby_units(drafts),
        TextUnitRubyMode::Separate => {
            for draft in &mut drafts {
                draft.logical_key = separate_ruby_logical_key(draft);
            }
            drafts
        }
    }
}

fn append_omitted_cluster_drafts(
    drafts: &mut Vec<UnitDraft>,
    projection: &TextSourceProjection,
    visible_line_count: usize,
) {
    let is_represented = |source_unit: &TextSourceUnit| {
        drafts.iter().any(|draft| {
            if draft.signature.role != source_unit.source_role {
                return false;
            }
            let source_covered = draft.signature.source_start <= source_unit.source_start
                && draft.signature.source_end >= source_unit.source_end;
            if source_unit.source_role == TextUnitSourceRole::RubyAnnotation {
                source_covered
                    && draft.signature.cluster_start <= source_unit.cluster_start
                    && draft.signature.cluster_end >= source_unit.cluster_end
            } else {
                source_covered
            }
        })
    };
    let omitted_units = projection
        .units
        .iter()
        .filter(|source_unit| !is_represented(source_unit))
        .cloned()
        .collect::<Vec<_>>();
    let mut occurrence_by_signature = drafts.iter().fold(
        BTreeMap::<ClusterSignature, u32>::new(),
        |mut counts, draft| {
            let next = counts.entry(draft.signature.clone()).or_default();
            *next = (*next).max(draft.occurrence.saturating_add(1));
            counts
        },
    );
    for (omitted_index, source_unit) in omitted_units.into_iter().enumerate() {
        let signature = ClusterSignature {
            role: source_unit.source_role,
            source_start: source_unit.source_start,
            source_end: source_unit.source_end,
            cluster_start: source_unit.cluster_start,
            cluster_end: source_unit.cluster_end,
        };
        let occurrence = occurrence_by_signature
            .entry(signature.clone())
            .or_default();
        let occurrence_value = *occurrence;
        *occurrence += 1;
        let unit_id = cluster_unit_id(&signature, occurrence_value, None);
        let visual_key = VisualKey {
            line_index: visible_line_count.saturating_add(omitted_index),
            inline_position: 0.0,
            paint_order: usize::MAX
                .saturating_sub(projection.units.len())
                .saturating_add(omitted_index),
        };
        drafts.push(UnitDraft {
            entry: TextUnitMapEntry {
                unit_id: unit_id.clone(),
                kind: TextUnitKind::Cluster,
                source_start: signature.source_start,
                source_end: signature.source_end,
                line_id: String::new(),
                logical_order: 0,
                visual_order: 0,
                members: Vec::new(),
            },
            signature: signature.clone(),
            occurrence: occurrence_value,
            logical_key: standalone_logical_key(&signature, occurrence_value, &unit_id),
            visual_key,
            ruby_group: None,
            first_paint_order: visual_key.paint_order,
        });
    }
}

fn candidate_visual_key(candidate: &GlyphCandidate) -> VisualKey {
    VisualKey {
        line_index: candidate.member.line_index as usize,
        inline_position: candidate.inline_position,
        paint_order: candidate.paint_order,
    }
}

fn cluster_unit_id(
    signature: &ClusterSignature,
    occurrence: u32,
    ruby_group: Option<(u32, u32)>,
) -> String {
    let association = ruby_group.map_or_else(
        || "plain".to_string(),
        |(start, end)| format!("ruby-{start}-{end}"),
    );
    format!(
        "cluster:{}:{}:{}:{association}:{}:{}:{occurrence}",
        signature.source_start,
        signature.source_end,
        role_token(signature.role),
        signature.cluster_start,
        signature.cluster_end,
    )
}

fn role_token(role: TextUnitSourceRole) -> &'static str {
    match role {
        TextUnitSourceRole::Content => "content",
        TextUnitSourceRole::RubyBase => "ruby-base",
        TextUnitSourceRole::RubyAnnotation => "ruby-annotation",
    }
}

fn assign_cluster_identities(drafts: &mut [UnitDraft]) {
    for draft in drafts {
        let unit_id = cluster_unit_id(&draft.signature, draft.occurrence, draft.ruby_group);
        draft.entry.unit_id.clone_from(&unit_id);
        draft.logical_key = standalone_logical_key(&draft.signature, draft.occurrence, &unit_id);
    }
}

fn standalone_logical_key(
    signature: &ClusterSignature,
    occurrence: u32,
    unit_id: &str,
) -> LogicalKey {
    LogicalKey {
        group_start: signature.source_start,
        group_end: signature.source_end,
        role_rank: match signature.role {
            TextUnitSourceRole::Content | TextUnitSourceRole::RubyBase => 0,
            TextUnitSourceRole::RubyAnnotation => 1,
        },
        local_start: signature.source_start,
        local_end: signature.source_end,
        occurrence,
        unit_id: unit_id.to_string(),
    }
}

fn assign_ruby_groups(drafts: &mut [UnitDraft]) {
    let annotation_ranges: BTreeSet<(u32, u32)> = drafts
        .iter()
        .filter(|draft| draft.signature.role == TextUnitSourceRole::RubyAnnotation)
        .map(|draft| (draft.signature.source_start, draft.signature.source_end))
        .collect();

    for draft in drafts {
        draft.ruby_group = match draft.signature.role {
            TextUnitSourceRole::RubyAnnotation => {
                Some((draft.signature.source_start, draft.signature.source_end))
            }
            TextUnitSourceRole::RubyBase => annotation_ranges
                .iter()
                .filter(|(start, end)| {
                    *start <= draft.signature.source_start && *end >= draft.signature.source_end
                })
                .min_by_key(|(start, end)| end.saturating_sub(*start))
                .copied(),
            TextUnitSourceRole::Content => None,
        };
    }
}

fn separate_ruby_logical_key(draft: &UnitDraft) -> LogicalKey {
    let Some((group_start, group_end)) = draft.ruby_group else {
        return standalone_logical_key(&draft.signature, draft.occurrence, &draft.entry.unit_id);
    };
    let (role_rank, local_start, local_end) = match draft.signature.role {
        TextUnitSourceRole::RubyBase => {
            (0, draft.signature.source_start, draft.signature.source_end)
        }
        TextUnitSourceRole::RubyAnnotation => (
            1,
            draft.signature.cluster_start,
            draft.signature.cluster_end,
        ),
        TextUnitSourceRole::Content => {
            (2, draft.signature.source_start, draft.signature.source_end)
        }
    };
    LogicalKey {
        group_start,
        group_end,
        role_rank,
        local_start,
        local_end,
        occurrence: draft.occurrence,
        unit_id: draft.entry.unit_id.clone(),
    }
}

fn combine_ruby_units(drafts: Vec<UnitDraft>) -> Vec<UnitDraft> {
    let mut grouped_indices = BTreeMap::<(u32, u32), Vec<usize>>::new();
    for (index, draft) in drafts.iter().enumerate() {
        if let Some(group) = draft.ruby_group {
            grouped_indices.entry(group).or_default().push(index);
        }
    }

    let mut consumed = vec![false; drafts.len()];
    let mut combined = Vec::<UnitDraft>::new();
    for ((source_start, source_end), indices) in grouped_indices {
        let has_annotation = indices
            .iter()
            .any(|index| drafts[*index].signature.role == TextUnitSourceRole::RubyAnnotation);
        let has_base = indices
            .iter()
            .any(|index| drafts[*index].signature.role == TextUnitSourceRole::RubyBase);
        if !has_annotation || !has_base {
            continue;
        }
        let mut group_drafts: Vec<&UnitDraft> = indices
            .iter()
            .map(|index| {
                consumed[*index] = true;
                &drafts[*index]
            })
            .collect();
        group_drafts.sort_by_key(|draft| draft.first_paint_order);
        let first = group_drafts[0];
        let unit_id = format!("cluster:{source_start}:{source_end}:ruby-composite");
        let visual_key = group_drafts
            .iter()
            .map(|draft| draft.visual_key)
            .min_by(compare_visual_keys)
            .unwrap_or(first.visual_key);
        let members = group_drafts
            .iter()
            .flat_map(|draft| draft.entry.members.iter().cloned())
            .collect();
        combined.push(UnitDraft {
            entry: TextUnitMapEntry {
                unit_id: unit_id.clone(),
                kind: TextUnitKind::Cluster,
                source_start,
                source_end,
                line_id: first.entry.line_id.clone(),
                logical_order: 0,
                visual_order: 0,
                members,
            },
            signature: ClusterSignature {
                role: TextUnitSourceRole::RubyBase,
                source_start,
                source_end,
                cluster_start: 0,
                cluster_end: 0,
            },
            occurrence: 0,
            logical_key: LogicalKey {
                group_start: source_start,
                group_end: source_end,
                role_rank: 0,
                local_start: source_start,
                local_end: source_end,
                occurrence: 0,
                unit_id,
            },
            visual_key,
            ruby_group: Some((source_start, source_end)),
            first_paint_order: first.first_paint_order,
        });
    }

    for (index, mut draft) in drafts.into_iter().enumerate() {
        if !consumed[index] {
            draft.logical_key =
                standalone_logical_key(&draft.signature, draft.occurrence, &draft.entry.unit_id);
            combined.push(draft);
        }
    }
    combined
}

fn build_line_units(
    candidates: Vec<GlyphCandidate>,
    line_ids: &[Option<String>],
) -> Vec<UnitDraft> {
    let mut candidates_by_line = vec![Vec::<GlyphCandidate>::new(); line_ids.len()];
    for candidate in candidates {
        candidates_by_line[candidate.member.line_index as usize].push(candidate);
    }
    let mut drafts = Vec::new();
    for (line_index, line_candidates) in candidates_by_line.into_iter().enumerate() {
        let Some(line_id) = line_ids[line_index].clone() else {
            continue;
        };
        let source_start = line_candidates
            .iter()
            .map(|candidate| candidate.signature.source_start)
            .min()
            .unwrap_or(0);
        let source_end = line_candidates
            .iter()
            .map(|candidate| candidate.signature.source_end)
            .max()
            .unwrap_or(source_start);
        let visual_key = line_candidates
            .iter()
            .map(candidate_visual_key)
            .min_by(compare_visual_keys)
            .unwrap_or(VisualKey {
                line_index,
                inline_position: 0.0,
                paint_order: 0,
            });
        let unit_id = line_id.clone();
        let members = line_candidates
            .iter()
            .map(|candidate| candidate.member.clone())
            .collect();
        let axis_rank = usize_to_u32(line_index);
        drafts.push(UnitDraft {
            entry: TextUnitMapEntry {
                unit_id: unit_id.clone(),
                kind: TextUnitKind::Line,
                source_start,
                source_end,
                line_id,
                logical_order: 0,
                visual_order: 0,
                members,
            },
            signature: ClusterSignature {
                role: TextUnitSourceRole::Content,
                source_start,
                source_end,
                cluster_start: 0,
                cluster_end: 0,
            },
            occurrence: axis_rank,
            logical_key: LogicalKey {
                group_start: source_start,
                group_end: source_end,
                role_rank: 0,
                local_start: source_start,
                local_end: source_end,
                occurrence: axis_rank,
                unit_id,
            },
            visual_key,
            ruby_group: None,
            first_paint_order: line_candidates
                .first()
                .map_or(0, |candidate| candidate.paint_order),
        });
    }
    drafts
}

fn assign_orders(units: &mut [UnitDraft]) {
    let mut logical_indices: Vec<usize> = (0..units.len()).collect();
    logical_indices.sort_by(|left, right| units[*left].logical_key.cmp(&units[*right].logical_key));
    for (order, index) in logical_indices.into_iter().enumerate() {
        units[index].entry.logical_order = usize_to_u32(order);
    }

    let mut visual_indices: Vec<usize> = (0..units.len()).collect();
    visual_indices.sort_by(|left, right| {
        compare_visual_keys(&units[*left].visual_key, &units[*right].visual_key)
            .then_with(|| units[*left].entry.unit_id.cmp(&units[*right].entry.unit_id))
    });
    for (order, index) in visual_indices.into_iter().enumerate() {
        units[index].entry.visual_order = usize_to_u32(order);
    }
}

fn compare_visual_keys(left: &VisualKey, right: &VisualKey) -> Ordering {
    left.line_index
        .cmp(&right.line_index)
        .then_with(|| left.inline_position.total_cmp(&right.inline_position))
        .then_with(|| left.paint_order.cmp(&right.paint_order))
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "text layout line, glyph, and unit counts are bounded far below u32::MAX"
)]
fn usize_to_u32(value: usize) -> u32 {
    value as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::FontStyle;
    use crate::text::types::PositionedGlyph;

    fn glyph(
        text: &str,
        source: (u32, u32),
        cluster: (u32, u32),
        role: &str,
        origin: (f64, f64),
    ) -> PositionedGlyph {
        PositionedGlyph {
            glyph_id: 1,
            text: text.to_string(),
            cluster_start: cluster.0,
            cluster_end: cluster.1,
            source_start: Some(source.0),
            source_end: Some(source.1),
            source_role: Some(role.to_string()),
            decoration_source_start: Some(source.0),
            decoration_source_end: Some(source.1),
            decoration_level: None,
            path_decoration_owner_id: None,
            path_distance_start_px: None,
            path_distance_end_px: None,
            text_decoration_geometry: None,
            font_alias: "Test".to_string(),
            font_fallback: Vec::new(),
            font_weight: 400,
            font_style: FontStyle::Normal,
            font_size_px: Some(16.0),
            font_variation_settings: None,
            font_feature_settings: None,
            fill: None,
            text_strokes: None,
            text_shadows: None,
            paint_range_index: None,
            origin_x: origin.0,
            origin_y: origin.1,
            x_offset: 0.0,
            y_offset: 0.0,
            x_advance: 10.0,
            y_advance: 0.0,
            rotation_deg: 0,
            baseline_rotation_deg: None,
            inline_scale: None,
            synthetic_kind: None,
            outline_writing_mode: None,
            absolute_position: Some(true),
        }
    }

    fn line(glyphs: Vec<PositionedGlyph>) -> Line {
        Line {
            text: glyphs.iter().map(|glyph| glyph.text.as_str()).collect(),
            glyphs: Vec::new(),
            width: glyphs.len() as f64 * 10.0,
            baseline_y: 12.0,
            fragments: None,
            positioned_glyphs: Some(glyphs),
        }
    }

    fn cluster_map(lines: &[Line], ruby: TextUnitRubyMode) -> TextUnitMap {
        build_text_unit_map(
            lines,
            TextUnitKind::Cluster,
            ruby,
            WritingMode::HorizontalTb,
        )
        .expect("unit map")
    }

    #[test]
    fn defers_wide_wire_indices_to_semantic_membership_validation() {
        let member: TextUnitGlyphMember = serde_json::from_str(
            r#"{"lineIndex":0,"glyphIndex":9007199254740991,"sourceRole":"content"}"#,
        )
        .expect("wide JSON integer should reach semantic validation");
        assert_eq!(member.glyph_index, u32::MAX);
    }

    #[test]
    fn keeps_ligature_combining_cjk_and_emoji_shaping_clusters_atomic() {
        let lines = vec![line(vec![
            glyph("fi", (0, 2), (0, 2), "content", (0.0, 12.0)),
            glyph("e", (2, 3), (2, 5), "content", (10.0, 12.0)),
            glyph("◌́", (2, 3), (2, 5), "content", (10.0, 12.0)),
            glyph("漢", (3, 4), (5, 8), "content", (20.0, 12.0)),
            glyph("👨", (4, 5), (8, 33), "content", (30.0, 12.0)),
            glyph("👩", (4, 5), (8, 33), "content", (30.0, 12.0)),
        ])];
        let map = cluster_map(&lines, TextUnitRubyMode::WithBase);
        assert_eq!(map.units.len(), 4);
        let member_counts: Vec<usize> = map.units.iter().map(|unit| unit.members.len()).collect();
        assert_eq!(member_counts, vec![1, 2, 1, 2]);
        assert_eq!((map.units[0].source_start, map.units[0].source_end), (0, 2));
    }

    #[test]
    fn logical_and_physical_visual_orders_are_independent() {
        let lines = vec![line(vec![
            glyph("A", (0, 1), (0, 1), "content", (20.0, 12.0)),
            glyph("B", (1, 2), (1, 2), "content", (0.0, 12.0)),
        ])];
        let map = cluster_map(&lines, TextUnitRubyMode::WithBase);
        let first = map
            .units
            .iter()
            .find(|unit| unit.source_start == 0)
            .expect("first logical unit");
        let second = map
            .units
            .iter()
            .find(|unit| unit.source_start == 1)
            .expect("second logical unit");
        assert_eq!((first.logical_order, second.logical_order), (0, 1));
        assert_eq!((first.visual_order, second.visual_order), (1, 0));
    }

    #[test]
    fn vertical_visual_order_uses_the_inline_y_axis() {
        let lines = vec![line(vec![
            glyph("上", (0, 1), (0, 3), "content", (40.0, 20.0)),
            glyph("下", (1, 2), (3, 6), "content", (40.0, 0.0)),
        ])];
        let map = build_text_unit_map(
            &lines,
            TextUnitKind::Cluster,
            TextUnitRubyMode::WithBase,
            WritingMode::VerticalRl,
        )
        .expect("vertical unit map");
        let first_logical = map
            .units
            .iter()
            .find(|unit| unit.source_start == 0)
            .expect("first logical unit");
        let second_logical = map
            .units
            .iter()
            .find(|unit| unit.source_start == 1)
            .expect("second logical unit");
        assert_eq!(
            (first_logical.logical_order, second_logical.logical_order),
            (0, 1)
        );
        assert_eq!(
            (first_logical.visual_order, second_logical.visual_order),
            (1, 0)
        );
    }

    #[test]
    fn cluster_ids_survive_reflow_while_line_ids_are_layout_local() {
        let glyphs = vec![
            glyph("A", (0, 1), (0, 1), "content", (0.0, 12.0)),
            glyph("B", (1, 2), (1, 2), "content", (10.0, 12.0)),
            glyph("C", (2, 3), (2, 3), "content", (20.0, 12.0)),
            glyph("D", (3, 4), (3, 4), "content", (30.0, 12.0)),
        ];
        let wide = vec![line(glyphs.clone())];
        let narrow = vec![line(glyphs[..2].to_vec()), line(glyphs[2..].to_vec())];
        let wide_clusters = cluster_map(&wide, TextUnitRubyMode::WithBase);
        let narrow_clusters = cluster_map(&narrow, TextUnitRubyMode::WithBase);
        let wide_ids: BTreeSet<&str> = wide_clusters
            .units
            .iter()
            .map(|unit| unit.unit_id.as_str())
            .collect();
        let narrow_ids: BTreeSet<&str> = narrow_clusters
            .units
            .iter()
            .map(|unit| unit.unit_id.as_str())
            .collect();
        assert_eq!(wide_ids, narrow_ids);
        assert_ne!(
            wide_clusters.units[2].line_id,
            narrow_clusters
                .units
                .iter()
                .find(|unit| unit.source_start == 2)
                .expect("reflowed unit")
                .line_id
        );

        let wide_lines = build_text_unit_map(
            &wide,
            TextUnitKind::Line,
            TextUnitRubyMode::WithBase,
            WritingMode::HorizontalTb,
        )
        .expect("wide line map");
        let narrow_lines = build_text_unit_map(
            &narrow,
            TextUnitKind::Line,
            TextUnitRubyMode::WithBase,
            WritingMode::HorizontalTb,
        )
        .expect("narrow line map");
        assert_eq!(wide_lines.units.len(), 1);
        assert_eq!(narrow_lines.units.len(), 2);
        assert_ne!(wide_lines.units[0].unit_id, narrow_lines.units[0].unit_id);
    }

    #[test]
    fn with_base_combines_all_base_and_annotation_clusters() {
        let lines = vec![line(vec![
            glyph("東", (0, 1), (0, 3), "rubyBase", (0.0, 12.0)),
            glyph("京", (1, 2), (3, 6), "rubyBase", (10.0, 12.0)),
            glyph("とう", (0, 2), (0, 6), "rubyAnnotation", (0.0, 4.0)),
            glyph("きょう", (0, 2), (6, 15), "rubyAnnotation", (10.0, 4.0)),
            glyph("駅", (2, 3), (6, 9), "content", (20.0, 12.0)),
        ])];
        let map = cluster_map(&lines, TextUnitRubyMode::WithBase);
        assert_eq!(map.units.len(), 2);
        let ruby = map
            .units
            .iter()
            .find(|unit| unit.source_start == 0)
            .expect("ruby composite");
        assert_eq!(ruby.members.len(), 4);
        assert!(ruby.unit_id.contains("ruby-composite"));
    }

    #[test]
    fn separate_orders_all_base_clusters_before_annotation_clusters() {
        let lines = vec![line(vec![
            glyph("東", (0, 1), (0, 3), "rubyBase", (0.0, 12.0)),
            glyph("京", (1, 2), (3, 6), "rubyBase", (10.0, 12.0)),
            glyph("とう", (0, 2), (0, 6), "rubyAnnotation", (0.0, 4.0)),
            glyph("きょう", (0, 2), (6, 15), "rubyAnnotation", (10.0, 4.0)),
            glyph("駅", (2, 3), (6, 9), "content", (20.0, 12.0)),
        ])];
        let map = cluster_map(&lines, TextUnitRubyMode::Separate);
        assert_eq!(map.units.len(), 5);
        let ordered_roles: Vec<TextUnitSourceRole> = {
            let mut units: Vec<&TextUnitMapEntry> = map.units.iter().collect();
            units.sort_by_key(|unit| unit.logical_order);
            units
                .iter()
                .map(|unit| unit.members[0].source_role)
                .collect()
        };
        assert_eq!(
            ordered_roles,
            vec![
                TextUnitSourceRole::RubyBase,
                TextUnitSourceRole::RubyBase,
                TextUnitSourceRole::RubyAnnotation,
                TextUnitSourceRole::RubyAnnotation,
                TextUnitSourceRole::Content,
            ]
        );
    }

    #[test]
    fn separate_cluster_identity_includes_ruby_association() {
        let narrow_annotation = vec![line(vec![
            glyph("東", (0, 1), (0, 3), "rubyBase", (0.0, 12.0)),
            glyph("とう", (0, 1), (0, 6), "rubyAnnotation", (0.0, 4.0)),
        ])];
        let wide_annotation = vec![line(vec![
            glyph("東", (0, 1), (0, 3), "rubyBase", (0.0, 12.0)),
            glyph("京", (1, 2), (3, 6), "rubyBase", (10.0, 12.0)),
            glyph("とうきょう", (0, 2), (0, 15), "rubyAnnotation", (0.0, 4.0)),
        ])];
        let narrow = cluster_map(&narrow_annotation, TextUnitRubyMode::Separate);
        let wide = cluster_map(&wide_annotation, TextUnitRubyMode::Separate);
        let base_id = |map: &TextUnitMap| {
            map.units
                .iter()
                .find(|unit| {
                    unit.source_start == 0
                        && unit.source_end == 1
                        && unit.members[0].source_role == TextUnitSourceRole::RubyBase
                })
                .expect("ruby base unit")
                .unit_id
                .clone()
        };
        assert_ne!(base_id(&narrow), base_id(&wide));
    }

    #[test]
    fn composite_visual_key_uses_earliest_physical_member() {
        let lines = vec![line(vec![
            glyph("東", (0, 1), (0, 3), "rubyBase", (20.0, 12.0)),
            glyph("とう", (0, 1), (0, 6), "rubyAnnotation", (0.0, 4.0)),
            glyph("駅", (1, 2), (3, 6), "content", (10.0, 12.0)),
        ])];
        let map = cluster_map(&lines, TextUnitRubyMode::WithBase);
        let ruby = map
            .units
            .iter()
            .find(|unit| unit.source_start == 0)
            .expect("ruby unit");
        assert_eq!(ruby.visual_order, 0);
    }

    #[test]
    fn synthetic_ellipsis_is_not_an_authored_unit_member() {
        let authored = glyph("A", (0, 1), (0, 1), "content", (0.0, 12.0));
        let mut marker = glyph("\u{2026}", (1, 1), (1, 4), "content", (10.0, 12.0));
        marker.source_start = None;
        marker.source_end = None;
        marker.source_role = None;
        marker.synthetic_kind = Some("ellipsis".to_string());

        let map = cluster_map(&[line(vec![authored, marker])], TextUnitRubyMode::WithBase);

        assert_eq!(map.units.len(), 1);
        assert_eq!((map.units[0].source_start, map.units[0].source_end), (0, 1));
        assert_eq!(map.units[0].members.len(), 1);
    }

    #[test]
    fn omitted_source_units_are_retained_without_glyph_members() {
        let authored = glyph("A", (0, 1), (0, 1), "content", (0.0, 12.0));
        let mut marker = glyph("\u{2026}", (1, 1), (1, 4), "content", (10.0, 12.0));
        marker.source_start = None;
        marker.source_end = None;
        marker.source_role = None;
        marker.synthetic_kind = Some("ellipsis".to_string());
        let lines = [line(vec![authored, marker])];
        let projection = TextSourceProjection::from_content("ABC");

        let map = build_text_unit_map_internal(
            &lines,
            Some(&projection),
            TextUnitKind::Cluster,
            TextUnitRubyMode::WithBase,
            WritingMode::HorizontalTb,
        )
        .expect("projected unit map");

        assert_eq!(map.units.len(), 3);
        assert_eq!(map.units[0].members.len(), 1);
        assert!(map.units[1].members.is_empty());
        assert!(map.units[2].members.is_empty());
        assert_eq!(
            map.units
                .iter()
                .map(|unit| (unit.source_start, unit.source_end))
                .collect::<Vec<_>>(),
            [(0, 1), (1, 2), (2, 3)]
        );
    }

    #[test]
    fn omitted_ruby_keeps_base_and_annotation_identity() {
        let projection = TextSourceProjection {
            units: vec![
                TextSourceUnit {
                    source_start: 0,
                    source_end: 1,
                    cluster_start: 0,
                    cluster_end: 3,
                    source_role: TextUnitSourceRole::RubyBase,
                    authored_order: 0,
                },
                TextSourceUnit {
                    source_start: 0,
                    source_end: 1,
                    cluster_start: 0,
                    cluster_end: 3,
                    source_role: TextUnitSourceRole::RubyAnnotation,
                    authored_order: 1,
                },
            ],
        };

        let separate = build_text_unit_map_internal(
            &[],
            Some(&projection),
            TextUnitKind::Cluster,
            TextUnitRubyMode::Separate,
            WritingMode::HorizontalTb,
        )
        .expect("separate omitted ruby");
        assert_eq!(separate.units.len(), 2);
        assert!(separate.units.iter().all(|unit| unit.members.is_empty()));

        let with_base = build_text_unit_map_internal(
            &[],
            Some(&projection),
            TextUnitKind::Cluster,
            TextUnitRubyMode::WithBase,
            WritingMode::HorizontalTb,
        )
        .expect("combined omitted ruby");
        assert_eq!(with_base.units.len(), 1);
        assert!(with_base.units[0].members.is_empty());
    }

    #[test]
    fn rejects_missing_or_unknown_source_metadata() {
        let mut missing = glyph("A", (0, 1), (0, 1), "content", (0.0, 0.0));
        missing.source_start = None;
        let error = build_text_unit_map(
            &[line(vec![missing])],
            TextUnitKind::Cluster,
            TextUnitRubyMode::WithBase,
            WritingMode::HorizontalTb,
        )
        .expect_err("missing source range");
        assert_eq!(error.reason, "sourceStart is missing");

        let unknown = glyph("A", (0, 1), (0, 1), "other", (0.0, 0.0));
        let error = build_text_unit_map(
            &[line(vec![unknown])],
            TextUnitKind::Cluster,
            TextUnitRubyMode::WithBase,
            WritingMode::HorizontalTb,
        )
        .expect_err("unknown source role");
        assert_eq!(error.reason, "sourceRole is unknown");

        let visible_without_positions = Line {
            text: "A".to_string(),
            glyphs: Vec::new(),
            width: 10.0,
            baseline_y: 12.0,
            fragments: None,
            positioned_glyphs: None,
        };
        let error = build_text_unit_map(
            &[visible_without_positions],
            TextUnitKind::Cluster,
            TextUnitRubyMode::WithBase,
            WritingMode::HorizontalTb,
        )
        .expect_err("visible lines need positioned glyph metadata");
        assert_eq!(
            error.reason,
            "positionedGlyphs are missing for a visible line"
        );
    }
}
