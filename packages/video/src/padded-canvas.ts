import { FatalError } from "@boundsvg/core";

/** Canvas sized to even dimensions, reused for every frame of an export. */
export type PaddedFrameCanvas = {
  readonly width: number;
  readonly height: number;
  /** Image source handed to `VideoFrame`. */
  readonly source: CanvasImageSource;
  /** Repaint the background and draw one decoded frame at the top left. */
  draw(bitmap: ImageBitmap): void;
};

/**
 * Create the drawing surface frames are composited onto.
 *
 * H.264 in yuv420 needs even dimensions and carries no alpha, so odd sizes gain
 * one padding column or row on the right and bottom, and the whole surface is
 * painted with the background colour before every frame.
 */
export function createPaddedFrameCanvas(
  frameWidth: number,
  frameHeight: number,
  background: string,
): PaddedFrameCanvas {
  const width = toEven(frameWidth);
  const height = toEven(frameHeight);
  const { canvas, context } = createCanvasContext(width, height);
  assertOpaqueColor(context, background);

  return {
    width,
    height,
    source: canvas,
    draw(bitmap) {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0);
    },
  };
}

function toEven(value: number): number {
  return Math.ceil(value / 2) * 2;
}

/** Divisor turning a percentage alpha term into the 0..1 range. */
const PERCENT_SCALE = 100;

/**
 * Reject a background the encoder cannot honour.
 *
 * An unparseable `fillStyle` assignment is ignored rather than reported, which
 * would leave every padded edge painted in whatever was set before. A parseable
 * but translucent one is worse: H.264 carries no alpha and the canvas is opaque,
 * so it composites against black instead of being seen for what it is.
 */
function assertOpaqueColor(context: CanvasContext["context"], background: string): void {
  // fillStyle reads back serialized, so a colour equal to one probe would look
  // like a rejected assignment. Two probes cannot both collide with it.
  const leavesProbeInPlace = (probe: string): boolean => {
    context.fillStyle = probe;
    context.fillStyle = background;
    return context.fillStyle === probe;
  };
  if (leavesProbeInPlace("#fedcba") && leavesProbeInPlace("#123456")) {
    throw new FatalError(
      "VIDEO_INVALID_OPTION",
      `background is not a colour this runtime can paint: ${background}`,
      { background },
    );
  }
  const alpha = serializedAlpha(context.fillStyle);
  if (alpha !== undefined && alpha < 1) {
    throw new FatalError(
      "VIDEO_INVALID_OPTION",
      `background must be opaque because H.264 has no alpha channel; ${background} would be painted as black`,
      { background },
    );
  }
}

/**
 * Alpha of a serialized `fillStyle`, or undefined when it carries none.
 *
 * An opaque colour serializes as `#rrggbb`, so any alpha at all is a signal.
 * Two serializations can carry one: the legacy sRGB form `rgba(r, g, b, a)`,
 * and the CSS Color 4 form used by `color()` / `oklch()` / `lab()`, which keeps
 * its own syntax and appends `/ a`. Matching only the first would let a
 * wide-gamut translucent colour through to be painted as black.
 */
function serializedAlpha(fillStyle: string | CanvasGradient | CanvasPattern): number | undefined {
  if (typeof fillStyle !== "string") {
    return undefined;
  }
  const legacy = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+%?)\s*\)$/.exec(
    fillStyle,
  );
  const modern = /\/\s*([\d.]+%?)\s*\)$/.exec(fillStyle);
  const term = legacy?.[1] ?? modern?.[1];
  if (term === undefined) {
    return undefined;
  }
  const alpha = term.endsWith("%") ? Number(term.slice(0, -1)) / PERCENT_SCALE : Number(term);
  return Number.isFinite(alpha) ? alpha : undefined;
}

type CanvasContext = {
  canvas: CanvasImageSource;
  context: {
    fillStyle: string | CanvasGradient | CanvasPattern;
    fillRect(x: number, y: number, width: number, height: number): void;
    drawImage(image: ImageBitmap, dx: number, dy: number): void;
  };
};

function createCanvasContext(width: number, height: number): CanvasContext {
  const canvas = createCanvas(width, height);
  // Frames are opaque after the background pass, and telling the compositor so
  // avoids a needless premultiplied-alpha round trip on every frame.
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new FatalError(
      "VIDEO_ENCODER_UNSUPPORTED",
      "a 2d canvas context is required to pad frames for MP4 export",
    );
  }
  return { canvas, context };
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new FatalError(
    "VIDEO_ENCODER_UNSUPPORTED",
    "MP4 export needs a canvas implementation; this runtime has neither OffscreenCanvas nor document",
  );
}
