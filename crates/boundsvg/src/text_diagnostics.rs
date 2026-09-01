use boundtext::{
    FlowRegionError, FlowRegionField, RegionProviderError, RegionQueryError, RegionQueryField,
    TextConstraintField, TextLayoutError, TextLayoutInvariant, TextPreparationPhase,
    TextRequestError,
};
use serde_json::{Map, Value};

use crate::diagnostics::PipelineStage;
use crate::error::EngineError;

const MAX_REQUESTED_ALIASES: usize = 16;
const MAX_ALIAS_BYTES: usize = 256;
const MAX_CONTEXT_BYTES: usize = 4_096;

/// Closed public operation identity carried by every text-layout diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TextLayoutOperation {
    LayoutTextFlow,
    LayoutTextFlowWithExclusions,
    MeasureTextBlock,
    ShrinkwrapText,
    ShrinkwrapFlow,
    MeasureIntrinsicInlineSize,
    RenderTextLayout,
}

impl TextLayoutOperation {
    #[must_use]
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::LayoutTextFlow => "layoutTextFlow",
            Self::LayoutTextFlowWithExclusions => "layoutTextFlowWithExclusions",
            Self::MeasureTextBlock => "measureTextBlock",
            Self::ShrinkwrapText => "shrinkwrapText",
            Self::ShrinkwrapFlow => "shrinkwrapFlow",
            Self::MeasureIntrinsicInlineSize => "measureIntrinsicInlineSize",
            Self::RenderTextLayout => "renderTextLayout",
        }
    }
}

/// Stable classification shared by render and measurement WASM consumers.
#[derive(Debug, Clone)]
pub(crate) struct TextLayoutDiagnostic {
    pub(crate) code: &'static str,
    pub(crate) message: &'static str,
    pub(crate) stage: PipelineStage,
    pub(crate) node_id: Option<String>,
    pub(crate) context: Value,
}

impl TextLayoutDiagnostic {
    #[must_use]
    pub(crate) fn into_engine_error(self) -> EngineError {
        EngineError::StructuredContext {
            code: self.code.to_string(),
            message: self.message.to_string(),
            stage: Some(self.stage),
            node_id: self.node_id,
            context: Box::new(self.context),
        }
    }
}

fn operation_context(operation: TextLayoutOperation) -> Value {
    let mut context = Map::new();
    context.insert(
        "operation".to_string(),
        Value::String(operation.as_str().to_string()),
    );
    Value::Object(context)
}

fn context_map(operation: TextLayoutOperation) -> Map<String, Value> {
    operation_context(operation)
        .as_object()
        .cloned()
        .expect("operation context is an object")
}

fn bounded_prefix(value: &str, maximum_bytes: usize) -> String {
    if value.len() <= maximum_bytes {
        return value.to_string();
    }
    let mut end = maximum_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

fn serialized_context_fits(context: &Value) -> bool {
    serde_json::to_vec(context).is_ok_and(|serialized| serialized.len() <= MAX_CONTEXT_BYTES)
}

fn font_context(
    operation: TextLayoutOperation,
    run_index: usize,
    families: &[String],
    weight: u16,
    style: &crate::font::FontStyle,
) -> Option<Value> {
    let mut requested_aliases = families
        .iter()
        .take(MAX_REQUESTED_ALIASES)
        .map(|alias| bounded_prefix(alias, MAX_ALIAS_BYTES))
        .collect::<Vec<_>>();
    let omitted_alias_count = families.len().saturating_sub(MAX_REQUESTED_ALIASES);

    loop {
        let mut context = context_map(operation);
        context.insert("runIndex".to_string(), Value::from(run_index));
        context.insert(
            "requestedAliases".to_string(),
            Value::Array(
                requested_aliases
                    .iter()
                    .cloned()
                    .map(Value::String)
                    .collect(),
            ),
        );
        context.insert(
            "omittedAliasCount".to_string(),
            Value::from(omitted_alias_count),
        );
        context.insert("fontWeight".to_string(), Value::from(weight));
        context.insert(
            "fontStyle".to_string(),
            Value::String(
                match style {
                    crate::font::FontStyle::Normal => "normal",
                    crate::font::FontStyle::Italic => "italic",
                }
                .to_string(),
            ),
        );
        let value = Value::Object(context);
        if serialized_context_fits(&value) {
            return Some(value);
        }

        let alias_to_shrink = requested_aliases
            .iter_mut()
            .rev()
            .find(|alias| !alias.is_empty())?;
        alias_to_shrink.pop();
    }
}

fn request_reason_context(operation: TextLayoutOperation, reason: TextRequestError) -> Value {
    let mut context = context_map(operation);
    match reason {
        TextRequestError::MissingLineWidths => {
            context.insert(
                "reason".to_string(),
                Value::String("missingLineWidths".to_string()),
            );
        }
        TextRequestError::MissingInlineConstraint { field } => {
            context.insert(
                "reason".to_string(),
                Value::String("missingInlineConstraint".to_string()),
            );
            context.insert(
                "field".to_string(),
                Value::String(text_constraint_field(field).to_string()),
            );
        }
        TextRequestError::ConflictingTextSources => {
            context.insert(
                "reason".to_string(),
                Value::String("conflictingTextSources".to_string()),
            );
        }
        TextRequestError::InvalidRequestShape => {
            context.insert(
                "reason".to_string(),
                Value::String("invalidRequestShape".to_string()),
            );
        }
    }
    Value::Object(context)
}

const fn text_constraint_field(field: TextConstraintField) -> &'static str {
    match field {
        TextConstraintField::MaxWidth => "maxWidth",
        TextConstraintField::LineWidths => "lineWidths",
        TextConstraintField::FlowBounds => "flowBounds",
    }
}

