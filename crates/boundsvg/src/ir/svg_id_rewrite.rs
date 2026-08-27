use std::collections::HashSet;
use std::ops::Range;

pub(super) const MALFORMED_XML: &str = "CONTENT_ID_PREFIX_MALFORMED_XML";
pub(super) const UNSUPPORTED_REFERENCE: &str = "CONTENT_ID_PREFIX_UNSUPPORTED_REFERENCE";

#[derive(Debug)]
pub(super) struct SvgIdRewriteError {
    pub(super) code: &'static str,
    pub(super) detail: String,
}

impl SvgIdRewriteError {
    fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

#[derive(Clone, Debug)]
struct Attribute {
    name: String,
    value: Range<usize>,
}

#[derive(Debug)]
struct Element {
    attributes: Vec<Attribute>,
}

#[derive(Debug)]
struct XmlScan {
    elements: Vec<Element>,
    style_bodies: Vec<Range<usize>>,
}

#[derive(Clone, Debug)]
struct Rewrite {
    range: Range<usize>,
    replacement: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ClassifiedReference {
    attribute: String,
    kind: String,
    syntax: String,
    id: String,
}

#[derive(Debug)]
struct ReferenceAt {
    start: usize,
    value: ClassifiedReference,
}

struct LocalReference<'a> {
    attribute: &'a str,
    kind: &'a str,
    syntax: &'a str,
    range: Range<usize>,
    encoding: ReferenceEncoding,
}

#[derive(Debug)]
struct RewriteReport {
    output: String,
    #[cfg(test)]
    definitions: Vec<String>,
    #[cfg(test)]
    references: Vec<ClassifiedReference>,
}

#[derive(Clone, Copy)]
enum ReferenceEncoding {
    Xml,
    CssOrSmil,
}

fn is_xml_space(byte: u8) -> bool {
    matches!(byte, b'\t' | b'\n' | b'\r' | b' ')
}

fn is_name_start_byte(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || matches!(byte, b'_' | b':') || byte >= 0x80
}

fn is_name_byte(byte: u8) -> bool {
    is_name_start_byte(byte) || byte.is_ascii_digit() || matches!(byte, b'-' | b'.')
}

fn is_css_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_') || byte >= 0x80
}

fn starts_with(bytes: &[u8], offset: usize, needle: &[u8]) -> bool {
    let Some(end) = offset.checked_add(needle.len()) else {
        return false;
    };
    bytes.get(offset..end) == Some(needle)
}

fn find_subslice(bytes: &[u8], needle: &[u8], start: usize) -> Option<usize> {
    if needle.is_empty() {
        return Some(start);
    }
    bytes
        .get(start..)?
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|offset| offset + start)
}

fn find_byte(bytes: &[u8], wanted: u8, start: usize, end: usize) -> Option<usize> {
    bytes
        .get(start..end)?
        .iter()
        .position(|byte| *byte == wanted)
        .map(|offset| offset + start)
}

