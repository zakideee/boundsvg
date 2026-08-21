import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type VNode } from "@boundsvg/core";
import { collectTimelineTracks } from "../src/pages/animation/timeline.js";

function scene(): VNode {
  return createElement(
    "Canvas",
    { width: 200, height: 100 },
    createElement("Box", {
      id: "fader",
      width: 40,
      height: 40,
      background: "#2563eb",
      animate: {
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
        durationMs: 400,
        delayMs: 100,
        easing: "linear",
        fill: "both",
      },
    }),
    createElement("Box", {
      id: "looper",
      width: 40,
      height: 40,
      background: "#e11d48",
      animate: {
        keyframes: [
          { at: 0, opacity: 1 },
          { at: 1, opacity: 0 },
        ],
        durationMs: 200,
        iterations: "infinite",
        easing: "linear",
        fill: "both",
      },
    }),
    createElement("Box", { id: "static-box", width: 10, height: 10, background: "#000000" }),
  ) as VNode;
}

test("collects a track only for animated nodes", () => {
  const tracks = collectTimelineTracks(scene());

  assert.deepEqual(
    tracks.map((track) => track.nodeId),
    ["fader", "looper"],
  );
});

test("folds delayMs and iterations into the track span", () => {
  const [fader] = collectTimelineTracks(scene());

  assert.equal(fader?.delayMs, 100);
  assert.equal(fader?.durationMs, 400);
  assert.equal(fader?.endMs, 500);
});

test("leaves an infinite track open ended", () => {
  const looper = collectTimelineTracks(scene())[1];

  assert.equal(looper?.iterations, "infinite");
  assert.equal(looper?.endMs, null);
});

test("reports text unit tracks separately from node tracks", () => {
  const tracks = collectTimelineTracks(
    createElement(
      "Canvas",
      { width: 200, height: 100 },
      createElement(
        "Text",
        {
          id: "units",
          font: "NotoSansJP",
          fontSizePx: 24,
          color: "#ffffff",
          animateUnits: {
            by: "cluster",
            delayStepMs: 40,
            animation: {
              keyframes: [
                { at: 0, opacity: 0 },
                { at: 1, opacity: 1 },
              ],
              durationMs: 300,
              easing: "linear",
              fill: "both",
            },
          },
        },
        "AB",
      ),
    ) as VNode,
  );

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.kind, "units");
  assert.match(tracks[0]?.label ?? "", /units/);
  assert.match(tracks[0]?.label ?? "", /40ms step/);
});

test("returns nothing for a scene without animation", () => {
  const tracks = collectTimelineTracks(
    createElement(
      "Canvas",
      { width: 50, height: 50 },
      createElement("Box", { width: 10, height: 10, background: "#000000" }),
    ) as VNode,
  );

  assert.deepEqual(tracks, []);
});
