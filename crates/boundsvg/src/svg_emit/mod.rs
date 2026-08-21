//! SVG emission: number formatting, XML/resource-id helpers, transform
//! attributes, paint attribute builders, and the SVG string emitter
//! (ported from packages/core/src/svg/).
//!
//! Ordering/grouping decisions live in `crate::scene`; this module only
//! formats and prints.

pub mod emitter;
pub mod num_format;
pub mod outline_resolver;
pub mod paint;
pub mod path_bbox;
pub mod text_decoration_resolver;
pub mod transform;
pub mod xml;