fn scan_xml(input: &str) -> Result<XmlScan, SvgIdRewriteError> {
    let bytes = input.as_bytes();
    let mut elements = Vec::new();
    let mut style_stack = Vec::new();
    let mut style_bodies = Vec::new();
    let mut cursor = 0;

    while cursor < bytes.len() {
        let Some(opening) = find_byte(bytes, b'<', cursor, bytes.len()) else {
            break;
        };
        if starts_with(bytes, opening, b"<!--") {
            let end = find_subslice(bytes, b"-->", opening + 4)
                .ok_or_else(|| SvgIdRewriteError::new(MALFORMED_XML, "unterminated comment"))?;
            cursor = end + 3;
            continue;
        }
        if starts_with(bytes, opening, b"<![CDATA[") {
            let end = find_subslice(bytes, b"]]>", opening + 9)
                .ok_or_else(|| SvgIdRewriteError::new(MALFORMED_XML, "unterminated CDATA"))?;
            cursor = end + 3;
            continue;
        }
        if starts_with(bytes, opening, b"<?") {
            let end = find_subslice(bytes, b"?>", opening + 2).ok_or_else(|| {
                SvgIdRewriteError::new(MALFORMED_XML, "unterminated processing instruction")
            })?;
            cursor = end + 2;
            continue;
        }
        if starts_with(bytes, opening, b"<!") {
            let mut index = opening + 2;
            let mut quote = None;
            let mut bracket_depth = 0_u32;
            while index < bytes.len() {
                let byte = bytes[index];
                if let Some(expected) = quote {
                    if byte == expected {
                        quote = None;
                    }
                } else if matches!(byte, b'"' | b'\'') {
                    quote = Some(byte);
                } else if byte == b'[' {
                    bracket_depth += 1;
                } else if byte == b']' && bracket_depth > 0 {
                    bracket_depth -= 1;
                } else if byte == b'>' && bracket_depth == 0 {
                    break;
                }
                index += 1;
            }
            if index >= bytes.len() {
                return Err(SvgIdRewriteError::new(
                    MALFORMED_XML,
                    "unterminated declaration",
                ));
            }
            cursor = index + 1;
            continue;
        }

        let mut index = opening + 1;
        let closing = bytes.get(index) == Some(&b'/');
        if closing {
            index += 1;
        }
        if !bytes
            .get(index)
            .is_some_and(|byte| is_name_start_byte(*byte))
        {
            return Err(SvgIdRewriteError::new(
                MALFORMED_XML,
                format!("invalid tag at byte {opening}"),
            ));
        }
        let name_start = index;
        while bytes.get(index).is_some_and(|byte| is_name_byte(*byte)) {
            index += 1;
        }
        let name = std::str::from_utf8(&bytes[name_start..index])
            .map_err(|_| SvgIdRewriteError::new(MALFORMED_XML, "invalid UTF-8 tag name"))?;

        if closing {
            while bytes.get(index).is_some_and(|byte| is_xml_space(*byte)) {
                index += 1;
            }
            if bytes.get(index) != Some(&b'>') {
                return Err(SvgIdRewriteError::new(
                    MALFORMED_XML,
                    format!("malformed closing tag {name}"),
                ));
            }
            if name == "style" {
                let body_start = style_stack
                    .pop()
                    .ok_or_else(|| SvgIdRewriteError::new(MALFORMED_XML, "unmatched </style>"))?;
                style_bodies.push(body_start..opening);
            }
            cursor = index + 1;
            continue;
        }

        let mut attributes = Vec::new();
        let mut attribute_names = HashSet::new();
        let mut self_closing = false;
        loop {
            while bytes.get(index).is_some_and(|byte| is_xml_space(*byte)) {
                index += 1;
            }
            if bytes.get(index) == Some(&b'>') {
                index += 1;
                break;
            }
            if bytes.get(index) == Some(&b'/') && bytes.get(index + 1) == Some(&b'>') {
                self_closing = true;
                index += 2;
                break;
            }
            if !bytes
                .get(index)
                .is_some_and(|byte| is_name_start_byte(*byte))
            {
                return Err(SvgIdRewriteError::new(
                    MALFORMED_XML,
                    format!("invalid attribute on {name} at byte {index}"),
                ));
            }
            let attribute_name_start = index;
            while bytes.get(index).is_some_and(|byte| is_name_byte(*byte)) {
                index += 1;
            }
            let attribute_name = std::str::from_utf8(&bytes[attribute_name_start..index])
                .map_err(|_| SvgIdRewriteError::new(MALFORMED_XML, "invalid UTF-8 attribute name"))?
                .to_string();
            if !attribute_names.insert(attribute_name.clone()) {
                return Err(SvgIdRewriteError::new(
                    MALFORMED_XML,
                    format!("duplicate {attribute_name} attribute on {name}"),
                ));
            }
            while bytes.get(index).is_some_and(|byte| is_xml_space(*byte)) {
                index += 1;
            }
            if bytes.get(index) != Some(&b'=') {
                return Err(SvgIdRewriteError::new(
                    MALFORMED_XML,
                    format!("attribute {attribute_name} has no equals sign"),
                ));
            }
            index += 1;
            while bytes.get(index).is_some_and(|byte| is_xml_space(*byte)) {
                index += 1;
            }
            let Some(quote @ (b'"' | b'\'')) = bytes.get(index).copied() else {
                return Err(SvgIdRewriteError::new(
                    MALFORMED_XML,
                    format!("attribute {attribute_name} is not quoted"),
                ));
            };
            let value_start = index + 1;
            let value_end = find_byte(bytes, quote, value_start, bytes.len()).ok_or_else(|| {
                SvgIdRewriteError::new(
                    MALFORMED_XML,
                    format!("unterminated {attribute_name} value"),
                )
            })?;
            if find_byte(bytes, b'<', value_start, value_end).is_some() {
                return Err(SvgIdRewriteError::new(
                    MALFORMED_XML,
                    format!("attribute {attribute_name} contains an unescaped '<'"),
                ));
            }
            attributes.push(Attribute {
                name: attribute_name,
                value: value_start..value_end,
            });
            index = value_end + 1;
        }
        elements.push(Element { attributes });
        if name == "style" && !self_closing {
            style_stack.push(index);
        }
        cursor = index;
    }
    if !style_stack.is_empty() {
        return Err(SvgIdRewriteError::new(
            MALFORMED_XML,
            "unterminated <style>",
        ));
    }
    Ok(XmlScan {
        elements,
        style_bodies,
    })
}

fn is_valid_xml_code_point(code_point: u32) -> bool {
    matches!(code_point, 0x9 | 0xa | 0xd)
        || (0x20..=0xd7ff).contains(&code_point)
        || (0xe000..=0xfffd).contains(&code_point)
        || (0x1_0000..=0x0010_ffff).contains(&code_point)
}

