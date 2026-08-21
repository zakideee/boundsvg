import { describe, expect, it } from "vitest";
import { buildAnimationTrack } from "../../src/animation-track.js";

describe("buildAnimationTrack", () => {
  it("normalizes absolute times into strictly increasing offsets", () => {
    const track = buildAnimationTrack({
      durationMs: 10_000,
      frames: [
        { atMs: 0, opacity: 0 },
        { atMs: 2_500, opacity: 1 },
        // Collides with its predecessor: nudged forward, never reordered.
        { atMs: 2_500, opacity: 0.5 },
        { atMs: 10_000, opacity: 0 },
      ],
      easing: "linear",
      fill: "both",
    });
    const offsets = track.keyframes.map((frame) => frame.at);
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(1);
    for (let index = 1; index < offsets.length; index += 1) {
      expect((offsets[index] ?? 0) > (offsets[index - 1] ?? 0)).toBe(true);
    }
    expect(track.easing).toBe("linear");
    expect(track.fill).toBe("both");
  });

  it("keeps one terminal frame and drops frames pushed past the end", () => {
    const track = buildAnimationTrack({
      durationMs: 1_000,
      frames: [
        { atMs: 999.9, opacity: 0.9 },
        // Interior frame that no longer fits before the terminal cap.
        { atMs: 999.95, opacity: 0.95 },
        { atMs: 1_000, opacity: 1 },
        // A second terminal frame is dropped.
        { atMs: 2_000, opacity: 0 },
      ],
    });
    const terminal = track.keyframes.filter((frame) => frame.at === 1);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]?.opacity).toBe(1);
    expect(track.keyframes.every((frame) => frame.at <= 1)).toBe(true);
  });
});
