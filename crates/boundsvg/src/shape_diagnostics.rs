use std::panic::AssertUnwindSafe;

use boundshape::{
    CompiledGeometryPart, DivideRegions, EvaluatedPart, GeometryDoc, GeometryIntersection,
    GeometryNode, PartBounds, PartHit, Region, ShapeError,
};
use serde::de::{DeserializeOwned, IgnoredAny};
use serde_json::{Map, Value};
use wasm_bindgen::JsValue;

use crate::diagnostics::{PipelineStage, SerializedFatalError};
use crate::error::EngineError;

const MAX_PART_ID_PREFIX_BYTES: usize = 256;
const MAX_SHAPE_CONTEXT_BYTES: usize = 4096;
const MAX_SHAPE_ENVELOPE_BYTES: usize = 8192;
const COMPILE_SHAPE_FALLBACK: &str = r#"{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"compileShapeSvg"}}"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShapeOperation {
    CompileShapeSvg,
    HitTestShapeParts,
    CompileShapePaths,
    ResolveSymbolGeometry,
    EvaluateShapeParts,
    EvaluateShapeRegion,
    RenderShapeRegionSvg,
    DivideShapeRegions,
    ComputeShapeIntersections,
    RenderShape,
    RenderSymbol,
}

impl ShapeOperation {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::CompileShapeSvg => "compileShapeSvg",
            Self::HitTestShapeParts => "hitTestShapeParts",
            Self::CompileShapePaths => "compileShapePaths",
            Self::ResolveSymbolGeometry => "resolveSymbolGeometry",
            Self::EvaluateShapeParts => "evaluateShapeParts",
            Self::EvaluateShapeRegion => "evaluateShapeRegion",
            Self::RenderShapeRegionSvg => "renderShapeRegionSvg",
            Self::DivideShapeRegions => "divideShapeRegions",
            Self::ComputeShapeIntersections => "computeShapeIntersections",
            Self::RenderShape => "renderShape",
            Self::RenderSymbol => "renderSymbol",
        }
    }

    const fn standalone_fallback(self) -> Option<&'static str> {
        match self {
            Self::CompileShapeSvg => Some(COMPILE_SHAPE_FALLBACK),
            Self::HitTestShapeParts => Some(
                r#"{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"hitTestShapeParts"}}"#,
            ),
            Self::CompileShapePaths => Some(
                r#"{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"compileShapePaths"}}"#,
            ),
            Self::ResolveSymbolGeometry => Some(
                r#"{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"resolveSymbolGeometry"}}"#,
            ),
            Self::EvaluateShapeParts => Some(
                r#"{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"evaluateShapeParts"}}"#,
            ),
            Self::EvaluateShapeRegion => Some(
                r#"{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"evaluateShapeRegion"}}"#,
            ),
            Self::RenderShapeRegionSvg => Some(
                r#"{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"renderShapeRegionSvg"}}"#,
            ),
            Self::DivideShapeRegions => Some(
                r#"{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"divideShapeRegions"}}"#,
            ),
            Self::ComputeShapeIntersections => Some(
                r#"{"severity":"fatal","code":"SHAPE_WASM_FAILED","message":"Shape operation WASM transport failed.","stage":"wasm","context":{"operation":"computeShapeIntersections"}}"#,
            ),
            Self::RenderShape | Self::RenderSymbol => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShapeOperand {
    Lhs,
    Rhs,
}

impl ShapeOperand {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Lhs => "lhs",
            Self::Rhs => "rhs",
        }
    }
}

pub(crate) struct ShapeOperationFailure {
    error: ShapeError,
    operand: Option<ShapeOperand>,
}

impl ShapeOperationFailure {
    pub(crate) fn for_operand(error: ShapeError, operand: ShapeOperand) -> Self {
        Self {
            error,
            operand: Some(operand),
        }
    }
}

impl From<ShapeError> for ShapeOperationFailure {
    fn from(error: ShapeError) -> Self {
        Self {
            error,
            operand: None,
        }
    }
}

pub(crate) enum ShapeOperationOutput {
    RawSvg(String),
    Hits(Vec<PartHit>),
    CompiledPaths(Vec<CompiledGeometryPart>),
    Geometry(GeometryDoc),
    Parts(Vec<EvaluatedPart>),
    Region(Region),
    Divide(DivideRegions),
    Intersections(Vec<GeometryIntersection>),
}

