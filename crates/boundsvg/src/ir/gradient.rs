//! CSS gradient parser.
//!
//! Parses `linear-gradient(...)` and `radial-gradient(...)` CSS strings
//! into structured `Gradient` types for SVG emission.

use super::types::{Gradient, GradientStop, RadialGradientGeometry};

/// Try to parse a CSS gradient string.
/// Returns `None` if the string is not a gradient (i.e., a solid color).
///
/// Supports:
/// - `linear-gradient(angle, color stop, ...)`
/// - `radial-gradient(color stop, ...)`
#[must_use]
pub fn parse_gradient(value: &str) -> Option<Gradient> {
    parse_gradient_for_box(value, 1.0, 1.0)
}

/// Whether the value claims to use one of the gradient functions implemented
/// by boundsvg. Used to distinguish invalid gradient syntax from a solid fill.
#[must_use]
pub(crate) fn is_supported_gradient_function(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.starts_with("linear-gradient(") || lower.starts_with("radial-gradient(")
}

/// Parse a gradient after layout has resolved its gradient box.
#[must_use]
pub(crate) fn parse_gradient_for_box(value: &str, width: f64, height: f64) -> Option<Gradient> {
    let trimmed = value.trim();

    if function_content(trimmed, "linear-gradient").is_some() {
        return parse_linear_gradient(trimmed, width, height);
    }
    if function_content(trimmed, "radial-gradient").is_some() {
        return parse_radial_gradient(trimmed, width, height);
    }

    None
}

fn parse_linear_gradient(value: &str, width: f64, height: f64) -> Option<Gradient> {
    let inner = function_content(value, "linear-gradient")?;
    let parts = split_gradient_args(inner);
    if parts.len() < 2 {
        return None;
    }

    let mut angle = 180.0_f64; // default: to bottom
    let mut stops_start = 0;

    // Check if first part is an angle or direction
    let first_part = parts[0].trim();
    if let Some(parsed_angle) = parse_angle_or_direction(first_part, width, height) {
        angle = parsed_angle;
        stops_start = 1;
    } else if parse_color_stop(first_part).is_none() {
        // Never discard an angle-looking or otherwise unknown prelude and
        // silently render it as the default `to bottom` direction.
        return None;
    }

    let stops = parse_stops(&parts[stops_start..])?;
    if stops.len() < 2 {
        return None;
    }

    Some(Gradient::Linear { angle, stops })
}

fn parse_radial_gradient(value: &str, width: f64, height: f64) -> Option<Gradient> {
    let inner = function_content(value, "radial-gradient")?;
    let parts = split_gradient_args(inner);
    if parts.len() < 2 {
        return None;
    }

    let first_part = parts[0].trim();
    let (geometry, stops_start) = if parse_color_stop(first_part).is_some() {
        (
            resolve_radial_geometry(
                width,
                height,
                RadialShape::Ellipse,
                RadialExtent::FarthestCorner,
                0.5,
                0.5,
            ),
            0,
        )
    } else {
        (parse_radial_prelude(first_part, width, height)?, 1)
    };

    let stops = parse_stops(&parts[stops_start..])?;
    if stops.len() < 2 {
        return None;
    }

    Some(Gradient::Radial {
        geometry: Some(geometry),
        stops,
    })
}

fn function_content<'a>(value: &'a str, expected_name: &str) -> Option<&'a str> {
    let open = value.find('(')?;
    if !value[..open].trim().eq_ignore_ascii_case(expected_name) || !value.ends_with(')') {
        return None;
    }
    Some(&value[open + 1..value.len() - 1])
}

/// Split gradient arguments respecting nested parentheses (for `rgb()`, `rgba()`, etc.).
fn split_gradient_args(inner: &str) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut depth = 0i32;
    let mut current = String::new();

    for ch in inner.chars() {
        if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth -= 1;
        }

        if ch == ',' && depth == 0 {
            parts.push(current.clone());
            current.clear();
        } else {
            current.push(ch);
        }
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        parts.push(current);
    }

    parts
}

fn parse_angle_or_direction(part: &str, width: f64, height: f64) -> Option<f64> {
    // CSS angles use the standard deg/grad/rad/turn units. A unitless zero is
    // also valid; all other unitless numbers remain invalid.
    if let Some(value) = parse_suffixed_css_number(part, "deg") {
        return Some(value);
    }
    if let Some(value) = parse_suffixed_css_number(part, "grad") {
        return Some(value * 0.9);
    }
    if let Some(value) = parse_suffixed_css_number(part, "rad") {
        return Some(value.to_degrees());
    }
    if let Some(value) = parse_suffixed_css_number(part, "turn") {
        return Some(value * 360.0);
    }
    if parse_css_number(part).is_some_and(|value| value == 0.0) {
        return Some(0.0);
    }

    let lower = part.to_ascii_lowercase();
    let tokens: Vec<&str> = lower.split_ascii_whitespace().collect();
    let directions = tokens.strip_prefix(&["to"])?;
    match directions {
        ["top"] => Some(0.0),
        ["right"] => Some(90.0),
        ["bottom"] => Some(180.0),
        ["left"] => Some(270.0),
        [first, second] => {
            let horizontal = [*first, *second]
                .into_iter()
                .find(|token| matches!(*token, "left" | "right"))?;
            let vertical = [*first, *second]
                .into_iter()
                .find(|token| matches!(*token, "top" | "bottom"))?;
            Some(corner_direction_angle(horizontal, vertical, width, height))
        }
        _ => None,
    }
}

