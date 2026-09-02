use crate::text::types::Language;

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