const fn preparation_phase(phase: TextPreparationPhase) -> &'static str {
    match phase {
        TextPreparationPhase::FontResolution => "fontResolution",
        TextPreparationPhase::PlainShaping => "plainShaping",
        TextPreparationPhase::SpanShaping => "spanShaping",
        TextPreparationPhase::RichPreparation => "richPreparation",
        TextPreparationPhase::VerticalLayout => "verticalLayout",
        TextPreparationPhase::FlowPreparation => "flowPreparation",
        TextPreparationPhase::ResultProjection => "resultProjection",
    }
}

const fn region_query_field(field: RegionQueryField) -> &'static str {
    match field {
        RegionQueryField::FlowX => "flowX",
        RegionQueryField::FlowY => "flowY",
        RegionQueryField::FlowWidth => "flowWidth",
        RegionQueryField::FlowHeight => "flowHeight",
        RegionQueryField::CrossStart => "crossStart",
        RegionQueryField::CrossEnd => "crossEnd",
        RegionQueryField::MinimumInlineSize => "minimumInlineSize",
    }
}

fn region_query_context(operation: TextLayoutOperation, reason: RegionQueryError) -> Value {
    let mut context = context_map(operation);
    match reason {
        RegionQueryError::NonFiniteBounds { field } => {
            context.insert(
                "reason".to_string(),
                Value::String("nonFiniteBounds".to_string()),
            );
            context.insert(
                "field".to_string(),
                Value::String(region_query_field(field).to_string()),
            );
        }
        RegionQueryError::NegativeFlowExtent { field } => {
            context.insert(
                "reason".to_string(),
                Value::String("negativeFlowExtent".to_string()),
            );
            context.insert(
                "field".to_string(),
                Value::String(region_query_field(field).to_string()),
            );
        }
        RegionQueryError::ReversedCrossRange => {
            context.insert(
                "reason".to_string(),
                Value::String("reversedCrossRange".to_string()),
            );
        }
        RegionQueryError::NegativeMinimumInlineSize => {
            context.insert(
                "reason".to_string(),
                Value::String("negativeMinimumInlineSize".to_string()),
            );
        }
    }
    Value::Object(context)
}

const fn region_provider_reason(reason: RegionProviderError) -> &'static str {
    match reason {
        RegionProviderError::Unavailable => "unavailable",
        RegionProviderError::UnsupportedQuery => "unsupportedQuery",
        RegionProviderError::ResourceExhausted => "resourceExhausted",
        RegionProviderError::InternalFailure => "internalFailure",
    }
}

const fn flow_region_field(field: FlowRegionField) -> &'static str {
    match field {
        FlowRegionField::InlineStart => "inlineStart",
        FlowRegionField::InlineSize => "inlineSize",
        FlowRegionField::InlineEnd => "inlineEnd",
    }
}

