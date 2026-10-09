//! Borrowed SVG path tokens shared by strict geometry and prefix bounds parsing.

use super::ShapeError;

/// One borrowed token with its byte position in the original path data.
pub(super) struct PathToken<'a> {
    /// Command or numeric spelling borrowed without allocating a token string.
    pub(super) text: &'a str,
    /// Byte offset used to report the first incomplete argument or lexical failure.
    pub(super) offset: usize,
}

impl AsRef<str> for PathToken<'_> {
    /// Share the token spelling with existing strict argument readers.
    fn as_ref(&self) -> &str {
        self.text
    }
}

/// Incremental lexer; an error terminates iteration after the completed prefix.
pub(super) struct PathTokens<'a> {
    source: &'a str,
    cursor: usize,
    has_failed: bool,
}

impl<'a> PathTokens<'a> {
    /// Borrow path data without allocating token strings.
    pub(super) const fn new(source: &'a str) -> Self {
        Self {
            source,
            cursor: 0,
            has_failed: false,
        }
    }

    /// Return the byte position of the next token or the terminating error.
    pub(super) const fn offset(&self) -> usize {
        self.cursor
    }
}

impl<'a> Iterator for PathTokens<'a> {
    type Item = Result<PathToken<'a>, ShapeError>;

    /// Yield a borrowed spelling, or one lexical error and then terminate.
    /// Argument validity remains the responsibility of the shared numeric readers.
    fn next(&mut self) -> Option<Self::Item> {
        if self.has_failed {
            return None;
        }
        let bytes = self.source.as_bytes();
        while self.cursor < bytes.len()
            && matches!(
                bytes[self.cursor],
                b' ' | b'\n' | b'\r' | b'\t' | b'\x0c' | b','
            )
        {
            self.cursor += 1;
        }
        if self.cursor == bytes.len() {
            return None;
        }
        let start = self.cursor;
        if bytes[start].is_ascii_alphabetic() {
            self.cursor += 1;
        } else {
            if matches!(bytes[self.cursor], b'+' | b'-') {
                self.cursor += 1;
            }
            while self.cursor < bytes.len() && bytes[self.cursor].is_ascii_digit() {
                self.cursor += 1;
            }
            if self.cursor < bytes.len() && bytes[self.cursor] == b'.' {
                self.cursor += 1;
                while self.cursor < bytes.len() && bytes[self.cursor].is_ascii_digit() {
                    self.cursor += 1;
                }
            }
            if self.cursor < bytes.len() && matches!(bytes[self.cursor], b'e' | b'E') {
                self.cursor += 1;
                if self.cursor < bytes.len() && matches!(bytes[self.cursor], b'+' | b'-') {
                    self.cursor += 1;
                }
                while self.cursor < bytes.len() && bytes[self.cursor].is_ascii_digit() {
                    self.cursor += 1;
                }
            }
            if self.cursor == start
                || (self.cursor == start + 1 && matches!(bytes[start], b'+' | b'-'))
            {
                self.cursor = start;
                self.has_failed = true;
                return Some(Err(ShapeError::InvalidPathData));
            }
        }
        Some(Ok(PathToken {
            text: &self.source[start..self.cursor],
            offset: start,
        }))
    }
}
