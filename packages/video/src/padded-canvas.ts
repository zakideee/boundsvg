import { FatalError } from "@boundsvg/core";
import { createVideoError } from "./diagnostics.js";

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
  try {
    assertOpaqueColor(context, background);
  } catch (failure) {
    if (failure instanceof FatalError) {
      throw failure;
    }
    throw createVideoError("VIDEO_FRAME_PREPARATION_FAILED", "createCanvas");
  }

  return {
    width,
    height,
    source: canvas,
    draw(bitmap) {
      try {
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0);
      } catch {
        throw createVideoError("VIDEO_FRAME_PREPARATION_FAILED", "drawFrame");
      }
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
      {
        context: {
          background,
        },
      },
    );
  }
  const alpha = serializedAlpha(context.fillStyle);
  if (alpha !== undefined && alpha < 1) {
    throw new FatalError(
      "VIDEO_INVALID_OPTION",
      `background must be opaque because H.264 has no alpha channel; ${background} would be painted as black`,
      {
        context: {
          background,
        },
      },
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
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  let context: CanvasContext["context"] | null;
  if (typeof OffscreenCanvas === "undefined" && typeof document === "undefined") {
    throw createVideoError("VIDEO_ENCODER_UNSUPPORTED", "createCanvas");
  }
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(width, height);
    } else {
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
    }
    context = canvas.getContext("2d", { alpha: false });
  } catch {
    throw createVideoError("VIDEO_FRAME_PREPARATION_FAILED", "createCanvas");
  }
  if (!context) {
    throw createVideoError("VIDEO_ENCODER_UNSUPPORTED", "createCanvas");
  }
  return { canvas, context };
}
