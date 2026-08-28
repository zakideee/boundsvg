/** @jsxImportSource react */
import type { AnimationTimeline, VNode } from "../../dist/index.js";
import { AnimatedBoundSvg, BoundSvg, useRenderToAnimatedSvg } from "../../dist/index.js";
import { InteractiveBoundSvg } from "../../dist/interactive.js";
import type { BoundSvgConfig } from "../../dist/provider.js";
import {
  useRenderToAnimatedSvgAndIrAsync,
  useRenderToAnimatedSvgAsync,
} from "../../dist/worker.js";

declare const vnode: VNode;

const timeline: AnimationTimeline = {
  durationMs: 1_000,
  iterations: 2.25,
};

void (<BoundSvg vnode={vnode} renderOptions={{ timeMs: 0, nodeIdMetadata: "omit" }} />);
void (
  <AnimatedBoundSvg
    vnode={vnode}
    renderOptions={{ playback: { mode: "timeline", ...timeline }, reducedMotion: "pause" }}
  />
);

// @ts-expect-error animated SVG requires an explicit playback contract
void (<AnimatedBoundSvg vnode={vnode} renderOptions={{}} />);
// @ts-expect-error the static component no longer accepts the legacy animation switch
void (<BoundSvg vnode={vnode} renderOptions={{ animation: "declarative" }} />);

useRenderToAnimatedSvg(vnode, { playback: { mode: "timeline", ...timeline } });
useRenderToAnimatedSvgAsync(vnode, { playback: { mode: "timeline", ...timeline } });
useRenderToAnimatedSvgAndIrAsync(vnode, {
  playback: { mode: "timeline", ...timeline },
  nodeIdMetadata: "include",
});

void (
  <InteractiveBoundSvg
    vnode={vnode}
    renderMode="animated"
    renderOptions={{ playback: { mode: "timeline", ...timeline } }}
  />
);
// @ts-expect-error animated interactive mode requires animated SVG options
void (<InteractiveBoundSvg vnode={vnode} renderMode="animated" renderOptions={{ timeMs: 0 }} />);

const commonDefaults: BoundSvgConfig = {
  fonts: [],
  defaultCommonOptions: { scale: 2, textPathMode: "merged" },
};
void commonDefaults;

const artifactSpecificDefault: BoundSvgConfig = {
  fonts: [],
  defaultCommonOptions: {
    // @ts-expect-error SVG emission options stay at each render call
    resourceIdPrefix: "preview-",
  },
};
void artifactSpecificDefault;

const playbackSpecificDefault: BoundSvgConfig = {
  fonts: [],
  defaultCommonOptions: {
    // @ts-expect-error animated SVG playback stays at each render call
    playback: { mode: "timeline", ...timeline },
  },
};
void playbackSpecificDefault;