fn corner_direction_angle(horizontal: &str, vertical: &str, width: f64, height: f64) -> f64 {
    let horizontal_sign = if horizontal == "right" { 1.0 } else { -1.0 };
    let vertical_screen_sign = if vertical == "bottom" { 1.0 } else { -1.0 };
    let direction_x = horizontal_sign * height.abs();
    let direction_y = vertical_screen_sign * width.abs();
    direction_x
        .atan2(-direction_y)
        .to_degrees()
        .rem_euclid(360.0)
}

fn parse_suffixed_css_number(part: &str, suffix: &str) -> Option<f64> {
    let lower = part.to_ascii_lowercase();
    parse_css_number(lower.strip_suffix(suffix)?)
}

fn parse_css_number(text: &str) -> Option<f64> {
    let bytes = text.as_bytes();
    let mut index = 0;
    if matches!(bytes.first(), Some(b'+' | b'-')) {
        index += 1;
    }

    let integer_start = index;
    while bytes.get(index).is_some_and(u8::is_ascii_digit) {
        index += 1;
    }
    let integer_digits = index - integer_start;

    let mut fraction_digits = 0;
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let fraction_start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        fraction_digits = index - fraction_start;
        if fraction_digits == 0 {
            return None;
        }
    }
    if integer_digits == 0 && fraction_digits == 0 {
        return None;
    }

    if matches!(bytes.get(index), Some(b'e' | b'E')) {
        index += 1;
        if matches!(bytes.get(index), Some(b'+' | b'-')) {
            index += 1;
        }
        let exponent_start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        if index == exponent_start {
            return None;
        }
    }

    if index != bytes.len() {
        return None;
    }
    text.parse::<f64>().ok().filter(|value| value.is_finite())
}

#[derive(Debug)]
struct ParsedColorStop {
    color: String,
    offset: Option<f64>,
}

fn parse_stops(parts: &[String]) -> Option<Vec<GradientStop>> {
    let mut parsed_stops = Vec::with_capacity(parts.len());

    for part in parts {
        parsed_stops.push(parse_color_stop(part.trim())?);
    }
    if parsed_stops.len() < 2 {
        return None;
    }

    // CSS Images color-stop fixup: pin the endpoints, prevent decreasing
    // explicit offsets, then evenly distribute each run of omitted offsets.
    if parsed_stops.first()?.offset.is_none() {
        parsed_stops.first_mut()?.offset = Some(0.0);
    }
    if parsed_stops.last()?.offset.is_none() {
        parsed_stops.last_mut()?.offset = Some(1.0);
    }

    let mut previous_offset = parsed_stops.first()?.offset?;
    for parsed_stop in parsed_stops.iter_mut().skip(1) {
        if let Some(offset) = parsed_stop.offset {
            let fixed_offset = offset.max(previous_offset);
            parsed_stop.offset = Some(fixed_offset);
            previous_offset = fixed_offset;
        }
    }

    let mut run_start = 1;
    while run_start + 1 < parsed_stops.len() {
        if parsed_stops[run_start].offset.is_some() {
            run_start += 1;
            continue;
        }
        let run_end = (run_start + 1..parsed_stops.len())
            .find(|index| parsed_stops[*index].offset.is_some())?;
        let lower = parsed_stops[run_start - 1].offset?;
        let upper = parsed_stops[run_end].offset?;
        let step = (upper - lower) / (run_end - run_start + 1) as f64;
        for (run_offset, parsed_stop) in parsed_stops[run_start..run_end].iter_mut().enumerate() {
            parsed_stop.offset = Some(lower + step * (run_offset + 1) as f64);
        }
        run_start = run_end + 1;
    }

    parsed_stops
        .into_iter()
        .map(|parsed_stop| {
            Some(GradientStop {
                color: parsed_stop.color,
                offset: parsed_stop.offset?,
            })
        })
        .collect()
}

fn parse_color_stop(part: &str) -> Option<ParsedColorStop> {
    if let Some(without_percent) = part.strip_suffix('%') {
        let mut fields = without_percent.rsplitn(2, char::is_whitespace);
        let offset_pct = parse_css_number(fields.next()?.trim())?;
        let color = fields.next()?.trim();
        if !is_valid_color(color) || !(0.0..=100.0).contains(&offset_pct) {
            return None;
        }
        return Some(ParsedColorStop {
            color: color.to_string(),
            offset: Some(offset_pct / 100.0),
        });
    }

    is_valid_color(part).then(|| ParsedColorStop {
        color: part.to_string(),
        offset: None,
    })
}

#[derive(Debug, Clone, Copy)]
enum RadialShape {
    Circle,
    Ellipse,
}

#[derive(Debug, Clone, Copy)]
enum RadialExtent {
    ClosestSide,
    FarthestSide,
    ClosestCorner,
    FarthestCorner,
}

