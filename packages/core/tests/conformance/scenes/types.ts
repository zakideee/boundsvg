import type { RenderOptions } from "../../../src/engine.js";
import type { VNode } from "../../../src/vnode/types.js";

/**
 * One conformance scene.
 *
 * Every scene is a deterministic pure builder: no Date/random access, no
 * network URLs, fonts limited to fixtures/fonts aliases, images embedded as
 * fixture bytes. The suite renders each scene through the real WASM engine
 * for SVG snapshots, IR assertions, and PNG hash verification.
 */
export type ConformanceScene = {
  id: string;
  build: () => VNode;
  width: number;
  height: number;
  /** Emit options this scene must always render with (e.g. glyph path mode). */
  renderOptions?: RenderOptions;
  /** RecoverableError codes this scene intentionally produces. */
  allowedWarningCodes?: readonly string[];
};