#[derive(Debug)]
pub(crate) struct ShapeDiagnostic {
    code: &'static str,
    message: &'static str,
    stage: PipelineStage,
    context: Value,
}

impl ShapeDiagnostic {
    fn into_engine_error(self, node_id: &str) -> EngineError {
        EngineError::StructuredContext {
            code: self.code.to_string(),
            message: self.message.to_string(),
            stage: Some(self.stage),
            node_id: Some(node_id.to_string()),
            context: Box::new(self.context),
        }
    }
}

pub(crate) fn shape_error_to_engine_error(
    error: &ShapeError,
    operation: ShapeOperation,
    node_id: &str,
) -> EngineError {
    classify_shape_error(error, operation, None).into_engine_error(node_id)
}

fn bounded_part_id(value: &str) -> (&str, usize) {
    if value.len() <= MAX_PART_ID_PREFIX_BYTES {
        return (value, 0);
    }
    let mut prefix_end = MAX_PART_ID_PREFIX_BYTES;
    while !value.is_char_boundary(prefix_end) {
        prefix_end -= 1;
    }
    (&value[..prefix_end], value.len() - prefix_end)
}

fn shape_context(operation: ShapeOperation, operand: Option<ShapeOperand>) -> Map<String, Value> {
    let mut context = Map::new();
    context.insert(
        "operation".to_string(),
        Value::String(operation.as_str().to_string()),
    );
    if let Some(shape_operand) = operand {
        context.insert(
            "operand".to_string(),
            Value::String(shape_operand.as_str().to_string()),
        );
    }
    context
}

fn finish_shape_diagnostic(
    code: &'static str,
    message: &'static str,
    stage: PipelineStage,
    context: Map<String, Value>,
) -> ShapeDiagnostic {
    let context = Value::Object(context);
    debug_assert!(
        serde_json::to_vec(&context).is_ok_and(|bytes| bytes.len() <= MAX_SHAPE_CONTEXT_BYTES),
        "shape diagnostic context must remain within its wire ceiling"
    );
    ShapeDiagnostic {
        code,
        message,
        stage,
        context,
    }
}

pub(crate) fn classify_shape_error(
    error: &ShapeError,
    operation: ShapeOperation,
    operand: Option<ShapeOperand>,
) -> ShapeDiagnostic {
    let mut context = shape_context(operation, operand);
    let (code, message, stage) = match error {
        ShapeError::BooleanChildCount => (
            "SHAPE_BOOLEAN_CHILD_COUNT",
            "Shape boolean nodes require at least two children.",
            PipelineStage::Validate,
        ),
        ShapeError::InvalidPathData => (
            "SHAPE_PATH_DATA_INVALID",
            "Shape path data is invalid.",
            PipelineStage::Validate,
        ),
        ShapeError::UnsupportedPathCommand(command) => {
            context.insert("command".to_string(), Value::String(command.to_string()));
            (
                "SHAPE_PATH_COMMAND_UNSUPPORTED",
                "Shape path data uses an unsupported command.",
                PipelineStage::Validate,
            )
        }
        ShapeError::BooleanTopology => (
            "SHAPE_BOOLEAN_TOPOLOGY_FAILED",
            "Shape boolean evaluation could not reconstruct a closed boundary.",
            PipelineStage::Ir,
        ),
        ShapeError::DuplicatePartId(part_id) => {
            let (part_id_prefix, omitted_byte_count) = bounded_part_id(part_id);
            context.insert(
                "partIdPrefix".to_string(),
                Value::String(part_id_prefix.to_string()),
            );
            context.insert(
                "omittedPartIdByteCount".to_string(),
                Value::from(omitted_byte_count),
            );
            (
                "SHAPE_DUPLICATE_PART_ID",
                "Shape contains a duplicate addressable part id.",
                PipelineStage::Validate,
            )
        }
        ShapeError::GeometryDepthLimit { actual, limit } => {
            context.insert("actual".to_string(), Value::from(*actual));
            context.insert("limit".to_string(), Value::from(*limit));
            (
                "SHAPE_GEOMETRY_MAX_DEPTH",
                "Shape geometry exceeds the maximum tree depth.",
                PipelineStage::Validate,
            )
        }
        ShapeError::PathMeasureMultipleSubpaths => (
            "SHAPE_PATH_MULTIPLE_SUBPATHS",
            "Shape path measurement requires exactly one drawable subpath.",
            PipelineStage::Validate,
        ),
        ShapeError::PathMeasureZeroLength => (
            "SHAPE_PATH_ZERO_LENGTH",
            "Shape path measurement requires a non-zero path length.",
            PipelineStage::Validate,
        ),
        ShapeError::PathMeasureComplexityLimit => (
            "SHAPE_PATH_COMPLEXITY_LIMIT",
            "Shape path measurement exceeded its complexity limit.",
            PipelineStage::Ir,
        ),
        ShapeError::PathOffsetGeometry => (
            "SHAPE_PATH_OFFSET_GEOMETRY_INVALID",
            "Shape path offset geometry could not be materialized.",
            PipelineStage::Ir,
        ),
        ShapeError::PathOffsetSampleLimit => (
            "SHAPE_PATH_OFFSET_SAMPLE_LIMIT",
            "Shape path offset sampling exceeded its complexity limit.",
            PipelineStage::Ir,
        ),
        ShapeError::BooleanPairLimit => (
            "SHAPE_BOOLEAN_PAIR_LIMIT",
            "Shape boolean evaluation exceeded its pair limit.",
            PipelineStage::Ir,
        ),
        ShapeError::RegionClipInterval => (
            "SHAPE_REGION_CLIP_INTERVAL_INVALID",
            "Shape region clipping requires a finite increasing interval.",
            PipelineStage::Validate,
        ),
        ShapeError::RegionClipNonMonotonic => (
            "SHAPE_REGION_CLIP_NON_MONOTONIC",
            "Shape region clipping requires axis-monotonic contour segments.",
            PipelineStage::Validate,
        ),
        ShapeError::NonFiniteOutput => {
            context.insert("phase".to_string(), Value::String("serialize".to_string()));
            (
                "SHAPE_OUTPUT_INVALID",
                "Shape operation returned invalid output.",
                PipelineStage::Wasm,
            )
        }
    };
    finish_shape_diagnostic(code, message, stage, context)
}