fn decode_xml(raw: &str) -> Result<String, SvgIdRewriteError> {
    let mut output = String::new();
    let mut cursor = 0;
    while let Some(relative) = raw[cursor..].find('&') {
        let opening = cursor + relative;
        output.push_str(&raw[cursor..opening]);
        let Some(close_relative) = raw[opening + 1..].find(';') else {
            output.push_str(&raw[opening..]);
            return Ok(output);
        };
        let close = opening + 1 + close_relative;
        let entity = &raw[opening + 1..close];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                let code_point = u32::from_str_radix(&entity[2..], 16).map_err(|_| {
                    SvgIdRewriteError::new(MALFORMED_XML, format!("invalid entity &{entity};"))
                })?;
                if !is_valid_xml_code_point(code_point) {
                    return Err(SvgIdRewriteError::new(
                        MALFORMED_XML,
                        format!("invalid XML code point in &{entity};"),
                    ));
                }
                char::from_u32(code_point)
            }
            _ if entity.starts_with('#') => {
                let code_point = entity[1..].parse::<u32>().map_err(|_| {
                    SvgIdRewriteError::new(MALFORMED_XML, format!("invalid entity &{entity};"))
                })?;
                if !is_valid_xml_code_point(code_point) {
                    return Err(SvgIdRewriteError::new(
                        MALFORMED_XML,
                        format!("invalid XML code point in &{entity};"),
                    ));
                }
                char::from_u32(code_point)
            }
            _ => None,
        };
        if let Some(character) = decoded {
            output.push(character);
        } else {
            output.push_str(&raw[opening..=close]);
        }
        cursor = close + 1;
    }
    output.push_str(&raw[cursor..]);
    Ok(output)
}

fn decode_css_or_smil_escapes(raw: &str) -> Result<String, SvgIdRewriteError> {
    let characters: Vec<char> = raw.chars().collect();
    let mut output = String::new();
    let mut index = 0;
    while index < characters.len() {
        if characters[index] != '\\' {
            output.push(characters[index]);
            index += 1;
            continue;
        }
        index += 1;
        if index >= characters.len() {
            return Err(SvgIdRewriteError::new(
                UNSUPPORTED_REFERENCE,
                "trailing identifier escape",
            ));
        }
        let mut hex = String::new();
        while index < characters.len() && hex.len() < 6 && characters[index].is_ascii_hexdigit() {
            hex.push(characters[index]);
            index += 1;
        }
        if hex.is_empty() {
            output.push(characters[index]);
            index += 1;
            continue;
        }
        let code_point = u32::from_str_radix(&hex, 16).unwrap_or(0xfffd);
        output.push(
            char::from_u32(if code_point == 0 { 0xfffd } else { code_point }).unwrap_or('\u{fffd}'),
        );
        if characters
            .get(index)
            .is_some_and(|character| character.is_whitespace())
        {
            index += 1;
        }
    }
    Ok(output)
}

fn decode_reference(raw: &str, encoding: ReferenceEncoding) -> Result<String, SvgIdRewriteError> {
    let xml_decoded = decode_xml(raw)?;
    match encoding {
        ReferenceEncoding::Xml => Ok(xml_decoded),
        ReferenceEncoding::CssOrSmil => decode_css_or_smil_escapes(&xml_decoded),
    }
}

fn add_rewrite(rewrites: &mut Vec<Rewrite>, range: Range<usize>, prefix: &str, bytes: &[u8]) {
    if rewrites
        .iter()
        .any(|rewrite| rewrite.range.start == range.start && rewrite.range.end == range.end)
    {
        return;
    }
    let mut replacement = Vec::with_capacity(prefix.len() + range.len());
    replacement.extend_from_slice(prefix.as_bytes());
    replacement.extend_from_slice(&bytes[range.clone()]);
    rewrites.push(Rewrite { range, replacement });
}

fn add_local_reference(
    references: &mut Vec<ReferenceAt>,
    rewrites: &mut Vec<Rewrite>,
    reference: LocalReference<'_>,
    definitions: &HashSet<String>,
    prefix: &str,
    bytes: &[u8],
) -> Result<bool, SvgIdRewriteError> {
    let raw = std::str::from_utf8(&bytes[reference.range.clone()])
        .map_err(|_| SvgIdRewriteError::new(MALFORMED_XML, "invalid UTF-8 reference"))?;
    let id = decode_reference(raw, reference.encoding)?;
    if !definitions.contains(&id) {
        return Ok(false);
    }
    references.push(ReferenceAt {
        start: reference.range.start,
        value: ClassifiedReference {
            attribute: reference.attribute.to_string(),
            kind: reference.kind.to_string(),
            syntax: reference.syntax.to_string(),
            id,
        },
    });
    add_rewrite(rewrites, reference.range, prefix, bytes);
    Ok(true)
}

fn supports_url_reference(attribute_name: &str) -> bool {
    matches!(
        attribute_name,
        "clip-path"
            | "color-profile"
            | "cursor"
            | "fill"
            | "filter"
            | "marker"
            | "marker-start"
            | "marker-mid"
            | "marker-end"
            | "mask"
            | "stroke"
            | "style"
    )
}

