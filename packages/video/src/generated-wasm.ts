/**
 * Bridge to the bundled MP4 muxer wasm.
 *
 * Names crossing this boundary use snake_case to match the Rust exports — do
 * not rename them.
 */
import wasmInit, { type InitInput, Mp4VideoMuxer } from "../wasm-pkg/boundmp4.js";

/** Instantiate the muxer wasm, optionally from a caller-supplied binary. */
export async function initMuxerWasm(input?: InitInput): Promise<void> {
  await (input === undefined ? wasmInit() : wasmInit({ module_or_path: input }));
}

export { Mp4VideoMuxer };
export type { InitInput };
