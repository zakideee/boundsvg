# Test & Demo Fonts

Fonts bundled for boundsvg tests and the playground demo.

## Fonts

### Japanese fonts (subsetted)

`scripts/subset-fonts.sh` fetches these three from the Google Fonts repository
rather than from each typeface's own project, so the column below names where the
committed files actually came from. The other source columns name the upstream
project: Noto Sans CJK JP is fetched from it directly, and the code fonts and
Inter are committed as distributed and never touched by the script.

| Font                                                                  | License     | Downloaded from                                                     |
| --------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP)   | SIL OFL 1.1 | [google/fonts](https://github.com/google/fonts) `ofl/notosansjp`    |
| [Noto Serif JP](https://fonts.google.com/noto/specimen/Noto+Serif+JP) | SIL OFL 1.1 | [google/fonts](https://github.com/google/fonts) `ofl/notoserifjp`   |
| [Zen Maru Gothic](https://fonts.google.com/specimen/Zen+Maru+Gothic)  | SIL OFL 1.1 | [google/fonts](https://github.com/google/fonts) `ofl/zenmarugothic` |

### Code fonts (full glyph set)

| Font                                                 | License     | Source                                                                |
| ---------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) | SIL OFL 1.1 | [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono) |
| [Monaspace Neon](https://monaspace.githubnext.com/)  | SIL OFL 1.1 | [githubnext/monaspace](https://github.com/githubnext/monaspace)       |

### Variable fonts (axes kept)

These stay variable so the variable-font demos and tests have real axes to move.

| Font                                                      | Axes           | License     | Source                                                      |
| --------------------------------------------------------- | -------------- | ----------- | ----------------------------------------------------------- |
| [Inter](https://rsms.me/inter/)                           | `opsz`, `wght` | SIL OFL 1.1 | [rsms/inter](https://github.com/rsms/inter)                 |
| [Noto Sans CJK JP](https://github.com/notofonts/noto-cjk) | `wght`         | SIL OFL 1.1 | [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk) |

`Inter-Variable.ttf` ships as distributed. `NotoSansCJKjp-VF.subset.ttf` is subsetted with the
`wght` axis preserved.

The unsubsetted `NotoSansCJKjp-VF.ttf` (36 MB) is not distributed in this repository.
The public `ttf-parser` regression generates the relevant 65,535-entry table boundaries
synthetically, so a clean checkout does not silently skip that contract. `scripts/subset-fonts.sh`
fetches the upstream font into a temporary directory only and does not leave a copy behind.

Per-font license files are colocated in this directory (`*-LICENSE-OFL.txt`).

### Self-authored shaping fixture

`ContextualArabicTest.ttf` is a tiny repository-authored fixture with distinct
Arabic `init`, `medi`, and `fina` substitutions plus an `A` + ellipsis test
ligature used to prove synthetic-marker run isolation. It contains no third-party
outlines. Regenerate it deterministically with:

```bash
python3 scripts/generate-contextual-arabic-test-font.py
```

## Subset Details

The Japanese fonts are subsetted to reduce file size (the upstream files run from 3.8 MB to 36 MB). The code fonts are included as-is with their full glyph set.

The Japanese font subset covers:

| Range                        | Characters  | Description                           |
| ---------------------------- | ----------- | ------------------------------------- |
| Basic Latin                  | U+0020-007E | ASCII printable characters            |
| Latin-1 Supplement           | U+00A0-00FF | Accented Latin characters             |
| General Punctuation          | U+2000-206F | Em-dash, ellipsis, etc.               |
| Arrows                       | U+2190-21FF | Basic arrows                          |
| CJK Symbols & Punctuation    | U+3000-303F | Ideographic comma/period, brackets    |
| Hiragana                     | U+3040-309F | Full hiragana set                     |
| Katakana                     | U+30A0-30FF | Full katakana set                     |
| Joyo Kanji                   | 2,136 chars | Government-mandated regular-use kanji |
| CJK Compatibility Ideographs | U+F900-FAFF | Compatibility characters              |
| CJK Compatibility Forms      | U+FE30-FE4F | Vertical punctuation forms            |
| Fullwidth & Halfwidth Forms  | U+FF00-FF9F | Fullwidth Latin, halfwidth katakana   |

Total: 2,778–3,196 unique characters per font. The ranges above are what is
requested; each face contributes only the codepoints it actually covers, so the
shipped subsets differ — measured from their `cmap` tables: Noto Sans JP 3,192,
Noto Serif JP 3,192, Zen Maru Gothic 2,778, Noto Sans CJK JP 3,196.

## Regenerating Fonts

To regenerate the subset fonts from upstream sources:

```bash
# Requires: pip install fonttools brotli
bash scripts/subset-fonts.sh
```

The script downloads the four Japanese sources, converts the variable ones (Noto Sans/Serif JP) to static weight=400, and subsets to the ranges above. Both TTF and WOFF2 outputs are generated for those three. Noto Sans CJK JP is subsetted to the same ranges but keeps its `wght` axis and is written as TTF only.

The script does not touch the two code fonts or `Inter-Variable.ttf` — those are committed as distributed upstream.

The Joyo kanji character list is maintained at `scripts/joyo-kanji.txt`.
