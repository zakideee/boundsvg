/// UTR#50 `Vertical_Orientation` property lookup.
///
/// Classifies code points by their vertical orientation behavior:
/// - U (Upright): displayed upright in vertical text
/// - R (Rotated): rotated 90° clockwise in vertical text
/// - Tu (Transformed Upright): special-cased, treated as upright in mixed mode
/// - Tr (Transformed Rotated): special-cased, treated as upright in mixed mode
///
/// In text-orientation: mixed (default for CJK vertical text):
///   U, Tu, Tr → upright
///   R → rotated (sideways)
///
/// Reference: Unicode Technical Report #50 — Unicode Vertical Text Layout.
/// Generated from Unicode 17.0.0 `VerticalOrientation.txt` (2025-07-24).

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum VerticalOrientation {
    /// Upright — CJK ideographs, kana, etc.
    U,
    /// Rotated — Latin, Cyrillic, most scripts
    R,
    /// Transformed Upright — characters that need special handling, treated as upright in mixed
    Tu,
    /// Transformed Rotated — characters specially rotated, treated as upright in mixed
    Tr,
}

/// Range table entry: (start, `end_inclusive`, orientation)
/// Ranges where orientation is R are omitted (R is the default).
/// U, Tu, and Tr ranges are listed; R is the default.
static ORIENTATION_RANGES: &[(u32, u32, VerticalOrientation)] = &[
    (0x00A7, 0x00A7, VerticalOrientation::U),
    (0x00A9, 0x00A9, VerticalOrientation::U),
    (0x00AE, 0x00AE, VerticalOrientation::U),
    (0x00B1, 0x00B1, VerticalOrientation::U),
    (0x00BC, 0x00BE, VerticalOrientation::U),
    (0x00D7, 0x00D7, VerticalOrientation::U),
    (0x00F7, 0x00F7, VerticalOrientation::U),
    (0x02EA, 0x02EB, VerticalOrientation::U),
    (0x1100, 0x11FF, VerticalOrientation::U),
    (0x1401, 0x166C, VerticalOrientation::U),
    (0x166D, 0x166D, VerticalOrientation::U),
    (0x166E, 0x166E, VerticalOrientation::U),
    (0x166F, 0x167F, VerticalOrientation::U),
    (0x18B0, 0x18F5, VerticalOrientation::U),
    (0x18F6, 0x18FF, VerticalOrientation::U),
    (0x2016, 0x2016, VerticalOrientation::U),
    (0x2018, 0x2018, VerticalOrientation::Tr),
    (0x2019, 0x2019, VerticalOrientation::Tr),
    (0x201C, 0x201C, VerticalOrientation::Tr),
    (0x201D, 0x201D, VerticalOrientation::Tr),
    (0x2020, 0x2021, VerticalOrientation::U),
    (0x2030, 0x2031, VerticalOrientation::U),
    (0x203B, 0x203C, VerticalOrientation::U),
    (0x2042, 0x2042, VerticalOrientation::U),
    (0x2047, 0x2049, VerticalOrientation::U),
    (0x2051, 0x2051, VerticalOrientation::U),
    (0x2065, 0x2065, VerticalOrientation::U),
    (0x20DD, 0x20E0, VerticalOrientation::U),
    (0x20E2, 0x20E4, VerticalOrientation::U),
    (0x2100, 0x2101, VerticalOrientation::U),
    (0x2103, 0x2106, VerticalOrientation::U),
    (0x2107, 0x2107, VerticalOrientation::U),
    (0x2108, 0x2109, VerticalOrientation::U),
    (0x210F, 0x210F, VerticalOrientation::U),
    (0x2113, 0x2113, VerticalOrientation::U),
    (0x2114, 0x2114, VerticalOrientation::U),
    (0x2116, 0x2117, VerticalOrientation::U),
    (0x211E, 0x2123, VerticalOrientation::U),
    (0x2125, 0x2125, VerticalOrientation::U),
    (0x2127, 0x2127, VerticalOrientation::U),
    (0x2129, 0x2129, VerticalOrientation::U),
    (0x212E, 0x212E, VerticalOrientation::U),
    (0x2135, 0x2138, VerticalOrientation::U),
    (0x2139, 0x2139, VerticalOrientation::U),
    (0x213A, 0x213B, VerticalOrientation::U),
    (0x213C, 0x213F, VerticalOrientation::U),
    (0x2145, 0x2149, VerticalOrientation::U),
    (0x214A, 0x214A, VerticalOrientation::U),
    (0x214C, 0x214D, VerticalOrientation::U),
    (0x214F, 0x214F, VerticalOrientation::U),
    (0x2150, 0x215F, VerticalOrientation::U),
    (0x2160, 0x2182, VerticalOrientation::U),
    (0x2183, 0x2184, VerticalOrientation::U),
    (0x2185, 0x2188, VerticalOrientation::U),
    (0x2189, 0x2189, VerticalOrientation::U),
    (0x218C, 0x218F, VerticalOrientation::U),
    (0x221E, 0x221E, VerticalOrientation::U),
    (0x2234, 0x2235, VerticalOrientation::U),
    (0x2300, 0x2307, VerticalOrientation::U),
    (0x230C, 0x231F, VerticalOrientation::U),
    (0x2324, 0x2328, VerticalOrientation::U),
    (0x2329, 0x2329, VerticalOrientation::Tr),
    (0x232A, 0x232A, VerticalOrientation::Tr),
    (0x232B, 0x232B, VerticalOrientation::U),
    (0x237D, 0x239A, VerticalOrientation::U),
    (0x23BE, 0x23CD, VerticalOrientation::U),
    (0x23CF, 0x23CF, VerticalOrientation::U),
    (0x23D1, 0x23DB, VerticalOrientation::U),
    (0x23E2, 0x23FF, VerticalOrientation::U),
    (0x2400, 0x2422, VerticalOrientation::U),
    (0x2424, 0x2429, VerticalOrientation::U),
    (0x242A, 0x243F, VerticalOrientation::U),
    (0x2440, 0x244A, VerticalOrientation::U),
    (0x244B, 0x245F, VerticalOrientation::U),
    (0x2460, 0x249B, VerticalOrientation::U),
    (0x249C, 0x24E9, VerticalOrientation::U),
    (0x24EA, 0x24FF, VerticalOrientation::U),
    (0x25A0, 0x25B6, VerticalOrientation::U),
    (0x25B7, 0x25B7, VerticalOrientation::U),
    (0x25B8, 0x25C0, VerticalOrientation::U),
    (0x25C1, 0x25C1, VerticalOrientation::U),
    (0x25C2, 0x25F7, VerticalOrientation::U),
    (0x25F8, 0x25FF, VerticalOrientation::U),
    (0x2600, 0x2619, VerticalOrientation::U),
    (0x2620, 0x266E, VerticalOrientation::U),
    (0x266F, 0x266F, VerticalOrientation::U),
    (0x2670, 0x26FF, VerticalOrientation::U),
    (0x2700, 0x2767, VerticalOrientation::U),
    (0x2776, 0x2793, VerticalOrientation::U),
    (0x2B12, 0x2B2F, VerticalOrientation::U),
    (0x2B50, 0x2B59, VerticalOrientation::U),
    (0x2B97, 0x2B97, VerticalOrientation::U),
    (0x2BB8, 0x2BD1, VerticalOrientation::U),
    (0x2BD3, 0x2BEB, VerticalOrientation::U),
    (0x2BF0, 0x2BFF, VerticalOrientation::U),
    (0x2E50, 0x2E51, VerticalOrientation::U),
    (0x2E80, 0x2E99, VerticalOrientation::U),
    (0x2E9A, 0x2E9A, VerticalOrientation::U),
    (0x2E9B, 0x2EF3, VerticalOrientation::U),
    (0x2EF4, 0x2EFF, VerticalOrientation::U),
    (0x2F00, 0x2FD5, VerticalOrientation::U),
    (0x2FD6, 0x2FDF, VerticalOrientation::U),
    (0x2FE0, 0x2FEF, VerticalOrientation::U),
    (0x2FF0, 0x2FFF, VerticalOrientation::U),
    (0x3000, 0x3000, VerticalOrientation::U),
    (0x3001, 0x3002, VerticalOrientation::Tu),
    (0x3003, 0x3003, VerticalOrientation::U),
    (0x3004, 0x3004, VerticalOrientation::U),
    (0x3005, 0x3005, VerticalOrientation::U),
    (0x3006, 0x3006, VerticalOrientation::U),
    (0x3007, 0x3007, VerticalOrientation::U),
    (0x3008, 0x3008, VerticalOrientation::Tr),
    (0x3009, 0x3009, VerticalOrientation::Tr),
    (0x300A, 0x300A, VerticalOrientation::Tr),
    (0x300B, 0x300B, VerticalOrientation::Tr),
    (0x300C, 0x300C, VerticalOrientation::Tr),
    (0x300D, 0x300D, VerticalOrientation::Tr),
    (0x300E, 0x300E, VerticalOrientation::Tr),
    (0x300F, 0x300F, VerticalOrientation::Tr),
    (0x3010, 0x3010, VerticalOrientation::Tr),
    (0x3011, 0x3011, VerticalOrientation::Tr),
    (0x3012, 0x3013, VerticalOrientation::U),
    (0x3014, 0x3014, VerticalOrientation::Tr),
    (0x3015, 0x3015, VerticalOrientation::Tr),
    (0x3016, 0x3016, VerticalOrientation::Tr),
    (0x3017, 0x3017, VerticalOrientation::Tr),
    (0x3018, 0x3018, VerticalOrientation::Tr),
    (0x3019, 0x3019, VerticalOrientation::Tr),
    (0x301A, 0x301A, VerticalOrientation::Tr),
    (0x301B, 0x301B, VerticalOrientation::Tr),
    (0x301C, 0x301C, VerticalOrientation::Tr),
    (0x301D, 0x301D, VerticalOrientation::Tr),
    (0x301E, 0x301F, VerticalOrientation::Tr),
    (0x3020, 0x3020, VerticalOrientation::U),
    (0x3021, 0x3029, VerticalOrientation::U),
    (0x302A, 0x302D, VerticalOrientation::U),
    (0x302E, 0x302F, VerticalOrientation::U),
    (0x3030, 0x3030, VerticalOrientation::Tr),
    (0x3031, 0x3035, VerticalOrientation::U),
    (0x3036, 0x3037, VerticalOrientation::U),
    (0x3038, 0x303A, VerticalOrientation::U),
    (0x303B, 0x303B, VerticalOrientation::U),
    (0x303C, 0x303C, VerticalOrientation::U),
    (0x303D, 0x303D, VerticalOrientation::U),
    (0x303E, 0x303F, VerticalOrientation::U),
    (0x3040, 0x3040, VerticalOrientation::U),
    (0x3041, 0x3041, VerticalOrientation::Tu),
    (0x3042, 0x3042, VerticalOrientation::U),
    (0x3043, 0x3043, VerticalOrientation::Tu),
    (0x3044, 0x3044, VerticalOrientation::U),
    (0x3045, 0x3045, VerticalOrientation::Tu),
    (0x3046, 0x3046, VerticalOrientation::U),
    (0x3047, 0x3047, VerticalOrientation::Tu),
    (0x3048, 0x3048, VerticalOrientation::U),
    (0x3049, 0x3049, VerticalOrientation::Tu),
    (0x304A, 0x3062, VerticalOrientation::U),
    (0x3063, 0x3063, VerticalOrientation::Tu),
    (0x3064, 0x3082, VerticalOrientation::U),
    (0x3083, 0x3083, VerticalOrientation::Tu),
    (0x3084, 0x3084, VerticalOrientation::U),
    (0x3085, 0x3085, VerticalOrientation::Tu),
    (0x3086, 0x3086, VerticalOrientation::U),
    (0x3087, 0x3087, VerticalOrientation::Tu),
    (0x3088, 0x308D, VerticalOrientation::U),
    (0x308E, 0x308E, VerticalOrientation::Tu),
    (0x308F, 0x3094, VerticalOrientation::U),
    (0x3095, 0x3096, VerticalOrientation::Tu),
    (0x3097, 0x3098, VerticalOrientation::U),
    (0x3099, 0x309A, VerticalOrientation::U),
    (0x309B, 0x309C, VerticalOrientation::Tu),
    (0x309D, 0x309E, VerticalOrientation::U),
    (0x309F, 0x309F, VerticalOrientation::U),
    (0x30A0, 0x30A0, VerticalOrientation::Tr),
    (0x30A1, 0x30A1, VerticalOrientation::Tu),
    (0x30A2, 0x30A2, VerticalOrientation::U),
    (0x30A3, 0x30A3, VerticalOrientation::Tu),
    (0x30A4, 0x30A4, VerticalOrientation::U),
    (0x30A5, 0x30A5, VerticalOrientation::Tu),
    (0x30A6, 0x30A6, VerticalOrientation::U),
    (0x30A7, 0x30A7, VerticalOrientation::Tu),
    (0x30A8, 0x30A8, VerticalOrientation::U),
    (0x30A9, 0x30A9, VerticalOrientation::Tu),
    (0x30AA, 0x30C2, VerticalOrientation::U),
    (0x30C3, 0x30C3, VerticalOrientation::Tu),
    (0x30C4, 0x30E2, VerticalOrientation::U),
    (0x30E3, 0x30E3, VerticalOrientation::Tu),
    (0x30E4, 0x30E4, VerticalOrientation::U),
    (0x30E5, 0x30E5, VerticalOrientation::Tu),
    (0x30E6, 0x30E6, VerticalOrientation::U),
    (0x30E7, 0x30E7, VerticalOrientation::Tu),
    (0x30E8, 0x30ED, VerticalOrientation::U),
    (0x30EE, 0x30EE, VerticalOrientation::Tu),
    (0x30EF, 0x30F4, VerticalOrientation::U),
    (0x30F5, 0x30F6, VerticalOrientation::Tu),
    (0x30F7, 0x30FA, VerticalOrientation::U),
    (0x30FB, 0x30FB, VerticalOrientation::U),
    (0x30FC, 0x30FC, VerticalOrientation::Tr),
    (0x30FD, 0x30FE, VerticalOrientation::U),
    (0x30FF, 0x30FF, VerticalOrientation::U),
    (0x3100, 0x3104, VerticalOrientation::U),
    (0x3105, 0x3126, VerticalOrientation::U),
    (0x3127, 0x3127, VerticalOrientation::Tu),
    (0x3128, 0x312F, VerticalOrientation::U),
    (0x3130, 0x3130, VerticalOrientation::U),
    (0x3131, 0x318E, VerticalOrientation::U),
    (0x318F, 0x318F, VerticalOrientation::U),
    (0x3190, 0x3191, VerticalOrientation::U),
    (0x3192, 0x3195, VerticalOrientation::U),
    (0x3196, 0x319F, VerticalOrientation::U),
    (0x31A0, 0x31B3, VerticalOrientation::U),
    (0x31B4, 0x31B7, VerticalOrientation::Tu),
    (0x31B8, 0x31BA, VerticalOrientation::U),
    (0x31BB, 0x31BB, VerticalOrientation::Tu),
    (0x31BC, 0x31BF, VerticalOrientation::U),
    (0x31C0, 0x31E5, VerticalOrientation::U),
    (0x31E6, 0x31EE, VerticalOrientation::U),
    (0x31EF, 0x31EF, VerticalOrientation::U),
    (0x31F0, 0x31FF, VerticalOrientation::Tu),
    (0x3200, 0x321E, VerticalOrientation::U),
    (0x321F, 0x321F, VerticalOrientation::U),
    (0x3220, 0x3229, VerticalOrientation::U),
    (0x322A, 0x3247, VerticalOrientation::U),
    (0x3248, 0x324F, VerticalOrientation::U),
    (0x3250, 0x3250, VerticalOrientation::U),
    (0x3251, 0x325F, VerticalOrientation::U),
    (0x3260, 0x327F, VerticalOrientation::U),
    (0x3280, 0x3289, VerticalOrientation::U),
    (0x328A, 0x32B0, VerticalOrientation::U),
    (0x32B1, 0x32BF, VerticalOrientation::U),
    (0x32C0, 0x32FE, VerticalOrientation::U),
    (0x32FF, 0x32FF, VerticalOrientation::Tu),
    (0x3300, 0x3357, VerticalOrientation::Tu),
    (0x3358, 0x337A, VerticalOrientation::U),
    (0x337B, 0x337F, VerticalOrientation::Tu),
    (0x3380, 0x33FF, VerticalOrientation::U),
    (0x3400, 0x4DBF, VerticalOrientation::U),
    (0x4DC0, 0x4DFF, VerticalOrientation::U),
    (0x4E00, 0x9FFF, VerticalOrientation::U),
    (0xA000, 0xA014, VerticalOrientation::U),
    (0xA015, 0xA015, VerticalOrientation::U),
    (0xA016, 0xA48C, VerticalOrientation::U),
    (0xA48D, 0xA48F, VerticalOrientation::U),
    (0xA490, 0xA4C6, VerticalOrientation::U),
    (0xA4C7, 0xA4CF, VerticalOrientation::U),
    (0xA960, 0xA97C, VerticalOrientation::U),
    (0xA97D, 0xA97F, VerticalOrientation::U),
    (0xAC00, 0xD7A3, VerticalOrientation::U),
    (0xD7A4, 0xD7AF, VerticalOrientation::U),
    (0xD7B0, 0xD7C6, VerticalOrientation::U),
    (0xD7C7, 0xD7CA, VerticalOrientation::U),
    (0xD7CB, 0xD7FB, VerticalOrientation::U),
    (0xD7FC, 0xD7FF, VerticalOrientation::U),
    (0xE000, 0xF8FF, VerticalOrientation::U),
    (0xF900, 0xFA6D, VerticalOrientation::U),
    (0xFA6E, 0xFA6F, VerticalOrientation::U),
    (0xFA70, 0xFAD9, VerticalOrientation::U),
    (0xFADA, 0xFAFF, VerticalOrientation::U),
    (0xFE10, 0xFE16, VerticalOrientation::U),
    (0xFE17, 0xFE17, VerticalOrientation::U),
    (0xFE18, 0xFE18, VerticalOrientation::U),
    (0xFE19, 0xFE19, VerticalOrientation::U),
    (0xFE1A, 0xFE1F, VerticalOrientation::U),
    (0xFE30, 0xFE30, VerticalOrientation::U),
    (0xFE31, 0xFE32, VerticalOrientation::U),
    (0xFE33, 0xFE34, VerticalOrientation::U),
    (0xFE35, 0xFE35, VerticalOrientation::U),
    (0xFE36, 0xFE36, VerticalOrientation::U),
    (0xFE37, 0xFE37, VerticalOrientation::U),
    (0xFE38, 0xFE38, VerticalOrientation::U),
    (0xFE39, 0xFE39, VerticalOrientation::U),
    (0xFE3A, 0xFE3A, VerticalOrientation::U),
    (0xFE3B, 0xFE3B, VerticalOrientation::U),
    (0xFE3C, 0xFE3C, VerticalOrientation::U),
    (0xFE3D, 0xFE3D, VerticalOrientation::U),
    (0xFE3E, 0xFE3E, VerticalOrientation::U),
    (0xFE3F, 0xFE3F, VerticalOrientation::U),
    (0xFE40, 0xFE40, VerticalOrientation::U),
    (0xFE41, 0xFE41, VerticalOrientation::U),
    (0xFE42, 0xFE42, VerticalOrientation::U),
    (0xFE43, 0xFE43, VerticalOrientation::U),
    (0xFE44, 0xFE44, VerticalOrientation::U),
    (0xFE45, 0xFE46, VerticalOrientation::U),
    (0xFE47, 0xFE47, VerticalOrientation::U),
    (0xFE48, 0xFE48, VerticalOrientation::U),
    (0xFE50, 0xFE52, VerticalOrientation::Tu),
    (0xFE53, 0xFE53, VerticalOrientation::U),
    (0xFE54, 0xFE57, VerticalOrientation::U),
    (0xFE59, 0xFE59, VerticalOrientation::Tr),
    (0xFE5A, 0xFE5A, VerticalOrientation::Tr),
    (0xFE5B, 0xFE5B, VerticalOrientation::Tr),
    (0xFE5C, 0xFE5C, VerticalOrientation::Tr),
    (0xFE5D, 0xFE5D, VerticalOrientation::Tr),
    (0xFE5E, 0xFE5E, VerticalOrientation::Tr),
    (0xFE5F, 0xFE61, VerticalOrientation::U),
    (0xFE62, 0xFE62, VerticalOrientation::U),
    (0xFE67, 0xFE67, VerticalOrientation::U),
    (0xFE68, 0xFE68, VerticalOrientation::U),
    (0xFE69, 0xFE69, VerticalOrientation::U),
    (0xFE6A, 0xFE6B, VerticalOrientation::U),
    (0xFE6C, 0xFE6F, VerticalOrientation::U),
    (0xFF01, 0xFF01, VerticalOrientation::Tu),
    (0xFF02, 0xFF03, VerticalOrientation::U),
    (0xFF04, 0xFF04, VerticalOrientation::U),
    (0xFF05, 0xFF07, VerticalOrientation::U),
    (0xFF08, 0xFF08, VerticalOrientation::Tr),
    (0xFF09, 0xFF09, VerticalOrientation::Tr),
    (0xFF0A, 0xFF0A, VerticalOrientation::U),
    (0xFF0B, 0xFF0B, VerticalOrientation::U),
    (0xFF0C, 0xFF0C, VerticalOrientation::Tu),
    (0xFF0E, 0xFF0E, VerticalOrientation::Tu),
    (0xFF0F, 0xFF0F, VerticalOrientation::U),
    (0xFF10, 0xFF19, VerticalOrientation::U),
    (0xFF1A, 0xFF1B, VerticalOrientation::Tr),
    (0xFF1F, 0xFF1F, VerticalOrientation::Tu),
    (0xFF20, 0xFF20, VerticalOrientation::U),
    (0xFF21, 0xFF3A, VerticalOrientation::U),
    (0xFF3B, 0xFF3B, VerticalOrientation::Tr),
    (0xFF3C, 0xFF3C, VerticalOrientation::U),
    (0xFF3D, 0xFF3D, VerticalOrientation::Tr),
    (0xFF3E, 0xFF3E, VerticalOrientation::U),
    (0xFF3F, 0xFF3F, VerticalOrientation::Tr),
    (0xFF40, 0xFF40, VerticalOrientation::U),
    (0xFF41, 0xFF5A, VerticalOrientation::U),
    (0xFF5B, 0xFF5B, VerticalOrientation::Tr),
    (0xFF5C, 0xFF5C, VerticalOrientation::Tr),
    (0xFF5D, 0xFF5D, VerticalOrientation::Tr),
    (0xFF5E, 0xFF5E, VerticalOrientation::Tr),
    (0xFF5F, 0xFF5F, VerticalOrientation::Tr),
    (0xFF60, 0xFF60, VerticalOrientation::Tr),
    (0xFFE0, 0xFFE1, VerticalOrientation::U),
    (0xFFE2, 0xFFE2, VerticalOrientation::U),
    (0xFFE3, 0xFFE3, VerticalOrientation::Tr),
    (0xFFE4, 0xFFE4, VerticalOrientation::U),
    (0xFFE5, 0xFFE6, VerticalOrientation::U),
    (0xFFE7, 0xFFE7, VerticalOrientation::U),
    (0xFFF0, 0xFFF8, VerticalOrientation::U),
    (0xFFFC, 0xFFFD, VerticalOrientation::U),
    (0x10980, 0x1099F, VerticalOrientation::U),
    (0x11580, 0x115AE, VerticalOrientation::U),
    (0x115AF, 0x115B1, VerticalOrientation::U),
    (0x115B2, 0x115B5, VerticalOrientation::U),
    (0x115B6, 0x115B7, VerticalOrientation::U),
    (0x115B8, 0x115BB, VerticalOrientation::U),
    (0x115BC, 0x115BD, VerticalOrientation::U),
    (0x115BE, 0x115BE, VerticalOrientation::U),
    (0x115BF, 0x115C0, VerticalOrientation::U),
    (0x115C1, 0x115D7, VerticalOrientation::U),
    (0x115D8, 0x115DB, VerticalOrientation::U),
    (0x115DC, 0x115DD, VerticalOrientation::U),
    (0x115DE, 0x115FF, VerticalOrientation::U),
    (0x11A00, 0x11A00, VerticalOrientation::U),
    (0x11A01, 0x11A0A, VerticalOrientation::U),
    (0x11A0B, 0x11A32, VerticalOrientation::U),
    (0x11A33, 0x11A38, VerticalOrientation::U),
    (0x11A39, 0x11A39, VerticalOrientation::U),
    (0x11A3A, 0x11A3A, VerticalOrientation::U),
    (0x11A3B, 0x11A3E, VerticalOrientation::U),
    (0x11A3F, 0x11A46, VerticalOrientation::U),
    (0x11A47, 0x11A47, VerticalOrientation::U),
    (0x11A48, 0x11A4F, VerticalOrientation::U),
    (0x11A50, 0x11A50, VerticalOrientation::U),
    (0x11A51, 0x11A56, VerticalOrientation::U),
    (0x11A57, 0x11A58, VerticalOrientation::U),
    (0x11A59, 0x11A5B, VerticalOrientation::U),
    (0x11A5C, 0x11A89, VerticalOrientation::U),
    (0x11A8A, 0x11A96, VerticalOrientation::U),
    (0x11A97, 0x11A97, VerticalOrientation::U),
    (0x11A98, 0x11A99, VerticalOrientation::U),
    (0x11A9A, 0x11A9C, VerticalOrientation::U),
    (0x11A9D, 0x11A9D, VerticalOrientation::U),
    (0x11A9E, 0x11AA2, VerticalOrientation::U),
    (0x11AA3, 0x11AAF, VerticalOrientation::U),
    (0x11AB0, 0x11ABF, VerticalOrientation::U),
    (0x13000, 0x1342F, VerticalOrientation::U),
    (0x13430, 0x1343F, VerticalOrientation::U),
    (0x13440, 0x13440, VerticalOrientation::U),
    (0x13441, 0x13446, VerticalOrientation::U),
    (0x13447, 0x13455, VerticalOrientation::U),
    (0x13456, 0x1345F, VerticalOrientation::U),
    (0x13460, 0x143FA, VerticalOrientation::U),
    (0x143FB, 0x143FF, VerticalOrientation::U),
    (0x14400, 0x14646, VerticalOrientation::U),
    (0x14647, 0x1467F, VerticalOrientation::U),
    (0x16FE0, 0x16FE1, VerticalOrientation::U),
    (0x16FE2, 0x16FE2, VerticalOrientation::U),
    (0x16FE3, 0x16FE3, VerticalOrientation::U),
    (0x16FE4, 0x16FE4, VerticalOrientation::U),
    (0x16FE5, 0x16FEF, VerticalOrientation::U),
    (0x16FF0, 0x16FF1, VerticalOrientation::U),
    (0x16FF2, 0x16FF3, VerticalOrientation::U),
    (0x16FF4, 0x16FF6, VerticalOrientation::U),
    (0x16FF7, 0x16FFF, VerticalOrientation::U),
    (0x17000, 0x187FF, VerticalOrientation::U),
    (0x18800, 0x18AFF, VerticalOrientation::U),
    (0x18B00, 0x18CD5, VerticalOrientation::U),
    (0x18CD6, 0x18CFE, VerticalOrientation::U),
    (0x18CFF, 0x18CFF, VerticalOrientation::U),
    (0x18D00, 0x18D1E, VerticalOrientation::U),
    (0x18D1F, 0x18D7F, VerticalOrientation::U),
    (0x18D80, 0x18DF2, VerticalOrientation::U),
    (0x18DF3, 0x18DFF, VerticalOrientation::U),
    (0x1AFF0, 0x1AFF3, VerticalOrientation::U),
    (0x1AFF4, 0x1AFF4, VerticalOrientation::U),
    (0x1AFF5, 0x1AFFB, VerticalOrientation::U),
    (0x1AFFC, 0x1AFFC, VerticalOrientation::U),
    (0x1AFFD, 0x1AFFE, VerticalOrientation::U),
    (0x1AFFF, 0x1AFFF, VerticalOrientation::U),
    (0x1B000, 0x1B0FF, VerticalOrientation::U),
    (0x1B100, 0x1B122, VerticalOrientation::U),
    (0x1B123, 0x1B12F, VerticalOrientation::U),
    (0x1B130, 0x1B131, VerticalOrientation::U),
    (0x1B132, 0x1B132, VerticalOrientation::Tu),
    (0x1B133, 0x1B14F, VerticalOrientation::U),
    (0x1B150, 0x1B152, VerticalOrientation::Tu),
    (0x1B153, 0x1B154, VerticalOrientation::U),
    (0x1B155, 0x1B155, VerticalOrientation::Tu),
    (0x1B156, 0x1B163, VerticalOrientation::U),
    (0x1B164, 0x1B167, VerticalOrientation::Tu),
    (0x1B168, 0x1B16F, VerticalOrientation::U),
    (0x1B170, 0x1B2FB, VerticalOrientation::U),
    (0x1B2FC, 0x1B2FF, VerticalOrientation::U),
    (0x1CEC0, 0x1CED0, VerticalOrientation::U),
    (0x1CED1, 0x1CEDF, VerticalOrientation::U),
    (0x1CEE0, 0x1CEEF, VerticalOrientation::U),
    (0x1CEF0, 0x1CEF0, VerticalOrientation::U),
    (0x1CEF1, 0x1CEFF, VerticalOrientation::U),
    (0x1CF00, 0x1CF2D, VerticalOrientation::U),
    (0x1CF2E, 0x1CF2F, VerticalOrientation::U),
    (0x1CF30, 0x1CF46, VerticalOrientation::U),
    (0x1CF47, 0x1CF4F, VerticalOrientation::U),
    (0x1CF50, 0x1CFC3, VerticalOrientation::U),
    (0x1CFC4, 0x1CFCF, VerticalOrientation::U),
    (0x1D000, 0x1D0F5, VerticalOrientation::U),
    (0x1D0F6, 0x1D0FF, VerticalOrientation::U),
    (0x1D100, 0x1D126, VerticalOrientation::U),
    (0x1D127, 0x1D128, VerticalOrientation::U),
    (0x1D129, 0x1D164, VerticalOrientation::U),
    (0x1D165, 0x1D166, VerticalOrientation::U),
    (0x1D167, 0x1D169, VerticalOrientation::U),
    (0x1D16A, 0x1D16C, VerticalOrientation::U),
    (0x1D16D, 0x1D172, VerticalOrientation::U),
    (0x1D173, 0x1D17A, VerticalOrientation::U),
    (0x1D17B, 0x1D182, VerticalOrientation::U),
    (0x1D183, 0x1D184, VerticalOrientation::U),
    (0x1D185, 0x1D18B, VerticalOrientation::U),
    (0x1D18C, 0x1D1A9, VerticalOrientation::U),
    (0x1D1AA, 0x1D1AD, VerticalOrientation::U),
    (0x1D1AE, 0x1D1EA, VerticalOrientation::U),
    (0x1D1EB, 0x1D1FF, VerticalOrientation::U),
    (0x1D2E0, 0x1D2F3, VerticalOrientation::U),
    (0x1D2F4, 0x1D2FF, VerticalOrientation::U),
    (0x1D300, 0x1D356, VerticalOrientation::U),
    (0x1D357, 0x1D35F, VerticalOrientation::U),
    (0x1D360, 0x1D378, VerticalOrientation::U),
    (0x1D379, 0x1D37F, VerticalOrientation::U),
    (0x1D800, 0x1D9FF, VerticalOrientation::U),
    (0x1DA00, 0x1DA36, VerticalOrientation::U),
    (0x1DA37, 0x1DA3A, VerticalOrientation::U),
    (0x1DA3B, 0x1DA6C, VerticalOrientation::U),
    (0x1DA6D, 0x1DA74, VerticalOrientation::U),
    (0x1DA75, 0x1DA75, VerticalOrientation::U),
    (0x1DA76, 0x1DA83, VerticalOrientation::U),
    (0x1DA84, 0x1DA84, VerticalOrientation::U),
    (0x1DA85, 0x1DA86, VerticalOrientation::U),
    (0x1DA87, 0x1DA8B, VerticalOrientation::U),
    (0x1DA8C, 0x1DA9A, VerticalOrientation::U),
    (0x1DA9B, 0x1DA9F, VerticalOrientation::U),
    (0x1DAA0, 0x1DAA0, VerticalOrientation::U),
    (0x1DAA1, 0x1DAAF, VerticalOrientation::U),
    (0x1F000, 0x1F02B, VerticalOrientation::U),
    (0x1F02C, 0x1F02F, VerticalOrientation::U),
    (0x1F030, 0x1F093, VerticalOrientation::U),
    (0x1F094, 0x1F09F, VerticalOrientation::U),
    (0x1F0A0, 0x1F0AE, VerticalOrientation::U),
    (0x1F0AF, 0x1F0B0, VerticalOrientation::U),
    (0x1F0B1, 0x1F0BF, VerticalOrientation::U),
    (0x1F0C0, 0x1F0C0, VerticalOrientation::U),
    (0x1F0C1, 0x1F0CF, VerticalOrientation::U),
    (0x1F0D0, 0x1F0D0, VerticalOrientation::U),
    (0x1F0D1, 0x1F0F5, VerticalOrientation::U),
    (0x1F0F6, 0x1F0FF, VerticalOrientation::U),
    (0x1F100, 0x1F10C, VerticalOrientation::U),
    (0x1F10D, 0x1F1AD, VerticalOrientation::U),
    (0x1F1AE, 0x1F1E5, VerticalOrientation::U),
    (0x1F1E6, 0x1F1FF, VerticalOrientation::U),
    (0x1F200, 0x1F201, VerticalOrientation::Tu),
    (0x1F202, 0x1F202, VerticalOrientation::U),
    (0x1F203, 0x1F20F, VerticalOrientation::U),
    (0x1F210, 0x1F23B, VerticalOrientation::U),
    (0x1F23C, 0x1F23F, VerticalOrientation::U),
    (0x1F240, 0x1F248, VerticalOrientation::U),
    (0x1F249, 0x1F24F, VerticalOrientation::U),
    (0x1F250, 0x1F251, VerticalOrientation::U),
    (0x1F252, 0x1F25F, VerticalOrientation::U),
    (0x1F260, 0x1F265, VerticalOrientation::U),
    (0x1F266, 0x1F2FF, VerticalOrientation::U),
    (0x1F300, 0x1F3FA, VerticalOrientation::U),
    (0x1F3FB, 0x1F3FF, VerticalOrientation::U),
    (0x1F400, 0x1F5FF, VerticalOrientation::U),
    (0x1F600, 0x1F64F, VerticalOrientation::U),
    (0x1F650, 0x1F67F, VerticalOrientation::U),
    (0x1F680, 0x1F6D8, VerticalOrientation::U),
    (0x1F6D9, 0x1F6DB, VerticalOrientation::U),
    (0x1F6DC, 0x1F6EC, VerticalOrientation::U),
    (0x1F6ED, 0x1F6EF, VerticalOrientation::U),
    (0x1F6F0, 0x1F6FC, VerticalOrientation::U),
    (0x1F6FD, 0x1F6FF, VerticalOrientation::U),
    (0x1F700, 0x1F77F, VerticalOrientation::U),
    (0x1F780, 0x1F7D9, VerticalOrientation::U),
    (0x1F7DA, 0x1F7DF, VerticalOrientation::U),
    (0x1F7E0, 0x1F7EB, VerticalOrientation::U),
    (0x1F7EC, 0x1F7EF, VerticalOrientation::U),
    (0x1F7F0, 0x1F7F0, VerticalOrientation::U),
    (0x1F7F1, 0x1F7FF, VerticalOrientation::U),
    (0x1F900, 0x1F9FF, VerticalOrientation::U),
    (0x1FA00, 0x1FA57, VerticalOrientation::U),
    (0x1FA58, 0x1FA5F, VerticalOrientation::U),
    (0x1FA60, 0x1FA6D, VerticalOrientation::U),
    (0x1FA6E, 0x1FA6F, VerticalOrientation::U),
    (0x1FA70, 0x1FA7C, VerticalOrientation::U),
    (0x1FA7D, 0x1FA7F, VerticalOrientation::U),
    (0x1FA80, 0x1FA8A, VerticalOrientation::U),
    (0x1FA8B, 0x1FA8D, VerticalOrientation::U),
    (0x1FA8E, 0x1FAC6, VerticalOrientation::U),
    (0x1FAC7, 0x1FAC7, VerticalOrientation::U),
    (0x1FAC8, 0x1FAC8, VerticalOrientation::U),
    (0x1FAC9, 0x1FACC, VerticalOrientation::U),
    (0x1FACD, 0x1FADC, VerticalOrientation::U),
    (0x1FADD, 0x1FADE, VerticalOrientation::U),
    (0x1FADF, 0x1FAEA, VerticalOrientation::U),
    (0x1FAEB, 0x1FAEE, VerticalOrientation::U),
    (0x1FAEF, 0x1FAF8, VerticalOrientation::U),
    (0x1FAF9, 0x1FAFF, VerticalOrientation::U),
    (0x20000, 0x2A6DF, VerticalOrientation::U),
    (0x2A6E0, 0x2A6FF, VerticalOrientation::U),
    (0x2A700, 0x2B81D, VerticalOrientation::U),
    (0x2B81E, 0x2B81F, VerticalOrientation::U),
    (0x2B820, 0x2CEAD, VerticalOrientation::U),
    (0x2CEAE, 0x2CEAF, VerticalOrientation::U),
    (0x2CEB0, 0x2EBE0, VerticalOrientation::U),
    (0x2EBE1, 0x2EBEF, VerticalOrientation::U),
    (0x2EBF0, 0x2EE5D, VerticalOrientation::U),
    (0x2EE5E, 0x2F7FF, VerticalOrientation::U),
    (0x2F800, 0x2FA1D, VerticalOrientation::U),
    (0x2FA1E, 0x2FA1F, VerticalOrientation::U),
    (0x2FA20, 0x2FFFD, VerticalOrientation::U),
    (0x30000, 0x3134A, VerticalOrientation::U),
    (0x3134B, 0x3134F, VerticalOrientation::U),
    (0x31350, 0x33479, VerticalOrientation::U),
    (0x3347A, 0x3FFFD, VerticalOrientation::U),
    (0xF0000, 0xFFFFD, VerticalOrientation::U),
    (0x0010_0000, 0x0010_FFFD, VerticalOrientation::U),
];

