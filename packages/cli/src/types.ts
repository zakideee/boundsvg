// ---------------------------------------------------------------------------
// Shared CLI types
// ---------------------------------------------------------------------------

export type CliIo = {
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
