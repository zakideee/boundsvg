//! Bounded preparation reuse within one rendering operation.

use std::sync::Arc;

use crate::font::shaping::{FeatureSetting, ShapeOptions, VariationSetting};
use crate::font::{FontContext, FontRegistry, FontStyle};
use crate::text::paragraph::{ShapedParagraph, shape_paragraph_with_options};
use crate::text::types::{Language, TextLayoutRequest, TextLayoutResult, WhiteSpaceMode, WrapMode};

/// Bound retained preparations without limiting the text accepted by layout.
const PREPARED_TEXT_MAX: usize = 128;

/// Retain only width-independent owner state for one rendering operation.
///
/// Registry borrows prevent font mutation while prepared state is alive.
/// Callers cannot inspect preparations or obtain a result without layout.
#[doc(hidden)]
pub struct TextLayoutSession<'font> {
    registry: &'font FontRegistry,
    fallback_registry: Option<&'font FontRegistry>,
    entries: Vec<(PreparationKey, Arc<PreparedPlainText>)>,
}

impl<'font> TextLayoutSession<'font> {
    /// Bind preparation lifetime to the immutable registries of one operation.
    #[must_use]
    pub fn new(
        registry: &'font FontRegistry,
        fallback_registry: Option<&'font FontRegistry>,
    ) -> Self {
        Self {
            registry,
            fallback_registry,
            entries: Vec::new(),
        }
    }

    /// Apply the complete owner pipeline with this request's current constraints.
    ///
    /// # Errors
    /// Returns the same validation, shaping, layout and projection errors as `layout_text`.
    pub fn layout_text(
        &mut self,
        request: &TextLayoutRequest<'_>,
        font_ctx: &FontContext<'_>,
        should_include_unit_metadata: bool,
    ) -> Result<TextLayoutResult, crate::TextLayoutError> {
        super::api::layout_text_with_options(
            request,
            font_ctx,
            should_include_unit_metadata,
            Some(self),
        )
    }

    pub(super) fn prepare(
        &mut self,
        request: &TextLayoutRequest<'_>,
        font_ctx: &FontContext<'_>,
    ) -> Arc<PreparedPlainText> {
        let has_matching_registry = std::ptr::eq(self.registry, font_ctx.registry)
            && match (self.fallback_registry, font_ctx.fallback_registry) {
                (Some(first), Some(second)) => std::ptr::eq(first, second),
                (None, None) => true,
                _ => false,
            };
        if !has_matching_registry {
            return Arc::new(prepare_plain_text(request, font_ctx));
        }
        if let Some((_, prepared)) = self
            .entries
            .iter()
            .find(|(key, _)| key.matches(request, font_ctx))
        {
            return Arc::clone(prepared);
        }
        let prepared = Arc::new(prepare_plain_text(request, font_ctx));
        if self.entries.len() >= PREPARED_TEXT_MAX {
            self.entries.clear();
        }
        self.entries.push((
            PreparationKey::new(request, font_ctx),
            Arc::clone(&prepared),
        ));
        prepared
    }
}

struct PreparationKey {
    // Authored text
    text: String,
    white_space: WhiteSpaceMode,
    tab_size: u32,

    // Font selection
    families: Vec<String>,
    weight: u16,
    style: FontStyle,
    variations: Vec<VariationSetting>,
    features: Vec<FeatureSetting>,

    // Break preparation
    language: Language,
    wrap: WrapMode,
    hanging_punctuation: bool,
    uax14_breaks: Option<Vec<usize>>,
    letter_spacing_bits: u64,
}

impl PreparationKey {
    fn new(request: &TextLayoutRequest<'_>, font_ctx: &FontContext<'_>) -> Self {
        Self {
            text: request.text.to_owned(),
            white_space: request.white_space,
            tab_size: request.tab_size,
            families: font_ctx.families.to_vec(),
            weight: font_ctx.weight,
            style: font_ctx.style.clone(),
            variations: request.font_variation_settings.clone(),
            features: request.font_feature_settings.clone(),
            language: request.language,
            wrap: request.effective_wrap(),
            hanging_punctuation: request.hanging_punctuation,
            uax14_breaks: request.uax14_breaks.map(<[usize]>::to_vec),
            letter_spacing_bits: request.letter_spacing_px.to_bits(),
        }
    }

