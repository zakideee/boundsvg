//! Direction-specific adapters for the engine's transport boundaries.

#[cfg(feature = "resvg-backend")]
pub(crate) mod animation;

pub(crate) mod presence;

#[cfg(test)]
pub(crate) mod test_support;

pub(crate) mod finite;