fn scan_url_references(
    range: &Range<usize>,
    attribute: &str,
    definitions: &HashSet<String>,
    prefix: &str,
    bytes: &[u8],
    references: &mut Vec<ReferenceAt>,
    rewrites: &mut Vec<Rewrite>,
) -> Result<(), SvgIdRewriteError> {
    let mut cursor = range.start;
    while cursor < range.end {
        if starts_with(bytes, cursor, b"/*") {
            let end = find_subslice(bytes, b"*/", cursor + 2)
                .filter(|end| *end < range.end)
                .ok_or_else(|| {
                    SvgIdRewriteError::new(UNSUPPORTED_REFERENCE, "unterminated CSS comment")
                })?;
            cursor = end + 2;
            continue;
        }
        if matches!(bytes[cursor], b'"' | b'\'') {
            let quote = bytes[cursor];
            cursor += 1;
            while cursor < range.end {
                if bytes[cursor] == b'\\' {
                    cursor = (cursor + 2).min(range.end);
                } else if bytes[cursor] == quote {
                    cursor += 1;
                    break;
                } else {
                    cursor += 1;
                }
            }
            continue;
        }
        if cursor + 3 > range.end || !bytes[cursor..cursor + 3].eq_ignore_ascii_case(b"url") {
            cursor += 1;
            continue;
        }
        let previous = if cursor > range.start {
            bytes[cursor - 1]
        } else {
            0
        };
        if is_css_name_byte(previous) {
            cursor += 3;
            continue;
        }
        let mut index = cursor + 3;
        while index < range.end && is_xml_space(bytes[index]) {
            index += 1;
        }
        if bytes.get(index) != Some(&b'(') {
            cursor += 3;
            continue;
        }
        index += 1;
        while index < range.end && is_xml_space(bytes[index]) {
            index += 1;
        }
        let inner_quote = bytes
            .get(index)
            .copied()
            .filter(|byte| matches!(byte, b'"' | b'\''));
        if inner_quote.is_some() {
            index += 1;
        }
        while index < range.end && is_xml_space(bytes[index]) {
            index += 1;
        }
        if bytes.get(index) != Some(&b'#') {
            cursor = find_byte(bytes, b')', index, range.end).map_or(range.end, |close| close + 1);
            continue;
        }
        let id_start = index + 1;
        index = id_start;
        while index < range.end {
            let byte = bytes[index];
            if byte == b'\\' && index + 1 < range.end {
                index += 2;
            } else if inner_quote.is_some_and(|quote| byte == quote)
                || (inner_quote.is_none() && (is_xml_space(byte) || byte == b')'))
            {
                break;
            } else {
                index += 1;
            }
        }
        let id_end = index;
        let decoded_id = std::str::from_utf8(&bytes[id_start..id_end])
            .ok()
            .and_then(|raw| decode_reference(raw, ReferenceEncoding::CssOrSmil).ok());
        if let Some(quote) = inner_quote {
            if bytes.get(index) != Some(&quote) {
                if decoded_id
                    .as_ref()
                    .is_some_and(|id| definitions.contains(id))
                {
                    return Err(SvgIdRewriteError::new(
                        UNSUPPORTED_REFERENCE,
                        "unterminated quoted url()",
                    ));
                }
                // The malformed unknown function can still close before a
                // later declaration. Resume after that boundary so a valid
                // known-local url() later in the same style body is not lost.
                cursor =
                    find_byte(bytes, b')', index, range.end).map_or(range.end, |close| close + 1);
                continue;
            }
            index += 1;
        }
        while index < range.end && is_xml_space(bytes[index]) {
            index += 1;
        }
        if bytes.get(index) != Some(&b')') {
            if decoded_id
                .as_ref()
                .is_some_and(|id| definitions.contains(id))
            {
                return Err(SvgIdRewriteError::new(
                    UNSUPPORTED_REFERENCE,
                    "unterminated url()",
                ));
            }
            cursor = find_byte(bytes, b')', index, range.end).map_or(range.end, |close| close + 1);
            continue;
        }
        add_local_reference(
            references,
            rewrites,
            LocalReference {
                attribute,
                kind: "url",
                syntax: "url",
                range: id_start..id_end,
                encoding: ReferenceEncoding::CssOrSmil,
            },
            definitions,
            prefix,
            bytes,
        )?;
        cursor = index + 1;
    }
    Ok(())
}

fn scan_css_selector_hashes(
    range: &Range<usize>,
    definitions: &HashSet<String>,
    prefix: &str,
    bytes: &[u8],
    references: &mut Vec<ReferenceAt>,
    rewrites: &mut Vec<Rewrite>,
) -> Result<(), SvgIdRewriteError> {
    let mut cursor = range.start;
    while cursor < range.end {
        if starts_with(bytes, cursor, b"/*") {
            let end = find_subslice(bytes, b"*/", cursor + 2)
                .filter(|end| *end < range.end)
                .ok_or_else(|| {
                    SvgIdRewriteError::new(UNSUPPORTED_REFERENCE, "unterminated CSS comment")
                })?;
            cursor = end + 2;
            continue;
        }
        if matches!(bytes[cursor], b'"' | b'\'') {
            let quote = bytes[cursor];
            cursor += 1;
            while cursor < range.end && bytes[cursor] != quote {
                cursor += if bytes[cursor] == b'\\' { 2 } else { 1 };
                cursor = cursor.min(range.end);
            }
            cursor = (cursor + 1).min(range.end);
            continue;
        }
        if bytes[cursor] != b'#' {
            cursor += 1;
            continue;
        }
        let id_start = cursor + 1;
        let mut id_end = id_start;
        while id_end < range.end {
            let byte = bytes[id_end];
            if byte == b'\\' && id_end + 1 < range.end {
                id_end += 2;
            } else if is_css_name_byte(byte) || matches!(byte, b'&' | b';') {
                id_end += 1;
            } else {
                break;
            }
        }
        if id_end > id_start {
            add_local_reference(
                references,
                rewrites,
                LocalReference {
                    attribute: "style",
                    kind: "css-selector",
                    syntax: "id-selector",
                    range: id_start..id_end,
                    encoding: ReferenceEncoding::CssOrSmil,
                },
                definitions,
                prefix,
                bytes,
            )?;
        }
        cursor = id_end.max(cursor + 1);
    }
    Ok(())
}

