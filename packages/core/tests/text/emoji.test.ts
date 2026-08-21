import { describe, expect, it } from "vitest";
import { findEmojiClusters, isEmojiCluster, splitEmojiClusters } from "../../src/text/emoji.js";

describe("splitEmojiClusters", () => {
  it("keeps plain text as single-character clusters", () => {
    expect(splitEmojiClusters("abc")).toEqual(["a", "b", "c"]);
    expect(splitEmojiClusters("あい")).toEqual(["あ", "い"]);
  });

  it("treats a single-codepoint emoji as one cluster", () => {
    expect(splitEmojiClusters("😀")).toEqual(["😀"]);
    expect(splitEmojiClusters("a😀b")).toEqual(["a", "😀", "b"]);
  });

  it("groups a ZWJ family sequence into one cluster", () => {
    const family = "👨‍👩‍👧";
    expect(splitEmojiClusters(family)).toEqual([family]);
  });

  it("groups skin-tone modifiers with their base", () => {
    const wave = "👋\u{1f3fb}";
    expect(splitEmojiClusters(wave)).toEqual([wave]);
  });

  it("groups a VS16-qualified symbol", () => {
    const redHeart = "❤️";
    expect(splitEmojiClusters(redHeart)).toEqual([redHeart]);
  });

  it("groups a keycap sequence", () => {
    const keycap = "1️⃣";
    expect(splitEmojiClusters(keycap)).toEqual([keycap]);
  });

  it("treats a flag as one cluster of two regional indicators", () => {
    const jp = "\u{1f1ef}\u{1f1f5}";
    expect(splitEmojiClusters(jp)).toEqual([jp]);
  });

  it("splits adjacent flags into separate clusters", () => {
    const jp = "\u{1f1ef}\u{1f1f5}";
    const us = "\u{1f1fa}\u{1f1f8}";
    expect(splitEmojiClusters(jp + us)).toEqual([jp, us]);
  });

  it("handles mixed text and emoji", () => {
    expect(splitEmojiClusters("hi😀!")).toEqual(["h", "i", "😀", "!"]);
  });
});

describe("isEmojiCluster", () => {
  it("is true for emoji clusters", () => {
    expect(isEmojiCluster("😀")).toBe(true);
    expect(isEmojiCluster("👨‍👩‍👧")).toBe(true);
    expect(isEmojiCluster("❤️")).toBe(true);
    expect(isEmojiCluster("\u{1f1ef}\u{1f1f5}")).toBe(true);
  });

  it("is false for plain text", () => {
    expect(isEmojiCluster("a")).toBe(false);
    expect(isEmojiCluster("あ")).toBe(false);
    expect(isEmojiCluster("")).toBe(false);
    expect(isEmojiCluster("1")).toBe(false); // keycap base without the keycap
    expect(isEmojiCluster("#")).toBe(false);
  });

  it("conservatively flags emoji-range symbols even without VS16", () => {
    // The detector does not carry Unicode Emoji_Presentation data, so a bare
    // symbol in the emoji ranges is reported as emoji-eligible. A resolver
    // that lacks art for it returns undefined and the text path renders it.
    expect(isEmojiCluster("❤")).toBe(true);
  });
});

describe("findEmojiClusters", () => {
  it("extracts only the emoji clusters in order", () => {
    expect(findEmojiClusters("a😀b👋\u{1f3fb}c")).toEqual(["😀", "👋\u{1f3fb}"]);
  });

  it("returns an empty array when there is no emoji", () => {
    expect(findEmojiClusters("plain text")).toEqual([]);
  });
});
