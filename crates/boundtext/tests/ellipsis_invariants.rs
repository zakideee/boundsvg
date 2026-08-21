//! Ellipsis invariants: the kept line fits its box, and the width the engine
//! reports is the width the kept text actually shapes to.
//!
//! Both broke when `apply_ellipsis` measured with default shaping options: it
//! kept text sized at the default instance of a variable font while the line
//! rendered at the requested weight.

// Integration tests always build with `cfg(test)`; declaring it lets clippy's
// `allow-*-in-tests` config apply to helper functions in this file.
#![cfg(test)]

use boundtext::font::shaping::{ShapeOptions, VariationSetting, shape_with_fallback_and_options};
use boundtext::font::{FontContext, FontRegistry, FontStyle};
use boundtext::text::ellipsis::apply_ellipsis;

fn registry(alias: &str, path: &str) -> FontRegistry {
    let mut reg = FontRegistry::new();
    reg.register(
        std::fs::read(format!(
            "{}/../../fixtures/fonts/{path}",
            env!("CARGO_MANIFEST_DIR")
        ))
        .expect("font"),
        alias.into(),
        400,
        FontStyle::Normal,
    )
    .unwrap();
    reg
}

#[test]
fn ellipsis_line_always_fits_or_is_ellipsis_only() {
    let jp = registry("JP", "NotoSansJP-Regular.subset.ttf");
    let families = vec!["JP".to_string()];
    let ctx = FontContext {
        registry: &jp,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };

    let texts = [
        "吾輩は猫である。名前はまだ無い。",
        "これは（括弧）を含む長い日本語のテキストです、句読点も。",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "ABCあいうDEFかきくGHIさしす",
        "🇯🇵👨‍👩‍👧‍👦é\u{0301}あ",
        "一",
        "",
        " ",
    ];
    let letter_spacings = [0.0_f64, -1.0];
    let sizes = [12.0_f64, 48.0];

    let mut violations = Vec::new();
    let mut checked = 0usize;

    for text in texts {
        for &size in &sizes {
            for &ls in &letter_spacings {
                // sweep widths from tiny to generous
                for step in 0..16 {
                    let max_width = f64::from(step) * 8.0;
                    let Some(line) = apply_ellipsis(
                        text,
                        max_width,
                        &ctx,
                        size,
                        ls,
                        size * 1.5,
                        size,
                        None,
                        &ShapeOptions::default(),
                    ) else {
                        continue; // already fits — no truncation
                    };
                    checked += 1;

                    // The engine's own reported width must not exceed the box,
                    // unless the line is the "…" alone (documented best effort).
                    if line.width > max_width + 0.001 && line.text != "\u{2026}" {
                        violations.push(format!(
                            "text={text:?} size={size} ls={ls} max_width={max_width} -> kept {:?} width {:.3}",
                            line.text, line.width
                        ));
                    }

                    // The reported width must equal a real shaping of the kept text.
                    let shaped = shape_with_fallback_and_options(
                        &ctx,
                        &line.text,
                        size,
                        ls,
                        &ShapeOptions::default(),
                    );
                    let actual: f64 = shaped.glyphs.iter().map(|g| g.x_advance).sum();
                    if (actual - line.width).abs() > 0.01 {
                        violations.push(format!(
                            "REPORTED != ACTUAL text={text:?} size={size} ls={ls} kept={:?} reported={:.3} actual={:.3}",
                            line.text, line.width, actual
                        ));
                    }
                }
            }
        }
    }

    println!(
        "checked {checked} truncations, {} violations",
        violations.len()
    );
    for v in violations.iter().take(12) {
        println!("  {v}");
    }
    assert!(
        violations.is_empty(),
        "{} invariant violations",
        violations.len()
    );
}

#[test]
fn ellipsis_with_variations_still_fits() {
    let vf = registry("VF", "Inter-Variable.ttf");
    let families = vec!["VF".to_string()];
    let ctx = FontContext {
        registry: &vf,
        fallback_registry: None,
        families: &families,
        weight: 400,
        style: &FontStyle::Normal,
    };
    let options = ShapeOptions {
        font_variation_settings: vec![VariationSetting {
            tag: "wght".into(),
            value: 900.0,
        }],
        ..ShapeOptions::default()
    };

    let mut violations = Vec::new();
    for step in 1..50 {
        let max_width = f64::from(step) * 10.0;
        let Some(line) = apply_ellipsis(
            "The quick brown fox jumps over the lazy dog",
            max_width,
            &ctx,
            32.0,
            0.0,
            48.0,
            32.0,
            None,
            &options,
        ) else {
            continue;
        };
        let shaped = shape_with_fallback_and_options(&ctx, &line.text, 32.0, 0.0, &options);
        let actual: f64 = shaped.glyphs.iter().map(|g| g.x_advance).sum();
        if actual > max_width + 0.001 && line.text != "\u{2026}" {
            violations.push(format!(
                "max_width={max_width} kept={:?} renders {actual:.2}",
                line.text
            ));
        }
    }
    for v in violations.iter().take(8) {
        println!("  {v}");
    }
    assert!(violations.is_empty(), "{} overflow(s)", violations.len());
}
