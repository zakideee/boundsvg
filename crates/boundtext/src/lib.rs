#![expect(
    clippy::too_many_arguments,
    reason = "text shaping and layout APIs pass several independent CSS/font constraints across module boundaries"
)]
#![expect(
    clippy::too_many_lines,
    reason = "text layout algorithms keep stateful line-breaking steps together for auditability"
)]

pub mod error;
pub mod font;
#[cfg(any(test, feature = "phase-trace"))]
#[doc(hidden)]
pub mod phase_trace;
#[cfg(feature = "schema")]
pub mod schema;
pub mod text;

pub use error::{
    BoundtextError, FlowRegionError, FlowRegionField, RegionProviderError, RegionQueryError,
    RegionQueryField, TextConstraintField, TextLayoutError, TextLayoutInvariant,
    TextPreparationPhase, TextRequestError,
};
