#!/usr/bin/env python3
"""Generate a tiny, self-authored contextual-shaping test font."""

from pathlib import Path

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


UNITS_PER_EM = 1_000
OUTPUT = Path(__file__).resolve().parents[1] / "fixtures/fonts/ContextualArabicTest.ttf"
GLYPH_ORDER = [
    ".notdef",
    "space",
    "A",
    "ellipsis",
    "A_ellipsis.liga",
    "beh",
    "beh.init",
    "beh.medi",
    "beh.fina",
]


def rectangle(left: int, bottom: int, right: int, top: int):
    pen = TTGlyphPen(None)
    pen.moveTo((left, bottom))
    pen.lineTo((right, bottom))
    pen.lineTo((right, top))
    pen.lineTo((left, top))
    pen.closePath()
    return pen.glyph()


def empty_glyph():
    return TTGlyphPen(None).glyph()


font_builder = FontBuilder(UNITS_PER_EM, isTTF=True)
font_builder.setupGlyphOrder(GLYPH_ORDER)
font_builder.setupCharacterMap(
    {
        0x0020: "space",
        0x0041: "A",
        0x0628: "beh",
        0x2026: "ellipsis",
    }
)
font_builder.setupGlyf(
    {
        ".notdef": rectangle(50, 0, 550, 700),
        "space": empty_glyph(),
        "A": rectangle(100, 0, 500, 700),
        "ellipsis": rectangle(100, 0, 500, 100),
        "A_ellipsis.liga": rectangle(50, 0, 1_150, 700),
        "beh": rectangle(50, 100, 550, 300),
        "beh.init": rectangle(50, 100, 250, 600),
        "beh.medi": rectangle(200, 100, 400, 600),
        "beh.fina": rectangle(350, 100, 550, 600),
    }
)
font_builder.setupHorizontalMetrics({glyph: (600, 0) for glyph in GLYPH_ORDER})
font_builder.setupHorizontalHeader(ascent=800, descent=-200)
font_builder.setupNameTable(
    {
        "familyName": "Contextual Arabic Test",
        "styleName": "Regular",
        "uniqueFontIdentifier": "boundsvg-contextual-shaping-test-2",
        "fullName": "Contextual Arabic Test Regular",
        "psName": "ContextualArabicTest-Regular",
        "version": "Version 1.000",
    }
)
font_builder.setupOS2(
    sTypoAscender=800,
    sTypoDescender=-200,
    usWinAscent=800,
    usWinDescent=200,
)
font_builder.setupPost()
font_builder.setupMaxp()
addOpenTypeFeaturesFromString(
    font_builder.font,
    """
    languagesystem DFLT dflt;
    languagesystem arab dflt;
    feature liga { sub A ellipsis by A_ellipsis.liga; } liga;
    feature init { sub beh by beh.init; } init;
    feature medi { sub beh by beh.medi; } medi;
    feature fina { sub beh by beh.fina; } fina;
    """,
)

# Use a fixed Mac-epoch timestamp so regeneration is byte-for-byte stable.
font_builder.font["head"].created = 3_700_000_000
font_builder.font["head"].modified = 3_700_000_000
font_builder.save(OUTPUT)