fn parse_radial_prelude(prelude: &str, width: f64, height: f64) -> Option<RadialGradientGeometry> {
    let lower = prelude.to_ascii_lowercase();
    let tokens: Vec<&str> = lower.split_ascii_whitespace().collect();
    let at_index = tokens.iter().position(|token| *token == "at");
    if tokens.iter().filter(|token| **token == "at").count() > 1 {
        return None;
    }

    let (geometry_tokens, position_tokens) = match at_index {
        Some(index) => (&tokens[..index], &tokens[index + 1..]),
        None => (tokens.as_slice(), &[][..]),
    };
    if geometry_tokens.is_empty() && position_tokens.is_empty() {
        return None;
    }

    let mut shape = None;
    let mut extent = None;
    for token in geometry_tokens {
        match *token {
            "circle" if shape.is_none() => shape = Some(RadialShape::Circle),
            "ellipse" if shape.is_none() => shape = Some(RadialShape::Ellipse),
            "closest-side" if extent.is_none() => extent = Some(RadialExtent::ClosestSide),
            "farthest-side" if extent.is_none() => extent = Some(RadialExtent::FarthestSide),
            "closest-corner" if extent.is_none() => extent = Some(RadialExtent::ClosestCorner),
            "farthest-corner" if extent.is_none() => extent = Some(RadialExtent::FarthestCorner),
            _ => return None,
        }
    }

    let (center_x, center_y) = if position_tokens.is_empty() {
        (0.5, 0.5)
    } else {
        parse_radial_position(position_tokens)?
    };
    Some(resolve_radial_geometry(
        width,
        height,
        shape.unwrap_or(RadialShape::Ellipse),
        extent.unwrap_or(RadialExtent::FarthestCorner),
        center_x,
        center_y,
    ))
}

#[derive(Debug, Clone, Copy)]
enum PositionComponent {
    Horizontal(f64),
    Vertical(f64),
    Center,
    Percentage(f64),
}

fn parse_position_component(token: &str) -> Option<PositionComponent> {
    match token {
        "left" => Some(PositionComponent::Horizontal(0.0)),
        "right" => Some(PositionComponent::Horizontal(1.0)),
        "top" => Some(PositionComponent::Vertical(0.0)),
        "bottom" => Some(PositionComponent::Vertical(1.0)),
        "center" => Some(PositionComponent::Center),
        _ => {
            let percent = parse_css_number(token.strip_suffix('%')?)?;
            (0.0..=100.0)
                .contains(&percent)
                .then_some(PositionComponent::Percentage(percent / 100.0))
        }
    }
}

fn parse_radial_position(tokens: &[&str]) -> Option<(f64, f64)> {
    let components: Vec<PositionComponent> = tokens
        .iter()
        .map(|token| parse_position_component(token))
        .collect::<Option<_>>()?;

    match components.as_slice() {
        [PositionComponent::Horizontal(x) | PositionComponent::Percentage(x)] => Some((*x, 0.5)),
        [PositionComponent::Vertical(y)] => Some((0.5, *y)),
        [PositionComponent::Center] => Some((0.5, 0.5)),
        [first, second] => parse_two_component_position(*first, *second),
        _ => None,
    }
}

fn parse_two_component_position(
    first: PositionComponent,
    second: PositionComponent,
) -> Option<(f64, f64)> {
    use PositionComponent::{Center, Horizontal, Percentage, Vertical};

    match (first, second) {
        (Horizontal(x) | Percentage(x), Vertical(y) | Percentage(y))
        | (Vertical(y) | Percentage(y), Horizontal(x))
        | (Vertical(y), Percentage(x)) => Some((x, y)),
        (Horizontal(x) | Percentage(x), Center) | (Center, Horizontal(x)) => Some((x, 0.5)),
        (Vertical(y), Center) | (Center, Vertical(y) | Percentage(y)) => Some((0.5, y)),
        (Center, Center) => Some((0.5, 0.5)),
        _ => None,
    }
}

fn resolve_radial_geometry(
    width: f64,
    height: f64,
    shape: RadialShape,
    extent: RadialExtent,
    center_x_fraction: f64,
    center_y_fraction: f64,
) -> RadialGradientGeometry {
    let box_width = width.abs();
    let box_height = height.abs();
    let center_x = box_width * center_x_fraction;
    let center_y = box_height * center_y_fraction;
    let horizontal_distances = [center_x, box_width - center_x];
    let vertical_distances = [center_y, box_height - center_y];

    let (radius_x, radius_y) = match shape {
        RadialShape::Circle => {
            let radius = match extent {
                RadialExtent::ClosestSide => horizontal_distances
                    .into_iter()
                    .chain(vertical_distances)
                    .fold(f64::INFINITY, f64::min),
                RadialExtent::FarthestSide => horizontal_distances
                    .into_iter()
                    .chain(vertical_distances)
                    .fold(0.0_f64, f64::max),
                RadialExtent::ClosestCorner => {
                    corner_distances(horizontal_distances, vertical_distances)
                        .into_iter()
                        .fold(f64::INFINITY, f64::min)
                }
                RadialExtent::FarthestCorner => {
                    corner_distances(horizontal_distances, vertical_distances)
                        .into_iter()
                        .fold(0.0_f64, f64::max)
                }
            };
            (radius, radius)
        }
        RadialShape::Ellipse => {
            resolve_ellipse_radii(horizontal_distances, vertical_distances, extent)
        }
    };

    RadialGradientGeometry {
        center_x,
        center_y,
        radius_x,
        radius_y,
    }
}

