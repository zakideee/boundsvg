import { useContext } from "react";
import { BoundSvgContext } from "../context.js";
import type { BoundSvgContextValue } from "../types.js";

/**
 * Access the BoundSvg engine and initialization status.
 * Must be used within a <BoundSvgProvider>.
 */
export function useBoundSvg(): BoundSvgContextValue {
  const ctx = useContext(BoundSvgContext);
  if (ctx === null) {
    throw new Error("useBoundSvg must be used within a <BoundSvgProvider>");
  }
  return ctx;
}
