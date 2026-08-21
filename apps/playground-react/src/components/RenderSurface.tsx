import { BoundSvg, type RenderOptions, useRenderToSvg, type VNode } from "@boundsvg/react";
import { useRenderToPng } from "@boundsvg/react/png";
import { useMemo } from "react";
import type { RendererMode } from "../types";

type RenderSurfaceProps = {
  renderer: RendererMode;
  vnode: VNode | null;
  renderOptions?: RenderOptions;
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

export function RenderSurface({ renderer, vnode, renderOptions, isPending }: RenderSurfaceProps) {
  const surface =
    renderer === "boundsvg" ? (
      <BoundSvgSurface vnode={vnode} renderOptions={renderOptions} />
    ) : renderer === "svg-hook" ? (
      <SvgHookSurface vnode={vnode} renderOptions={renderOptions} />
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
}: {
  vnode: VNode | null;
  renderOptions?: RenderOptions;
}) {
  return (
    <div className="preview-stage">
      <BoundSvg
        vnode={vnode}
        className="rendered-content"
        renderOptions={renderOptions}
        fallback={<p className="placeholder-text">Rendering…</p>}
        errorFallback={(error) => <p className="error-text">Render failed: {error.message}</p>}
      />
    </div>
  );
}

function SvgHookSurface({
  vnode,
  renderOptions,
}: {
  vnode: VNode | null;
  renderOptions?: RenderOptions;
}) {
  const { svg, error, isReady } = useRenderToSvg(vnode, renderOptions);

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
  renderOptions?: RenderOptions;
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
