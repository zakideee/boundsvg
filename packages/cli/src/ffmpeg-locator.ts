import { spawnSync } from "node:child_process";

/**
 * Command used to invoke ffmpeg.
 *
 * `FFMPEG_PATH` wins so a caller can point at a specific build; otherwise the
 * bare name is handed to the OS, which knows how to search PATH. No download or
 * bundling happens here — ffmpeg is the user's to install, deliberately.
 */
export function resolveFfmpegCommand(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FFMPEG_PATH?.trim();
  return configured ? configured : "ffmpeg";
}

/** Whether the resolved command is an ffmpeg that runs. */
export function probeFfmpeg(command: string): boolean {
  // Existence is not the question — a path that exists but cannot execute, or a
  // name PATH does not resolve, both have to fail the same way.
  const probe = spawnSync(command, ["-version"], { stdio: "ignore" });
  return probe.error === undefined && probe.status === 0;
}

/** Guidance printed when ffmpeg cannot be found, covering the three platforms. */
export function ffmpegNotFoundMessage(command: string): string {
  return [
    `Error: [FFMPEG_NOT_FOUND] ffmpeg not found (tried ${command}). Install it and re-run, or set FFMPEG_PATH.`,
    "  macOS:   brew install ffmpeg",
    "  Ubuntu:  sudo apt install ffmpeg",
    "  Windows: winget install Gyan.FFmpeg",
    "",
  ].join("\n");
}
