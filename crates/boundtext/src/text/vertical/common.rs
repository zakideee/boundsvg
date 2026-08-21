use crate::font::{FontRegistry, FontStyle};
use crate::text::types::Language;

pub(super) fn resolve_font<'a>(
    font_registry: &'a FontRegistry,
    fallback_registry: Option<&'a FontRegistry>,
    aliases: &[String],
    weight: u16,
    style: &FontStyle,
) -> Option<&'a crate::font::FontEntry> {
    if let Some(entry) = font_registry.resolve_chain(aliases, weight, style) {
        return Some(entry);
    }
    if let Some(fallback) = fallback_registry {
        return fallback.resolve_chain(aliases, weight, style);
    }
    None
}

// ---------------------------------------------------------------------------
// Language helpers
// ---------------------------------------------------------------------------

pub(super) fn language_to_str(lang: Language) -> &'static str {
    match lang {
        Language::Ja => "ja",
        Language::En => "en",
        Language::Auto => "auto",
    }
}

pub(super) fn language_to_option_string(lang: Language) -> Option<String> {
    match lang {
        Language::Ja => Some("ja".to_string()),
        Language::En => Some("en".to_string()),
        Language::Auto => None,
    }
}