fn scan_style_body(
    range: &Range<usize>,
    definitions: &HashSet<String>,
    prefix: &str,
    bytes: &[u8],
    references: &mut Vec<ReferenceAt>,
    rewrites: &mut Vec<Rewrite>,
) -> Result<(), SvgIdRewriteError> {
    scan_url_references(
        range,
        "style",
        definitions,
        prefix,
        bytes,
        references,
        rewrites,
    )?;
    let mut cursor = range.start;
    let mut prelude_start = cursor;
    let mut depth = 0_u32;
    while cursor < range.end {
        if starts_with(bytes, cursor, b"/*") {
            let end = find_subslice(bytes, b"*/", cursor + 2)
                .filter(|end| *end < range.end)
                .ok_or_else(|| {
                    SvgIdRewriteError::new(UNSUPPORTED_REFERENCE, "unterminated CSS comment")
                })?;
            cursor = end + 2;
            continue;
        }
        if matches!(bytes[cursor], b'"' | b'\'') {
            let quote = bytes[cursor];
            cursor += 1;
            while cursor < range.end && bytes[cursor] != quote {
                cursor += if bytes[cursor] == b'\\' { 2 } else { 1 };
                cursor = cursor.min(range.end);
            }
            cursor = (cursor + 1).min(range.end);
            continue;
        }
        if bytes[cursor] == b'{' {
            if depth > 0 {
                return Err(SvgIdRewriteError::new(
                    UNSUPPORTED_REFERENCE,
                    "nested CSS blocks are unsupported with contentIdPrefix",
                ));
            }
            let mut first = prelude_start;
            while first < cursor && is_xml_space(bytes[first]) {
                first += 1;
            }
            if bytes.get(first) == Some(&b'@') {
                return Err(SvgIdRewriteError::new(
                    UNSUPPORTED_REFERENCE,
                    "CSS block at-rules are unsupported with contentIdPrefix",
                ));
            }
            scan_css_selector_hashes(
                &(prelude_start..cursor),
                definitions,
                prefix,
                bytes,
                references,
                rewrites,
            )?;
            depth = 1;
        } else if bytes[cursor] == b'}' {
            if depth == 0 {
                return Err(SvgIdRewriteError::new(
                    UNSUPPORTED_REFERENCE,
                    "unbalanced CSS brace",
                ));
            }
            depth = 0;
            prelude_start = cursor + 1;
        }
        cursor += 1;
    }
    if depth != 0 {
        return Err(SvgIdRewriteError::new(
            UNSUPPORTED_REFERENCE,
            "unbalanced CSS block",
        ));
    }
    Ok(())
}

fn whitespace_tokens(attribute: &Attribute, bytes: &[u8]) -> Vec<Range<usize>> {
    let mut tokens = Vec::new();
    let mut cursor = attribute.value.start;
    while cursor < attribute.value.end {
        while cursor < attribute.value.end && is_xml_space(bytes[cursor]) {
            cursor += 1;
        }
        let start = cursor;
        while cursor < attribute.value.end && !is_xml_space(bytes[cursor]) {
            cursor += 1;
        }
        if cursor > start {
            tokens.push(start..cursor);
        }
    }
    tokens
}

fn aria_syntax(name: &str) -> Option<&'static str> {
    match name {
        "aria-activedescendant" | "aria-details" | "aria-errormessage" => Some("single"),
        "aria-controls" | "aria-describedby" | "aria-flowto" | "aria-labelledby" | "aria-owns" => {
            Some("list")
        }
        _ => None,
    }
}

fn scan_aria(
    attribute: &Attribute,
    syntax: &str,
    definitions: &HashSet<String>,
    prefix: &str,
    bytes: &[u8],
    references: &mut Vec<ReferenceAt>,
    rewrites: &mut Vec<Rewrite>,
) -> Result<(), SvgIdRewriteError> {
    let tokens = whitespace_tokens(attribute, bytes);
    if syntax == "single" && tokens.len() > 1 {
        let contains_known = tokens.iter().any(|token| {
            std::str::from_utf8(&bytes[token.clone()])
                .ok()
                .and_then(|raw| decode_xml(raw).ok())
                .is_some_and(|id| definitions.contains(&id))
        });
        if contains_known {
            return Err(SvgIdRewriteError::new(
                UNSUPPORTED_REFERENCE,
                format!("{} must contain one ID", attribute.name),
            ));
        }
        return Ok(());
    }
    for token in tokens {
        add_local_reference(
            references,
            rewrites,
            LocalReference {
                attribute: &attribute.name,
                kind: "aria",
                syntax,
                range: token,
                encoding: ReferenceEncoding::Xml,
            },
            definitions,
            prefix,
            bytes,
        )?;
    }
    Ok(())
}