fn corner_distances(horizontal: [f64; 2], vertical: [f64; 2]) -> [f64; 4] {
    [
        horizontal[0].hypot(vertical[0]),
        horizontal[0].hypot(vertical[1]),
        horizontal[1].hypot(vertical[0]),
        horizontal[1].hypot(vertical[1]),
    ]
}

fn resolve_ellipse_radii(
    horizontal: [f64; 2],
    vertical: [f64; 2],
    extent: RadialExtent,
) -> (f64, f64) {
    let closest = matches!(
        extent,
        RadialExtent::ClosestSide | RadialExtent::ClosestCorner
    );
    let radius_x = if closest {
        horizontal.into_iter().fold(f64::INFINITY, f64::min)
    } else {
        horizontal.into_iter().fold(0.0_f64, f64::max)
    };
    let radius_y = if closest {
        vertical.into_iter().fold(f64::INFINITY, f64::min)
    } else {
        vertical.into_iter().fold(0.0_f64, f64::max)
    };

    if matches!(
        extent,
        RadialExtent::ClosestSide | RadialExtent::FarthestSide
    ) || radius_x == 0.0
        || radius_y == 0.0
    {
        return (radius_x, radius_y);
    }

    let corner_scale_factors = [
        (horizontal[0] / radius_x).hypot(vertical[0] / radius_y),
        (horizontal[0] / radius_x).hypot(vertical[1] / radius_y),
        (horizontal[1] / radius_x).hypot(vertical[0] / radius_y),
        (horizontal[1] / radius_x).hypot(vertical[1] / radius_y),
    ];
    let scale_factor = if closest {
        corner_scale_factors
            .into_iter()
            .fold(f64::INFINITY, f64::min)
    } else {
        corner_scale_factors.into_iter().fold(0.0_f64, f64::max)
    };
    (radius_x * scale_factor, radius_y * scale_factor)
}

/// CSS color validation matching TS `parseColor` behavior exactly: a color
/// is valid iff `parseColor` would not throw. That includes its quirks —
/// case-sensitive function names, digit/dot-only numeric tokens, and NaN
/// values (e.g. a `1.2.3` alpha) passing the range guards.
pub(crate) fn is_valid_color(value: &str) -> bool {
    let trimmed = value.trim();

    // Hex colors (#RGB / #RRGGBB / #RRGGBBAA)
    if let Some(hex) = trimmed.strip_prefix('#') {
        return matches!(hex.len(), 3 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit());
    }

    // rgb(r,g,b) — function names are case-sensitive in the TS regexes
    if let Some(inner) = trimmed
        .strip_prefix("rgb(")
        .and_then(|r| r.strip_suffix(')'))
    {
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() != 3 {
            return false;
        }
        return parts.iter().all(|p| is_rgb_component_0_255(p.trim()));
    }

    // rgba(r,g,b,a)
    if let Some(inner) = trimmed
        .strip_prefix("rgba(")
        .and_then(|r| r.strip_suffix(')'))
    {
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() != 4 {
            return false;
        }
        return parts[..3].iter().all(|p| is_rgb_component_0_255(p.trim()))
            && is_unit_fraction_lenient(parts[3].trim());
    }

    // hsl(h,s%,l%)
    if let Some(inner) = trimmed
        .strip_prefix("hsl(")
        .and_then(|r| r.strip_suffix(')'))
    {
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() != 3 {
            return false;
        }
        return is_digit_dot_token(parts[0].trim())
            && is_percent_0_100_lenient(parts[1].trim())
            && is_percent_0_100_lenient(parts[2].trim());
    }

    // hsla(h,s%,l%,a)
    if let Some(inner) = trimmed
        .strip_prefix("hsla(")
        .and_then(|r| r.strip_suffix(')'))
    {
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() != 4 {
            return false;
        }
        return is_digit_dot_token(parts[0].trim())
            && is_percent_0_100_lenient(parts[1].trim())
            && is_percent_0_100_lenient(parts[2].trim())
            && is_unit_fraction_lenient(parts[3].trim());
    }

    let lowered = trimmed.to_lowercase();

    // "transparent"
    if lowered == "transparent" {
        return true;
    }

    // CSS named colors (case-insensitive)
    is_css_named_color(&lowered)
}

/// TS `\d{1,3}` component followed by the `> 255` guard.
fn is_rgb_component_0_255(token: &str) -> bool {
    (1..=3).contains(&token.len())
        && token.bytes().all(|byte| byte.is_ascii_digit())
        && token.parse::<u32>().is_ok_and(|component| component <= 255)
}

/// TS `[\d.]+` token shape (digits and dots only, non-empty).
fn is_digit_dot_token(token: &str) -> bool {
    !token.is_empty()
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
}

