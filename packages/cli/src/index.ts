// ---------------------------------------------------------------------------
// boundsvg CLI — main entry with subcommand dispatch
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runConvert } from "./convert.js";
import { runDoctor } from "./doctor.js";
import { runExport } from "./export.js";
import { runInspect } from "./inspect.js";
import type { CliIo } from "./types.js";

export type { CliIo } from "./types.js";

function createDefaultIo(): CliIo {
  return {
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

function isDirectExecution(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) {
    return false;
  }
  return resolve(argvPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  const result = runCli();
  if (result instanceof Promise) {
    result
      .then((exitCode) => {
        if (exitCode !== 0) {
          process.exit(exitCode);
        }
      })
      .catch((err) => {
        process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      });
  } else if (result !== 0) {
    process.exit(result);
  }
}
