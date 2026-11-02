import { type IRHitIndex, prepareHitIndex } from "./hit-test.js";
import type { IR } from "./types.js";

/** Prepare source inspection queries, preferring primary geometry and deeper source frames.
 * @throws {FatalError} VALIDATION for invalid ownership or Path output geometry.
 */
export function buildInspectHitTestIndex(ir: IR): IRHitIndex {
  return prepareHitIndex(ir, "inspection");
}