    fn matches(&self, request: &TextLayoutRequest<'_>, font_ctx: &FontContext<'_>) -> bool {
        self.text == request.text
            && self.white_space == request.white_space
            && self.tab_size == request.tab_size
            && self.families == font_ctx.families
            && self.weight == font_ctx.weight
            && &self.style == font_ctx.style
            && self.variations == request.font_variation_settings
            && self.features == request.font_feature_settings
            && self.language == request.language
            && self.wrap == request.effective_wrap()
            && self.hanging_punctuation == request.hanging_punctuation
            && self.uax14_breaks.as_deref() == request.uax14_breaks
            && self.letter_spacing_bits == request.letter_spacing_px.to_bits()
    }
}

pub(super) struct PreparedPlainText {
    pub(super) text: String,
    pub(super) shaped: Option<ShapedParagraph>,
}

pub(super) fn prepare_plain_text(
    request: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
) -> PreparedPlainText {
    let text = crate::text::types::preprocess_text_for_white_space(
        request.text,
        request.white_space,
        request.tab_size,
    );
    let options = ShapeOptions {
        writing_mode: None,
        language: super::api::language_to_option_string(request.language),
        vertical_feature_priority: None,
        text_orientation: None,
        font_variation_settings: request.font_variation_settings.clone(),
        font_feature_settings: request.font_feature_settings.clone(),
    };
    let shaped = shape_paragraph_with_options(
        &text,
        font_ctx,
        request.language,
        request.effective_wrap(),
        request.hanging_punctuation,
        &options,
        request.uax14_breaks,
        request.letter_spacing_px,
        request.has_forced_newline_breaks(),
    );
    PreparedPlainText { text, shaped }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::types::{FitMode, TextOrientation, WritingMode};
    fn test_registry() -> FontRegistry {
        let font_bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("test font");
        let mut registry = FontRegistry::new();
        registry
            .register(font_bytes, "NotoSansJP".to_string(), 400, FontStyle::Normal)
            .expect("register test font");
        registry
    }

    fn build_request(text: &str) -> TextLayoutRequest<'_> {
        TextLayoutRequest {
            text,
            spans: None,
            rich_text: None,
            font_size_px: 24.0,
            line_height: Some(1.5),
            line_height_px: None,
            letter_spacing_px: 0.0,
            text_indent: None,
            max_width: 100.0,
            max_height: None,
            wrap: WrapMode::Char,
            white_space: WhiteSpaceMode::Normal,
            tab_size: 4,
            fit: FitMode::None,
            max_lines: None,
            ellipsis: false,
            language: Language::Ja,
            writing_mode: WritingMode::HorizontalTb,
            text_orientation: TextOrientation::Mixed,
            uax14_breaks: None,
            hanging_punctuation: false,
            font_variation_settings: Vec::new(),
            font_feature_settings: Vec::new(),
            min_font_size_px: None,
            shrink_epsilon_px: None,
            shrink_max_iterations: None,
            max_font_size_px: None,
            grow_epsilon_px: None,
            grow_max_iterations: None,
            fit_max_probes: None,
        }
    }

    #[test]
    fn preparation_reuses_shaping_but_reapplies_constraints() {
        let registry = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let mut session = TextLayoutSession::new(&registry, None);
        let mut request = build_request(" A\t B\r\nHello あいうえお  ");
        let first = session.prepare(&request, &font_ctx);
        assert!(first.shaped.is_some());
        for (width, height, lines, size) in [
            (480.0, None, None, 24.0),
            (16.0, Some(20.0), Some(1), 24.0),
            (60.0, Some(200.0), None, 32.0),
        ] {
            request.max_width = width;
            request.max_height = height;
            request.max_lines = lines;
            request.font_size_px = size;
            assert!(Arc::ptr_eq(&first, &session.prepare(&request, &font_ctx)));
            let actual = session
                .layout_text(&request, &font_ctx, false)
                .expect("cached layout");
            let expected =
                crate::text::engine::layout_text(&request, &font_ctx).expect("fresh layout");
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                serde_json::to_value(expected).unwrap()
            );
        }
        assert_eq!(session.entries.len(), 1);
    }

    #[test]
    fn preparation_identity_covers_every_shaping_input_and_registry() {
        let registry = test_registry();
        let other_registry = test_registry();
        let families = vec!["NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let request = build_request("A\t B\nあいうえお");
        let mut session = TextLayoutSession::new(&registry, None);
        let first = session.prepare(&request, &font_ctx);
        let breaks = [1, 3];
        for field in 0..10 {
            let mut changed = request.clone();
            match field {
                0 => changed.text = "different",
                1 => changed.white_space = WhiteSpaceMode::PreWrap,
                2 => changed.tab_size = 8,
                3 => changed.language = Language::En,
                4 => changed.wrap = WrapMode::Word,
                5 => changed.hanging_punctuation = true,
                6 => changed.uax14_breaks = Some(&breaks),
                7 => changed.letter_spacing_px = 1.0,
                8 => changed.font_feature_settings.push(FeatureSetting {
                    tag: "liga".into(),
                    value: 0,
                }),
                _ => changed.font_variation_settings.push(VariationSetting {
                    tag: "wght".into(),
                    value: 700.0,
                }),
            }
            assert!(!Arc::ptr_eq(&first, &session.prepare(&changed, &font_ctx)));
            let actual = session
                .layout_text(&changed, &font_ctx, true)
                .expect("cached layout");
            let expected = crate::text::engine::layout_text_with_unit_metadata(&changed, &font_ctx)
                .expect("fresh layout");
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                serde_json::to_value(expected).unwrap()
            );
        }
        let other_families = vec!["missing".to_string(), "NotoSansJP".to_string()];
        for changed_ctx in [
            FontContext {
                registry: &other_registry,
                ..font_ctx
            },
            FontContext {
                fallback_registry: Some(&other_registry),
                ..font_ctx
            },
            FontContext {
                families: &other_families,
                ..font_ctx
            },
            FontContext {
                weight: 700,
                ..font_ctx
            },
            FontContext {
                style: &FontStyle::Italic,
                ..font_ctx
            },
        ] {
            assert!(!Arc::ptr_eq(
                &first,
                &session.prepare(&request, &changed_ctx)
            ));
        }
    }

    #[test]
    fn preparation_preserves_fallback_and_bounded_lifetime() {
        let registry = test_registry();
        let families = vec!["missing".to_string(), "NotoSansJP".to_string()];
        let font_ctx = FontContext {
            registry: &registry,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &FontStyle::Normal,
        };
        let mut session = TextLayoutSession::new(&registry, None);
        let request = build_request("hello あいうえお 🦄");
        let first = session.prepare(&request, &font_ctx);
        assert!(first.shaped.is_none());
        for width in [200.0, 20.0] {
            let constrained = TextLayoutRequest {
                max_width: width,
                ..request.clone()
            };
            let actual = session.layout_text(&constrained, &font_ctx, false);
            let expected = crate::text::engine::layout_text(&constrained, &font_ctx);
            assert_eq!(format!("{actual:?}"), format!("{expected:?}"));
            assert!(Arc::ptr_eq(
                &first,
                &session.prepare(&constrained, &font_ctx)
            ));
        }
        for index in 0..PREPARED_TEXT_MAX {
            let text = format!("entry {index}");
            session.prepare(&build_request(&text), &font_ctx);
        }
        assert_eq!(session.entries.len(), 1);
        assert!(!Arc::ptr_eq(&first, &session.prepare(&request, &font_ctx)));
        let mut next_session = TextLayoutSession::new(&registry, None);
        assert!(!Arc::ptr_eq(
            &first,
            &next_session.prepare(&request, &font_ctx)
        ));
    }
}
