import type { AnimatedRasterSink, AnimatedWebpSink } from "@boundsvg/core";

/** Destination used by animated CLI exports, including a dry-run discard sink. */
export type AnimatedRasterCliTarget =
  | { kind: "file"; path: string }
  | { kind: "stdout" }
  | { kind: "discard" };

/** Container-dependent destination capability; implementations must supply animated IO explicitly. */
export type OpenAnimatedRasterSink = {
  /** Open a patchable destination for WebP. */
  (target: AnimatedRasterCliTarget, format: "webp"): Promise<AnimatedWebpSink>;
  /** Open a sequential destination for GIF. */
  (target: AnimatedRasterCliTarget, format: "gif"): Promise<AnimatedRasterSink>;
};

/** Caller-supplied CLI IO operations, including fresh animated sinks and output-length stat access. */
export type CliIo = {
  /** Open a fresh animated destination, without using whole-output binary IO. */
  openAnimatedRasterSink: OpenAnimatedRasterSink;
  /** Stat an existing output length without reading its contents. */
  getFileByteLength: (path: string) => number;
  argv: string[];
  readTextFile: (path: string) => string;
  readBinaryFile: (path: string) => Uint8Array;
  ensureDir: (path: string) => void;
  writeTextFile: (path: string, data: string) => void;
  writeBinaryFile: (path: string, data: Uint8Array) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  fileExists: (path: string) => boolean;
  readStdin: () => string;
  writeBinaryStdout: (data: Uint8Array) => void;
  stdinIsTTY: boolean;
  watchFiles: (
    paths: string[],
    onChange: (changedPath: string) => void,
    options?: { debounceMs?: number },
  ) => { close: () => void };
};
