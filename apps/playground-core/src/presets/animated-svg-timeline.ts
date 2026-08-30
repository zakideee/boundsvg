import { Box, Canvas, Text, type VNode } from "@boundsvg/core";
import { FONT_ALIAS, JETBRAINS_ALIAS } from "../config";
import type { Preset } from "../types";

const DOCUMENT_DURATION_MS = 2_400;
const POSTER_TIME_MS = 600;

const FAST_TRACK = {
  keyframes: [
    { at: 0, opacity: 0.35, transform: { translateX: 0 } },
    { at: 0.5, opacity: 1, transform: { translateX: 620 } },
    { at: 1, opacity: 0.35, transform: { translateX: 0 } },
  ],
  durationMs: 800,
  easing: "ease-in-out",
  iterations: "infinite",
  fill: "both",
} as const;

const SLOW_TRACK = {
  keyframes: [
    { at: 0, opacity: 0.35, transform: { translateX: 0 } },
    { at: 0.5, opacity: 1, transform: { translateX: 620 } },
    { at: 1, opacity: 0.35, transform: { translateX: 0 } },
  ],
  durationMs: 1_200,
  easing: "ease-in-out",
  iterations: "infinite",
  fill: "both",
} as const;

function buildAnimatedSvgTimeline(): VNode {
  return Canvas(
    { width: 920, height: 420, background: "#0b1120" },
    Text(
      {
        position: "absolute",
        left: 32,
        top: 24,
        width: 856,
        font: FONT_ALIAS,
        fontSizePx: 28,
        color: "#f8fafc",
        wrap: "none",
      },
      "DOCUMENT TIMELINE · D = 2400 ms",
    ),
    Text(
      {
        position: "absolute",
        left: 32,
        top: 62,
        width: 856,
        font: FONT_ALIAS,
        fontSizePx: 13,
        color: "#94a3b8",
        wrap: "none",
      },
      "One document clock synchronizes authored tracks with different local durations.",
    ),
    Box({
      position: "absolute",
      left: 128,
      top: 126,
      width: 668,
      height: 44,
      background: "#172554",
      borderRadius: 22,
    }),
    Text(
      {
        position: "absolute",
        left: 32,
        top: 138,
        width: 84,
        font: JETBRAINS_ALIAS,
        fontSizePx: 12,
        color: "#93c5fd",
        wrap: "none",
      },
      "800 ms × 3",
    ),
    Box({
      id: "timeline-fast-track",
      position: "absolute",
      left: 140,
      top: 136,
      width: 24,
      height: 24,
      background: "#38bdf8",
      borderRadius: 12,
      opacity: 0.35,
      animate: FAST_TRACK,
    }),
    Box({
      position: "absolute",
      left: 128,
      top: 218,
      width: 668,
      height: 44,
      background: "#3b174f",
      borderRadius: 22,
    }),
    Text(
      {
        position: "absolute",
        left: 32,
        top: 230,
        width: 84,
        font: JETBRAINS_ALIAS,
        fontSizePx: 12,
        color: "#f0abfc",
        wrap: "none",
      },
      "1200 ms × 2",
    ),
    Box({
      id: "timeline-slow-track",
      position: "absolute",
      left: 140,
      top: 228,
      width: 24,
      height: 24,
      background: "#e879f9",
      borderRadius: 12,
      opacity: 0.35,
      animate: SLOW_TRACK,
    }),
    Text(
      {
        position: "absolute",
        left: 32,
        top: 326,
        width: 856,
        font: JETBRAINS_ALIAS,
        fontSizePx: 12,
        color: "#cbd5e1",
        wrap: "none",
      },
      "base pose = 600 ms · iterations = infinite · reducedMotion = pause",
    ),
    Text(
      {
        position: "absolute",
        left: 32,
        top: 356,
        width: 856,
        font: FONT_ALIAS,
        fontSizePx: 12,
        color: "#64748b",
        wrap: "none",
      },
      "Enable prefers-reduced-motion: reduce to hold the deterministic 600 ms poster frame.",
    ),
  );
}

export const animatedSvgTimelinePreset: Preset = {
  title: "Animated SVG Timeline",
  description:
    "A 2400 ms document clock synchronizes 800 ms and 1200 ms tracks; reduced motion holds the deterministic 600 ms base pose.",
  animationDurationMs: DOCUMENT_DURATION_MS,
  animatedSvgOptions: {
    playback: {
      mode: "timeline",
      durationMs: DOCUMENT_DURATION_MS,
      iterations: "infinite",
    },
    timeMs: POSTER_TIME_MS,
    reducedMotion: "pause",
  },
  source: `import { Box, Canvas, Text } from "@boundsvg/core";

const makeTrack = (durationMs) => ({
  keyframes: [
    { at: 0, opacity: 0.35, transform: { translateX: 0 } },
    { at: 0.5, opacity: 1, transform: { translateX: 620 } },
    { at: 1, opacity: 0.35, transform: { translateX: 0 } },
  ],
  durationMs,
  easing: "ease-in-out",
  iterations: "infinite",
  fill: "both",
});

const fastTrack = makeTrack(800);
const slowTrack = makeTrack(1200);

const scene = Canvas(
  { width: 920, height: 420, background: "#0b1120" },
  // Two continuous local loops: 800 ms × 3 and 1200 ms × 2 per document cycle.
  Box({ id: "timeline-fast-track", animate: fastTrack }),
  Box({ id: "timeline-slow-track", animate: slowTrack }),
);

const svg = engine.renderToAnimatedSvg(scene, {
  playback: { mode: "timeline", durationMs: 2400, iterations: "infinite" },
  timeMs: 600,
  reducedMotion: "pause",
});`,
  build: buildAnimatedSvgTimeline,
};
