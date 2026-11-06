pub mod animation;
pub(crate) mod animation_timeline;
pub(crate) mod box_geometry;
pub mod builder;
pub mod gradient;
pub(crate) mod numeric_envelope;
pub mod ownership;
pub(crate) mod path_geometry;
pub(crate) mod position;
mod svg_id_rewrite;
pub mod svg_security;
pub(crate) mod text_paint;
pub(crate) mod text_placement;
pub mod types;
pub(crate) mod wire_input;
pub(crate) mod wire_output;

#[cfg(test)]
mod wire_tests;

#[cfg(test)]
mod output_tests;