fn input_diagnostic(operation: ShapeOperation, reason: &'static str) -> ShapeDiagnostic {
    let mut context = shape_context(operation, None);
    context.insert("reason".to_string(), Value::String(reason.to_string()));
    finish_shape_diagnostic(
        "SHAPE_INPUT_INVALID",
        "Shape operation input is invalid.",
        PipelineStage::Validate,
        context,
    )
}

fn output_diagnostic(operation: ShapeOperation) -> ShapeDiagnostic {
    let mut context = shape_context(operation, None);
    context.insert("phase".to_string(), Value::String("serialize".to_string()));
    finish_shape_diagnostic(
        "SHAPE_OUTPUT_INVALID",
        "Shape operation returned invalid output.",
        PipelineStage::Wasm,
        context,
    )
}

fn panic_diagnostic(operation: ShapeOperation) -> ShapeDiagnostic {
    finish_shape_diagnostic(
        "SHAPE_PANIC",
        "Shape operation failed unexpectedly.",
        PipelineStage::Wasm,
        shape_context(operation, None),
    )
}

fn serialize_shape_diagnostic(diagnostic: ShapeDiagnostic, operation: ShapeOperation) -> String {
    let serialized = SerializedFatalError::new(
        diagnostic.code,
        diagnostic.message,
        Some(diagnostic.stage),
        None,
        Some(diagnostic.context),
    )
    .ok()
    .and_then(|wire_diagnostic| serde_json::to_string(&wire_diagnostic).ok())
    .filter(|envelope| envelope.len() <= MAX_SHAPE_ENVELOPE_BYTES);
    serialized.unwrap_or_else(|| {
        operation
            .standalone_fallback()
            .unwrap_or(COMPILE_SHAPE_FALLBACK)
            .to_string()
    })
}

fn shape_diagnostic_to_js(diagnostic: ShapeDiagnostic, operation: ShapeOperation) -> JsValue {
    JsValue::from_str(&serialize_shape_diagnostic(diagnostic, operation))
}

fn ensure_finite(values: impl IntoIterator<Item = f64>) -> Result<(), ShapeError> {
    if values.into_iter().all(f64::is_finite) {
        Ok(())
    } else {
        Err(ShapeError::NonFiniteOutput)
    }
}

fn validate_part_bounds(bounds: &PartBounds) -> Result<(), ShapeError> {
    ensure_finite([bounds.x, bounds.y, bounds.width, bounds.height])
}

