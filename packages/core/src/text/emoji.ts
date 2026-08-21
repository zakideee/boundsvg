/**
 * Zero-dependency emoji cluster detection.
 *
 * The core renders declarative text as glyph outlines; a font that lacks a
 * character produces a `.notdef` glyph. Color emoji (COLR/CBDT/sbix) is not
 * rendered by the core. This module is the shared primitive for emoji-aware
 * asset resolution: it identifies which grapheme-like clusters are emoji so
 * an asset resolver can supply a replacement (e.g. a Twemoji SVG).
 *
 * It intentionally ships no emoji artwork and no Unicode data tables — only
 * range checks over the emoji-relevant code point blocks and the ZWJ / variation
 * selector / regional indicator / skin-tone joining rules. This is a
 * conservative detector: it errs toward grouping adjacent emoji code points
 * into one cluster rather than splitting a sequence.
 */

const ZWJ = 0x200d;
const VARIATION_SELECTOR_16 = 0xfe0f;
const VARIATION_SELECTOR_15 = 0xfe0e;
const COMBINING_ENCLOSING_KEYCAP = 0x20e3;
const REGIONAL_INDICATOR_START = 0x1f1e6;
const REGIONAL_INDICATOR_END = 0x1f1ff;
const SKIN_TONE_START = 0x1f3fb;
const SKIN_TONE_END = 0x1f3ff;
const TAG_START = 0xe0020;
const TAG_END = 0xe007f;

/** Code point ranges that are emoji or emoji-presentation candidates. */
const EMOJI_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x231a, 0x231b], // watch, hourglass
  [0x23e9, 0x23f3], // media controls, clock
  [0x23f8, 0x23fa],
  [0x25fd, 0x25fe],
  [0x2600, 0x27bf], // misc symbols, dingbats
  [0x2b00, 0x2bff], // misc symbols and arrows
  [0x1f000, 0x1faff], // mahjong through symbols-and-pictographs-extended-A
  [0x1f900, 0x1f9ff], // supplemental symbols and pictographs
];

function inRanges(codePoint: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (codePoint >= lo && codePoint <= hi) {
      return true;
    }
  }
  return false;
}

/** A code point that carries emoji presentation on its own. */
function isEmojiBase(codePoint: number): boolean {
  return inRanges(codePoint, EMOJI_RANGES);
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= REGIONAL_INDICATOR_START && codePoint <= REGIONAL_INDICATOR_END;
}

function isSkinToneModifier(codePoint: number): boolean {
  return codePoint >= SKIN_TONE_START && codePoint <= SKIN_TONE_END;
}

function isTagCharacter(codePoint: number): boolean {
  return codePoint >= TAG_START && codePoint <= TAG_END;
}

/**
 * A base code point plus a trailing VS16 (U+FE0F). ASCII/BMP symbols such as
 * ❤ (U+2764) or digits with a keycap only take emoji presentation when
 * followed by VS16, so those are detected at the cluster level, not here.
 */
function isExtendedPictographicStart(codePoint: number): boolean {
  // Symbols that commonly take VS16 to become emoji (hearts, keycap bases, etc.)
  if (codePoint >= 0x0023 && codePoint <= 0x0039) {
    return true; // # * 0-9 (keycap bases)
  }
  return isEmojiBase(codePoint) || isRegionalIndicator(codePoint);
}

function isTrailingModifier(codePoint: number): boolean {
  return (
    codePoint === VARIATION_SELECTOR_16 ||
    codePoint === VARIATION_SELECTOR_15 ||
    codePoint === COMBINING_ENCLOSING_KEYCAP ||
    isSkinToneModifier(codePoint) ||
    isTagCharacter(codePoint)
  );
}

/**
 * Starting at `start` (the code point after an emoji base), consume trailing
 * modifiers and ZWJ-joined pictographs. Returns the joined text and the index
 * just past the consumed run.
 */
function consumeEmojiTail(codePoints: string[], start: number): { text: string; next: number } {
  let text = "";
  let index = start;
  while (index < codePoints.length) {
    const modifier = codePoints[index] as string;
    const modifierCp = modifier.codePointAt(0) ?? -1;

    if (isTrailingModifier(modifierCp)) {
      text += modifier;
      index += 1;
      continue;
    }

    if (modifierCp === ZWJ) {
      const joined = codePoints[index + 1];
      const joinedCp = joined?.codePointAt(0) ?? -1;
      if (joined !== undefined && isExtendedPictographicStart(joinedCp)) {
        text += modifier + joined;
        index += 2;
        continue;
      }
    }

    break;
  }
  return { text, next: index };
}

/**
 * Split `text` into a sequence of clusters, where each emoji sequence (including
 * ZWJ sequences, flags, keycaps, and skin-tone/variation modifiers) is one
 * cluster and every other code point is its own single-character cluster.
 */
export function splitEmojiClusters(text: string): string[] {
  const codePoints = Array.from(text);
  const clusters: string[] = [];
  let index = 0;

  while (index < codePoints.length) {
    const char = codePoints[index] as string;
    const codePoint = char.codePointAt(0) ?? 0;

    if (!isExtendedPictographicStart(codePoint)) {
      clusters.push(char);
      index += 1;
      continue;
    }

    // Flags: exactly two regional indicators form one cluster.
    if (isRegionalIndicator(codePoint)) {
      const next = codePoints[index + 1];
      const nextCp = next?.codePointAt(0) ?? -1;
      if (next !== undefined && isRegionalIndicator(nextCp)) {
        clusters.push(char + next);
        index += 2;
        continue;
      }
    }

    const tail = consumeEmojiTail(codePoints, index + 1);
    clusters.push(char + tail.text);
    index = tail.next;
  }

  return clusters;
}

/**
 * Whether `cluster` is an emoji cluster: it begins with an emoji base (or a
 * VS16-qualified symbol / keycap / flag) rather than ordinary text.
 */
export function isEmojiCluster(cluster: string): boolean {
  const codePoints = Array.from(cluster);
  if (codePoints.length === 0) {
    return false;
  }
  const first = (codePoints[0] as string).codePointAt(0) ?? 0;

  // A lone keycap base or symbol is only emoji when a VS16 / keycap follows.
  if (isEmojiBase(first) || isRegionalIndicator(first)) {
    return true;
  }
  if (codePoints.length >= 2) {
    const second = (codePoints[1] as string).codePointAt(0) ?? -1;
    if (second === VARIATION_SELECTOR_16 || second === COMBINING_ENCLOSING_KEYCAP) {
      return true;
    }
  }
  return false;
}

/** Extract the emoji clusters from `text`, in order, preserving duplicates. */
export function findEmojiClusters(text: string): string[] {
  return splitEmojiClusters(text).filter(isEmojiCluster);
}
