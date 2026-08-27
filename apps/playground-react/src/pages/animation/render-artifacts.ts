import type { Engine, EngineInput, LayoutNode, RenderOptions } from "@boundsvg/core";

function toRenderError(renderError: unknown): Error {
  return renderError instanceof Error ? renderError : new Error(String(renderError));
}

export function tryRenderAnimationArtifacts(
  engine: Pick<Engine, "renderToSvgAndIR"> | null,
  input: EngineInput,
  renderOptions: RenderOptions,
) {
  if (!engine) {
    return { artifacts: null, error: null };
  }
  try {
    return { artifacts: engine.renderToSvgAndIR(input, renderOptions), error: null };
  } catch (renderError) {
    return { artifacts: null, error: toRenderError(renderError) };
  }
}

/** Sampling rate for the animated downloads. 50 ms per frame, clear of GIF's 20 ms floor. */
const ANIMATED_EXPORT_FPS = 20;

const ANIMATED_EXPORT_MIME: Record<AnimatedExportFormat, string> = {
  "animated-webp": "image/webp",
  gif: "image/gif",
};

const ANIMATED_EXPORT_EXTENSION: Record<AnimatedExportFormat, string> = {
  "animated-webp": "webp",
  gif: "gif",
};

export type AnimatedExportFormat = "animated-webp" | "gif";

/**
 * Download the current frame as a still PNG, sampled at the scrubbed `timeMs`.
 *
 * The animated exports package the whole schedule; this is the one frame on
 * screen, which is what a timeline scrub is for.
 */
export function downloadStillArtifact({
  engine,
  input,
  renderOptions,
  fileName,
}: {
  engine: Pick<Engine, "renderToPng"> | null;
  input: EngineInput;
  renderOptions: RenderOptions;
  fileName: string;
}): { error: Error | null } {
  if (!engine) {
    return { error: new Error("Engine is not ready") };
  }
  let bytes: Uint8Array;
  try {
    bytes = engine.renderToPng(input, { ...renderOptions, animation: "static" });
  } catch (renderError) {
    return { error: toRenderError(renderError) };
  }

  let url: string | null = null;
  const link = document.createElement("a");
  try {
    url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    link.href = url;
    link.download = `${fileName}.png`;
    document.body.appendChild(link);
    link.click();
  } catch (downloadError) {
    return { error: toRenderError(downloadError) };
  } finally {
    // Leaving either behind would leak for the life of the document.
    link.remove();
    if (url !== null) {
      URL.revokeObjectURL(url);
    }
  }
  return { error: null };
}

/**
 * Package the sampled frames of the scene on screen as a single animated file
 * and hand it to the browser as a download.
 */
export function downloadAnimatedArtifact({
  engine,
  input,
  renderOptions,
  durationMs,
  format,
  fileName,
}: {
  engine: Pick<Engine, "renderToAnimatedWebp" | "renderToAnimatedGif"> | null;
  input: EngineInput;
  renderOptions: RenderOptions;
  durationMs: number;
  format: AnimatedExportFormat;
  fileName: string;
}): { error: Error | null } {
  if (!engine) {
    return { error: new Error("Engine is not ready") };
  }
  // `animation` and `timeMs` describe a single sampled still; the animated
  // encoders own the whole schedule instead.
  const { animation: _animation, timeMs: _timeMs, ...rasterOptions } = renderOptions;
  let bytes: Uint8Array;
  try {
    const animatedOptions = {
      ...rasterOptions,
      durationMs,
      fps: ANIMATED_EXPORT_FPS,
      iterations: "infinite" as const,
    };
    bytes =
      format === "gif"
        ? engine.renderToAnimatedGif(input, animatedOptions)
        : engine.renderToAnimatedWebp(input, animatedOptions);
  } catch (renderError) {
    return { error: toRenderError(renderError) };
  }

  let url: string | null = null;
  const link = document.createElement("a");
  try {
    url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: ANIMATED_EXPORT_MIME[format] }),
    );
    link.href = url;
    link.download = `${fileName}.${ANIMATED_EXPORT_EXTENSION[format]}`;
    document.body.appendChild(link);
    link.click();
  } catch (downloadError) {
    return { error: toRenderError(downloadError) };
  } finally {
    // Leaving either behind would leak for the life of the document.
    link.remove();
    if (url !== null) {
      URL.revokeObjectURL(url);
    }
  }
  return { error: null };
}

/** Frame rate offered for MP4 export. 29.97 is the NTSC rate, exactly 30000/1001. */
export type Mp4ExportFrameRate = 30 | 29.97;

/**
 * Whether this browser has the encoder API at all.
 *
 * `@boundsvg/video` needs WebCodecs, which Safari gained late and Firefox still
 * lacks for H.264 encode, so the button is hidden where it is absent entirely.
 * Whether a present encoder supports H.264 is only knowable from
 * `isConfigSupported`, which is async and would gate the render on a probe; a
 * browser that has WebCodecs but refuses the codec still shows the button and
 * reports the refusal in the notice.
 */
