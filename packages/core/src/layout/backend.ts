import type { ShapeRegistry } from "../shape/expand.js";

// ---------------------------------------------------------------------------
// Layout backend transport types
// ---------------------------------------------------------------------------

/** Raw transport function: accepts a JSON string, returns a JSON string.
 *  Implemented by the WASM `compute_layout` binding. */
export type ComputeLayoutTransportFn = (inputJson: string) => string;

/** Options passed to a layout backend's compute function. */
export type ComputeLayoutOptions = {
  computeLayoutFn: ComputeLayoutTransportFn;
  fonts?: Array<{
    alias: string;
    weight?: number;
    style?: "normal" | "italic";
    data: Uint8Array;
  }>;
  /**
   * Registry for resolving Shape/Symbol references while serializing visual
   * props. Optional: unresolvable references are omitted from the transport
   * and surface (or not) at IR build.
   */
  shapeRegistry?: ShapeRegistry;
};