fn validate_region(region: &Region) -> Result<(), ShapeError> {
    for contour in &region.contours {
        for segment in &contour.segments {
            match segment {
                boundshape::CurveSegment::Line {
                    p0: start_point,
                    p1: end_point,
                } => {
                    ensure_finite([start_point.x, start_point.y, end_point.x, end_point.y])?;
                }
                boundshape::CurveSegment::Quad {
                    p0: start_point,
                    p1: control_point,
                    p2: end_point,
                } => {
                    ensure_finite([
                        start_point.x,
                        start_point.y,
                        control_point.x,
                        control_point.y,
                        end_point.x,
                        end_point.y,
                    ])?;
                }
                boundshape::CurveSegment::Cubic {
                    p0: start_point,
                    p1: first_control_point,
                    p2: second_control_point,
                    p3: end_point,
                } => {
                    ensure_finite([
                        start_point.x,
                        start_point.y,
                        first_control_point.x,
                        first_control_point.y,
                        second_control_point.x,
                        second_control_point.y,
                        end_point.x,
                        end_point.y,
                    ])?;
                }
            }
        }
    }
    Ok(())
}

fn validate_geometry(geometry: &GeometryDoc) -> Result<(), ShapeError> {
    ensure_finite([
        geometry.view_box.x,
        geometry.view_box.y,
        geometry.view_box.width,
        geometry.view_box.height,
    ])?;
    let mut pending_nodes = vec![&geometry.root];
    while let Some(node) = pending_nodes.pop() {
        match node {
            GeometryNode::Path { .. } => {}
            GeometryNode::Group { children, .. } | GeometryNode::Boolean { children, .. } => {
                pending_nodes.extend(children);
            }
            GeometryNode::Transform {
                transform, child, ..
            } => {
                ensure_finite(
                    [
                        transform.translate_x,
                        transform.translate_y,
                        transform.scale_x,
                        transform.scale_y,
                        transform.rotate_deg,
                        transform.origin_x,
                        transform.origin_y,
                    ]
                    .into_iter()
                    .flatten(),
                )?;
                pending_nodes.push(child);
            }
        }
    }
    Ok(())
}

fn validate_compiled_paths(parts: &[CompiledGeometryPart]) -> Result<(), ShapeError> {
    for compiled_part in parts {
        if let Some(bounds) = &compiled_part.bounds {
            validate_part_bounds(bounds)?;
        }
    }
    Ok(())
}

fn validate_evaluated_parts(parts: &[EvaluatedPart]) -> Result<(), ShapeError> {
    for evaluated_part in parts {
        validate_region(&evaluated_part.region)?;
        validate_region(&evaluated_part.stroke_region)?;
        if let Some(bounds) = &evaluated_part.bounds {
            validate_part_bounds(bounds)?;
        }
    }
    Ok(())
}

fn validate_intersections(intersections: &[GeometryIntersection]) -> Result<(), ShapeError> {
    for intersection in intersections {
        ensure_finite([
            intersection.point.x,
            intersection.point.y,
            intersection.t_a,
            intersection.t_b,
        ])?;
    }
    Ok(())
}

fn serialize_json_output<T: serde::Serialize>(
    output: &T,
    operation: ShapeOperation,
) -> Result<String, ShapeDiagnostic> {
    serde_json::to_string(output).map_err(|_| output_diagnostic(operation))
}

impl ShapeOperationOutput {
    fn serialize_checked(self, operation: ShapeOperation) -> Result<String, ShapeDiagnostic> {
        match self {
            Self::RawSvg(svg) => Ok(svg),
            Self::Hits(hits) => serialize_json_output(&hits, operation),
            Self::CompiledPaths(parts) => {
                validate_compiled_paths(&parts)
                    .map_err(|error| classify_shape_error(&error, operation, None))?;
                serialize_json_output(&parts, operation)
            }
            Self::Geometry(geometry) => {
                validate_geometry(&geometry)
                    .map_err(|error| classify_shape_error(&error, operation, None))?;
                serialize_json_output(&geometry, operation)
            }
            Self::Parts(parts) => {
                validate_evaluated_parts(&parts)
                    .map_err(|error| classify_shape_error(&error, operation, None))?;
                serialize_json_output(&parts, operation)
            }
            Self::Region(region) => {
                validate_region(&region)
                    .map_err(|error| classify_shape_error(&error, operation, None))?;
                serialize_json_output(&region, operation)
            }
            Self::Divide(divided_regions) => {
                validate_region(&divided_regions.subtract)
                    .and_then(|()| validate_region(&divided_regions.intersect))
                    .map_err(|error| classify_shape_error(&error, operation, None))?;
                serialize_json_output(&divided_regions, operation)
            }
            Self::Intersections(intersections) => {
                validate_intersections(&intersections)
                    .map_err(|error| classify_shape_error(&error, operation, None))?;
                serialize_json_output(&intersections, operation)
            }
        }
    }
}

