use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::text::types::{TextWarning, TextWarningCode};

const RESERVED_CONTEXT_KEYS: [&str; 6] =
    ["severity", "code", "message", "fallback", "stage", "nodeId"];

/// Closed set of pipeline stages shared with the TypeScript diagnostic contract.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PipelineStage {
    Validate,
    Layout,
    Text,
    Ir,
    Emit,
    Wasm,
    Font,
    Engine,
    Analyzer,
}

impl PipelineStage {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Validate => "validate",
            Self::Layout => "layout",
            Self::Text => "text",
            Self::Ir => "ir",
            Self::Emit => "emit",
            Self::Wasm => "wasm",
            Self::Font => "font",
            Self::Engine => "engine",
            Self::Analyzer => "analyzer",
        }
    }
}

/// Recoverable codes owned by the Rust render pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoverableCode {
    ImageLoadFailed,
    ImageSrcNotEmbedded,
    InlineBoxMaxDepth,
    KinsokuUnresolved,
    LongRubyAnnotation,
    MissingGlyph,
    RubyInterCharacterFallback,
    ShapePartPaintUnknownPart,
    SvgEmbeddedText,
    TextAnimationFragmentCountHigh,
    TextAnimationUnitCountHigh,
    TextDecorationSkipInkLimit,
}

