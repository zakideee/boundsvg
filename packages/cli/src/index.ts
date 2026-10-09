/** CLI command dispatch and injectable I/O; importing this module does not run a command. */

import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { openAnimatedRasterSink } from "./animation-io.js";
import { runConvert } from "./convert.js";
import { runDoctor } from "./doctor.js";
import { runExport } from "./export.js";
import { runInspect } from "./inspect.js";
import type { CliIo } from "./types.js";

export { convertSceneToComponent } from "./convert.js";
export type { AnimatedRasterCliTarget, CliIo, OpenAnimatedRasterSink } from "./types.js";

/** Bind command I/O to this process without performing reads, writes, or dispatch. */
function createDefaultIo(): CliIo {
  return {
    openAnimatedRasterSink,
    getFileByteLength: (path) => statSync(path).size,
    argv: process.argv,
    readTextFile: (path) => readFileSync(path, "utf-8"),
    readBinaryFile: (path) => readFileSync(path),
    ensureDir: (path) => mkdirSync(path, { recursive: true }),
    writeTextFile: (path, data) => writeFileSync(path, data, "utf-8"),
    writeBinaryFile: (path, data) => writeFileSync(path, data),
    writeStdout: (message) => process.stdout.write(message),
    writeStderr: (message) => process.stderr.write(message),
    fileExists: (path) => existsSync(path),
    readStdin: () => readFileSync(0, "utf-8"),
    writeBinaryStdout: (data) => {
      process.stdout.write(data);
    },
    stdinIsTTY: !!process.stdin.isTTY,
    watchFiles: (paths, onChange, options) => {
      const debounceMs = options?.debounceMs ?? 150;
      const watchers: ReturnType<typeof watch>[] = [];
      const timers = new Map<string, ReturnType<typeof setTimeout>>();

      for (const filePath of paths) {
        const watcher = watch(filePath, () => {
          const existing = timers.get(filePath);
          if (existing) {
            clearTimeout(existing);
          }
          timers.set(
            filePath,
            setTimeout(() => {
              timers.delete(filePath);
              onChange(filePath);
            }, debounceMs),
          );
        });
        watchers.push(watcher);
      }

      return {
        close: () => {
          for (const watcher of watchers) {
            watcher.close();
          }
          for (const timer of timers.values()) {
            clearTimeout(timer);
          }
        },
      };
    },
  };
}

/** Write main usage to stderr, leaving stdout available for command payloads. */
function printMainUsage(io: CliIo): void {
  io.writeStderr(`
Usage: boundsvg <command> [options]

Commands:
  convert   Convert between SVG, Scene Document (.scene.json), and bound component (.tsx)
  export    Export SVG or Scene Document to SVG, PNG, WebP, animated WebP, GIF, MP4,
            layered output, or a static component, using the WASM engine
  inspect   Inspect render diagnostics for SVG or Scene Document input
  doctor    Check local WASM, font file setup, and ffmpeg availability for MP4

Options:
  --help, -h   Show this help message

Run "boundsvg <command> --help" for more information on a command.
`);
}

/**
 * Run the command in `argv` with supplied I/O overrides, returning its exit code.
 * Async commands return a Promise; the executable owns process exit and fatal rejection handling.
 * @throws When an I/O override or command propagates an unhandled synchronous error.
 */
export function runCli(overrides: Partial<CliIo> = {}): number | Promise<number> {
  const io: CliIo = { ...createDefaultIo(), ...overrides };
  const args = io.argv.slice(2);
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printMainUsage(io);
    return 0;
  }

  const subArgs = args.slice(1);

  switch (subcommand) {
    case "convert":
      return runConvert(io, subArgs);
    case "export":
      return runExport(io, subArgs);
    case "inspect":
      return runInspect(io, subArgs);
    case "doctor":
      return runDoctor(io, subArgs);
    default:
      io.writeStderr(`Unknown command: ${subcommand}\n`);
      printMainUsage(io);
      return 1;
  }
}