fn split_smil_items(attribute: &Attribute, bytes: &[u8]) -> Vec<Range<usize>> {
    let mut items = Vec::new();
    let mut cursor = attribute.value.start;
    let mut start = cursor;
    let mut depth = 0_u32;
    let mut escaped = false;
    while cursor <= attribute.value.end {
        let at_end = cursor == attribute.value.end;
        let byte = bytes.get(cursor).copied().unwrap_or_default();
        if at_end || (byte == b';' && depth == 0 && !escaped) {
            let mut item_start = start;
            let mut item_end = cursor;
            while item_start < item_end && is_xml_space(bytes[item_start]) {
                item_start += 1;
            }
            while item_end > item_start && is_xml_space(bytes[item_end - 1]) {
                item_end -= 1;
            }
            if item_end > item_start {
                items.push(item_start..item_end);
            }
            start = cursor + 1;
            escaped = false;
            cursor += 1;
            continue;
        }
        if escaped {
            escaped = false;
        } else if byte == b'\\' {
            escaped = true;
        } else if byte == b'(' {
            depth += 1;
        } else if byte == b')' && depth > 0 {
            depth -= 1;
        }
        cursor += 1;
    }
    items
}

fn find_unescaped(bytes: &[u8], range: &Range<usize>, wanted: u8) -> Option<usize> {
    let mut escaped = false;
    for cursor in range.clone() {
        if escaped {
            escaped = false;
        } else if bytes[cursor] == b'\\' {
            escaped = true;
        } else if bytes[cursor] == wanted {
            return Some(cursor);
        }
    }
    None
}

fn local_candidate(bytes: &[u8], range: &Range<usize>, definitions: &HashSet<String>) -> bool {
    std::str::from_utf8(&bytes[range.clone()])
        .ok()
        .and_then(|raw| decode_reference(raw, ReferenceEncoding::CssOrSmil).ok())
        .is_some_and(|id| definitions.contains(&id))
}

fn valid_offset_suffix(suffix: &str) -> bool {
    let trimmed = suffix.trim();
    if trimmed.is_empty() {
        return true;
    }
    let Some(rest) = trimmed
        .strip_prefix('+')
        .or_else(|| trimmed.strip_prefix('-'))
    else {
        return false;
    };
    rest.trim_start()
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_digit() || character == '.')
}

fn classify_smil_suffix(suffix: &str) -> Option<&'static str> {
    for base in ["begin", "end"] {
        if let Some(rest) = suffix.strip_prefix(base) {
            if valid_offset_suffix(rest) {
                return Some("syncbase");
            }
        }
    }
    if let Some(rest) = suffix.strip_prefix("repeat(") {
        if let Some(close) = rest.find(')') {
            if !rest[..close].is_empty()
                && rest[..close]
                    .chars()
                    .all(|character| character.is_ascii_digit())
                && valid_offset_suffix(&rest[close + 1..])
            {
                return Some("repeat");
            }
        }
        return None;
    }
    if let Some(rest) = suffix.strip_prefix("marker(") {
        return rest.ends_with(')').then_some("marker");
    }
    let split = suffix
        .char_indices()
        .find(|(_, character)| matches!(character, '+' | '-'))
        .map_or(suffix.len(), |(index, _)| index);
    let event = &suffix[..split];
    let offset = &suffix[split..];
    let valid_event = event.chars().enumerate().all(|(index, character)| {
        if index == 0 {
            character.is_ascii_alphabetic() || matches!(character, '_' | ':')
        } else {
            character.is_ascii_alphanumeric() || matches!(character, '_' | ':' | '.')
        }
    });
    (!event.is_empty() && valid_event && valid_offset_suffix(offset)).then_some("eventbase")
}

fn is_offset_or_reserved(raw: &str) -> bool {
    let trimmed = raw.trim_start();
    let first = trimmed.chars().next();
    first.is_some_and(|character| {
        character.is_ascii_digit() || matches!(character, '+' | '-') || character == '.'
    }) || raw == "indefinite"
        || raw.starts_with("wallclock(")
        || raw.starts_with("accesskey(")
}

fn scan_smil(
    attribute: &Attribute,
    definitions: &HashSet<String>,
    prefix: &str,
    bytes: &[u8],
    references: &mut Vec<ReferenceAt>,
    rewrites: &mut Vec<Rewrite>,
) -> Result<(), SvgIdRewriteError> {
    for item in split_smil_items(attribute, bytes) {
        let raw = std::str::from_utf8(&bytes[item.clone()])
            .map_err(|_| SvgIdRewriteError::new(MALFORMED_XML, "invalid UTF-8 SMIL item"))?;
        if is_offset_or_reserved(raw) {
            continue;
        }
        if let Some(after_open) = raw.strip_prefix("id(") {
            let Some(close) = after_open.find(')') else {
                let candidate = item.start + 3..item.end;
                if local_candidate(bytes, &candidate, definitions) {
                    return Err(SvgIdRewriteError::new(
                        UNSUPPORTED_REFERENCE,
                        "unterminated deprecated id()",
                    ));
                }
                continue;
            };
            let id_start = item.start + 3;
            let id_end = id_start + close;
            add_local_reference(
                references,
                rewrites,
                LocalReference {
                    attribute: &attribute.name,
                    kind: "smil",
                    syntax: "deprecated-id",
                    range: id_start..id_end,
                    encoding: ReferenceEncoding::CssOrSmil,
                },
                definitions,
                prefix,
                bytes,
            )?;
            continue;
        }
        let Some(separator) = find_unescaped(bytes, &item, b'.') else {
            continue;
        };
        let id_range = item.start..separator;
        let known = local_candidate(bytes, &id_range, definitions);
        let suffix = std::str::from_utf8(&bytes[separator + 1..item.end])
            .map_err(|_| SvgIdRewriteError::new(MALFORMED_XML, "invalid UTF-8 SMIL suffix"))?;
        let Some(syntax) = classify_smil_suffix(suffix) else {
            if known {
                return Err(SvgIdRewriteError::new(
                    UNSUPPORTED_REFERENCE,
                    format!("unsupported {} item {raw}", attribute.name),
                ));
            }
            continue;
        };
        add_local_reference(
            references,
            rewrites,
            LocalReference {
                attribute: &attribute.name,
                kind: "smil",
                syntax,
                range: id_range,
                encoding: ReferenceEncoding::CssOrSmil,
            },
            definitions,
            prefix,
            bytes,
        )?;
    }
    Ok(())
}