fn browser_compatible_orientation_override(cp: u32) -> Option<VerticalOrientation> {
    match cp {
        // Japanese vertical text in current browsers prefers vertical font
        // alternates for common dash/leader punctuation. Keep these upright so
        // OpenType `vert` glyphs are not rotated back into horizontal shapes.
        0x2014 | 0x2015 | 0x2025 | 0x2026 => Some(VerticalOrientation::U),
        _ => None,
    }
}

/// Lookup the UTR#50 vertical orientation for a code point, with browser
/// compatibility overrides for Japanese dash/leader punctuation.
/// Uses binary search on the range table for O(log n) performance.
#[must_use]
pub fn vertical_orientation(cp: u32) -> VerticalOrientation {
    if let Some(orientation) = browser_compatible_orientation_override(cp) {
        return orientation;
    }

    // Binary search: find the last range whose start <= cp
    match ORIENTATION_RANGES.binary_search_by(|&(start, _, _)| start.cmp(&cp)) {
        Ok(idx) => ORIENTATION_RANGES[idx].2,
        Err(0) => VerticalOrientation::R, // Before all ranges
        Err(idx) => {
            let &(start, end, orient) = &ORIENTATION_RANGES[idx - 1];
            if cp >= start && cp <= end {
                orient
            } else {
                VerticalOrientation::R // Default: rotated
            }
        }
    }
}

