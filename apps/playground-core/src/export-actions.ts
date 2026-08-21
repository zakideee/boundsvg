// ---------------------------------------------------------------------------
// Raster download buttons under the PNG preview
// ---------------------------------------------------------------------------

import type { Engine, VNode } from "@boundsvg/core";
import { presets } from "./presets/index";
import { coreState, resolveDebugOverlayConfig } from "./state";
import type { Preset } from "./types";

/** Sampling rate for the animated formats. 50 ms per frame, clear of GIF's 20 ms floor. */
const ANIMATION_FPS = 20;

type ExportFormat = "png" | "webp" | "animated-webp" | "gif";

const MIME_TYPES: Record<ExportFormat, string> = {
  png: "image/png",
  webp: "image/webp",
  "animated-webp": "image/webp",
  gif: "image/gif",
};

const FILE_EXTENSIONS: Record<ExportFormat, string> = {
  png: "png",
  webp: "webp",
  "animated-webp": "webp",
  gif: "gif",
};

let currentSource: { engine: Engine; presetKey: string } | null = null;

/** Point the buttons at the preset currently on screen. */
export function setExportSource(engine: Engine, presetKey: string, preset: Preset): void {
  currentSource = { engine, presetKey };
  restoreButtons();
  const animated = preset.animationDurationMs !== undefined;
  setNote(
    animated
      ? `Animated export samples ${preset.animationDurationMs} ms at ${ANIMATION_FPS} fps.`
      : "This preset has no declarative animation, so only still formats are available.",
  );
}

/** Wire the buttons once; `setExportSource` keeps them current. */
export function initExportActions(): void {
  for (const button of exportButtons()) {
    button.addEventListener("click", () => {
      const format = button.dataset.export as ExportFormat | undefined;
      if (format) {
        void downloadCurrent(format);
      }
    });
  }
}

function exportButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("#export-actions button[data-export]")];
}

function setNote(message: string): void {
  const note = document.getElementById("export-note");
  if (note) {
    note.textContent = message;
  }
}

async function downloadCurrent(format: ExportFormat): Promise<void> {
  const requestedSource = currentSource;
  if (!requestedSource) {
    return;
  }

  // Encoding an animation is seconds of synchronous WASM work. Disable the
  // buttons and let the browser paint the notice before starting.
  const buttons = exportButtons();
  for (const button of buttons) {
    button.disabled = true;
  }
  setNote(`Encoding ${format}…`);
  await new Promise((resolve) => {
    requestAnimationFrame(() => resolve(undefined));
  });

  // A preset switch during that gap replaces the source; downloading the one
  // that is no longer on screen would be worse than doing nothing.
  if (currentSource !== requestedSource) {
    restoreButtons();
    return;
  }
  const { engine, presetKey } = requestedSource;
  const preset = presets[presetKey];
  if (!preset) {
    restoreButtons();
    return;
  }

  const link = document.createElement("a");
  let url: string | null = null;
  try {
    // Rebuilt rather than cached: dragging an obstacle rebuilds the scene in
    // place, so a cached VNode would download the pre-drag layout.
    const bytes = renderFormat(engine, preset, preset.build(engine), format);
    url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: MIME_TYPES[format] }));
    link.href = url;
    link.download = `${slugify(preset.title)}${scaleSuffix()}.${FILE_EXTENSIONS[format]}`;
    document.body.appendChild(link);
    link.click();
    setNote(`Downloaded ${link.download} (${formatBytes(bytes.length)}).`);
  } catch (error) {
    setNote(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    link.remove();
    if (url !== null) {
      URL.revokeObjectURL(url);
    }
    // Re-derived rather than replayed: `setExportSource` may have changed which
    // buttons belong enabled while the encode was running.
    restoreButtons();
  }
}

/** Re-apply the enabled state the preset on screen calls for. */
function restoreButtons(): void {
  const preset = currentSource ? presets[currentSource.presetKey] : undefined;
  const animated = preset?.animationDurationMs !== undefined;
  for (const button of exportButtons()) {
    const format = button.dataset.export as ExportFormat | undefined;
    button.disabled = format === "animated-webp" || format === "gif" ? !animated : false;
  }
}

/** Distinguish a 2x download from the 1x one, as the visual editor does. */
function scaleSuffix(): string {
  return coreState.pngScale > 1 ? `@${coreState.pngScale}x` : "";
}

function renderFormat(
  engine: Engine,
  preset: Preset,
  vnode: VNode,
  format: ExportFormat,
): Uint8Array {
  const options = {
    debug: resolveDebugOverlayConfig(),
    textPathMode: coreState.textPathMode,
    showMissingGlyphs: true,
    ...(coreState.pngScale > 1 && { scale: coreState.pngScale }),
  };
  if (format === "png") {
    return engine.renderToPng(vnode, options);
  }
  if (format === "webp") {
    return engine.renderToWebp(vnode, options);
  }
  const animated = {
    ...options,
    durationMs: preset.animationDurationMs ?? 0,
    fps: ANIMATION_FPS,
  };
  return format === "gif"
    ? engine.renderToAnimatedGif(vnode, animated)
    : engine.renderToAnimatedWebp(vnode, animated);
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "preset"
  );
}

function formatBytes(byteLength: number): string {
  return byteLength < 1024 ? `${byteLength} B` : `${(byteLength / 1024).toFixed(1)} KB`;
}