fn apply_rewrites(bytes: &[u8], rewrites: &[Rewrite]) -> Result<String, SvgIdRewriteError> {
    let mut ordered = rewrites.to_vec();
    ordered.sort_by_key(|rewrite| (rewrite.range.start, rewrite.range.end));
    let mut output = Vec::with_capacity(
        bytes.len()
            + ordered
                .iter()
                .map(|rewrite| rewrite.replacement.len() - rewrite.range.len())
                .sum::<usize>(),
    );
    let mut cursor = 0;
    for rewrite in ordered {
        if rewrite.range.start < cursor {
            return Err(SvgIdRewriteError::new(
                UNSUPPORTED_REFERENCE,
                "overlapping SVG ID references",
            ));
        }
        output.extend_from_slice(&bytes[cursor..rewrite.range.start]);
        output.extend_from_slice(&rewrite.replacement);
        cursor = rewrite.range.end;
    }
    output.extend_from_slice(&bytes[cursor..]);
    String::from_utf8(output)
        .map_err(|_| SvgIdRewriteError::new(MALFORMED_XML, "invalid UTF-8 output"))
}

fn rewrite_svg_ids_with_report(
    input: &str,
    prefix: &str,
) -> Result<RewriteReport, SvgIdRewriteError> {
    if prefix.is_empty() {
        return Ok(RewriteReport {
            output: input.to_string(),
            #[cfg(test)]
            definitions: Vec::new(),
            #[cfg(test)]
            references: Vec::new(),
        });
    }
    let scan = scan_xml(input)?;
    let bytes = input.as_bytes();
    #[cfg(test)]
    let mut definitions = Vec::new();
    let mut definition_set = HashSet::new();
    let mut rewrites = Vec::new();
    for element in &scan.elements {
        for attribute in &element.attributes {
            if attribute.name != "id" {
                continue;
            }
            let raw = std::str::from_utf8(&bytes[attribute.value.clone()])
                .map_err(|_| SvgIdRewriteError::new(MALFORMED_XML, "invalid UTF-8 ID"))?;
            let decoded = decode_xml(raw)?;
            if decoded.is_empty() {
                continue;
            }
            #[cfg(test)]
            definitions.push(decoded.clone());
            definition_set.insert(decoded);
            add_rewrite(&mut rewrites, attribute.value.clone(), prefix, bytes);
        }
    }

    let mut references = Vec::new();
    for element in &scan.elements {
        for attribute in &element.attributes {
            if attribute.name == "id" {
                continue;
            }
            if matches!(attribute.name.as_str(), "href" | "xlink:href")
                && bytes.get(attribute.value.start) == Some(&b'#')
            {
                let kind = if attribute.name == "xlink:href" {
                    "xlink:href"
                } else {
                    "href"
                };
                add_local_reference(
                    &mut references,
                    &mut rewrites,
                    LocalReference {
                        attribute: &attribute.name,
                        kind,
                        syntax: "fragment",
                        range: attribute.value.start + 1..attribute.value.end,
                        encoding: ReferenceEncoding::Xml,
                    },
                    &definition_set,
                    prefix,
                    bytes,
                )?;
            }
            if let Some(syntax) = aria_syntax(&attribute.name) {
                scan_aria(
                    attribute,
                    syntax,
                    &definition_set,
                    prefix,
                    bytes,
                    &mut references,
                    &mut rewrites,
                )?;
            }
            if matches!(attribute.name.as_str(), "begin" | "end") {
                scan_smil(
                    attribute,
                    &definition_set,
                    prefix,
                    bytes,
                    &mut references,
                    &mut rewrites,
                )?;
            }
            if supports_url_reference(&attribute.name) {
                scan_url_references(
                    &attribute.value,
                    &attribute.name,
                    &definition_set,
                    prefix,
                    bytes,
                    &mut references,
                    &mut rewrites,
                )?;
            }
        }
    }
    for style_body in &scan.style_bodies {
        scan_style_body(
            style_body,
            &definition_set,
            prefix,
            bytes,
            &mut references,
            &mut rewrites,
        )?;
    }
    references.sort_by(|left, right| {
        left.start
            .cmp(&right.start)
            .then_with(|| left.value.attribute.cmp(&right.value.attribute))
            .then_with(|| left.value.kind.cmp(&right.value.kind))
            .then_with(|| left.value.syntax.cmp(&right.value.syntax))
            .then_with(|| left.value.id.cmp(&right.value.id))
    });
    let output = apply_rewrites(bytes, &rewrites)?;
    #[cfg(test)]
    let classified_references = references
        .into_iter()
        .map(|reference| reference.value)
        .collect();
    Ok(RewriteReport {
        output,
        #[cfg(test)]
        definitions,
        #[cfg(test)]
        references: classified_references,
    })
}