/// TS alpha guard: `[\d.]+` then reject only when `Number(...) > 1`.
/// A multi-dot token is NaN in JS and passes the guard, so a parse
/// failure here counts as valid.
fn is_unit_fraction_lenient(token: &str) -> bool {
    if !is_digit_dot_token(token) {
        return false;
    }
    match token.parse::<f64>() {
        Ok(alpha) => alpha <= 1.0,
        Err(_) => true,
    }
}

/// TS saturation/lightness guard: `[\d.]+%` then reject only when the
/// number exceeds 0-100 (NaN passes, like the alpha guard).
fn is_percent_0_100_lenient(token: &str) -> bool {
    let Some(number_text) = token.strip_suffix('%') else {
        return false;
    };
    is_digit_dot_token(number_text)
        && match number_text.parse::<f64>() {
            Ok(fraction) => (0.0..=100.0).contains(&fraction),
            Err(_) => true,
        }
}

/// Check if a string is a CSS named color.
/// Includes all 148 CSS color names.
fn is_css_named_color(name: &str) -> bool {
    matches!(
        name,
        "aliceblue"
            | "antiquewhite"
            | "aqua"
            | "aquamarine"
            | "azure"
            | "beige"
            | "bisque"
            | "black"
            | "blanchedalmond"
            | "blue"
            | "blueviolet"
            | "brown"
            | "burlywood"
            | "cadetblue"
            | "chartreuse"
            | "chocolate"
            | "coral"
            | "cornflowerblue"
            | "cornsilk"
            | "crimson"
            | "cyan"
            | "darkblue"
            | "darkcyan"
            | "darkgoldenrod"
            | "darkgray"
            | "darkgreen"
            | "darkgrey"
            | "darkkhaki"
            | "darkmagenta"
            | "darkolivegreen"
            | "darkorange"
            | "darkorchid"
            | "darkred"
            | "darksalmon"
            | "darkseagreen"
            | "darkslateblue"
            | "darkslategray"
            | "darkslategrey"
            | "darkturquoise"
            | "darkviolet"
            | "deeppink"
            | "deepskyblue"
            | "dimgray"
            | "dimgrey"
            | "dodgerblue"
            | "firebrick"
            | "floralwhite"
            | "forestgreen"
            | "fuchsia"
            | "gainsboro"
            | "ghostwhite"
            | "gold"
            | "goldenrod"
            | "gray"
            | "green"
            | "greenyellow"
            | "grey"
            | "honeydew"
            | "hotpink"
            | "indianred"
            | "indigo"
            | "ivory"
            | "khaki"
            | "lavender"
            | "lavenderblush"
            | "lawngreen"
            | "lemonchiffon"
            | "lightblue"
            | "lightcoral"
            | "lightcyan"
            | "lightgoldenrodyellow"
            | "lightgray"
            | "lightgreen"
            | "lightgrey"
            | "lightpink"
            | "lightsalmon"
            | "lightseagreen"
            | "lightskyblue"
            | "lightslategray"
            | "lightslategrey"
            | "lightsteelblue"
            | "lightyellow"
            | "lime"
            | "limegreen"
            | "linen"
            | "magenta"
            | "maroon"
            | "mediumaquamarine"
            | "mediumblue"
            | "mediumorchid"
            | "mediumpurple"
            | "mediumseagreen"
            | "mediumslateblue"
            | "mediumspringgreen"
            | "mediumturquoise"
            | "mediumvioletred"
            | "midnightblue"
            | "mintcream"
            | "mistyrose"
            | "moccasin"
            | "navajowhite"
            | "navy"
            | "oldlace"
            | "olive"
            | "olivedrab"
            | "orange"
            | "orangered"
            | "orchid"
            | "palegoldenrod"
            | "palegreen"
            | "paleturquoise"
            | "palevioletred"
            | "papayawhip"
            | "peachpuff"
            | "peru"
            | "pink"
            | "plum"
            | "powderblue"
            | "purple"
            | "rebeccapurple"
            | "red"
            | "rosybrown"
            | "royalblue"
            | "saddlebrown"
            | "salmon"
            | "sandybrown"
            | "seagreen"
            | "seashell"
            | "sienna"
            | "silver"
            | "skyblue"
            | "slateblue"
            | "slategray"
            | "slategrey"
            | "snow"
            | "springgreen"
            | "steelblue"
            | "tan"
            | "teal"
            | "thistle"
            | "tomato"
            | "turquoise"
            | "violet"
            | "wheat"
            | "white"
            | "whitesmoke"
            | "yellow"
            | "yellowgreen"
    )
}

