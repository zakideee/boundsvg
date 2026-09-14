pub mod animation;
pub(crate) mod animation_timeline;
pub mod builder;
pub mod gradient;
mod svg_id_rewrite;
pub mod svg_security;
pub mod types;
pub(crate) mod wire_input;
pub(crate) mod wire_output;

#[cfg(test)]
mod wire_tests;

#[cfg(test)]
mod output_tests;
