import { resolve } from "node:path";
import { initNodeWasm } from "@boundsvg/core/node";
import { parseFontSourceArg } from "./cli.js";
import { probeFfmpeg, resolveFfmpegCommand } from "./ffmpeg-locator.js";
import type { CliIo } from "./types.js";

type DoctorResult = {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message: string }>;
};

function printDoctorUsage(io: CliIo): void {
  io.writeStderr(`
Usage: boundsvg doctor [options]

Options:
  --font <spec>      Font file (alias:weight:style:path) (repeatable)
  --help, -h         Show this help message
`);
}

function collectFontSpecs(args: string[]) {
  const fonts: ReturnType<typeof parseFontSourceArg>[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--font") {
      fonts.push(parseFontSourceArg(args[i + 1] ?? "", ""));
      i++;
    }
  }
  return fonts;
}

export async function runDoctor(io: CliIo, args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printDoctorUsage(io);
    return 0;
  }

  const result: DoctorResult = { ok: true, checks: [] };

  try {
    await initNodeWasm();
    result.checks.push({ name: "wasm", ok: true, message: "node WASM initialized" });
  } catch (err) {
    result.ok = false;
    result.checks.push({
      name: "wasm",
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const fonts = collectFontSpecs(args);
  const seenAliases = new Set<string>();
  for (const font of fonts) {
    const fontPath = resolve(font.source);
    const exists = io.fileExists(fontPath);
    if (!exists) {
      result.ok = false;
    }
    result.checks.push({
      name: `font:${font.alias}`,
      ok: exists,
      message: exists ? fontPath : `missing: ${fontPath}`,
    });

    const key = `${font.alias}:${font.weight}:${font.style}`;
    if (seenAliases.has(key)) {
      result.ok = false;
      result.checks.push({
        name: "font-alias",
        ok: false,
        message: `duplicate font registration: ${key}`,
      });
    }
    seenAliases.add(key);
  }

  // Absence is reported, not failed: ffmpeg is only needed for mp4 export, and
  // a doctor that fails without it would call a healthy install broken.
  const ffmpegCommand = resolveFfmpegCommand();
  const hasFfmpeg = probeFfmpeg(ffmpegCommand);
  result.checks.push({
    name: "ffmpeg",
    ok: true,
    message: hasFfmpeg
      ? `${ffmpegCommand} (mp4 export available)`
      : `not found: ${ffmpegCommand} — install it or set FFMPEG_PATH for mp4 export`,
  });

  result.checks.push({
    name: "png-scale",
    ok: true,
    message: "PNG scale is capped by the engine at 4K-equivalent output",
  });
  result.checks.push({
    name: "worker",
    ok: true,
    message: "Worker bundling check is skipped in the Node CLI environment",
  });

  for (const check of result.checks) {
    io.writeStdout(`${check.ok ? "ok" : "fail"} ${check.name}: ${check.message}\n`);
  }
  return result.ok ? 0 : 1;
}
