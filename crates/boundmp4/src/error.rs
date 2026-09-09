//! Closed failures owned by the MP4 container assembler.

/// Authored dimension rejected by the visual sample entry.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Dimension {
    Width,
    Height,
}

/// Authored term rejected by the container time axis.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FrameRateTerm {
    Numerator,
    Denominator,
}

/// Missing half of a generator identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GeneratorPart {
    Name,
    Version,
}

/// Report a container failure without retaining external error text.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MuxerError {
    InvalidDimension {
        dimension: Dimension,
        pixels: u32,
    },
    InvalidFrameRate(FrameRateTerm),
    InvalidFrameCountHint,
    InvalidGeneratorName,
    InvalidGeneratorVersion,
    IncompleteGenerator(GeneratorPart),
    InvalidCodecDescription,
    MissingCodecDescription,
    EmptySamples,
    AlreadyFinished,
    DescriptionAfterSamples,
    OutputByteLimit {
        limit_bytes: usize,
        requested_bytes: usize,
    },
    OutputAllocation {
        requested_bytes: usize,
    },
    MetadataReservationLimit,
    WriterRejected,
    InsufficientIndexSpace,
    InvalidContainerStructure,
}

impl std::fmt::Display for MuxerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for MuxerError {}