/// Convert CSS gradient angle (0=top, 90=right) to SVG linearGradient x1/y1/x2/y2.
/// Returns user-space coordinates relative to the gradient box origin.
///
/// Per CSS, the angle points from the gradient line's start toward its end,
/// so 0deg ("to top") places the first stop on the bottom edge. SVG y grows
/// downward, hence the start point uses `+cos`, not `-cos`. The CSS gradient
/// line length is `abs(width * sin(angle)) + abs(height * cos(angle))`; using
/// user-space units preserves both that length and the authored angle on
/// non-square boxes.
#[must_use]
pub fn angle_to_svg_coords(angle_deg: f64, width: f64, height: f64) -> (f64, f64, f64, f64) {
    let rad = angle_deg.to_radians();
    let direction_x = rad.sin();
    let direction_y = -rad.cos();
    let line_half_length =
        (width.abs() * direction_x.abs() + height.abs() * direction_y.abs()) * 0.5;
    let center_x = width * 0.5;
    let center_y = height * 0.5;
    let x1 = center_x - direction_x * line_half_length;
    let y1 = center_y - direction_y * line_half_length;
    let x2 = center_x + direction_x * line_half_length;
    let y2 = center_y + direction_y * line_half_length;
    (x1, y1, x2, y2)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    #[test]
    fn color_function_names_are_case_sensitive_like_ts() {
        // TS regexes have no /i flag on rgb()/hsl(); uppercase falls through
        // to the named-color lookup and fails.
        assert!(parse_gradient("linear-gradient(RGB(255,0,0), blue)").is_none());
        assert!(parse_gradient("linear-gradient(rgb(255,0,0), blue)").is_some());
    }

    #[test]
    fn hsl_hue_rejects_sign_and_exponent_like_ts() {
        // TS hue class is [\d.]+ — no sign, no exponent.
        assert!(parse_gradient("linear-gradient(hsl(-10,50%,50%), blue)").is_none());
        assert!(parse_gradient("linear-gradient(hsl(1e2,50%,50%), blue)").is_none());
        assert!(parse_gradient("linear-gradient(hsl(100,50%,50%), blue)").is_some());
    }

    #[test]
    fn degenerate_alpha_is_nan_valid_like_ts() {
        // Number("1.2.3") is NaN in JS and NaN passes the 0..1 range guard.
        assert!(parse_gradient("linear-gradient(rgba(0,0,0,1.2.3), blue)").is_some());
        assert!(parse_gradient("linear-gradient(rgba(0,0,0,1.5), blue)").is_none());
    }

    #[test]
    fn angle_accepts_css_number_syntax() {
        assert!(parse_gradient("linear-gradient(.5deg, red, blue)").is_some());
        let Some(Gradient::Linear { angle, stops }) =
            parse_gradient("linear-gradient(.5deg, red, blue)")
        else {
            panic!("expected linear gradient");
        };
        assert_eq!(angle, 0.5);
        assert_eq!(stops.len(), 2);

        // Case-insensitive suffix, like the TS /i flag
        let Some(Gradient::Linear { angle, .. }) =
            parse_gradient("linear-gradient(45DEG, red, blue)")
        else {
            panic!("expected linear gradient");
        };
        assert_eq!(angle, 45.0);

        let Some(Gradient::Linear { angle, .. }) =
            parse_gradient("linear-gradient(+45deg, red, blue)")
        else {
            panic!("expected linear gradient");
        };
        assert_eq!(angle, 45.0);

        let Some(Gradient::Linear { angle, .. }) =
            parse_gradient("linear-gradient(1e2deg, red, blue)")
        else {
            panic!("expected linear gradient");
        };
        assert_eq!(angle, 100.0);
    }

    use super::*;

    #[test]
    fn test_parse_linear_gradient_basic() {
        let g = parse_gradient("linear-gradient(red, blue)").unwrap();
        match g {
            Gradient::Linear { angle, stops } => {
                assert_eq!(angle, 180.0); // default: to bottom
                assert_eq!(stops.len(), 2);
                assert_eq!(stops[0].color, "red");
                assert!((stops[0].offset - 0.0).abs() < f64::EPSILON);
                assert_eq!(stops[1].color, "blue");
                assert!((stops[1].offset - 1.0).abs() < f64::EPSILON);
            }
            Gradient::Radial { .. } => panic!("expected linear gradient"),
        }
    }

    #[test]
    fn test_parse_linear_gradient_with_angle() {
        let g = parse_gradient("linear-gradient(45deg, #ff0000, #0000ff)").unwrap();
        match g {
            Gradient::Linear { angle, stops } => {
                assert_eq!(angle, 45.0);
                assert_eq!(stops.len(), 2);
                assert_eq!(stops[0].color, "#ff0000");
                assert_eq!(stops[1].color, "#0000ff");
            }
            Gradient::Radial { .. } => panic!("expected linear gradient"),
        }
    }

    #[test]
    fn test_parse_linear_gradient_with_direction() {
        let g = parse_gradient("linear-gradient(to right, red, blue)").unwrap();
        match g {
            Gradient::Linear { angle, .. } => {
                assert_eq!(angle, 90.0);
            }
            Gradient::Radial { .. } => panic!("expected linear gradient"),
        }
    }

    #[test]
    fn test_parse_linear_gradient_with_stops() {
        let g = parse_gradient("linear-gradient(90deg, red 0%, green 50%, blue 100%)").unwrap();
        match g {
            Gradient::Linear { stops, .. } => {
                assert_eq!(stops.len(), 3);
                assert_eq!(stops[0].color, "red");
                assert!((stops[0].offset - 0.0).abs() < f64::EPSILON);
                assert_eq!(stops[1].color, "green");
                assert!((stops[1].offset - 0.5).abs() < f64::EPSILON);
                assert_eq!(stops[2].color, "blue");
                assert!((stops[2].offset - 1.0).abs() < f64::EPSILON);
            }
            Gradient::Radial { .. } => panic!("expected linear gradient"),
        }
    }

    #[test]
    fn test_parse_linear_gradient_rgba() {
        let g = parse_gradient("linear-gradient(rgba(255,0,0,0.5), rgba(0,0,255,1))").unwrap();
        match g {
            Gradient::Linear { stops, .. } => {
                assert_eq!(stops.len(), 2);
                assert_eq!(stops[0].color, "rgba(255,0,0,0.5)");
            }
            Gradient::Radial { .. } => panic!("expected linear gradient"),
        }
    }

    #[test]
    fn test_parse_radial_gradient() {
        let g = parse_gradient("radial-gradient(red, blue)").unwrap();
        match g {
            Gradient::Radial { geometry, stops } => {
                assert_eq!(stops.len(), 2);
                assert_eq!(stops[0].color, "red");
                assert_eq!(stops[1].color, "blue");
                let geometry = geometry.expect("resolved radial geometry");
                assert!((geometry.center_x - 0.5).abs() < 1e-10);
                assert!((geometry.center_y - 0.5).abs() < 1e-10);
                assert!((geometry.radius_x - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-10);
                assert!((geometry.radius_y - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-10);
            }
            Gradient::Linear { .. } => panic!("expected radial gradient"),
        }
    }

    #[test]
    fn test_parse_gradient_not_gradient() {
        assert!(parse_gradient("#ff0000").is_none());
        assert!(parse_gradient("red").is_none());
        assert!(parse_gradient("rgb(255,0,0)").is_none());
    }

    #[test]
    fn test_parse_gradient_too_few_stops() {
        assert!(parse_gradient("linear-gradient(red)").is_none());
    }

    #[test]
    fn test_parse_angle_or_direction_deg() {
        assert_eq!(parse_angle_or_direction("45deg", 100.0, 100.0), Some(45.0));
        assert_eq!(
            parse_angle_or_direction("-90deg", 100.0, 100.0),
            Some(-90.0)
        );
        assert_eq!(parse_angle_or_direction("0deg", 100.0, 100.0), Some(0.0));
    }

    #[test]
    fn test_parse_angle_or_direction_turn() {
        assert_eq!(
            parse_angle_or_direction("0.5turn", 100.0, 100.0),
            Some(180.0)
        );
        assert_eq!(parse_angle_or_direction("1turn", 100.0, 100.0), Some(360.0));
        assert_eq!(
            parse_angle_or_direction("100grad", 100.0, 100.0),
            Some(90.0)
        );
        assert!(
            parse_angle_or_direction("1.5707963267948966rad", 100.0, 100.0)
                .is_some_and(|angle| (angle - 90.0).abs() < 1e-10)
        );
    }

    #[test]
    fn test_parse_angle_or_direction_keywords() {
        assert_eq!(parse_angle_or_direction("to top", 160.0, 90.0), Some(0.0));
        assert_eq!(
            parse_angle_or_direction("to right", 160.0, 90.0),
            Some(90.0)
        );
        assert_eq!(
            parse_angle_or_direction("to bottom", 160.0, 90.0),
            Some(180.0)
        );
        assert_eq!(
            parse_angle_or_direction("to left", 160.0, 90.0),
            Some(270.0)
        );
        let top_right =
            parse_angle_or_direction("to top right", 160.0, 90.0).expect("top-right direction");
        let right_top =
            parse_angle_or_direction("to right top", 160.0, 90.0).expect("reversed keyword order");
        assert!((top_right - 29.357_753_542_791_276).abs() < 1e-10);
        assert!((right_top - top_right).abs() < 1e-10);
    }

    #[test]
    fn test_angle_to_svg_coords_0deg() {
        // 0deg = to top: the first stop sits on the bottom edge (CSS §3.1),
        // so the SVG gradient line runs bottom → top.
        // x1 = 100, y1 = 100, x2 = 100, y2 = 0
        let (x1, y1, x2, y2) = angle_to_svg_coords(0.0, 200.0, 100.0);
        assert!((x1 - 100.0).abs() < 1e-10);
        assert!((y1 - 100.0).abs() < 1e-10);
        assert!((x2 - 100.0).abs() < 1e-10);
        assert!(y2.abs() < 1e-10);
    }

    #[test]
    fn test_angle_to_svg_coords_90deg() {
        // 90deg = to right: rad = (90-90)*PI/180 = 0
        // cos(0) = 1, sin(0) = 0
        // x1 = 0, y1 = 50, x2 = 200, y2 = 50
        let (x1, y1, x2, y2) = angle_to_svg_coords(90.0, 200.0, 100.0);
        assert!(x1.abs() < 1e-10);
        assert!((y1 - 50.0).abs() < 1e-10);
        assert!((x2 - 200.0).abs() < 1e-10);
        assert!((y2 - 50.0).abs() < 1e-10);
    }

    #[test]
    fn test_angle_to_svg_coords_180deg() {
        // 180deg = to bottom: the first stop sits on the top edge, so the
        // SVG gradient line runs top → bottom.
        // x1 = 100, y1 = 0, x2 = 100, y2 = 100
        let (x1, y1, x2, y2) = angle_to_svg_coords(180.0, 200.0, 100.0);
        assert!((x1 - 100.0).abs() < 1e-10);
        assert!(y1.abs() < 1e-10);
        assert!((x2 - 100.0).abs() < 1e-10);
        assert!((y2 - 100.0).abs() < 1e-10);
    }

    #[test]
    fn diagonal_angle_keeps_css_angle_and_gradient_line_length() {
        let (x1, y1, x2, y2) = angle_to_svg_coords(45.0, 1920.0, 1080.0);
        assert!(((y1 - y2) / (x2 - x1) - 1.0).abs() < 1e-10);
        let line_length = (x2 - x1).hypot(y2 - y1);
        let expected_length = (1920.0 + 1080.0) * std::f64::consts::FRAC_1_SQRT_2;
        assert!((line_length - expected_length).abs() < 1e-10);
    }

    #[test]
    fn radial_circle_position_and_extent_are_resolved_from_the_box() {
        let Some(Gradient::Radial {
            geometry: Some(geometry),
            ..
        }) = parse_gradient_for_box(
            "radial-gradient(circle at 100% 100%, red, blue)",
            200.0,
            100.0,
        )
        else {
            panic!("expected radial gradient geometry");
        };
        assert!((geometry.center_x - 200.0).abs() < 1e-10);
        assert!((geometry.center_y - 100.0).abs() < 1e-10);
        assert!((geometry.radius_x - 200.0_f64.hypot(100.0)).abs() < 1e-10);
        assert!((geometry.radius_y - geometry.radius_x).abs() < 1e-10);
    }

    #[test]
    fn unknown_preludes_do_not_fall_back_to_default_geometry() {
        assert!(parse_gradient("linear-gradient(45degrees, red, blue)").is_none());
        assert!(parse_gradient("radial-gradient(square at left, red, blue)").is_none());
    }

    #[test]
    fn omitted_stops_are_distributed_between_explicit_neighbors() {
        let Some(Gradient::Linear { stops, .. }) =
            parse_gradient("linear-gradient(red 20%, yellow, green, blue 80%)")
        else {
            panic!("expected linear gradient");
        };
        for (stop, expected) in stops.iter().zip([0.2, 0.4, 0.6, 0.8]) {
            assert!((stop.offset - expected).abs() < 1e-10);
        }
    }

    #[test]
    fn test_is_valid_color() {
        // Valid colors
        assert!(is_valid_color("#f00"));
        assert!(is_valid_color("#ff0000"));
        assert!(is_valid_color("#ff000080"));
        assert!(is_valid_color("rgb(255,0,0)"));
        assert!(is_valid_color("rgba(255,0,0,0.5)"));
        assert!(is_valid_color("hsl(0,100%,50%)"));
        assert!(is_valid_color("hsla(0,100%,50%,0.5)"));
        assert!(is_valid_color("red"));
        assert!(is_valid_color("transparent"));
        assert!(!is_valid_color("not-a-color"));
        assert!(!is_valid_color(""));
    }

    #[test]
    fn test_is_valid_color_rejects_invalid_rgb() {
        // rgb values must be 0-255
        assert!(!is_valid_color("rgb(999,0,0)"));
        assert!(!is_valid_color("rgb(0,256,0)"));
        assert!(!is_valid_color("rgb(0,0,300)"));
        // Must have exactly 3 components
        assert!(!is_valid_color("rgb(0,0)"));
        assert!(!is_valid_color("rgb(0,0,0,0)"));
        // Non-numeric args
        assert!(!is_valid_color("rgb(foo,0,0)"));
    }

    #[test]
    fn test_is_valid_color_rejects_invalid_rgba() {
        // rgb values must be 0-255
        assert!(!is_valid_color("rgba(999,0,0,1)"));
        // alpha must be 0-1
        assert!(!is_valid_color("rgba(0,0,0,2)"));
        assert!(!is_valid_color("rgba(0,0,0,-0.5)"));
        // Must have exactly 4 components
        assert!(!is_valid_color("rgba(0,0,0)"));
    }

    #[test]
    fn test_is_valid_color_rejects_invalid_hsl() {
        // s/l must be 0-100%
        assert!(!is_valid_color("hsl(0,200%,50%)"));
        assert!(!is_valid_color("hsl(0,50%,200%)"));
        // Must have % suffix
        assert!(!is_valid_color("hsl(0,50,50%)"));
        // Must have exactly 3 components
        assert!(!is_valid_color("hsl(0,50%)"));
    }

    #[test]
    fn test_is_valid_color_rejects_invalid_hsla() {
        // alpha must be 0-1
        assert!(!is_valid_color("hsla(0,100%,50%,2)"));
        assert!(!is_valid_color("hsla(0,100%,50%,-1)"));
    }

    #[test]
    fn test_split_gradient_args_nested() {
        let parts = split_gradient_args("rgba(255,0,0,0.5), rgba(0,0,255,1)");
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].trim(), "rgba(255,0,0,0.5)");
        assert_eq!(parts[1].trim(), "rgba(0,0,255,1)");
    }
}