fn flow_region_context(
    operation: TextLayoutOperation,
    index: usize,
    reason: FlowRegionError,
) -> Option<Value> {
    let mut context = context_map(operation);
    context.insert("index".to_string(), Value::from(index));
    match reason {
        FlowRegionError::NonFiniteInterval { field } => {
            context.insert(
                "reason".to_string(),
                Value::String("nonFiniteInterval".to_string()),
            );
            context.insert(
                "field".to_string(),
                Value::String(flow_region_field(field).to_string()),
            );
        }
        FlowRegionError::IntervalBelowMinimum { actual, minimum } => {
            if !actual.is_finite() || !minimum.is_finite() {
                return None;
            }
            context.insert(
                "reason".to_string(),
                Value::String("intervalBelowMinimum".to_string()),
            );
            context.insert("actual".to_string(), Value::from(actual));
            context.insert("minimum".to_string(), Value::from(minimum));
        }
        FlowRegionError::IntervalOutsideFrame {
            start,
            end,
            frame_start,
            frame_end,
        } => {
            if !start.is_finite()
                || !end.is_finite()
                || !frame_start.is_finite()
                || !frame_end.is_finite()
            {
                return None;
            }
            context.insert(
                "reason".to_string(),
                Value::String("intervalOutsideFrame".to_string()),
            );
            context.insert("start".to_string(), Value::from(start));
            context.insert("end".to_string(), Value::from(end));
            context.insert("frameStart".to_string(), Value::from(frame_start));
            context.insert("frameEnd".to_string(), Value::from(frame_end));
        }
        FlowRegionError::OverlappingIntervals {
            previous_end,
            current_start,
        } => {
            if !previous_end.is_finite() || !current_start.is_finite() {
                return None;
            }
            context.insert(
                "reason".to_string(),
                Value::String("overlappingIntervals".to_string()),
            );
            context.insert("previousEnd".to_string(), Value::from(previous_end));
            context.insert("currentStart".to_string(), Value::from(current_start));
        }
    }
    Some(Value::Object(context))
}

const fn invariant_name(invariant: TextLayoutInvariant) -> &'static str {
    match invariant {
        TextLayoutInvariant::LineRangeMissing => "lineRangeMissing",
        TextLayoutInvariant::LineRangeReversed => "lineRangeReversed",
        TextLayoutInvariant::LineRangeOutOfBounds => "lineRangeOutOfBounds",
        TextLayoutInvariant::LineRangeNotUtf8Boundary => "lineRangeNotUtf8Boundary",
        TextLayoutInvariant::FlowMadeNoProgress => "flowMadeNoProgress",
    }
}

