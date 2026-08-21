pub mod decode;

// Re-export all boundtext font submodules and types
pub use boundtext::font::line_metrics;
pub use boundtext::font::outline;
pub use boundtext::font::registry;
pub use boundtext::font::shaping;
pub use boundtext::font::vertical_orientation;

pub use boundtext::font::{
    FontContext, FontEntry, FontKey, FontRegistry, FontStyle, RasterizeFontData,
};