pub(super) fn rewrite_svg_ids(input: &str, prefix: &str) -> Result<String, SvgIdRewriteError> {
    rewrite_svg_ids_with_report(input, prefix).map(|report| report.output)
}

#[cfg(test)]
mod tests {
    use super::{ClassifiedReference, rewrite_svg_ids_with_report};
    use serde_json::Value;

    fn fixture() -> Value {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../fixtures/conformance/embedded-svg-id-reference-cases.json"
        ))
        .expect("embedded SVG ID conformance fixture should parse");
        assert_eq!(fixture["schemaVersion"].as_u64(), Some(1));
        fixture
    }

    fn fixture_text<'a>(value: &'a Value, key: &str) -> &'a str {
        value[key]
            .as_str()
            .unwrap_or_else(|| panic!("fixture {key} should be a string"))
    }

    fn fixture_definitions(fixture_case: &Value) -> Vec<String> {
        fixture_case["definitions"]
            .as_array()
            .map(|definitions| {
                definitions
                    .iter()
                    .map(|definition| {
                        definition
                            .as_str()
                            .expect("fixture definition should be a string")
                            .to_string()
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn fixture_references(fixture_case: &Value) -> Vec<ClassifiedReference> {
        fixture_case["references"]
            .as_array()
            .map(|references| {
                references
                    .iter()
                    .map(|reference| ClassifiedReference {
                        attribute: fixture_text(reference, "attribute").to_string(),
                        kind: fixture_text(reference, "kind").to_string(),
                        syntax: fixture_text(reference, "syntax").to_string(),
                        id: fixture_text(reference, "id").to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn shared_conformance_fixture_matches_expected_rewrites() {
        let fixture = fixture();
        let prefix = fixture_text(&fixture, "prefix");
        let cases = fixture["cases"]
            .as_array()
            .expect("fixture cases should be an array");
        for fixture_case in cases {
            let name = fixture_text(fixture_case, "name");
            let input = fixture_text(fixture_case, "input");
            let result = rewrite_svg_ids_with_report(input, prefix);
            if fixture_text(fixture_case, "status") == "error" {
                let error = result.expect_err(name);
                assert_eq!(Some(error.code), fixture_case["error"].as_str(), "{name}");
                continue;
            }
            let report =
                result.unwrap_or_else(|error| panic!("{name}: {}: {}", error.code, error.detail));
            assert_eq!(
                report.definitions,
                fixture_definitions(fixture_case),
                "{name}"
            );
            assert_eq!(
                report.references,
                fixture_references(fixture_case),
                "{name}"
            );
            assert_eq!(
                Some(report.output.as_str()),
                fixture_case["output"].as_str(),
                "{name}"
            );
        }
    }

    #[test]
    fn empty_prefix_bypasses_scanning_and_preserves_every_byte() {
        let fixture = fixture();
        let cases = fixture["cases"]
            .as_array()
            .expect("fixture cases should be an array");
        for fixture_case in cases {
            let name = fixture_text(fixture_case, "name");
            let input = fixture_text(fixture_case, "input");
            let first = rewrite_svg_ids_with_report(input, "")
                .unwrap_or_else(|error| panic!("{name}: {}", error.detail));
            let second = rewrite_svg_ids_with_report(input, "")
                .unwrap_or_else(|error| panic!("{name}: {}", error.detail));
            assert_eq!(first.output.as_bytes(), input.as_bytes());
            assert_eq!(first.output, second.output);
        }
    }

    #[test]
    fn rewrite_is_deterministic_and_closed_under_a_second_prefix() {
        let fixture = fixture();
        let cases = fixture["cases"]
            .as_array()
            .expect("fixture cases should be an array");
        for fixture_case in cases
            .iter()
            .filter(|fixture_case| fixture_text(fixture_case, "status") == "ok")
        {
            let name = fixture_text(fixture_case, "name");
            let input = fixture_text(fixture_case, "input");
            let first = rewrite_svg_ids_with_report(input, "p-")
                .unwrap_or_else(|error| panic!("{name}: {}", error.detail));
            let repeated = rewrite_svg_ids_with_report(input, "p-")
                .unwrap_or_else(|error| panic!("{name}: {}", error.detail));
            assert_eq!(first.output, repeated.output, "{name}");

            let second = rewrite_svg_ids_with_report(&first.output, "q-")
                .unwrap_or_else(|error| panic!("{name}: {}", error.detail));
            assert!(
                second
                    .definitions
                    .iter()
                    .all(|definition| definition.starts_with("p-")),
                "{name}: {:?}",
                second.definitions
            );
            assert!(
                second.references.iter().all(|reference| second
                    .definitions
                    .iter()
                    .any(|definition| definition == &reference.id)),
                "{name}: {:?}",
                second.references
            );
        }
    }
}
