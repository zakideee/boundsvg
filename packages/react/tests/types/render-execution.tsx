/** @jsxImportSource react */
import type { IR, VNode } from "@boundsvg/core";
import { useCompiledScene, usePngObjectUrl, useRenderAsset } from "../../dist/assets.js";
import {
  type RenderExecutionOptions,
  type RenderExecutionState,
  type UseRenderToSvgAndIrAsyncResult,
  useRenderToAnimatedSvgAndIrAsync,
  useRenderToAnimatedSvgAsync,
  useRenderToLayeredPngAsync,
  useRenderToLayeredSvgAsync,
  useRenderToPngAsync,
  useRenderToSvgAndIrAsync,
  useRenderToSvgAsync,
} from "../../dist/async.js";
import { BoundSvg, type RenderInputOptions, useRenderToSvg } from "../../dist/index.js";
import { useBoundSvgInspection } from "../../dist/inspect.js";
import { useRenderToPng } from "../../dist/png.js";
import type { BoundSvgConfig } from "../../dist/provider.js";

declare const vnode: VNode;
declare const png: Uint8Array;
const controls: RenderExecutionOptions = {
  revision: 1,
  retainPreviousResult: false,
  onError: (error) => {
    void error.message;
  },
};
const inputControls: RenderInputOptions = { revision: 2 };
const result = useRenderToSvgAndIrAsync(vnode, {}, controls);
const state: RenderExecutionState = result;
void state;
if (result.status === "success") {
  const svg: string = result.svg;
  const ir: IR = result.ir;
  const ready: true = result.isReady;
  void [svg, ir, ready];
}
if (result.status === "idle") {
  const empty: null = result.svg;
  const execution: null = result.execution;
  void [empty, execution];
}
if (result.status === "error") {
  const error: Error = result.error;
  const ready: false = result.isReady;
  void [error, ready];
}
if (result.status === "rendering" && result.isStale) {
  const svg: string = result.svg;
  const ir: IR = result.ir;
  void [svg, ir];
}

// @ts-expect-error a retained generation cannot contain SVG without its matching IR
const mixed: UseRenderToSvgAndIrAsyncResult = {
  status: "rendering",
  execution: "worker",
  error: null,
  isRendering: true,
  isReady: false,
  isStale: true,
  svg: "<svg/>",
  ir: null,
};
void mixed;
useRenderToSvgAsync(vnode, {}, controls);
useRenderToPngAsync(vnode, {}, controls);
useRenderToLayeredSvgAsync(vnode, {}, controls);
useRenderToLayeredPngAsync(vnode, {}, controls);
useRenderToAnimatedSvgAsync(vnode, { playback: { mode: "independent" } }, controls);
useRenderToAnimatedSvgAndIrAsync(vnode, { playback: { mode: "independent" } }, controls);
useRenderToSvg(vnode, {}, inputControls);
useRenderToPng(vnode, {}, inputControls);
useCompiledScene(vnode, {}, inputControls);
useRenderAsset(vnode, {}, inputControls);
useBoundSvgInspection(vnode, {}, inputControls);
usePngObjectUrl(png, inputControls);
void (<BoundSvg vnode={vnode} executionOptions={controls} />);
const config: BoundSvgConfig = { fonts: [], resourcesRevision: 1 };
void config;

// @ts-expect-error revision must be a number
useRenderToSvgAsync(vnode, {}, { revision: "1" });
// @ts-expect-error retention must be a boolean
useRenderToPngAsync(vnode, {}, { retainPreviousResult: "false" });
// @ts-expect-error callback controls require a function
useRenderToSvgAsync(vnode, {}, { onError: false });
// @ts-expect-error execution controls do not enter Core render options
useRenderToSvgAsync(vnode, { revision: 1 });