/// Exhaustively classify a boundtext-owned layout failure without exposing raw input.
#[must_use]
pub(crate) fn classify_text_layout_error(
    error: &TextLayoutError,
    operation: TextLayoutOperation,
    node_id: Option<String>,
) -> TextLayoutDiagnostic {
    let (code, message, stage, context) = match error {
        TextLayoutError::InvalidRequest { reason } => (
            "TEXT_LAYOUT_INPUT_INVALID",
            "Text layout request is invalid.",
            PipelineStage::Validate,
            Some(request_reason_context(operation, *reason)),
        ),
        TextLayoutError::FontUnavailable {
            run_index,
            families,
            weight,
            style,
        } => (
            "TEXT_FONT_UNAVAILABLE",
            "No requested font is available for text layout.",
            PipelineStage::Text,
            font_context(operation, *run_index, families, *weight, style),
        ),
        TextLayoutError::PreparationFailed { phase } => {
            let mut context = context_map(operation);
            context.insert(
                "phase".to_string(),
                Value::String(preparation_phase(*phase).to_string()),
            );
            (
                "TEXT_LAYOUT_PREPARATION_FAILED",
                "Text layout preparation failed.",
                PipelineStage::Text,
                Some(Value::Object(context)),
            )
        }
        TextLayoutError::InvalidFitStep => (
            "TEXT_FIT_INVALID_STEP",
            "Text fit step is invalid.",
            PipelineStage::Text,
            Some(operation_context(operation)),
        ),
        TextLayoutError::FitProbeLimit { required, limit } => {
            let mut context = context_map(operation);
            context.insert("required".to_string(), Value::from(*required));
            context.insert("limit".to_string(), Value::from(*limit));
            (
                "TEXT_FIT_PROBE_LIMIT",
                "Text fit probe limit was exceeded.",
                PipelineStage::Text,
                Some(Value::Object(context)),
            )
        }
        TextLayoutError::EllipsisCandidateLimit { required, limit } => {
            let mut context = context_map(operation);
            context.insert("required".to_string(), Value::from(*required));
            context.insert("limit".to_string(), Value::from(*limit));
            (
                "TEXT_ELLIPSIS_CANDIDATE_LIMIT",
                "Text ellipsis candidate limit was exceeded.",
                PipelineStage::Text,
                Some(Value::Object(context)),
            )
        }
        TextLayoutError::RichTextDepthLimit { actual, limit } => {
            let mut context = context_map(operation);
            context.insert("actual".to_string(), Value::from(*actual));
            context.insert("limit".to_string(), Value::from(*limit));
            (
                "RICH_TEXT_MAX_DEPTH",
                "Rich text depth limit was exceeded.",
                PipelineStage::Validate,
                Some(Value::Object(context)),
            )
        }
        TextLayoutError::InlineRectLimit { required, limit } => {
            let mut context = context_map(operation);
            context.insert("required".to_string(), Value::from(*required));
            context.insert("limit".to_string(), Value::from(*limit));
            (
                "INLINE_RECT_COMPLEXITY_LIMIT",
                "Inline rectangle limit was exceeded.",
                PipelineStage::Text,
                Some(Value::Object(context)),
            )
        }
        TextLayoutError::InvalidRegionQuery { reason } => (
            "TEXT_REGION_QUERY_INVALID",
            "Text region query is invalid.",
            PipelineStage::Text,
            Some(region_query_context(operation, *reason)),
        ),
        TextLayoutError::RegionProviderFailure { reason } => {
            let mut context = context_map(operation);
            context.insert(
                "reason".to_string(),
                Value::String(region_provider_reason(*reason).to_string()),
            );
            (
                "TEXT_REGION_PROVIDER_FAILED",
                "Text region provider failed.",
                PipelineStage::Text,
                Some(Value::Object(context)),
            )
        }
        TextLayoutError::InvalidFlowRegion { index, reason } => (
            "TEXT_FLOW_REGION_INVALID",
            "Text flow region is invalid.",
            PipelineStage::Text,
            flow_region_context(operation, *index, *reason),
        ),
        TextLayoutError::RegionQueryLimit { limit } => {
            let mut context = context_map(operation);
            context.insert("limit".to_string(), Value::from(*limit));
            (
                "TEXT_REGION_QUERY_LIMIT",
                "Text region query limit was exceeded.",
                PipelineStage::Text,
                Some(Value::Object(context)),
            )
        }
        TextLayoutError::RegionIntervalLimit { required, limit } => {
            let mut context = context_map(operation);
            context.insert("required".to_string(), Value::from(*required));
            context.insert("limit".to_string(), Value::from(*limit));
            (
                "TEXT_REGION_INTERVAL_LIMIT",
                "Text region interval limit was exceeded.",
                PipelineStage::Text,
                Some(Value::Object(context)),
            )
        }
        TextLayoutError::InvariantViolation { invariant } => {
            let mut context = context_map(operation);
            context.insert(
                "invariant".to_string(),
                Value::String(invariant_name(*invariant).to_string()),
            );
            (
                "TEXT_LAYOUT_INVARIANT",
                "Text layout invariant failed.",
                PipelineStage::Text,
                Some(Value::Object(context)),
            )
        }
    };

    let context = context.filter(serialized_context_fits);
    let Some(context) = context else {
        return TextLayoutDiagnostic {
            code: "TEXT_LAYOUT_WASM_FAILED",
            message: "Text layout WASM transport failed.",
            stage: PipelineStage::Wasm,
            node_id,
            context: operation_context(operation),
        };
    };

    TextLayoutDiagnostic {
        code,
        message,
        stage,
        node_id,
        context,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_alias_context_is_utf8_safe_and_bounded() {
        let families = (0..18)
            .map(|index| format!("{index}-{}", "é".repeat(200)))
            .collect::<Vec<_>>();
        let diagnostic = classify_text_layout_error(
            &TextLayoutError::FontUnavailable {
                run_index: 0,
                families,
                weight: 400,
                style: crate::font::FontStyle::Normal,
            },
            TextLayoutOperation::MeasureTextBlock,
            None,
        );

        let aliases = diagnostic.context["requestedAliases"]
            .as_array()
            .expect("requested aliases are an array");
        assert_eq!(aliases.len(), MAX_REQUESTED_ALIASES);
        assert_eq!(diagnostic.context["omittedAliasCount"], 2);
        assert!(aliases.iter().all(|alias| {
            alias
                .as_str()
                .is_some_and(|value| value.len() <= MAX_ALIAS_BYTES)
        }));
        assert!(serialized_context_fits(&diagnostic.context));
    }

    #[test]
    fn non_finite_constructed_region_detail_uses_the_bounded_fallback() {
        let diagnostic = classify_text_layout_error(
            &TextLayoutError::InvalidFlowRegion {
                index: 1,
                reason: FlowRegionError::IntervalBelowMinimum {
                    actual: f64::NAN,
                    minimum: 1.0,
                },
            },
            TextLayoutOperation::LayoutTextFlowWithExclusions,
            Some("node".to_string()),
        );

        assert_eq!(diagnostic.code, "TEXT_LAYOUT_WASM_FAILED");
        assert_eq!(diagnostic.message, "Text layout WASM transport failed.");
        assert_eq!(diagnostic.stage, PipelineStage::Wasm);
        assert_eq!(diagnostic.node_id.as_deref(), Some("node"));
        assert_eq!(
            diagnostic.context,
            serde_json::json!({ "operation": "layoutTextFlowWithExclusions" })
        );
    }
}