export function isMp4ExportSupported(): boolean {
  return typeof globalThis.VideoEncoder !== "undefined";
}

/**
 * Encode the sampled frames of the scene on screen as an MP4 and download it.
 *
 * `@boundsvg/video` is imported dynamically so a browser without WebCodecs — or
 * a visitor who never clicks — pays for neither the package nor its muxer wasm.
 */
export async function downloadMp4Artifact({
  engine,
  input,
  renderOptions,
  durationMs,
  frameRate,
  fileName,
  signal,
}: {
  engine: Engine | null;
  input: EngineInput;
  renderOptions: RenderOptions;
  durationMs: number;
  frameRate: Mp4ExportFrameRate;
  fileName: string;
  signal?: AbortSignal;
}): Promise<{ error: Error | null }> {
  if (!engine) {
    return { error: new Error("Engine is not ready") };
  }
  if (!isMp4ExportSupported()) {
    return { error: new Error("This browser has no WebCodecs VideoEncoder") };
  }
  let bytes: Uint8Array;
  try {
    signal?.throwIfAborted();
    const { renderToMp4 } = await import("@boundsvg/video");
    // `scale` is the only shared option this page drives today. The exporter
    // owns the whole schedule, so `animation` and `timeMs` are simply not
    // forwarded. The rest `renderToMp4` accepts — background, onWarning,
    // rasterOversizeBehavior — have no control here yet; forwarding them now
    // would only thread undefined, so add each alongside its control.
    bytes = await renderToMp4(engine, input, {
      durationMs,
      frameRate,
      ...(renderOptions.scale !== undefined && { scale: renderOptions.scale }),
      ...(signal !== undefined && { signal }),
    });
    signal?.throwIfAborted();
  } catch (renderError) {
    return { error: toRenderError(renderError) };
  }

  let url: string | null = null;
  const link = document.createElement("a");
  try {
    url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "video/mp4" }));
    link.href = url;
    link.download = `${fileName}.mp4`;
    document.body.appendChild(link);
    link.click();
  } catch (downloadError) {
    return { error: toRenderError(downloadError) };
  } finally {
    // Leaving either behind would leak for the life of the document.
    link.remove();
    if (url !== null) {
      URL.revokeObjectURL(url);
    }
  }
  return { error: null };
}

type LayoutReactiveRenderMetrics = {
  layoutProbeMs: number;
  fullFrameRenderMs: number;
  chosenFontSizePx: number | null;
  lineCount: number | null;
  overflow: string | null;
  flowSignature: string | null;
};

function resolvedFlowSignature(
  textLayout: NonNullable<LayoutNode["textLayout"]>["resolvedTextLayout"],
): string {
  return JSON.stringify(
    textLayout.lines.map((line) => ({
      text: line.text,
      width: line.width,
      baselineY: line.baselineY,
      glyphs: line.positionedGlyphs?.map((glyph) => ({
        glyphId: glyph.glyphId,
        originX: glyph.originX,
        originY: glyph.originY,
        xAdvance: glyph.xAdvance,
        yAdvance: glyph.yAdvance,
        sourceStart: glyph.sourceStart,
        sourceEnd: glyph.sourceEnd,
        sourceRole: glyph.sourceRole,
      })),
    })),
  );
}

function findLayoutNode(layoutNode: LayoutNode, nodeId: string): LayoutNode | null {
  if (layoutNode.nodeId === nodeId) {
    return layoutNode;
  }
  for (const child of layoutNode.children) {
    const found = findLayoutNode(child, nodeId);
    if (found) {
      return found;
    }
  }
  return null;
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function tryRenderLayoutReactiveArtifacts(
  engine: Pick<Engine, "renderToLayoutTree" | "renderToSvgAndIR"> | null,
  input: EngineInput,
  renderOptions: RenderOptions,
  textNodeId?: string,
) {
  if (!engine) {
    return { artifacts: null, metrics: null, error: null };
  }
  try {
    const layoutStart = monotonicNow();
    const layout = engine.renderToLayoutTree(input, renderOptions);
    const layoutProbeMs = monotonicNow() - layoutStart;
    const renderStart = monotonicNow();
    const artifacts = engine.renderToSvgAndIR(input, renderOptions);
    const fullFrameRenderMs = monotonicNow() - renderStart;
    const textLayout = textNodeId
      ? findLayoutNode(layout.root, textNodeId)?.textLayout?.resolvedTextLayout
      : undefined;
    return {
      artifacts,
      metrics: {
        layoutProbeMs,
        fullFrameRenderMs,
        chosenFontSizePx: textLayout?.chosenFontSizePx ?? null,
        lineCount: textLayout?.lines.length ?? null,
        overflow: textLayout?.overflow.type ?? null,
        flowSignature: textLayout ? resolvedFlowSignature(textLayout) : null,
      } satisfies LayoutReactiveRenderMetrics,
      error: null,
    };
  } catch (renderError) {
    return { artifacts: null, metrics: null, error: toRenderError(renderError) };
  }
}
