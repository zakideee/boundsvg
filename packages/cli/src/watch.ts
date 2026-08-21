// ---------------------------------------------------------------------------
// Watch mode — re-run on file change
// ---------------------------------------------------------------------------

import type { CliIo } from "./types.js";

type WatchAndRunOptions = {
  runOnce: (changedPath: string) => void;
  debounceMs: number;
};

/**
 * Watch files and re-run a callback when any of them changes.
 * Performs an initial run for all files, then watches for changes.
 * Resolves on SIGINT with exit code 0.
 */
export function watchAndRun(
  io: CliIo,
  filePaths: string[],
  options: WatchAndRunOptions,
): Promise<number> {
  return new Promise((resolve) => {
    // Initial run
    for (const filePath of filePaths) {
      try {
        options.runOnce(filePath);
      } catch (err) {
        io.writeStderr(
          `Error processing ${filePath}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }

    io.writeStderr(`\nWatching ${filePaths.length} file(s) for changes... (Ctrl+C to stop)\n`);

    const watcher = io.watchFiles(
      filePaths,
      (changedPath) => {
        const timestamp = new Date().toLocaleTimeString();
        io.writeStderr(`\n[${timestamp}] Changed: ${changedPath}\n`);
        try {
          options.runOnce(changedPath);
        } catch (err) {
          io.writeStderr(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      },
      { debounceMs: options.debounceMs },
    );

    const onSignal = (): void => {
      io.writeStderr("\nStopping watch...\n");
      watcher.close();
      process.removeListener("SIGINT", onSignal);
      resolve(0);
    };
    process.on("SIGINT", onSignal);
  });
}
