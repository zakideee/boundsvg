/**
 * Bridge to the bundled MP4 muxer wasm.
 *
 * Names crossing this boundary use snake_case to match the Rust exports — do
 * not rename them.
 */

import type { InitInput } from "../wasm-pkg/boundmp4.js";
import wasmInit, * as generatedMuxer from "../wasm-pkg/boundmp4.js";
import { createVideoError } from "./diagnostics.js";

/** Independent revision of the bundled MP4 boundary. */
const EXPECTED_MP4_WASM_SCHEMA_VERSION = 1;
const { Mp4VideoMuxer } = generatedMuxer;

/** Instantiate the muxer wasm, optionally from a caller-supplied binary. */
export async function initMuxerWasm(input?: InitInput): Promise<void> {
  try {
    await (input === undefined ? wasmInit() : wasmInit({ module_or_path: input }));
  } catch {
    throw createVideoError("VIDEO_MUXER_LOAD_FAILED", "load");
  }
  try {
    if (
      typeof generatedMuxer.mp4_wasm_schema_version !== "function" ||
      generatedMuxer.mp4_wasm_schema_version() !== EXPECTED_MP4_WASM_SCHEMA_VERSION
    ) {
      throw createVideoError("VIDEO_MUXER_ABI_MISMATCH", "load");
    }
  } catch {
    throw createVideoError("VIDEO_MUXER_ABI_MISMATCH", "load");
  }
}

export { Mp4VideoMuxer };
export type { InitInput };
