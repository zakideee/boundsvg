//! Privacy-minimizing generator identity embedded in exported files.
//!
//! This is intentionally not an arbitrary metadata bag. A small, validated
//! package/service name plus its public version covers support diagnostics
//! without offering a convenient carrier for user ids, prompts, paths, or
//! other personal data.

use serde::{Deserialize, Serialize};

use crate::error::EngineError;

const GENERATOR_NAME_MAX_LEN: usize = 64;
const GENERATOR_VERSION_MAX_LEN: usize = 64;

/// Public generator identity attached to an exported file.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OutputGenerator {
    pub name: String,
    pub version: String,
}

impl OutputGenerator {
    /// Validate the deliberately narrow public representation.
    ///
    /// # Errors
    ///
    /// Returns a structured validation error for values that could carry
    /// arbitrary prose or unexpectedly large hidden payloads.
    pub fn validate(&self) -> Result<(), EngineError> {
        if !is_valid_package_name(&self.name) {
            return Err(validation_error(&format!(
                "generator.name must be a lowercase package identifier of at most {GENERATOR_NAME_MAX_LEN} ASCII characters"
            )));
        }
        if self.version.is_empty()
            || self.version.len() > GENERATOR_VERSION_MAX_LEN
            || !self
                .version
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            || !self.version.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-' | b'_')
            })
        {
            return Err(validation_error(&format!(
                "generator.version must start with an ASCII letter or digit, contain only ASCII letters, digits, '.', '+', '-' or '_', and be at most {GENERATOR_VERSION_MAX_LEN} characters"
            )));
        }
        Ok(())
    }

    /// Stable compact JSON used by container formats with one text payload.
    #[must_use]
    pub fn canonical_json(&self) -> String {
        // Validation constrains both fields to an ASCII set that never needs
        // JSON escaping, so the fixed field order is explicit and stable.
        format!(
            "{{\"name\":\"{}\",\"version\":\"{}\"}}",
            self.name, self.version
        )
    }

    /// Conventional human-readable software identifier.
    #[must_use]
    pub fn software_text(&self) -> String {
        format!("{}/{}", self.name, self.version)
    }

    /// Minimal deterministic XMP packet for WebP containers.
    #[must_use]
    pub fn xmp_packet(&self) -> String {
        format!(
            "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"><rdf:Description rdf:about=\"\" xmlns:boundsvg=\"https://github.com/zakideee/boundsvg/ns/generator/1.0/\"><boundsvg:name>{}</boundsvg:name><boundsvg:version>{}</boundsvg:version></rdf:Description></rdf:RDF></x:xmpmeta>",
            self.name, self.version
        )
    }
}

fn is_valid_package_name(name: &str) -> bool {
    if name.is_empty() || name.len() > GENERATOR_NAME_MAX_LEN || !name.is_ascii() {
        return false;
    }
    let unscoped = if let Some(scoped) = name.strip_prefix('@') {
        let Some((scope, package)) = scoped.split_once('/') else {
            return false;
        };
        if !is_package_segment(scope) {
            return false;
        }
        package
    } else {
        name
    };
    is_package_segment(unscoped)
}

fn is_package_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-' | b'_')
        })
        && segment
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

fn validation_error(detail: &str) -> EngineError {
    EngineError::Structured {
        code: "VALIDATION".to_string(),
        message: format!("Validation error: {detail}"),
        stage: Some(crate::diagnostics::PipelineStage::Emit),
        node_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_package_names_and_versions() {
        for name in ["aaaa", "@scope/aaaa", "com.example.aaaa"] {
            OutputGenerator {
                name: name.to_string(),
                version: "1.2.3-beta.1+build".to_string(),
            }
            .validate()
            .expect("valid generator");
        }
    }

    #[test]
    fn rejects_freeform_or_person_identifying_shapes() {
        for name in [
            "Jane Doe",
            "jane@example.com",
            "@scope",
            "AAAA",
            "aaaa\nignore",
        ] {
            assert!(
                OutputGenerator {
                    name: name.to_string(),
                    version: "1.0.0".to_string(),
                }
                .validate()
                .is_err()
            );
        }
        for version in ["", ".hidden", "1.0.0\nignore", "１.０.０"] {
            assert!(
                OutputGenerator {
                    name: "aaaa".to_string(),
                    version: version.to_string(),
                }
                .validate()
                .is_err()
            );
        }
    }

    #[test]
    fn serializes_in_fixed_field_order() {
        let generator = OutputGenerator {
            name: "aaaa".to_string(),
            version: "1.2.3".to_string(),
        };
        assert_eq!(
            generator.canonical_json(),
            r#"{"name":"aaaa","version":"1.2.3"}"#
        );
    }
}
