//! Constrained public generator identity for MP4 exports.

use crate::muxer::MuxerError;

const GENERATOR_NAME_MAX_LEN: usize = 64;
const GENERATOR_VERSION_MAX_LEN: usize = 64;

/// Public package/service identity embedded in a completed MP4 file.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GeneratorIdentity {
    name: String,
    version: String,
}

impl GeneratorIdentity {
    /// Validate and construct the deliberately narrow representation.
    pub fn new(name: String, version: String) -> Result<Self, MuxerError> {
        if !is_valid_package_name(&name) {
            return Err(MuxerError::InvalidArgument(format!(
                "generator name must be a lowercase package identifier of at most {GENERATOR_NAME_MAX_LEN} ASCII characters"
            )));
        }
        if version.is_empty()
            || version.len() > GENERATOR_VERSION_MAX_LEN
            || !version
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            || !version.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-' | b'_')
            })
        {
            return Err(MuxerError::InvalidArgument(format!(
                "generator version must start with an ASCII letter or digit, contain only ASCII letters, digits, '.', '+', '-' or '_', and be at most {GENERATOR_VERSION_MAX_LEN} characters"
            )));
        }
        Ok(Self { name, version })
    }

    /// Conventional value stored in the MP4 encoding-tool field.
    pub fn software_text(&self) -> String {
        format!("{}/{}", self.name, self.version)
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

#[cfg(test)]
mod tests {
    use super::GeneratorIdentity;

    #[test]
    fn accepts_public_package_identifiers() {
        for name in ["aaaa", "@scope/aaaa", "com.example.aaaa"] {
            GeneratorIdentity::new(name.to_string(), "1.2.3-beta.1+build".to_string())
                .expect("valid generator");
        }
    }

    #[test]
    fn rejects_freeform_hidden_or_person_identifying_values() {
        for name in [
            "Jane Doe",
            "jane@example.com",
            "@scope",
            "AAAA",
            "aaaa\nignore",
        ] {
            assert!(
                GeneratorIdentity::new(name.to_string(), "1.0.0".to_string()).is_err(),
                "accepted {name:?}"
            );
        }
        for version in ["", ".hidden", "1.0.0\nignore", "１.０.０"] {
            assert!(
                GeneratorIdentity::new("aaaa".to_string(), version.to_string()).is_err(),
                "accepted {version:?}"
            );
        }
    }
}