pub(crate) fn run_shape_wasm_operation<Input, Run>(
    operation: ShapeOperation,
    json_input: &str,
    run: Run,
) -> Result<String, JsValue>
where
    Input: DeserializeOwned,
    Run: FnOnce(Input) -> Result<ShapeOperationOutput, ShapeOperationFailure>,
{
    assert!(
        operation.standalone_fallback().is_some(),
        "render-only operation cannot use the standalone shape runner"
    );
    run_shape_operation(operation, json_input, run)
        .map_err(|diagnostic| shape_diagnostic_to_js(diagnostic, operation))
}

fn run_shape_operation<Input, Run>(
    operation: ShapeOperation,
    json_input: &str,
    run: Run,
) -> Result<String, ShapeDiagnostic>
where
    Input: DeserializeOwned,
    Run: FnOnce(Input) -> Result<ShapeOperationOutput, ShapeOperationFailure>,
{
    let operation_result = std::panic::catch_unwind(AssertUnwindSafe(|| {
        serde_json::from_str::<IgnoredAny>(json_input)
            .map_err(|_| input_diagnostic(operation, "malformedJson"))?;
        let input = serde_json::from_str::<Input>(json_input)
            .map_err(|_| input_diagnostic(operation, "invalidRequestShape"))?;
        let output = run(input)
            .map_err(|failure| classify_shape_error(&failure.error, operation, failure.operand))?;
        output.serialize_checked(operation)
    }));
    match operation_result {
        Ok(result) => result,
        Err(_) => Err(panic_diagnostic(operation)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standalone_operations() -> [ShapeOperation; 9] {
        [
            ShapeOperation::CompileShapeSvg,
            ShapeOperation::HitTestShapeParts,
            ShapeOperation::CompileShapePaths,
            ShapeOperation::ResolveSymbolGeometry,
            ShapeOperation::EvaluateShapeParts,
            ShapeOperation::EvaluateShapeRegion,
            ShapeOperation::RenderShapeRegionSvg,
            ShapeOperation::DivideShapeRegions,
            ShapeOperation::ComputeShapeIntersections,
        ]
    }

    #[test]
    fn error_catalog_has_exact_fixed_projection() {
        let rows = [
            (
                ShapeError::BooleanChildCount,
                "SHAPE_BOOLEAN_CHILD_COUNT",
                "Shape boolean nodes require at least two children.",
                PipelineStage::Validate,
                serde_json::json!({ "operation": "compileShapePaths" }),
            ),
            (
                ShapeError::InvalidPathData,
                "SHAPE_PATH_DATA_INVALID",
                "Shape path data is invalid.",
                PipelineStage::Validate,
                serde_json::json!({ "operation": "compileShapePaths" }),
            ),
            (
                ShapeError::UnsupportedPathCommand('X'),
                "SHAPE_PATH_COMMAND_UNSUPPORTED",
                "Shape path data uses an unsupported command.",
                PipelineStage::Validate,
                serde_json::json!({ "operation": "compileShapePaths", "command": "X" }),
            ),
            (
                ShapeError::BooleanTopology,
                "SHAPE_BOOLEAN_TOPOLOGY_FAILED",
                "Shape boolean evaluation could not reconstruct a closed boundary.",
                PipelineStage::Ir,
                serde_json::json!({ "operation": "compileShapePaths" }),
            ),
            (
                ShapeError::DuplicatePartId("face".to_string()),
                "SHAPE_DUPLICATE_PART_ID",
                "Shape contains a duplicate addressable part id.",
                PipelineStage::Validate,
                serde_json::json!({
                    "operation": "compileShapePaths",
                    "partIdPrefix": "face",
                    "omittedPartIdByteCount": 0,
                }),
            ),
            (
                ShapeError::GeometryDepthLimit {
                    actual: 49,
                    limit: 48,
                },
                "SHAPE_GEOMETRY_MAX_DEPTH",
                "Shape geometry exceeds the maximum tree depth.",
                PipelineStage::Validate,
                serde_json::json!({
                    "operation": "compileShapePaths",
                    "actual": 49,
                    "limit": 48,
                }),
            ),
            (
                ShapeError::PathMeasureMultipleSubpaths,
                "SHAPE_PATH_MULTIPLE_SUBPATHS",
                "Shape path measurement requires exactly one drawable subpath.",
                PipelineStage::Validate,
                serde_json::json!({ "operation": "compileShapePaths" }),
            ),
            (
                ShapeError::PathMeasureZeroLength,
                "SHAPE_PATH_ZERO_LENGTH",
                "Shape path measurement requires a non-zero path length.",
                PipelineStage::Validate,
                serde_json::json!({ "operation": "compileShapePaths" }),
            ),
            (
                ShapeError::PathMeasureComplexityLimit,
                "SHAPE_PATH_COMPLEXITY_LIMIT",
                "Shape path measurement exceeded its complexity limit.",
                PipelineStage::Ir,
                serde_json::json!({ "operation": "compileShapePaths" }),
            ),
            (
                ShapeError::PathOffsetGeometry,
                "SHAPE_PATH_OFFSET_GEOMETRY_INVALID",
                "Shape path offset geometry could not be materialized.",
                PipelineStage::Ir,
                serde_json::json!({ "operation": "compileShapePaths" }),
            ),
            (
                ShapeError::PathOffsetSampleLimit,
                "SHAPE_PATH_OFFSET_SAMPLE_LIMIT",
                "Shape path offset sampling exceeded its complexity limit.",
                PipelineStage::Ir,
                serde_json::json!({ "operation": "compileShapePaths" }),
            ),
            (
                ShapeError::BooleanPairLimit,
                "SHAPE_BOOLEAN_PAIR_LIMIT",
                "Shape boolean evaluation exceeded its pair limit.",
                PipelineStage::Ir,
                serde_json::json!({ "operation": "compileShapePaths" }),
            ),
            (
                ShapeError::RegionClipInterval,
                "SHAPE_REGION_CLIP_INTERVAL_INVALID",
                "Shape region clipping requires a finite increasing interval.",
                PipelineStage::Validate,
                serde_json::json!({ "operation": "compileShapePaths" }),
            ),
            (
                ShapeError::RegionClipNonMonotonic,
                "SHAPE_REGION_CLIP_NON_MONOTONIC",
                "Shape region clipping requires axis-monotonic contour segments.",
                PipelineStage::Validate,
                serde_json::json!({ "operation": "compileShapePaths" }),
            ),
            (
                ShapeError::NonFiniteOutput,
                "SHAPE_OUTPUT_INVALID",
                "Shape operation returned invalid output.",
                PipelineStage::Wasm,
                serde_json::json!({
                    "operation": "compileShapePaths",
                    "phase": "serialize",
                }),
            ),
        ];

        assert_eq!(rows.len(), 15);
        for (error, expected_code, expected_message, expected_stage, expected_context) in rows {
            let diagnostic = classify_shape_error(&error, ShapeOperation::CompileShapePaths, None);
            assert_eq!(diagnostic.code, expected_code);
            assert_eq!(diagnostic.message, expected_message);
            assert_eq!(diagnostic.stage, expected_stage);
            assert_eq!(diagnostic.context, expected_context);
        }
    }

    #[test]
    fn duplicate_identifier_context_is_utf8_bounded() {
        let duplicate_id = "界".repeat(100);
        let diagnostic = classify_shape_error(
            &ShapeError::DuplicatePartId(duplicate_id),
            ShapeOperation::EvaluateShapeParts,
            None,
        );
        let prefix = diagnostic.context["partIdPrefix"]
            .as_str()
            .expect("part id prefix");

        assert!(prefix.len() <= MAX_PART_ID_PREFIX_BYTES);
        assert_eq!(prefix.len() % "界".len(), 0);
        assert_eq!(diagnostic.context["omittedPartIdByteCount"], 45);
        assert!(
            serde_json::to_vec(&diagnostic.context)
                .is_ok_and(|bytes| bytes.len() <= MAX_SHAPE_CONTEXT_BYTES)
        );
    }

    #[test]
    fn standalone_fallbacks_are_exact_valid_envelopes() {
        for operation in standalone_operations() {
            let fallback = operation
                .standalone_fallback()
                .expect("standalone fallback");
            let parsed: Value = serde_json::from_str(fallback).expect("valid fallback JSON");
            assert_eq!(parsed["severity"], "fatal");
            assert_eq!(parsed["code"], "SHAPE_WASM_FAILED");
            assert_eq!(parsed["context"]["operation"], operation.as_str());
            assert!(fallback.len() <= MAX_SHAPE_ENVELOPE_BYTES);
        }
    }

    #[test]
    fn non_finite_json_output_fails_before_serde_can_emit_null() {
        let region = Region {
            contours: vec![boundshape::Contour {
                segments: vec![boundshape::CurveSegment::Line {
                    p0: boundshape::Point2D { x: 0.0, y: 0.0 },
                    p1: boundshape::Point2D {
                        x: f64::INFINITY,
                        y: 0.0,
                    },
                }],
                closed: false,
            }],
        };
        let diagnostic = ShapeOperationOutput::Region(region)
            .serialize_checked(ShapeOperation::EvaluateShapeRegion)
            .expect_err("non-finite region must fail");

        assert_eq!(diagnostic.code, "SHAPE_OUTPUT_INVALID");
        assert_eq!(diagnostic.context["phase"], "serialize");
    }

    #[test]
    fn every_numeric_json_root_rejects_non_finite_output() {
        let non_finite_region = || Region {
            contours: vec![boundshape::Contour {
                segments: vec![boundshape::CurveSegment::Line {
                    p0: boundshape::Point2D { x: 0.0, y: 0.0 },
                    p1: boundshape::Point2D {
                        x: f64::INFINITY,
                        y: 0.0,
                    },
                }],
                closed: false,
            }],
        };
        let empty_region = || Region { contours: vec![] };
        let cases = [
            (
                ShapeOperationOutput::CompiledPaths(vec![CompiledGeometryPart {
                    part_id: None,
                    d: "M0,0Z".to_string(),
                    stroke_d: None,
                    bounds: Some(PartBounds {
                        x: 0.0,
                        y: 0.0,
                        width: f64::INFINITY,
                        height: 1.0,
                    }),
                }]),
                ShapeOperation::CompileShapePaths,
            ),
            (
                ShapeOperationOutput::Geometry(GeometryDoc {
                    view_box: boundshape::GeometryViewBox {
                        x: 0.0,
                        y: 0.0,
                        width: 10.0,
                        height: 10.0,
                    },
                    root: GeometryNode::Transform {
                        node_id: None,
                        transform: boundshape::Transform2D {
                            translate_x: Some(f64::INFINITY),
                            ..boundshape::Transform2D::default()
                        },
                        child: Box::new(GeometryNode::Path {
                            node_id: None,
                            d: "M0 0Z".to_string(),
                            fill_rule: None,
                        }),
                    },
                }),
                ShapeOperation::ResolveSymbolGeometry,
            ),
            (
                ShapeOperationOutput::Parts(vec![EvaluatedPart {
                    part_id: "body".to_string(),
                    region: non_finite_region(),
                    stroke_region: empty_region(),
                    bounds: None,
                }]),
                ShapeOperation::EvaluateShapeParts,
            ),
            (
                ShapeOperationOutput::Region(non_finite_region()),
                ShapeOperation::EvaluateShapeRegion,
            ),
            (
                ShapeOperationOutput::Divide(DivideRegions {
                    subtract: non_finite_region(),
                    intersect: empty_region(),
                }),
                ShapeOperation::DivideShapeRegions,
            ),
            (
                ShapeOperationOutput::Intersections(vec![GeometryIntersection {
                    point: boundshape::Point2D {
                        x: f64::INFINITY,
                        y: 0.0,
                    },
                    t_a: 0.0,
                    t_b: 0.0,
                    contour_index_a: 0,
                    segment_index_a: 0,
                    contour_index_b: 0,
                    segment_index_b: 0,
                }]),
                ShapeOperation::ComputeShapeIntersections,
            ),
        ];

        for (output, operation) in cases {
            let diagnostic = output
                .serialize_checked(operation)
                .expect_err("non-finite output must fail");
            assert_eq!(diagnostic.code, "SHAPE_OUTPUT_INVALID");
            assert_eq!(
                diagnostic.context,
                serde_json::json!({ "operation": operation.as_str(), "phase": "serialize" })
            );
        }
    }

    struct SerializationFailure;

    impl serde::Serialize for SerializationFailure {
        fn serialize<Serializer>(
            &self,
            _serializer: Serializer,
        ) -> Result<Serializer::Ok, Serializer::Error>
        where
            Serializer: serde::Serializer,
        {
            Err(serde::ser::Error::custom("synthetic serialization failure"))
        }
    }

    #[test]
    fn serialization_failure_uses_the_output_boundary() {
        let diagnostic = serialize_json_output(
            &SerializationFailure,
            ShapeOperation::ComputeShapeIntersections,
        )
        .expect_err("serialization must fail");

        assert_eq!(diagnostic.code, "SHAPE_OUTPUT_INVALID");
        assert_eq!(
            diagnostic.message,
            "Shape operation returned invalid output."
        );
        assert_eq!(diagnostic.stage, PipelineStage::Wasm);
        assert_eq!(
            diagnostic.context,
            serde_json::json!({
                "operation": "computeShapeIntersections",
                "phase": "serialize",
            })
        );
    }

    #[test]
    fn operation_runner_classifies_input_for_every_standalone_operation() {
        for operation in standalone_operations() {
            let mut malformed_closure_called = false;
            let malformed = run_shape_operation::<u8, _>(operation, "{", |_| {
                malformed_closure_called = true;
                Err(ShapeOperationFailure::from(ShapeError::InvalidPathData))
            })
            .expect_err("malformed JSON must fail");
            assert!(!malformed_closure_called);
            assert_eq!(malformed.code, "SHAPE_INPUT_INVALID");
            assert_eq!(
                malformed.context,
                serde_json::json!({
                    "operation": operation.as_str(),
                    "reason": "malformedJson",
                })
            );

            let mut invalid_closure_called = false;
            let invalid = run_shape_operation::<u8, _>(operation, r#""not-a-number""#, |_| {
                invalid_closure_called = true;
                Err(ShapeOperationFailure::from(ShapeError::InvalidPathData))
            })
            .expect_err("invalid request shape must fail");
            assert!(!invalid_closure_called);
            assert_eq!(invalid.code, "SHAPE_INPUT_INVALID");
            assert_eq!(
                invalid.context,
                serde_json::json!({
                    "operation": operation.as_str(),
                    "reason": "invalidRequestShape",
                })
            );

            for duplicate_input in [
                r#"{"geometry":{"viewBox":{"width":10,"height":10},"root":{"kind":"path","d":"M0 0H10V10H0Z"}},"geometry":{"viewBox":{"width":10,"height":10},"root":{"kind":"path","d":"M0 0H10V10H0Z"}}}"#,
                r#"{"geometry":{"viewBox":{"width":10,"width":10,"height":10},"root":{"kind":"path","d":"M0 0H10V10H0Z"}}}"#,
            ] {
                let mut duplicate_closure_called = false;
                let duplicate = run_shape_operation::<crate::EvaluateShapeRegionInput, _>(
                    operation,
                    duplicate_input,
                    |input| {
                        duplicate_closure_called = true;
                        let _ = input.geometry;
                        Err(ShapeOperationFailure::from(ShapeError::InvalidPathData))
                    },
                )
                .expect_err("duplicate known fields must fail");
                assert!(!duplicate_closure_called);
                assert_eq!(duplicate.code, "SHAPE_INPUT_INVALID");
                assert_eq!(
                    duplicate.context,
                    serde_json::json!({
                        "operation": operation.as_str(),
                        "reason": "invalidRequestShape",
                    })
                );
            }
        }
    }

    #[test]
    fn operation_runner_contains_a_domain_panic_for_every_standalone_operation() {
        for operation in standalone_operations() {
            let diagnostic = run_shape_operation::<u8, _>(
                operation,
                "7",
                |input| -> Result<ShapeOperationOutput, ShapeOperationFailure> {
                    assert_eq!(input, 7);
                    panic!("synthetic domain panic");
                },
            )
            .expect_err("panic must become a diagnostic");

            assert_eq!(diagnostic.code, "SHAPE_PANIC");
            assert_eq!(diagnostic.message, "Shape operation failed unexpectedly.");
            assert_eq!(diagnostic.stage, PipelineStage::Wasm);
            assert_eq!(
                diagnostic.context,
                serde_json::json!({ "operation": operation.as_str() })
            );
        }
    }
}
