/**
 * Debug overlay option types for SVG emission.
 *
 * The overlay itself is rendered by the WASM emitter; these types describe
 * the `debug` render option carried through `RenderOptions` / `EmitOptions`.
 */

export type DebugOverlayPart = "specified" | "layout" | "actual" | "baseline";

export type DebugOverlayConfig = {
  /** Parts to render. Omit to keep the full `debug: true` overlay. */
  parts?: readonly DebugOverlayPart[];
};