/// Check if a UTR#50 property value maps to upright in text-orientation: mixed.
/// U, Tu, and Tr → upright; R → rotated.
#[must_use]
fn is_orientation_upright_mixed(orientation: VerticalOrientation) -> bool {
    matches!(
        orientation,
        VerticalOrientation::U | VerticalOrientation::Tu | VerticalOrientation::Tr
    )
}

/// Check if a code point should be rendered upright in text-orientation: mixed.
/// U, Tu, and Tr → upright; R → rotated.
#[must_use]
pub fn is_upright_mixed(cp: u32) -> bool {
    is_orientation_upright_mixed(vertical_orientation(cp))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cjk_ideograph_is_upright() {
        assert!(is_upright_mixed('漢' as u32));
        assert!(is_upright_mixed('字' as u32));
        assert!(is_upright_mixed(0x4E00)); // CJK Unified start
        assert!(is_upright_mixed(0x9FFF)); // CJK Unified end
    }

    #[test]
    fn test_hiragana_is_upright() {
        assert!(is_upright_mixed('あ' as u32));
        assert!(is_upright_mixed('ん' as u32));
    }

    #[test]
    fn test_katakana_is_upright() {
        assert!(is_upright_mixed('ア' as u32));
        assert!(is_upright_mixed('ン' as u32));
    }

    #[test]
    fn test_cjk_punctuation_is_upright() {
        assert!(is_upright_mixed('。' as u32));
        assert!(is_upright_mixed('、' as u32));
        assert!(is_upright_mixed('「' as u32));
        assert!(is_upright_mixed('」' as u32));
    }

    #[test]
    fn test_fullwidth_forms_are_upright() {
        assert!(is_upright_mixed('Ａ' as u32));
        assert!(is_upright_mixed('１' as u32));
        assert!(is_upright_mixed(0xFF01)); // ！
    }

    #[test]
    fn test_ascii_is_rotated() {
        assert!(!is_upright_mixed('A' as u32));
        assert!(!is_upright_mixed('z' as u32));
        assert!(!is_upright_mixed('1' as u32));
        assert!(!is_upright_mixed(' ' as u32));
    }

    #[test]
    fn test_css_mixed_orientation_mapping_keeps_tu_upright() {
        assert!(is_orientation_upright_mixed(VerticalOrientation::U));
        assert!(is_orientation_upright_mixed(VerticalOrientation::Tu));
        assert!(is_orientation_upright_mixed(VerticalOrientation::Tr));
        assert!(!is_orientation_upright_mixed(VerticalOrientation::R));
    }

    #[test]
    fn test_table_maps_tu_and_tr_values() {
        assert_eq!(vertical_orientation(0x3001), VerticalOrientation::Tu); // IDEOGRAPHIC COMMA
        assert_eq!(vertical_orientation(0x3041), VerticalOrientation::Tu); // HIRAGANA LETTER SMALL A
        assert_eq!(vertical_orientation(0x2018), VerticalOrientation::Tr); // LEFT SINGLE QUOTATION MARK
        assert_eq!(vertical_orientation(0x300C), VerticalOrientation::Tr); // LEFT CORNER BRACKET
        assert!(is_upright_mixed(0x3001));
        assert!(is_upright_mixed(0x2018));
    }

    #[test]
    fn test_dashes_follow_unicode_vertical_orientation_data_with_browser_overrides() {
        assert!(!is_upright_mixed('‐' as u32)); // U+2010 Hyphen
        assert!(!is_upright_mixed('–' as u32)); // U+2013 En dash
        assert!(is_upright_mixed('—' as u32)); // U+2014 Em dash
        assert!(is_upright_mixed('―' as u32)); // U+2015 Horizontal bar
        assert!(is_upright_mixed('‖' as u32)); // U+2016 Double vertical line
    }

    #[test]
    fn test_japanese_leaders_are_upright_for_browser_compatible_vertical_text() {
        assert!(is_upright_mixed('‥' as u32)); // U+2025 Two dot leader
        assert!(is_upright_mixed('…' as u32)); // U+2026 Horizontal ellipsis
    }

    #[test]
    fn test_latin_extended_is_rotated() {
        assert!(!is_upright_mixed('é' as u32));
        assert!(!is_upright_mixed('ü' as u32));
    }

    #[test]
    fn test_cjk_extension_b() {
        assert!(is_upright_mixed(0x20000));
        assert!(is_upright_mixed(0x2A6DF));
    }

    #[test]
    fn test_mathematical_operators_follow_unicode_vertical_orientation_data() {
        assert!(!is_upright_mixed('∀' as u32)); // U+2200
        assert!(is_upright_mixed('∞' as u32)); // U+221E
    }

    #[test]
    fn test_box_drawing_follows_unicode_vertical_orientation_data() {
        assert!(!is_upright_mixed(0x2500)); // ─
        assert!(!is_upright_mixed(0x2510)); // ┐
    }

    #[test]
    fn test_halfwidth_katakana_follows_unicode_vertical_orientation_data() {
        assert!(!is_upright_mixed(0xFF65)); // ・ (halfwidth)
        assert!(!is_upright_mixed(0xFF66)); // ヲ (halfwidth)
        assert!(!is_upright_mixed(0xFF70)); // ｰ (halfwidth prolonged sound mark)
    }

    #[test]
    fn test_hangul_is_upright() {
        assert!(is_upright_mixed(0xAC00)); // 가
        assert!(is_upright_mixed(0xD7AF)); // last Hangul syllable
    }

    #[test]
    fn test_binary_search_correctness() {
        // Ensure no overlap in ranges and ranges are sorted
        for i in 1..ORIENTATION_RANGES.len() {
            let prev_end = ORIENTATION_RANGES[i - 1].1;
            let curr_start = ORIENTATION_RANGES[i].0;
            assert!(
                curr_start > prev_end,
                "Range overlap or unsorted at index {i}: prev_end={prev_end:#X}, curr_start={curr_start:#X}",
            );
        }
    }
}