impl RecoverableCode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ImageLoadFailed => "IMAGE_LOAD_FAILED",
            Self::ImageSrcNotEmbedded => "IMAGE_SRC_NOT_EMBEDDED",
            Self::InlineBoxMaxDepth => "INLINE_BOX_MAX_DEPTH",
            Self::KinsokuUnresolved => "KINSOKU_UNRESOLVED",
            Self::LongRubyAnnotation => "LONG_RUBY_ANNOTATION",
            Self::MissingGlyph => "MISSING_GLYPH",
            Self::RubyInterCharacterFallback => "RUBY_INTER_CHARACTER_FALLBACK",
            Self::ShapePartPaintUnknownPart => "SHAPE_PART_PAINT_UNKNOWN_PART",
            Self::SvgEmbeddedText => "SVG_EMBEDDED_TEXT",
            Self::TextAnimationFragmentCountHigh => "TEXT_ANIMATION_FRAGMENT_COUNT_HIGH",
            Self::TextAnimationUnitCountHigh => "TEXT_ANIMATION_UNIT_COUNT_HIGH",
            Self::TextDecorationSkipInkLimit => "TEXT_DECORATION_SKIP_INK_LIMIT",
        }
    }

    const fn policy(self) -> RecoverablePolicy {
        match self {
            Self::ImageLoadFailed => RecoverablePolicy::approved(
                PolicyMode::DelegatedOpaque,
                "Render a placeholder rectangle.",
                "Provide image bytes or a valid data URI.",
            ),
            Self::ImageSrcNotEmbedded => RecoverablePolicy::approved(
                PolicyMode::DelegatedOpaque,
                "Keep the reference for SVG and omit it from raster output.",
                "Provide image bytes or a data URI to embed the image.",
            ),
            Self::InlineBoxMaxDepth => RecoverablePolicy::approved(
                PolicyMode::StrictOwned,
                "Skip the inline box above the supported nesting depth.",
                "Reduce inline-box nesting depth.",
            ),
            Self::KinsokuUnresolved => RecoverablePolicy::approved(
                PolicyMode::DerivedInternal,
                "Use a forced line break.",
                "Adjust the text or available inline size.",
            ),
            Self::LongRubyAnnotation => RecoverablePolicy::approved(
                PolicyMode::DerivedInternal,
                "Render without JLREQ overhang adjustment.",
                "Shorten the annotation or adjust the base text.",
            ),
            Self::MissingGlyph => RecoverablePolicy::approved(
                PolicyMode::DelegatedOpaque,
                "Render the missing glyph as blank.",
                "Provide a font containing the missing glyph.",
            ),
            Self::RubyInterCharacterFallback => RecoverablePolicy::approved(
                PolicyMode::NormalizedOwned,
                "Render inter-character ruby in the over position.",
                "Use a supported ruby position.",
            ),
            Self::ShapePartPaintUnknownPart => RecoverablePolicy::approved(
                PolicyMode::StrictOwned,
                "Ignore the unknown part-paint override.",
                "Use an addressable part id from the compiled shape.",
            ),
            Self::SvgEmbeddedText => RecoverablePolicy::approved(
                PolicyMode::DelegatedOpaque,
                "Pass the embedded SVG text through unchanged.",
                "Convert embedded text to paths for reproducible output.",
            ),
            Self::TextAnimationFragmentCountHigh => RecoverablePolicy::approved(
                PolicyMode::DerivedInternal,
                "Render without truncation up to the declared hard limit.",
                "Reduce the number of animated text fragments.",
            ),
            Self::TextAnimationUnitCountHigh => RecoverablePolicy::approved(
                PolicyMode::DerivedInternal,
                "Render without truncation up to the declared hard limit.",
                "Reduce the number of animated text units.",
            ),
            Self::TextDecorationSkipInkLimit => RecoverablePolicy::approved(
                PolicyMode::DerivedInternal,
                "Render the decoration without skip-ink.",
                "Reduce text-decoration geometry complexity.",
            ),
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum PolicyMode {
    StrictOwned,
    NormalizedOwned,
    DelegatedOpaque,
    DerivedInternal,
}

#[derive(Debug, Clone, Copy)]
struct RecoverablePolicy {
    mode: PolicyMode,
    normative_fallback: &'static str,
    deterministic_output: bool,
    same_output_across_public_paths: bool,
    numeric_approximation: bool,
    user_action: &'static str,
}

impl RecoverablePolicy {
    const fn approved(
        mode: PolicyMode,
        normative_fallback: &'static str,
        user_action: &'static str,
    ) -> Self {
        Self {
            mode,
            normative_fallback,
            deterministic_output: true,
            same_output_across_public_paths: true,
            numeric_approximation: false,
            user_action,
        }
    }

    fn validate(self) -> Result<(), DiagnosticContractError> {
        let mode_is_declared = matches!(
            self.mode,
            PolicyMode::StrictOwned
                | PolicyMode::NormalizedOwned
                | PolicyMode::DelegatedOpaque
                | PolicyMode::DerivedInternal
        );
        if !mode_is_declared
            || self.normative_fallback.trim().is_empty()
            || !self.deterministic_output
            || !self.same_output_across_public_paths
            || self.numeric_approximation
            || self.user_action.trim().is_empty()
        {
            return Err(DiagnosticContractError::IncompleteRecoverablePolicy);
        }
        Ok(())
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DiagnosticContractError {
    #[error("diagnostic code must be stable SCREAMING_SNAKE_CASE")]
    InvalidCode,
    #[error("diagnostic message must not be empty")]
    EmptyMessage,
    #[error("recoverable fallback must not be empty")]
    EmptyFallback,
    #[error("diagnostic context root must be an object")]
    ContextRootNotObject,
    #[error("diagnostic context root contains reserved key {0}")]
    ReservedContextKey(String),
    #[error("recoverable policy is incomplete")]
    IncompleteRecoverablePolicy,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum FatalSeverity {
    Fatal,
}

#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum RecoverableSeverity {
    Recoverable,
}

/// Exact serialized shape for fatal diagnostics crossing the WASM boundary.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedFatalError {
    severity: FatalSeverity,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<PipelineStage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<Value>,
}

impl SerializedFatalError {
    /// Construct and validate a fatal wire diagnostic.
    ///
    /// # Errors
    ///
    /// Returns [`DiagnosticContractError`] when the code, message, or context
    /// does not satisfy the serialized diagnostic contract.
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        stage: Option<PipelineStage>,
        node_id: Option<String>,
        context: Option<Value>,
    ) -> Result<Self, DiagnosticContractError> {
        let diagnostic = Self {
            severity: FatalSeverity::Fatal,
            code: code.into(),
            message: message.into(),
            stage,
            node_id,
            context,
        };
        diagnostic.validate()?;
        Ok(diagnostic)
    }

    /// Validate the fatal wire diagnostic.
    ///
    /// # Errors
    ///
    /// Returns [`DiagnosticContractError`] when a required field is invalid.
    pub fn validate(&self) -> Result<(), DiagnosticContractError> {
        validate_code_and_message(&self.code, &self.message)?;
        validate_context(self.context.as_ref())
    }
}

/// Exact serialized shape for recoverable diagnostics crossing the WASM boundary.
#[cfg_attr(feature = "ir-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedRecoverableError {
    severity: RecoverableSeverity,
    pub code: String,
    pub message: String,
    pub fallback: String,
    pub stage: PipelineStage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<Value>,
}

impl SerializedRecoverableError {
    #[must_use]
    pub(crate) fn recoverable(
        code: RecoverableCode,
        message: impl Into<String>,
        stage: PipelineStage,
        node_id: Option<String>,
        fallback: impl Into<String>,
    ) -> Self {
        let diagnostic = Self {
            severity: RecoverableSeverity::Recoverable,
            code: code.as_str().to_string(),
            message: message.into(),
            fallback: fallback.into(),
            stage,
            node_id,
            context: None,
        };
        assert!(
            diagnostic.validate_for_policy(code).is_ok(),
            "internal recoverable diagnostic must satisfy its approved policy"
        );
        diagnostic
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        code: impl Into<String>,
        message: impl Into<String>,
        stage: PipelineStage,
        node_id: Option<String>,
        fallback: impl Into<String>,
    ) -> Self {
        let diagnostic = Self {
            severity: RecoverableSeverity::Recoverable,
            code: code.into(),
            message: message.into(),
            fallback: fallback.into(),
            stage,
            node_id,
            context: None,
        };
        diagnostic
            .validate()
            .unwrap_or_else(|error| panic!("invalid test recoverable diagnostic: {error}"));
        diagnostic
    }

    /// Validate the recoverable wire diagnostic.
    ///
    /// # Errors
    ///
    /// Returns [`DiagnosticContractError`] when a required field is invalid.
    pub fn validate(&self) -> Result<(), DiagnosticContractError> {
        validate_code_and_message(&self.code, &self.message)?;
        if self.fallback.trim().is_empty() {
            return Err(DiagnosticContractError::EmptyFallback);
        }
        validate_context(self.context.as_ref())
    }

    fn validate_for_policy(&self, code: RecoverableCode) -> Result<(), DiagnosticContractError> {
        self.validate()?;
        code.policy().validate()
    }
}

/// Map a boundtext-owned warning into the single boundsvg recoverable wire type.
#[must_use]
pub(crate) fn text_warning_to_recoverable(
    warning: &TextWarning,
    node_id: Option<String>,
) -> SerializedRecoverableError {
    let code = match warning.code {
        TextWarningCode::InlineBoxMaxDepth => RecoverableCode::InlineBoxMaxDepth,
        TextWarningCode::LongRubyAnnotation => RecoverableCode::LongRubyAnnotation,
        TextWarningCode::MissingGlyph => RecoverableCode::MissingGlyph,
        TextWarningCode::RubyInterCharacterFallback => RecoverableCode::RubyInterCharacterFallback,
    };
    SerializedRecoverableError::recoverable(
        code,
        warning.message.clone(),
        PipelineStage::Text,
        node_id,
        warning.fallback.clone(),
    )
}

fn validate_code_and_message(code: &str, message: &str) -> Result<(), DiagnosticContractError> {
    let first_is_uppercase = code
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_uppercase());
    let segments_are_valid = code.split('_').all(|segment| {
        !segment.is_empty()
            && segment
                .chars()
                .all(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
    });
    if !first_is_uppercase || !segments_are_valid {
        return Err(DiagnosticContractError::InvalidCode);
    }
    if message.trim().is_empty() {
        return Err(DiagnosticContractError::EmptyMessage);
    }
    Ok(())
}

fn validate_context(context: Option<&Value>) -> Result<(), DiagnosticContractError> {
    let Some(context) = context else {
        return Ok(());
    };
    let Some(object) = context.as_object() else {
        return Err(DiagnosticContractError::ContextRootNotObject);
    };
    if let Some(reserved_key) = RESERVED_CONTEXT_KEYS
        .iter()
        .find(|reserved_key| object.contains_key(**reserved_key))
    {
        return Err(DiagnosticContractError::ReservedContextKey(
            (*reserved_key).to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::FontStyle;
    use crate::text_diagnostics::{TextLayoutOperation, classify_text_layout_error};
    use boundtext::{
        FlowRegionError, FlowRegionField, RegionProviderError, RegionQueryError, RegionQueryField,
        TextLayoutError, TextLayoutInvariant, TextPreparationPhase, TextRequestError,
    };
    use serde_json::json;

    #[expect(
        clippy::needless_pass_by_value,
        reason = "catalog tests consume one-shot diagnostic fixtures for readability"
    )]
    fn assert_text_layout_diagnostic(
        error: TextLayoutError,
        expected_code: &str,
        expected_message: &str,
        expected_stage: PipelineStage,
        expected_context: Value,
    ) {
        let diagnostic = classify_text_layout_error(
            &error,
            TextLayoutOperation::MeasureTextBlock,
            Some("text-node".to_string()),
        );
        assert_eq!(diagnostic.code, expected_code);
        assert_eq!(diagnostic.message, expected_message);
        assert_eq!(diagnostic.stage, expected_stage);
        assert_eq!(diagnostic.node_id.as_deref(), Some("text-node"));
        assert_eq!(diagnostic.context, expected_context);
    }

    #[test]
    fn pipeline_stage_serialization_matches_the_typescript_vocabulary() {
        let stages = [
            PipelineStage::Validate,
            PipelineStage::Layout,
            PipelineStage::Text,
            PipelineStage::Ir,
            PipelineStage::Emit,
            PipelineStage::Wasm,
            PipelineStage::Font,
            PipelineStage::Engine,
            PipelineStage::Analyzer,
        ];
        let serialized = serde_json::to_value(stages).expect("serialize stages");
        assert_eq!(
            serialized,
            json!([
                "validate", "layout", "text", "ir", "emit", "wasm", "font", "engine", "analyzer"
            ])
        );
    }

    #[test]
    fn fatal_omits_absent_fields_and_has_no_fallback() {
        let diagnostic = SerializedFatalError::new("TEST_FATAL", "failed", None, None, None)
            .expect("valid fatal diagnostic");
        assert_eq!(
            serde_json::to_value(diagnostic).expect("serialize fatal diagnostic"),
            json!({
                "severity": "fatal",
                "code": "TEST_FATAL",
                "message": "failed"
            })
        );
    }

    #[test]
    fn recoverable_requires_stage_and_fallback_in_its_serialized_shape() {
        let diagnostic = SerializedRecoverableError::recoverable(
            RecoverableCode::ImageLoadFailed,
            "image failed",
            PipelineStage::Ir,
            Some("image".to_string()),
            "placeholder_rect",
        );
        assert_eq!(
            serde_json::to_value(diagnostic).expect("serialize recoverable diagnostic"),
            json!({
                "severity": "recoverable",
                "code": "IMAGE_LOAD_FAILED",
                "message": "image failed",
                "fallback": "placeholder_rect",
                "stage": "ir",
                "nodeId": "image"
            })
        );
    }

    #[test]
    fn context_rejects_non_object_roots_and_reserved_root_keys() {
        let non_object =
            SerializedFatalError::new("TEST_FATAL", "failed", None, None, Some(json!(["invalid"])));
        assert_eq!(
            non_object.expect_err("array context must fail"),
            DiagnosticContractError::ContextRootNotObject
        );

        let reserved = SerializedFatalError::new(
            "TEST_FATAL",
            "failed",
            None,
            None,
            Some(json!({ "stage": "nested duplicate" })),
        );
        assert_eq!(
            reserved.expect_err("reserved context key must fail"),
            DiagnosticContractError::ReservedContextKey("stage".to_string())
        );

        SerializedFatalError::new(
            "TEST_FATAL",
            "failed",
            None,
            None,
            Some(json!({ "nested": { "stage": "allowed" } })),
        )
        .expect("reserved names below the context root remain valid");
    }

    #[test]
    fn code_validation_matches_the_typescript_screaming_snake_case_pattern() {
        for code in ["_LEADING", "TRAILING_", "DOUBLE__SEPARATOR", "lowercase"] {
            assert_eq!(
                SerializedFatalError::new(code, "failed", None, None, None)
                    .expect_err("invalid code must fail"),
                DiagnosticContractError::InvalidCode
            );
        }
        SerializedFatalError::new("VALID_CODE_2", "failed", None, None, None).expect("valid code");
    }

    #[test]
    fn text_layout_operation_vocabulary_is_closed_and_camel_case() {
        let operations = [
            TextLayoutOperation::LayoutTextFlow,
            TextLayoutOperation::LayoutTextFlowWithExclusions,
            TextLayoutOperation::MeasureTextBlock,
            TextLayoutOperation::ShrinkwrapText,
            TextLayoutOperation::ShrinkwrapFlow,
            TextLayoutOperation::MeasureIntrinsicInlineSize,
            TextLayoutOperation::RenderTextLayout,
        ];
        assert_eq!(
            operations.map(TextLayoutOperation::as_str),
            [
                "layoutTextFlow",
                "layoutTextFlowWithExclusions",
                "measureTextBlock",
                "shrinkwrapText",
                "shrinkwrapFlow",
                "measureIntrinsicInlineSize",
                "renderTextLayout",
            ]
        );
    }

    #[test]
    fn text_layout_projection_matches_the_stable_catalog() {
        let operation = "measureTextBlock";
        assert_text_layout_diagnostic(
            TextLayoutError::InvalidRequest {
                reason: TextRequestError::MissingLineWidths,
            },
            "TEXT_LAYOUT_INPUT_INVALID",
            "Text layout request is invalid.",
            PipelineStage::Validate,
            json!({ "operation": operation, "reason": "missingLineWidths" }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::FontUnavailable {
                run_index: 2,
                families: vec!["Missing".to_string()],
                weight: 500,
                style: FontStyle::Italic,
            },
            "TEXT_FONT_UNAVAILABLE",
            "No requested font is available for text layout.",
            PipelineStage::Text,
            json!({
                "operation": operation,
                "runIndex": 2,
                "requestedAliases": ["Missing"],
                "omittedAliasCount": 0,
                "fontWeight": 500,
                "fontStyle": "italic",
            }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::PreparationFailed {
                phase: TextPreparationPhase::RichPreparation,
            },
            "TEXT_LAYOUT_PREPARATION_FAILED",
            "Text layout preparation failed.",
            PipelineStage::Text,
            json!({ "operation": operation, "phase": "richPreparation" }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::InvalidFitStep,
            "TEXT_FIT_INVALID_STEP",
            "Text fit step is invalid.",
            PipelineStage::Text,
            json!({ "operation": operation }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::FitProbeLimit {
                required: 3,
                limit: 2,
            },
            "TEXT_FIT_PROBE_LIMIT",
            "Text fit probe limit was exceeded.",
            PipelineStage::Text,
            json!({ "operation": operation, "required": 3, "limit": 2 }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::EllipsisCandidateLimit {
                required: 3,
                limit: 2,
            },
            "TEXT_ELLIPSIS_CANDIDATE_LIMIT",
            "Text ellipsis candidate limit was exceeded.",
            PipelineStage::Text,
            json!({ "operation": operation, "required": 3, "limit": 2 }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::RichTextDepthLimit {
                actual: 49,
                limit: 48,
            },
            "RICH_TEXT_MAX_DEPTH",
            "Rich text depth limit was exceeded.",
            PipelineStage::Validate,
            json!({ "operation": operation, "actual": 49, "limit": 48 }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::InlineRectLimit {
                required: 4_097,
                limit: 4_096,
            },
            "INLINE_RECT_COMPLEXITY_LIMIT",
            "Inline rectangle limit was exceeded.",
            PipelineStage::Text,
            json!({ "operation": operation, "required": 4097, "limit": 4096 }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::InvalidRegionQuery {
                reason: RegionQueryError::NonFiniteBounds {
                    field: RegionQueryField::CrossStart,
                },
            },
            "TEXT_REGION_QUERY_INVALID",
            "Text region query is invalid.",
            PipelineStage::Text,
            json!({ "operation": operation, "reason": "nonFiniteBounds", "field": "crossStart" }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::RegionProviderFailure {
                reason: RegionProviderError::UnsupportedQuery,
            },
            "TEXT_REGION_PROVIDER_FAILED",
            "Text region provider failed.",
            PipelineStage::Text,
            json!({ "operation": operation, "reason": "unsupportedQuery" }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::InvalidFlowRegion {
                index: 3,
                reason: FlowRegionError::NonFiniteInterval {
                    field: FlowRegionField::InlineStart,
                },
            },
            "TEXT_FLOW_REGION_INVALID",
            "Text flow region is invalid.",
            PipelineStage::Text,
            json!({
                "operation": operation,
                "reason": "nonFiniteInterval",
                "index": 3,
                "field": "inlineStart",
            }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::InvalidFlowRegion {
                index: 3,
                reason: FlowRegionError::IntervalBelowMinimum {
                    actual: 1.0,
                    minimum: 2.0,
                },
            },
            "TEXT_FLOW_REGION_INVALID",
            "Text flow region is invalid.",
            PipelineStage::Text,
            json!({
                "operation": operation,
                "reason": "intervalBelowMinimum",
                "index": 3,
                "actual": 1.0,
                "minimum": 2.0,
            }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::InvalidFlowRegion {
                index: 3,
                reason: FlowRegionError::IntervalOutsideFrame {
                    start: 1.0,
                    end: 3.0,
                    frame_start: 0.0,
                    frame_end: 2.0,
                },
            },
            "TEXT_FLOW_REGION_INVALID",
            "Text flow region is invalid.",
            PipelineStage::Text,
            json!({
                "operation": operation,
                "reason": "intervalOutsideFrame",
                "index": 3,
                "start": 1.0,
                "end": 3.0,
                "frameStart": 0.0,
                "frameEnd": 2.0,
            }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::InvalidFlowRegion {
                index: 3,
                reason: FlowRegionError::OverlappingIntervals {
                    previous_end: 2.0,
                    current_start: 1.0,
                },
            },
            "TEXT_FLOW_REGION_INVALID",
            "Text flow region is invalid.",
            PipelineStage::Text,
            json!({
                "operation": operation,
                "reason": "overlappingIntervals",
                "index": 3,
                "previousEnd": 2.0,
                "currentStart": 1.0,
            }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::RegionQueryLimit { limit: 4 },
            "TEXT_REGION_QUERY_LIMIT",
            "Text region query limit was exceeded.",
            PipelineStage::Text,
            json!({ "operation": operation, "limit": 4 }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::RegionIntervalLimit {
                required: 5,
                limit: 4,
            },
            "TEXT_REGION_INTERVAL_LIMIT",
            "Text region interval limit was exceeded.",
            PipelineStage::Text,
            json!({ "operation": operation, "required": 5, "limit": 4 }),
        );
        assert_text_layout_diagnostic(
            TextLayoutError::InvariantViolation {
                invariant: TextLayoutInvariant::LineRangeNotUtf8Boundary,
            },
            "TEXT_LAYOUT_INVARIANT",
            "Text layout invariant failed.",
            PipelineStage::Text,
            json!({ "operation": operation, "invariant": "lineRangeNotUtf8Boundary" }),
        );
    }
}
