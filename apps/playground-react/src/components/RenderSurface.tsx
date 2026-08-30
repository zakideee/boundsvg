import {
  AnimatedBoundSvg,
  BoundSvg,
  type CompileOptions,
  type OutputCommonOptions,
  type RenderAnimatedSvgOptions,
  useRenderToAnimatedSvg,
  useRenderToSvg,
  type VNode,
} from "@boundsvg/react";
import { useRenderToPng } from "@boundsvg/react/png";
import { useMemo } from "react";
import type { RendererMode } from "../types";

// Static SVG rendering rejects animated scenes without an explicit timeMs, so
// SVG surfaces route scenes that declare animation through the animated
// entry points with independent playback, preserving the live preview.
function declaresAnimation(vnode: VNode | null): boolean {
  return vnode !== null && /"animate(Units)?":/.test(JSON.stringify(vnode));
}

const INDEPENDENT_PLAYBACK = { playback: { mode: "independent" } } as const;

type RenderSurfaceProps = {
  renderer: RendererMode;
  vnode: VNode | null;
  renderOptions?: CompileOptions & OutputCommonOptions;
  animatedSvgOptions?: RenderAnimatedSvgOptions;
  isPending?: boolean;
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function readPngDimensions(png: Uint8Array): { width: number; height: number } | null {
  if (png.byteLength < 24) {
    return null;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (png[i] !== PNG_SIGNATURE[i]) {
      return null;
    }
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function resolvePreviewScale(scale: number | undefined): number {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) {
    return 1;
  }
  return scale;
}

export function RenderSurface({
  renderer,
  vnode,
  renderOptions,
  animatedSvgOptions,
  isPending,
}: RenderSurfaceProps) {
  const surface =
    renderer === "boundsvg" ? (
      <BoundSvgSurface
        vnode={vnode}
        renderOptions={renderOptions}
        animatedSvgOptions={animatedSvgOptions}
      />
    ) : renderer === "svg-hook" ? (
      <SvgHookSurface
        vnode={vnode}
        renderOptions={renderOptions}
        animatedSvgOptions={animatedSvgOptions}
      />
    ) : (
      <PngHookSurface vnode={vnode} renderOptions={renderOptions} />
    );

  return (
    <div className={`preview-stage-wrap${isPending ? " is-pending" : ""}`}>
      {surface}
      {isPending && (
        <div className="rendering-overlay">
          <span className="rendering-label">Rendering…</span>
        </div>
      )}
    </div>
  );
}

function BoundSvgSurface({
  vnode,
  renderOptions,
  animatedSvgOptions,
}: {
  vnode: VNode | null;
  renderOptions?: CompileOptions & OutputCommonOptions;
  animatedSvgOptions?: RenderAnimatedSvgOptions;
}) {
  const animated = useMemo(() => declaresAnimation(vnode), [vnode]);
  const fallback = <p className="placeholder-text">Rendering…</p>;
  const errorFallback = (error: Error) => (
    <p className="error-text">Render failed: {error.message}</p>
  );
  return (
    <div className="preview-stage">
      {animated ? (
        <AnimatedBoundSvg
          vnode={vnode}
          className="rendered-content"
          renderOptions={{ ...renderOptions, ...(animatedSvgOptions ?? INDEPENDENT_PLAYBACK) }}
          fallback={fallback}
          errorFallback={errorFallback}
        />
      ) : (
        <BoundSvg
          vnode={vnode}
          className="rendered-content"
          renderOptions={renderOptions}
          fallback={fallback}
          errorFallback={errorFallback}
        />
      )}
    </div>
  );
}

function SvgHookSurface(props: {
  vnode: VNode | null;
  renderOptions?: CompileOptions & OutputCommonOptions;
  animatedSvgOptions?: RenderAnimatedSvgOptions;
}) {
  const animated = useMemo(() => declaresAnimation(props.vnode), [props.vnode]);
  return animated ? <AnimatedSvgHookSurface {...props} /> : <StaticSvgHookSurface {...props} />;
}

function AnimatedSvgHookSurface({
  vnode,
  renderOptions,
  animatedSvgOptions,
}: {
  vnode: VNode | null;
  renderOptions?: CompileOptions & OutputCommonOptions;
  animatedSvgOptions?: RenderAnimatedSvgOptions;
}) {
  const animatedRenderOptions = useMemo(
    () => ({ ...renderOptions, ...(animatedSvgOptions ?? INDEPENDENT_PLAYBACK) }),
    [renderOptions, animatedSvgOptions],
  );
  const { svg, error, isReady } = useRenderToAnimatedSvg(vnode, animatedRenderOptions);
  return <SvgHookResult svg={svg} error={error} isReady={isReady} />;
}

function StaticSvgHookSurface({
  vnode,
  renderOptions,
}: {
  vnode: VNode | null;
  renderOptions?: CompileOptions & OutputCommonOptions;
}) {
  const { svg, error, isReady } = useRenderToSvg(vnode, renderOptions);
  return <SvgHookResult svg={svg} error={error} isReady={isReady} />;
}

function SvgHookResult({
  svg,
  error,
  isReady,
}: {
  svg: string | null;
  error: Error | null;
  isReady: boolean;
}) {
  if (error) {
    return (
      <div className="preview-stage">
        <p className="error-text">Render failed: {error.message}</p>
      </div>
    );
  }

  if (!isReady || !svg) {
    return (
      <div className="preview-stage">
        <p className="placeholder-text">Rendering…</p>
      </div>
    );
  }

  return (
    <div className="preview-stage">
      <div className="rendered-content" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

function PngHookSurface({
  vnode,
  renderOptions,
}: {
  vnode: VNode | null;
  renderOptions?: CompileOptions & OutputCommonOptions;
}) {
  const { png, dataUrl, error, isReady } = useRenderToPng(vnode, renderOptions);
  const previewSize = useMemo(() => {
    if (!png) {
      return null;
    }
    const dimensions = readPngDimensions(png);
    if (!dimensions) {
      return null;
    }
    const scale = resolvePreviewScale(renderOptions?.scale);
    return {
      width: dimensions.width / scale,
      height: dimensions.height / scale,
    };
  }, [png, renderOptions?.scale]);

  if (error) {
    return (
      <div className="preview-stage">
        <p className="error-text">Render failed: {error.message}</p>
      </div>
    );
  }

  if (!isReady || !dataUrl) {
    return (
      <div className="preview-stage">
        <p className="placeholder-text">Rendering…</p>
      </div>
    );
  }

  return (
    <div className="preview-stage">
      <img
        className="preview-image"
        src={dataUrl}
        alt="Rendered PNG preview"
        style={previewSize ? { width: previewSize.width } : undefined}
      />
    </div>
  );
}
