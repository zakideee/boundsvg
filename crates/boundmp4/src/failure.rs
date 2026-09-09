//! Project native MP4 failures into the package's produce-only JavaScript wire.

use crate::error::{Dimension, FrameRateTerm, GeneratorPart, MuxerError};
use wasm_bindgen::prelude::*;

/// Boundary operation whose failure is being reported.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Operation {
    CreateMuxer,
    SetDescription,
    AppendSample,
    FinishMuxer,
}

impl Operation {
    fn as_str(self) -> &'static str {
        match self {
            Self::CreateMuxer => "createMuxer",
            Self::SetDescription => "setDescription",
            Self::AppendSample => "appendSample",
            Self::FinishMuxer => "finishMuxer",
        }
    }
}

/// Scalar projection, separate from the assembler's domain error representation.
#[derive(Debug)]
pub struct Mp4FailureOutput {
    code: &'static str,
    message: &'static str,
    stage: &'static str,
    category: &'static str,
    operation: &'static str,
    reason: &'static str,
    field: Option<&'static str>,
    numbers: [Option<(&'static str, f64)>; 2],
}

impl Mp4FailureOutput {
    /// Project one closed reason at its owning boundary operation.
    pub fn new(error: MuxerError, operation: Operation, sample_count: Option<usize>) -> Self {
        let mut output = Self::invalid_input(operation);
        let count = sample_count.map(|count| ("sampleCount", count as f64));
        match error {
            MuxerError::InvalidDimension { dimension, pixels } => {
                let field = match dimension {
                    Dimension::Width => "width",
                    Dimension::Height => "height",
                };
                output.reason = "invalidDimension";
                output.field = Some(field);
                output.numbers[0] = Some((field, f64::from(pixels)));
            }
            MuxerError::InvalidFrameRate(term) => {
                output.reason = "invalidFrameRate";
                output.field = Some(match term {
                    FrameRateTerm::Numerator => "fpsNumerator",
                    FrameRateTerm::Denominator => "fpsDenominator",
                });
            }
            MuxerError::InvalidFrameCountHint => {
                output.reason = "invalidFrameCountHint";
                output.field = Some("frameCountHint");
            }
            MuxerError::InvalidGeneratorName => {
                output.reason = "invalidGeneratorName";
                output.field = Some("generatorName");
            }
            MuxerError::InvalidGeneratorVersion => {
                output.reason = "invalidGeneratorVersion";
                output.field = Some("generatorVersion");
            }
            MuxerError::IncompleteGenerator(part) => {
                output.reason = "incompleteGenerator";
                output.field = Some(match part {
                    GeneratorPart::Name => "generatorName",
                    GeneratorPart::Version => "generatorVersion",
                });
            }
            MuxerError::InvalidCodecDescription => {
                output.reason = "invalidCodecDescription";
                output.field = Some("codecDescription");
            }
            MuxerError::MissingCodecDescription | MuxerError::EmptySamples => {
                output.missing_input();
                if matches!(error, MuxerError::MissingCodecDescription) {
                    output.reason = "missingCodecDescription";
                    output.field = Some("codecDescription");
                    output.numbers[0] = count;
                } else {
                    output.reason = "emptySamples";
                    output.numbers[0] = Some(("sampleCount", 0.0));
                }
            }
            MuxerError::AlreadyFinished | MuxerError::DescriptionAfterSamples => {
                output.invalid_state();
                output.reason = if matches!(error, MuxerError::AlreadyFinished) {
                    "alreadyFinished"
                } else {
                    "descriptionAfterSamples"
                };
                output.numbers[0] = count;
            }
            MuxerError::OutputByteLimit {
                limit_bytes,
                requested_bytes,
            } => {
                output.resource_limit();
                output.reason = "outputByteLimit";
                output.numbers = [
                    Some(("limitBytes", limit_bytes as f64)),
                    Some(("requestedBytes", requested_bytes as f64)),
                ];
            }
            MuxerError::OutputAllocation { requested_bytes } => {
                output.code = "VIDEO_MUXER_ALLOCATION_FAILED";
                output.message = "MP4 muxer could not allocate output storage";
                output.stage = "emit";
                output.category = "resource";
                output.reason = "outputAllocation";
                output.numbers[0] = Some(("requestedBytes", requested_bytes as f64));
            }
            MuxerError::MetadataReservationLimit => {
                output.resource_limit();
                output.reason = "metadataReservationLimit";
            }
            MuxerError::WriterRejected
            | MuxerError::InsufficientIndexSpace
            | MuxerError::InvalidContainerStructure => {
                output.container_failure();
                output.reason = match error {
                    MuxerError::WriterRejected => "writerRejected",
                    MuxerError::InsufficientIndexSpace => "insufficientIndexSpace",
                    _ => "invalidContainerStructure",
                };
                output.numbers[0] = count;
            }
        }
        output
    }

    fn invalid_input(operation: Operation) -> Self {
        Self {
            code: "VIDEO_MUXER_INVALID_INPUT",
            message: "MP4 muxer input is invalid",
            stage: "validate",
            category: "invalidInput",
            operation: operation.as_str(),
            reason: "",
            field: None,
            numbers: [None, None],
        }
    }

    fn missing_input(&mut self) {
        self.code = "VIDEO_MUXER_MISSING_INPUT";
        self.message = "MP4 muxer requires an input that was not supplied";
        self.stage = "emit";
        self.category = "missingInput";
    }

    fn invalid_state(&mut self) {
        self.code = "VIDEO_MUXER_INVALID_STATE";
        self.message = "MP4 muxer operation is invalid in its current state";
        self.stage = "emit";
        self.category = "invalidState";
    }

    fn container_failure(&mut self) {
        self.code = "VIDEO_MUXER_WRITE_FAILED";
        self.message = "MP4 container assembly failed";
        self.stage = "emit";
        self.category = "container";
    }

    fn resource_limit(&mut self) {
        self.code = "VIDEO_MUXER_RESOURCE_LIMIT";
        self.message = "MP4 output exceeds the supported resource limit";
        self.stage = "emit";
        self.category = "resource";
    }

    /// Allocate an ordinary JavaScript object with no native lifetime to release.
    pub fn into_js(self) -> JsValue {
        let failure = create_mp4_failure(
            self.code,
            self.message,
            self.stage,
            self.category,
            self.operation,
            self.reason,
            self.field,
        );
        for (key, number) in self.numbers.into_iter().flatten() {
            set_mp4_failure_number(&failure, key, number);
        }
        failure
    }
}

#[wasm_bindgen(inline_js = "\
export function createMp4Failure(code, message, stage, category, operation, reason, field) {\n\
  const context = { domain: 'video', category, operation, reason };\n\
  if (field !== undefined) { context.field = field; }\n\
  return { severity: 'fatal', code, message, stage, context };\n\
}\n\
export function setMp4FailureNumber(failure, key, number) {\n\
  failure.context[key] = number;\n\
}\n")]
extern "C" {
    #[wasm_bindgen(js_name = createMp4Failure)]
    fn create_mp4_failure(
        code: &str,
        message: &str,
        stage: &str,
        category: &str,
        operation: &str,
        reason: &str,
        field: Option<&str>,
    ) -> JsValue;
    #[wasm_bindgen(js_name = setMp4FailureNumber)]
    fn set_mp4_failure_number(failure: &JsValue, key: &str, number: f64);
}

#[cfg(test)]
mod tests {
    use super::*;

    const CASES: [(MuxerError, Operation, &str, &str, Option<&str>); 17] = [
        (
            MuxerError::InvalidDimension {
                dimension: Dimension::Width,
                pixels: 65,
            },
            Operation::CreateMuxer,
            "invalidDimension",
            "VIDEO_MUXER_INVALID_INPUT",
            Some("width"),
        ),
        (
            MuxerError::InvalidFrameRate(FrameRateTerm::Numerator),
            Operation::CreateMuxer,
            "invalidFrameRate",
            "VIDEO_MUXER_INVALID_INPUT",
            Some("fpsNumerator"),
        ),
        (
            MuxerError::InvalidFrameCountHint,
            Operation::CreateMuxer,
            "invalidFrameCountHint",
            "VIDEO_MUXER_INVALID_INPUT",
            Some("frameCountHint"),
        ),
        (
            MuxerError::InvalidGeneratorName,
            Operation::CreateMuxer,
            "invalidGeneratorName",
            "VIDEO_MUXER_INVALID_INPUT",
            Some("generatorName"),
        ),
        (
            MuxerError::InvalidGeneratorVersion,
            Operation::CreateMuxer,
            "invalidGeneratorVersion",
            "VIDEO_MUXER_INVALID_INPUT",
            Some("generatorVersion"),
        ),
        (
            MuxerError::IncompleteGenerator(GeneratorPart::Name),
            Operation::CreateMuxer,
            "incompleteGenerator",
            "VIDEO_MUXER_INVALID_INPUT",
            Some("generatorName"),
        ),
        (
            MuxerError::InvalidCodecDescription,
            Operation::SetDescription,
            "invalidCodecDescription",
            "VIDEO_MUXER_INVALID_INPUT",
            Some("codecDescription"),
        ),
        (
            MuxerError::MissingCodecDescription,
            Operation::AppendSample,
            "missingCodecDescription",
            "VIDEO_MUXER_MISSING_INPUT",
            Some("codecDescription"),
        ),
        (
            MuxerError::EmptySamples,
            Operation::FinishMuxer,
            "emptySamples",
            "VIDEO_MUXER_MISSING_INPUT",
            None,
        ),
        (
            MuxerError::AlreadyFinished,
            Operation::FinishMuxer,
            "alreadyFinished",
            "VIDEO_MUXER_INVALID_STATE",
            None,
        ),
        (
            MuxerError::DescriptionAfterSamples,
            Operation::SetDescription,
            "descriptionAfterSamples",
            "VIDEO_MUXER_INVALID_STATE",
            None,
        ),
        (
            MuxerError::OutputByteLimit {
                limit_bytes: 256 << 20,
                requested_bytes: (256 << 20) + 1,
            },
            Operation::AppendSample,
            "outputByteLimit",
            "VIDEO_MUXER_RESOURCE_LIMIT",
            None,
        ),
        (
            MuxerError::OutputAllocation {
                requested_bytes: 16,
            },
            Operation::AppendSample,
            "outputAllocation",
            "VIDEO_MUXER_ALLOCATION_FAILED",
            None,
        ),
        (
            MuxerError::MetadataReservationLimit,
            Operation::CreateMuxer,
            "metadataReservationLimit",
            "VIDEO_MUXER_RESOURCE_LIMIT",
            None,
        ),
        (
            MuxerError::WriterRejected,
            Operation::CreateMuxer,
            "writerRejected",
            "VIDEO_MUXER_WRITE_FAILED",
            None,
        ),
        (
            MuxerError::InsufficientIndexSpace,
            Operation::FinishMuxer,
            "insufficientIndexSpace",
            "VIDEO_MUXER_WRITE_FAILED",
            None,
        ),
        (
            MuxerError::InvalidContainerStructure,
            Operation::FinishMuxer,
            "invalidContainerStructure",
            "VIDEO_MUXER_WRITE_FAILED",
            None,
        ),
    ];

    #[test]
    fn projects_every_native_reason_without_external_text() {
        for (error, operation, reason, code, field) in CASES {
            let projection = Mp4FailureOutput::new(
                error,
                operation,
                if operation == Operation::CreateMuxer {
                    None
                } else {
                    Some(0)
                },
            );
            assert_eq!(projection.reason, reason);
            assert_eq!(projection.code, code);
            assert_eq!(projection.field, field);
            assert_eq!(projection.operation, operation.as_str());
            assert!(!projection.message.is_empty());
        }
    }

    #[test]
    fn preserves_operation_and_sample_count_on_state_and_writer_failures() {
        for operation in [
            Operation::SetDescription,
            Operation::AppendSample,
            Operation::FinishMuxer,
        ] {
            for error in [MuxerError::AlreadyFinished, MuxerError::WriterRejected] {
                let projection = Mp4FailureOutput::new(error, operation, Some(8));
                assert_eq!(projection.operation, operation.as_str());
                assert_eq!(projection.numbers, [Some(("sampleCount", 8.0)), None]);
            }
        }
        let constructor =
            Mp4FailureOutput::new(MuxerError::WriterRejected, Operation::CreateMuxer, None);
        assert_eq!(constructor.numbers, [None, None]);
    }
}
