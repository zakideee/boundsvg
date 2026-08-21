use std::io::Cursor;

use crate::error::EngineError;

/// WOFF2 magic bytes: "wOF2"
const WOFF2_SIGNATURE: [u8; 4] = [0x77, 0x4F, 0x46, 0x32];

/// Check if the given font data is in WOFF2 format.
#[must_use]
pub fn is_woff2(data: &[u8]) -> bool {
    data.len() >= 4 && data[..4] == WOFF2_SIGNATURE
}

/// If the input is WOFF2, decompress to raw TTF/OTF bytes.
/// If the input is already TTF/OTF, return it unchanged.
///
/// # Errors
///
/// Returns `EngineError::Woff2Decode` if WOFF2 decompression fails.
pub fn decode_font(data: Vec<u8>) -> Result<Vec<u8>, EngineError> {
    if is_woff2(&data) {
        woff2::decode::convert_woff2_to_ttf(&mut Cursor::new(data))
            .map_err(|e| EngineError::Woff2Decode(e.to_string()))
    } else {
        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ttf_data() -> Vec<u8> {
        std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("TTF fixture not found")
    }

    fn woff2_data() -> Vec<u8> {
        std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.woff2"
        ))
        .expect("WOFF2 fixture not found")
    }

    #[test]
    fn test_is_woff2_detects_woff2() {
        assert!(is_woff2(&woff2_data()));
    }

    #[test]
    fn test_is_woff2_rejects_ttf() {
        assert!(!is_woff2(&ttf_data()));
    }

    #[test]
    fn test_is_woff2_rejects_short_input() {
        assert!(!is_woff2(&[0x77, 0x4F]));
        assert!(!is_woff2(&[]));
    }

    #[test]
    fn test_decode_woff2_produces_valid_ttf() {
        let decoded = decode_font(woff2_data()).expect("WOFF2 decode failed");
        let backend = boundtext::font::backend_ttfparser::TtfParserBackend;
        let metrics = boundtext::font::backend::FontBackend::parse_metrics(&backend, &decoded)
            .expect("Decoded data is not valid TTF/OTF");
        assert!(metrics.units_per_em > 0);
    }

    #[test]
    fn test_decode_ttf_passthrough() {
        let original = ttf_data();
        let decoded = decode_font(original.clone()).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn test_decode_invalid_woff2_returns_error() {
        let mut bad = vec![0x77, 0x4F, 0x46, 0x32];
        bad.extend_from_slice(&[0u8; 100]);
        let result = decode_font(bad);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("WOFF2 decompression failed")
        );
    }
}
