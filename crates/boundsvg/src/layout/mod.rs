mod compute;
mod measure;
mod taffy;
pub mod types;

pub(crate) const MAX_LAYOUT_TREE_DEPTH: usize = 48;

#[cfg(test)]
mod tests;

pub use compute::{compute_full_layout, compute_full_layout_with_registry};
pub use types::{
    FontInput, ImageInput, LayoutInput, LayoutNodeInput, LayoutNodeOutput, LayoutOutput,
    PreferredFrame, TaffyStyleInput, TextInput, TextLayoutOutput, TextPathInput,
};
