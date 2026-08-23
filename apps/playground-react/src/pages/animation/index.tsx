import { BoundSvg, type RenderOptions } from "@boundsvg/react";
import { useBoundSvg } from "@boundsvg/react/provider";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type AnimationIrMetrics,
  type AnimationUnitDebugEntry,
  DEFAULT_LAYOUT_REACTIVE_PLAYGROUND_CONTROLS,
  DEFAULT_TEXT_UNIT_PLAYGROUND_CONTROLS,
  formatAnimationBytes,
  inspectAnimationIr,
  type LayoutReactivePlaygroundControls,
  TEXT_UNIT_EASING_OPTIONS,
  type TextUnitPlaygroundControls,
} from "../../../../playground-shared/animation-playground.js";
import { CheckField, NumberField, Section, SelectField } from "../../components/fields";
import { useMobileViewer } from "../../hooks/use-mobile-viewer";
import {
  isLayoutReactivePresetKey,
  LAYOUT_REACTIVE_PRESET_OPTIONS,
  LAYOUT_REACTIVE_PRESETS,
  type LayoutReactiveFrame,
  type LayoutReactivePresetKey,
} from "./layout-reactive-presets";
import { ANIMATION_PRESET_OPTIONS, ANIMATION_PRESETS, type AnimationPresetKey } from "./presets";
import {
  type AnimatedExportFormat,
  downloadAnimatedArtifact,
  downloadMp4Artifact,
  downloadStillArtifact,
  isMp4ExportSupported,
  type Mp4ExportFrameRate,
  tryRenderAnimationArtifacts,
  tryRenderLayoutReactiveArtifacts,
} from "./render-artifacts";
import {
  renderStaticPlaybackFrames,
  STATIC_PLAYBACK_STEP_MS,
  type StaticPlaybackFrame,
  sampleStaticPlaybackTime,
} from "./static-playback";
import { collectTimelineTracks, TimelineTracks, ValueInspector } from "./timeline";

const DEFAULT_PRESET: AnimationPresetKey = "hero-card";
type AnimationPagePresetKey = AnimationPresetKey | LayoutReactivePresetKey;
const ANIMATION_PAGE_PRESET_OPTIONS = [
  ...ANIMATION_PRESET_OPTIONS,
  ...LAYOUT_REACTIVE_PRESET_OPTIONS,
];
const ANIMATION_DEBUG_MODE =
  import.meta.env.DEV ||
  (typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("animationDebug") === "1");

/**
 * Reduced motion falls back to a sampled still, because a self-animating SVG
 * would keep moving on its own clock no matter where the scrubber sits.
 */
function isDeclarativeRigidPanel(
  rigidAnimation: "static" | "declarative" | undefined,
  reducedMotion: boolean,
): boolean {
  if (reducedMotion) {
    return false;
  }
  return rigidAnimation === "declarative";
}

/** A declarative comparison panel is emitted once instead of resampled. */
function rigidPanelAnimationOptions(
  declarative: boolean,
  timeMs: number,
): Pick<RenderOptions, "animation" | "timeMs"> {
  return declarative ? { animation: "declarative" } : { animation: "static", timeMs };
}

function missingAnimationPreset(presetKey: string): never {
  throw new RangeError(`Missing animation preset ${presetKey}`);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onStoreChange: () => void): () => void {
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getServerReducedMotionSnapshot(): boolean {
  return false;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getServerReducedMotionSnapshot,
  );
}

function compactOpaqueUnitId(unitId: string): string {
  if (unitId.length <= 18) {
    return unitId;
  }
  return `${unitId.slice(0, 8)}…${unitId.slice(-7)}`;
}

function UnitDebugOverlay({
  width,
  height,
  units,
}: {
  width: number;
  height: number;
  units: readonly AnimationUnitDebugEntry[];
}) {
  return (
    <svg
      className="animation-unit-debug-overlay"
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Text paint unit bounds"
    >
      {units.map((unit, unitIndex) => (
        <g key={`${unit.nodeId}:${unit.unitId}`}>
          <title>{unit.unitId}</title>
          <rect x={unit.bbox.x} y={unit.bbox.y} width={unit.bbox.w} height={unit.bbox.h} />
          <text x={unit.bbox.x + 2} y={Math.max(10, unit.bbox.y - 3 - (unitIndex % 2) * 8)}>
            {compactOpaqueUnitId(unit.unitId)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ShapingParitySection({
  metrics,
  comparisonAvailable,
  shapingIsStable,
  staticSvgByteLength,
  comparisonError,
}: {
  metrics: AnimationIrMetrics;
  comparisonAvailable: boolean;
  shapingIsStable: boolean;
  staticSvgByteLength: number;
  comparisonError: Error | null;
}) {
  const statusClass = !comparisonAvailable
    ? "is-unavailable"
    : shapingIsStable
      ? "is-stable"
      : "is-changed";
  const statusLabel = !comparisonAvailable
    ? "UNAVAILABLE"
    : shapingIsStable
      ? "UNCHANGED"
      : "CHANGED";

  return (
    <Section title="Shaping parity">
      <dl className="animation-metrics">
        <div>
          <dt>Animation off</dt>
          <dd className={statusClass} data-testid="animation-shaping-parity">
            {statusLabel}
          </dd>
        </div>
        <div>
          <dt>Units / lines</dt>
          <dd>
            {metrics.unitCount} / {metrics.lineCount}
          </dd>
        </div>
        <div>
          <dt>Glyphs / outlines / missing</dt>
          <dd>
            {metrics.glyphCount} / {metrics.outlineCount} / {metrics.missingGlyphCount}
          </dd>
        </div>
        <div>
          <dt>Static SVG</dt>
          <dd>{formatAnimationBytes(staticSvgByteLength)} bytes</dd>
        </div>
      </dl>
      <p className="animation-note">
        Compares line breaks, glyph IDs, advances, and resolved font sizes against the same scene
        with animateUnits removed.
      </p>
      {comparisonError && (
        <p className="error-text" role="alert">
          Comparison failed: {comparisonError.message}
        </p>
      )}
    </Section>
  );
}

function StaticPreviewContent({
  renderResult,
  metrics,
  showUnitOverlay,
  contentRef,
}: {
  renderResult: ReturnType<typeof tryRenderAnimationArtifacts>;
  metrics: AnimationIrMetrics | null;
  showUnitOverlay: boolean;
  contentRef?: Ref<HTMLDivElement>;
}) {
  if (renderResult.error) {
    return (
      <p className="error-text" role="alert">
        Render failed: {renderResult.error.message}
      </p>
    );
  }
  if (!renderResult.artifacts) {
    return <p className="placeholder-text">Rendering…</p>;
  }

  return (
    <div className="animation-static-render">
      <div
        ref={contentRef}
        className="rendered-content"
        // The string is generated by the local renderer from a fixed playground scene.
        dangerouslySetInnerHTML={{ __html: renderResult.artifacts.svg }}
      />
      {ANIMATION_DEBUG_MODE && showUnitOverlay && metrics && (
        <UnitDebugOverlay
          width={renderResult.artifacts.ir.width}
          height={renderResult.artifacts.ir.height}
          units={metrics.unitBboxes}
        />
      )}
    </div>
  );
}

function toDisplayError(renderError: unknown): Error {
  return renderError instanceof Error ? renderError : new Error(String(renderError));
}

function formatTiming(durationMs: number | undefined): string {
  return durationMs === undefined ? "—" : `${durationMs.toFixed(2)} ms`;
}

function resolveAnimationDuration(
  isLayoutReactivePreset: boolean,
  isTextUnitPreset: boolean,
  animationDurationMs: number | undefined,
  unitDurationMs: number,
  layoutDurationMs: number,
): number {
  if (isLayoutReactivePreset) {
    return layoutDurationMs;
  }
  if (isTextUnitPreset) {
    return unitDurationMs;
  }
  return animationDurationMs ?? DEFAULT_LAYOUT_REACTIVE_PLAYGROUND_CONTROLS.durationMs;
}

function samplingDescription(isLayoutReactivePreset: boolean): string {
  return isLayoutReactivePreset
    ? "Each slider position calls a pure timeMs generator, then renders two independent static scenes."
    : "Each slider position renders a deterministic SVG sampled by the core at that exact time.";
}

function staticSamplingMobileClass(isLayoutReactivePreset: boolean): string | undefined {
  return isLayoutReactivePreset ? undefined : "mobile-viewer-secondary";
}

function motionDescription(isLayoutReactivePreset: boolean, reducedMotion: boolean): string {
  if (reducedMotion) {
    return "Reduced motion is enabled: both previews show deterministic still frames.";
  }
  return isLayoutReactivePreset
    ? "Static materialized playback is active. Every tick creates a complete independent scene."
    : "Native playback is active. Static playback is an independent sampling clock.";
}

function TextUnitControlsSection({
  controls,
  supportsWritingMode,
  showUnitOverlay,
  onUpdate,
  onShowUnitOverlay,
}: {
  controls: TextUnitPlaygroundControls;
  supportsWritingMode: boolean;
  showUnitOverlay: boolean;
  onUpdate: (patch: Partial<TextUnitPlaygroundControls>) => void;
  onShowUnitOverlay: (show: boolean) => void;
}) {
  return (
    <Section title="Text paint units">
      <SelectField
        id="animation-unit-by"
        label="by"
        value={controls.by}
        options={[
          { value: "cluster", label: "Cluster" },
          { value: "line", label: "Line / column" },
        ]}
        onChange={(value) => onUpdate({ by: value as TextUnitPlaygroundControls["by"] })}
      />
      <NumberField
        id="animation-unit-delay-step"
        label="delayStepMs"
        value={controls.delayStepMs}
        min={0}
        max={400}
        step={5}
        unit="ms"
        onChange={(delayStepMs) => onUpdate({ delayStepMs })}
      />
      <SelectField
        id="animation-unit-order"
        label="order"
        value={controls.order}
        options={[
          { value: "logical", label: "Logical" },
          { value: "visual", label: "Visual" },
        ]}
        onChange={(value) => onUpdate({ order: value as TextUnitPlaygroundControls["order"] })}
      />
      <SelectField
        id="animation-unit-ruby"
        label="ruby"
        value={controls.ruby}
        options={[
          { value: "with-base", label: "With base" },
          { value: "separate", label: "Separate" },
        ]}
        onChange={(value) => onUpdate({ ruby: value as TextUnitPlaygroundControls["ruby"] })}
      />
      <NumberField
        id="animation-unit-duration"
        label="duration"
        value={controls.durationMs}
        min={200}
        max={4_000}
        step={20}
        unit="ms"
        onChange={(durationMs) => onUpdate({ durationMs })}
      />
      <SelectField
        id="animation-unit-easing"
        label="easing"
        value={controls.easing}
        options={TEXT_UNIT_EASING_OPTIONS}
        onChange={(value) => onUpdate({ easing: value as TextUnitPlaygroundControls["easing"] })}
      />
      {supportsWritingMode && (
        <SelectField
          id="animation-unit-writing-mode"
          label="writing mode"
          value={controls.writingMode}
          options={[
            { value: "horizontal-tb", label: "Horizontal lines" },
            { value: "vertical-rl", label: "Vertical columns" },
          ]}
          onChange={(value) =>
            onUpdate({ writingMode: value as TextUnitPlaygroundControls["writingMode"] })
          }
        />
      )}
      {ANIMATION_DEBUG_MODE && (
        <CheckField
          id="animation-unit-debug-overlay"
          label="Show unit bbox + ID"
          checked={showUnitOverlay}
          onChange={onShowUnitOverlay}
        />
      )}
    </Section>
  );
}

function LayoutReactiveMetricsSection({
  frame,
  rigidRenderResult,
  materializedRenderResult,
  canvasFit,
}: {
  frame: LayoutReactiveFrame;
  rigidRenderResult: ReturnType<typeof tryRenderLayoutReactiveArtifacts>;
  materializedRenderResult: ReturnType<typeof tryRenderLayoutReactiveArtifacts>;
  canvasFit: LayoutReactivePlaygroundControls["canvasFit"];
}) {
  const materializedTextMetrics = materializedRenderResult.metrics;
  const rigidTextMetrics = rigidRenderResult.metrics;
  const chosenFontSizePx = materializedTextMetrics?.chosenFontSizePx ?? null;
  const lineCount = materializedTextMetrics?.lineCount ?? null;
  const rigidLineCount = rigidTextMetrics?.lineCount ?? null;
  const overflow = materializedTextMetrics?.overflow ?? "—";
  let interpolationLabel: string;
  switch (frame.values.kind) {
    case "growing-box":
      interpolationLabel = `${frame.values.width} × ${frame.values.height}px`;
      break;
    case "moving-exclusion":
      interpolationLabel = `rect(${frame.values.rectX}, ${frame.values.rectY}) · circle(${frame.values.circleCx}, ${frame.values.circleCy})`;
      break;
    case "terminal-typing":
      interpolationLabel = `frame ${frame.values.frameIndex + 1} · ${frame.values.status}`;
      break;
    case "text-path-motion":
      interpolationLabel = `offset ${frame.values.startOffsetPx} · controlY ${frame.values.controlY}`;
      break;
  }

  let frameStatus: string;
  switch (frame.values.kind) {
    case "moving-exclusion":
      frameStatus =
        rigidTextMetrics?.flowSignature === materializedTextMetrics?.flowSignature
          ? "At this checkpoint both flows happen to match; only materialization owns the current geometry."
          : "Rigid paint is intentionally desynchronized; materialization reflows from current static geometry.";
      break;
    case "growing-box":
      frameStatus =
        "Rigid scales resolved paint; materialization reruns the normal full-scene layout from static dimensions.";
      break;
    case "terminal-typing":
      frameStatus =
        "The fixed preview keeps the initial prompt; materialization reshapes each authored command/output state.";
      break;
    case "text-path-motion":
      frameStatus =
        "The fixed preview keeps the initial path; materialization reshapes against the current d and startOffsetPx.";
      break;
  }

  return (
    <Section title="Materialized frame metrics">
      <dl className="animation-metrics">
        <div>
          <dt>Static interpolation</dt>
          <dd data-testid="layout-reactive-values">{interpolationLabel}</dd>
        </div>
        <div>
          <dt>Chosen font size</dt>
          <dd>{chosenFontSizePx === null ? "—" : `${chosenFontSizePx.toFixed(1)}px`}</dd>
        </div>
        <div>
          <dt>Lines rigid → materialized</dt>
          <dd data-testid="layout-reactive-line-count">
            {rigidLineCount ?? "—"} → {lineCount ?? "—"}
          </dd>
        </div>
        <div>
          <dt>Overflow</dt>
          <dd>{overflow}</dd>
        </div>
        <div>
          <dt>Layout probe (extra pass)</dt>
          <dd data-testid="layout-reactive-layout-ms">
            {formatTiming(materializedTextMetrics?.layoutProbeMs)}
          </dd>
        </div>
        <div>
          <dt>Full frame render (includes layout)</dt>
          <dd data-testid="layout-reactive-render-ms">
            {formatTiming(materializedTextMetrics?.fullFrameRenderMs)}
          </dd>
        </div>
        <div>
          <dt>Fixed canvas</dt>
          <dd data-testid="layout-reactive-canvas">640 × 360 · {canvasFit}</dd>
        </div>
      </dl>
      <p className="animation-note" data-testid="layout-reactive-flow-status">
        {frameStatus}
      </p>
      <p className="animation-note">
        The layout probe is a separate diagnostic pass; full frame render repeats layout before
        emit.
      </p>
    </Section>
  );
}

function A1PreviewPanels({
  mobileViewer,
  reducedMotion,
  posterTimeMs,
  declarativeStartTimeMs,
  runtime,
  declarativePreview,
  timeMs,
  staticRenderResult,
  staticMetrics,
  showUnitOverlay,
  onDownloadAnimated,
  onDownloadMp4,
  mp4Supported,
  onDownloadStill,
  animatedExportError,
  animatedExportPending,
  staticPreviewContentRef,
  staticPreviewRevision,
}: {
  mobileViewer: boolean;
  reducedMotion: boolean;
  posterTimeMs: number;
  declarativeStartTimeMs: number;
  runtime: string;
  declarativePreview: ReactNode;
  timeMs: number;
  staticRenderResult: ReturnType<typeof tryRenderAnimationArtifacts>;
  staticMetrics: AnimationIrMetrics | null;
  showUnitOverlay: boolean;
  onDownloadAnimated: (format: AnimatedExportFormat) => void;
  onDownloadMp4: (frameRate: Mp4ExportFrameRate) => void;
  mp4Supported: boolean;
  onDownloadStill: () => void;
  animatedExportError: Error | null;
  animatedExportPending: boolean;
  staticPreviewContentRef: Ref<HTMLDivElement>;
  staticPreviewRevision: number;
}) {
  return (
    <>
      <section
        className="panel preview-panel animation-preview-panel"
        data-testid="animation-declarative-preview"
        data-animation-mode={reducedMotion ? "static" : "declarative"}
      >
        <header className="animation-preview-header">
          <div>
            <strong>Declarative animation</strong>
            <span>
              {reducedMotion
                ? `Static fallback at ${posterTimeMs} ms`
                : `Browser-native from ${declarativeStartTimeMs} ms · ${runtime}`}
            </span>
          </div>
          <span className="animation-mode-badge">{reducedMotion ? "STATIC" : "CSS"}</span>
        </header>
        <div className="preview-stage animation-preview-stage">{declarativePreview}</div>
      </section>

      {!mobileViewer && (
        <section
          className="panel preview-panel animation-preview-panel"
          data-testid="animation-static-preview"
        >
          <header className="animation-preview-header">
            <div>
              <strong>Static sampling preview</strong>
              <span>
                Exact SVG output at {timeMs} ms · {runtime}
              </span>
            </div>
            <span className="animation-mode-badge">timeMs</span>
          </header>
          <div className="preview-stage animation-preview-stage animation-static-stage">
            <StaticPreviewContent
              key={staticPreviewRevision}
              renderResult={staticRenderResult}
              metrics={staticMetrics}
              showUnitOverlay={showUnitOverlay}
              contentRef={staticPreviewContentRef}
            />
          </div>
        </section>
      )}

      {/* Spans both preview columns: keeping it inside the static panel made
          that panel's stage shorter than the declarative one by the height of
          this row, so the two samples no longer lined up. The exports are
          scene-level anyway — neither is a property of one preview. */}
      {!mobileViewer ? (
        <div className="animation-export-actions" data-testid="animation-export-actions">
          <button
            data-testid="animation-download-still"
            disabled={animatedExportPending}
            onClick={onDownloadStill}
            type="button"
          >
            Download PNG at this time
          </button>
          <button
            type="button"
            disabled={animatedExportPending}
            onClick={() => onDownloadAnimated("animated-webp")}
          >
            Download animated WebP
          </button>
          <button
            type="button"
            disabled={animatedExportPending}
            onClick={() => onDownloadAnimated("gif")}
          >
            Download animated GIF
          </button>
          {/* Hidden rather than disabled where WebCodecs is missing: a button that
              can never work is worse than no button. */}
          {mp4Supported ? (
            <>
              <button
                data-testid="animation-download-mp4-30"
                type="button"
                disabled={animatedExportPending}
                onClick={() => onDownloadMp4(30)}
              >
                Download MP4 (30fps)
              </button>
              <button
                data-testid="animation-download-mp4-ntsc"
                type="button"
                disabled={animatedExportPending}
                onClick={() => onDownloadMp4(29.97)}
              >
                Download MP4 (29.97fps)
              </button>
            </>
          ) : null}
          <span>
            {animatedExportPending
              ? "Encoding…"
              : animatedExportError
                ? `Export failed: ${animatedExportError.message}`
                : mp4Supported
                  ? "PNG is this frame; the animated formats and MP4 sample the whole animation."
                  : "PNG is this frame; the animated formats sample the whole animation. MP4 needs WebCodecs, which this browser lacks."}
          </span>
        </div>
      ) : null}
    </>
  );
}

function LayoutReactivePreviewPanels({
  mobileViewer,
  presetKey,
  timeMs,
  canvasFit,
  rigidRenderResult,
  materializedRenderResult,
  rigidPreviewContentRef,
  materializedPreviewContentRef,
  staticPreviewRevision,
}: {
  mobileViewer: boolean;
  presetKey: LayoutReactivePresetKey;
  timeMs: number;
  canvasFit: LayoutReactivePlaygroundControls["canvasFit"];
  rigidRenderResult: ReturnType<typeof tryRenderLayoutReactiveArtifacts>;
  materializedRenderResult: ReturnType<typeof tryRenderLayoutReactiveArtifacts>;
  rigidPreviewContentRef: Ref<HTMLDivElement>;
  materializedPreviewContentRef: Ref<HTMLDivElement>;
  staticPreviewRevision: number;
}) {
  const declarativeRigid = LAYOUT_REACTIVE_PRESETS[presetKey].rigidAnimation === "declarative";
  const rigidHeading = declarativeRigid
    ? "Declarative SVG"
    : presetKey === "text-path-motion"
      ? "Fixed path"
      : "Rigid post-layout";
  const rigidDescription = declarativeRigid
    ? "Emitted once; the SVG animates itself over a layout resolved once"
    : presetKey === "text-path-motion"
      ? `Initial d/startOffsetPx at ${timeMs} ms`
      : `Resolved once; only paint transforms at ${timeMs} ms`;
  return (
    <>
      {!mobileViewer && (
        <section
          className="panel preview-panel animation-preview-panel"
          data-testid="layout-rigid-preview"
          data-animation-mode="rigid"
        >
          <header className="animation-preview-header">
            <div>
              <strong>{rigidHeading}</strong>
              <span>{rigidDescription}</span>
            </div>
            <span className="animation-mode-badge">
              {declarativeRigid ? "DECLARATIVE" : "RIGID"}
            </span>
          </header>
          <div className={`preview-stage animation-preview-stage is-${canvasFit}`}>
            <StaticPreviewContent
              key={staticPreviewRevision}
              renderResult={rigidRenderResult}
              metrics={null}
              showUnitOverlay={false}
              contentRef={rigidPreviewContentRef}
            />
          </div>
        </section>
      )}

      <section
        className="panel preview-panel animation-preview-panel"
        data-testid="layout-materialized-preview"
      >
        <header className="animation-preview-header">
          <div>
            <strong>Materialized scene</strong>
            <span>Full-scene static layout at {timeMs} ms</span>
          </div>
          <span className="animation-mode-badge">FULL LAYOUT</span>
        </header>
        <div
          className={`preview-stage animation-preview-stage animation-static-stage is-${canvasFit}`}
        >
          <StaticPreviewContent
            key={staticPreviewRevision}
            renderResult={materializedRenderResult}
            metrics={null}
            showUnitOverlay={false}
            contentRef={materializedPreviewContentRef}
          />
        </div>
      </section>
    </>
  );
}

export function AnimationPage() {
  const { engine, defaultRenderOptions } = useBoundSvg();
  const mobileViewer = useMobileViewer();
  const [presetKey, setPresetKey] = useState<AnimationPagePresetKey>(DEFAULT_PRESET);
  const reducedMotion = usePrefersReducedMotion();
  const layoutPreset = isLayoutReactivePresetKey(presetKey)
    ? LAYOUT_REACTIVE_PRESETS[presetKey]
    : null;
  const animationPreset = layoutPreset ? null : ANIMATION_PRESETS[presetKey as AnimationPresetKey];
  const preset = layoutPreset ?? animationPreset ?? missingAnimationPreset(presetKey);
  const declarativeRigidPanel = isDeclarativeRigidPanel(
    layoutPreset?.rigidAnimation,
    reducedMotion,
  );
  const [unitControls, setUnitControls] = useState<TextUnitPlaygroundControls>(() => ({
    ...DEFAULT_TEXT_UNIT_PLAYGROUND_CONTROLS,
  }));
  const [layoutControls, setLayoutControls] = useState<LayoutReactivePlaygroundControls>(() => ({
    ...DEFAULT_LAYOUT_REACTIVE_PLAYGROUND_CONTROLS,
  }));
  const [showUnitOverlay, setShowUnitOverlay] = useState(false);
  const [timeMs, setTimeMs] = useState(() => (reducedMotion ? preset.posterTimeMs : 0));
  const [staticPlayback, setStaticPlayback] = useState(false);
  const [staticPlaybackError, setStaticPlaybackError] = useState<Error | null>(null);
  const [staticPreviewRevision, setStaticPreviewRevision] = useState(0);
  const [declarativeRestart, setDeclarativeRestart] = useState(0);
  const [declarativeStartTimeMs, setDeclarativeStartTimeMs] = useState(0);
  const timelineOriginRef = useRef({ wallTimeMs: 0, sceneTimeMs: 0 });
  const playbackTimeRef = useRef(timeMs);
  const staticPlaybackActiveRef = useRef(false);
  const timeOutputRef = useRef<HTMLOutputElement>(null);
  const timeSliderRef = useRef<HTMLInputElement>(null);
  const staticPreviewContentRef = useRef<HTMLDivElement>(null);
  const rigidPreviewContentRef = useRef<HTMLDivElement>(null);
  const materializedPreviewContentRef = useRef<HTMLDivElement>(null);
  const isLayoutReactivePreset = layoutPreset !== null;
  const isTextUnitPreset = animationPreset?.defaultControls !== undefined;
  const durationMs = resolveAnimationDuration(
    isLayoutReactivePreset,
    isTextUnitPreset,
    animationPreset?.durationMs,
    unitControls.durationMs,
    layoutControls.durationMs,
  );
  const posterTimeMs = Math.min(preset.posterTimeMs, durationMs);
  const vnode = useMemo(
    () => animationPreset?.build(unitControls, true) ?? null,
    [animationPreset, unitControls],
  );
  const animationOffVNode = useMemo(
    () => (isTextUnitPreset && animationPreset ? animationPreset.build(unitControls, false) : null),
    [animationPreset, isTextUnitPreset, unitControls],
  );
  const layoutGeneratorResult = useMemo(() => {
    if (!engine || !layoutPreset) {
      return { generator: null, error: null };
    }
    try {
      return {
        generator: layoutPreset.createFrameGenerator(layoutControls),
        error: null,
      };
    } catch (generatorError) {
      return { generator: null, error: toDisplayError(generatorError) };
    }
  }, [engine, layoutControls, layoutPreset]);
  const layoutFrameResult = useMemo(() => {
    if (!layoutGeneratorResult.generator) {
      return { frame: null, error: layoutGeneratorResult.error };
    }
    try {
      return { frame: layoutGeneratorResult.generator(timeMs), error: null };
    } catch (generatorError) {
      return { frame: null, error: toDisplayError(generatorError) };
    }
  }, [layoutGeneratorResult, timeMs]);

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const timelineTracks = useMemo(
    () => collectTimelineTracks(vnode ?? layoutFrameResult.frame?.materializedScene ?? null),
    [vnode, layoutFrameResult],
  );
  const animationStateResult = useMemo(() => {
    const scene = vnode ?? layoutFrameResult.frame?.materializedScene ?? null;
    // Each call validates and compiles the whole scene. Scrubbing fires this
    // per tick, so only pay for it while the panel is actually open.
    if (!engine || !scene || !timelineOpen) {
      return { samples: [], error: null };
    }
    try {
      return { samples: engine.sampleAnimationState(scene, timeMs), error: null };
    } catch (stateError) {
      return { samples: [], error: toDisplayError(stateError).message };
    }
  }, [engine, vnode, layoutFrameResult, timeMs, timelineOpen]);

  const stopStaticPlayback = useCallback(() => {
    if (!staticPlaybackActiveRef.current) {
      return;
    }
    staticPlaybackActiveRef.current = false;
    setStaticPlayback(false);
    setTimeMs(playbackTimeRef.current);
    // React's last virtual DOM may describe the same time as the committed
    // state even though playback mutated the preview in between. Remount once
    // at the user-action boundary so React owns the DOM again.
    setStaticPreviewRevision((currentRevision) => currentRevision + 1);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      stopStaticPlayback();
      playbackTimeRef.current = posterTimeMs;
      setTimeMs(posterTimeMs);
      setDeclarativeStartTimeMs(posterTimeMs);
    }
  }, [posterTimeMs, reducedMotion, stopStaticPlayback]);

  useEffect(() => {
    playbackTimeRef.current = Math.min(playbackTimeRef.current, durationMs);
    setTimeMs((currentTimeMs) => Math.min(currentTimeMs, durationMs));
    setDeclarativeStartTimeMs((currentTimeMs) => Math.min(currentTimeMs, durationMs));
  }, [durationMs]);

  const declarativeOptions = useMemo<RenderOptions>(
    () => ({
      animation: reducedMotion ? "static" : "declarative",
      timeMs: reducedMotion ? posterTimeMs : declarativeStartTimeMs,
      resourceIdPrefix: `animation-${presetKey}-declarative`,
    }),
    [declarativeStartTimeMs, posterTimeMs, presetKey, reducedMotion],
  );
  const staticOptions = useMemo<RenderOptions>(
    () => ({
      ...defaultRenderOptions,
      animation: "static",
      timeMs,
      resourceIdPrefix: `animation-${presetKey}-static`,
    }),
    [defaultRenderOptions, presetKey, timeMs],
  );

  const [animatedExportError, setAnimatedExportError] = useState<Error | null>(null);
  const [animatedExportPending, setAnimatedExportPending] = useState(false);
  const animatedExportFrameRef = useRef(0);
  const mp4GenerationRef = useRef(0);
  const mp4AbortRef = useRef<AbortController | null>(null);
  // Switching presets makes a previous failure meaningless.
  useEffect(() => {
    // Read the generation key explicitly: changing it is the reset signal.
    void presetKey;
    setAnimatedExportError(null);
    setAnimatedExportPending(false);
    mp4GenerationRef.current += 1;
    mp4AbortRef.current?.abort();
    mp4AbortRef.current = null;
    if (animatedExportFrameRef.current !== 0) {
      cancelAnimationFrame(animatedExportFrameRef.current);
      animatedExportFrameRef.current = 0;
    }
    return () => {
      mp4GenerationRef.current += 1;
      mp4AbortRef.current?.abort();
      mp4AbortRef.current = null;
      if (animatedExportFrameRef.current !== 0) {
        cancelAnimationFrame(animatedExportFrameRef.current);
        animatedExportFrameRef.current = 0;
      }
    };
  }, [presetKey]);
  const downloadStill = useCallback(() => {
    if (!vnode) {
      setAnimatedExportError(new Error("The preset has not rendered yet"));
      return;
    }
    const sampledTimeMs = playbackTimeRef.current;
    const { error } = downloadStillArtifact({
      engine,
      input: vnode,
      renderOptions: { ...staticOptions, timeMs: sampledTimeMs },
      fileName: `animation-${presetKey}-${Math.round(sampledTimeMs)}ms`,
    });
    setAnimatedExportError(error);
  }, [engine, presetKey, staticOptions, vnode]);

  const downloadAnimated = useCallback(
    (format: AnimatedExportFormat) => {
      if (!vnode) {
        setAnimatedExportError(new Error("The preset has not rendered yet"));
        return;
      }
      // Encoding is seconds of synchronous WASM work; paint the pending state
      // before starting it.
      setAnimatedExportPending(true);
      if (animatedExportFrameRef.current !== 0) {
        cancelAnimationFrame(animatedExportFrameRef.current);
      }
      animatedExportFrameRef.current = requestAnimationFrame(() => {
        animatedExportFrameRef.current = 0;
        try {
          const { error } = downloadAnimatedArtifact({
            engine,
            input: vnode,
            renderOptions: staticOptions,
            durationMs,
            format,
            fileName: `animation-${presetKey}`,
          });
          setAnimatedExportError(error);
        } finally {
          // Without this the buttons stay disabled and the notice stuck for the
          // rest of the session.
          setAnimatedExportPending(false);
        }
      });
    },
    [durationMs, engine, presetKey, staticOptions, vnode],
  );

  // Support cannot change for the life of the page, so it is read once rather
  // than on every render.
  const [mp4Supported] = useState(isMp4ExportSupported);

  const downloadMp4 = useCallback(
    (frameRate: Mp4ExportFrameRate) => {
      if (!vnode) {
        setAnimatedExportError(new Error("The preset has not rendered yet"));
        return;
      }
      const generation = ++mp4GenerationRef.current;
      mp4AbortRef.current?.abort();
      const abortController = new AbortController();
      mp4AbortRef.current = abortController;
      setAnimatedExportPending(true);
      void downloadMp4Artifact({
        engine,
        input: vnode,
        renderOptions: staticOptions,
        durationMs,
        frameRate,
        fileName: `animation-${presetKey}-${String(frameRate).replace(".", "-")}fps`,
        signal: abortController.signal,
      })
        .then(({ error }) => {
          if (mp4GenerationRef.current === generation && !abortController.signal.aborted) {
            setAnimatedExportError(error);
          }
        })
        .finally(() => {
          if (mp4GenerationRef.current === generation) {
            mp4AbortRef.current = null;
            // Without this the buttons stay disabled for the rest of the session.
            setAnimatedExportPending(false);
          }
        });
    },
    [durationMs, engine, presetKey, staticOptions, vnode],
  );

  const staticRenderResult = useMemo(() => {
    if (!vnode) {
      return { artifacts: null, error: null };
    }
    return tryRenderAnimationArtifacts(engine, vnode, staticOptions);
  }, [engine, staticOptions, vnode]);
  const rigidRenderResult = useMemo(() => {
    if (!layoutFrameResult.frame) {
      return { artifacts: null, metrics: null, error: layoutFrameResult.error };
    }
    return tryRenderLayoutReactiveArtifacts(
      engine,
      layoutFrameResult.frame.rigidScene,
      {
        ...defaultRenderOptions,
        ...rigidPanelAnimationOptions(declarativeRigidPanel, timeMs),
        resourceIdPrefix: `animation-${presetKey}-rigid`,
      },
      layoutPreset?.textNodeId,
    );
  }, [
    declarativeRigidPanel,
    defaultRenderOptions,
    engine,
    layoutFrameResult,
    layoutPreset,
    presetKey,
    timeMs,
  ]);
  const materializedRenderResult = useMemo(() => {
    if (!layoutFrameResult.frame) {
      return { artifacts: null, metrics: null, error: layoutFrameResult.error };
    }
    return tryRenderLayoutReactiveArtifacts(
      engine,
      layoutFrameResult.frame.materializedScene,
      {
        ...defaultRenderOptions,
        animation: "static",
        timeMs,
        resourceIdPrefix: `animation-${presetKey}-materialized`,
      },
      layoutPreset?.textNodeId,
    );
  }, [defaultRenderOptions, engine, layoutFrameResult, layoutPreset, presetKey, timeMs]);
  const animationOffRenderResult = useMemo(() => {
    if (!animationOffVNode) {
      return { artifacts: null, error: null };
    }
    return tryRenderAnimationArtifacts(engine, animationOffVNode, {
      ...defaultRenderOptions,
      animation: "static",
      timeMs: 0,
      resourceIdPrefix: `animation-${presetKey}-off`,
    });
  }, [animationOffVNode, defaultRenderOptions, engine, presetKey]);
  const staticArtifacts = staticRenderResult.artifacts;
  const animationOffArtifacts = animationOffRenderResult.artifacts;
  const staticMetrics = useMemo(
    () => (staticArtifacts ? inspectAnimationIr(staticArtifacts.ir) : null),
    [staticArtifacts],
  );
  const animationOffMetrics = useMemo(
    () => (animationOffArtifacts ? inspectAnimationIr(animationOffArtifacts.ir) : null),
    [animationOffArtifacts],
  );

  useEffect(() => {
    if (!staticPlayback || reducedMotion) {
      return;
    }

    if (!engine) {
      staticPlaybackActiveRef.current = false;
      setStaticPlayback(false);
      setStaticPlaybackError(new Error("Engine is not ready"));
      return;
    }

    let fixedFrames: StaticPlaybackFrame[] | null = null;
    try {
      if (vnode) {
        fixedFrames = renderStaticPlaybackFrames(
          engine,
          vnode,
          staticOptions,
          durationMs,
          STATIC_PLAYBACK_STEP_MS,
        );
      } else if (!layoutGeneratorResult.generator) {
        throw layoutGeneratorResult.error ?? new Error("The preset has not rendered yet");
      }
    } catch (playbackError) {
      staticPlaybackActiveRef.current = false;
      setStaticPlayback(false);
      setStaticPlaybackError(toDisplayError(playbackError));
      return;
    }

    let animationFrameId = 0;
    let lastSampleMs = -1;
    const stopAfterError = (playbackError: unknown) => {
      staticPlaybackActiveRef.current = false;
      setStaticPlayback(false);
      setStaticPlaybackError(toDisplayError(playbackError));
      setTimeMs(playbackTimeRef.current);
      setStaticPreviewRevision((currentRevision) => currentRevision + 1);
    };
    const updatePreview = (previewElement: HTMLDivElement | null, svg: string) => {
      if (previewElement) {
        previewElement.innerHTML = svg;
      }
    };
    // Rewriting a declarative panel every tick would restart its CSS
    // animations, so playback leaves that DOM subtree alone.
    const syncRigidPreview = (frame: LayoutReactiveFrame, sharedOptions: RenderOptions) => {
      if (declarativeRigidPanel) {
        return;
      }
      updatePreview(
        rigidPreviewContentRef.current,
        engine.renderToSvg(frame.rigidScene, {
          ...sharedOptions,
          resourceIdPrefix: `animation-${presetKey}-rigid`,
        }),
      );
    };
    const renderSample = (sampledTimeMs: number) => {
      if (fixedFrames) {
        const frameIndex = Math.floor(sampledTimeMs / STATIC_PLAYBACK_STEP_MS);
        const frame = fixedFrames[frameIndex];
        if (!frame || frame.timeMs !== sampledTimeMs) {
          throw new RangeError(`Missing static playback frame at ${sampledTimeMs} ms`);
        }
        updatePreview(staticPreviewContentRef.current, frame.svg);
      } else {
        const generator = layoutGeneratorResult.generator;
        if (!generator) {
          throw new Error("The layout-reactive frame generator is not ready");
        }
        const frame = generator(sampledTimeMs);
        const sharedOptions: RenderOptions = {
          ...defaultRenderOptions,
          animation: "static",
          timeMs: sampledTimeMs,
        };
        syncRigidPreview(frame, sharedOptions);
        updatePreview(
          materializedPreviewContentRef.current,
          engine.renderToSvg(frame.materializedScene, {
            ...sharedOptions,
            resourceIdPrefix: `animation-${presetKey}-materialized`,
          }),
        );
      }

      playbackTimeRef.current = sampledTimeMs;
      if (timeOutputRef.current) {
        timeOutputRef.current.value = `${sampledTimeMs} ms`;
      }
      if (timeSliderRef.current) {
        timeSliderRef.current.value = String(sampledTimeMs);
      }
    };
    const tick = (wallTimeMs: number) => {
      const sampledTimeMs = sampleStaticPlaybackTime({
        wallTimeMs,
        originWallTimeMs: timelineOriginRef.current.wallTimeMs,
        originSceneTimeMs: timelineOriginRef.current.sceneTimeMs,
        durationMs,
      });
      if (sampledTimeMs !== lastSampleMs) {
        lastSampleMs = sampledTimeMs;
        try {
          renderSample(sampledTimeMs);
        } catch (playbackError) {
          stopAfterError(playbackError);
          return;
        }
      }
      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [
    declarativeRigidPanel,
    defaultRenderOptions,
    durationMs,
    engine,
    layoutGeneratorResult,
    presetKey,
    reducedMotion,
    staticOptions,
    staticPlayback,
    vnode,
  ]);

  const shapingComparisonAvailable = staticMetrics !== null && animationOffMetrics !== null;
  const shapingIsStable =
    shapingComparisonAvailable &&
    staticMetrics.shapingFingerprint === animationOffMetrics.shapingFingerprint;
  const updateUnitControls = (patch: Partial<TextUnitPlaygroundControls>) => {
    stopStaticPlayback();
    setUnitControls((currentControls) => ({ ...currentControls, ...patch }));
  };
  const updateLayoutControls = (patch: Partial<LayoutReactivePlaygroundControls>) => {
    stopStaticPlayback();
    setLayoutControls((currentControls) => ({ ...currentControls, ...patch }));
  };

  const changePreset = (nextPresetKey: AnimationPagePresetKey) => {
    stopStaticPlayback();
    setStaticPlaybackError(null);
    setPresetKey(nextPresetKey);
    const nextPreset = isLayoutReactivePresetKey(nextPresetKey)
      ? LAYOUT_REACTIVE_PRESETS[nextPresetKey]
      : ANIMATION_PRESETS[nextPresetKey];
    if (isLayoutReactivePresetKey(nextPresetKey)) {
      setLayoutControls({ ...LAYOUT_REACTIVE_PRESETS[nextPresetKey].defaultControls });
    } else {
      setUnitControls({
        ...(ANIMATION_PRESETS[nextPresetKey].defaultControls ??
          DEFAULT_TEXT_UNIT_PLAYGROUND_CONTROLS),
      });
    }
    const nextTimeMs = reducedMotion ? nextPreset.posterTimeMs : 0;
    playbackTimeRef.current = nextTimeMs;
    setTimeMs(nextTimeMs);
    setDeclarativeStartTimeMs(nextTimeMs);
    setDeclarativeRestart((current) => current + 1);
  };

  const restartDeclarative = () => {
    setDeclarativeStartTimeMs(reducedMotion ? posterTimeMs : playbackTimeRef.current);
    setDeclarativeRestart((current) => current + 1);
  };

  const toggleStaticPlayback = () => {
    if (staticPlaybackActiveRef.current) {
      stopStaticPlayback();
      return;
    }
    playbackTimeRef.current = timeMs;
    timelineOriginRef.current = {
      wallTimeMs: performance.now(),
      sceneTimeMs: timeMs,
    };
    staticPlaybackActiveRef.current = true;
    setStaticPlaybackError(null);
    setStaticPlayback(true);
  };

  const scrubTo = (nextTimeMs: number) => {
    staticPlaybackActiveRef.current = false;
    setStaticPlayback(false);
    playbackTimeRef.current = nextTimeMs;
    setTimeMs(nextTimeMs);
    setStaticPreviewRevision((currentRevision) => currentRevision + 1);
  };

  // The declarative preview does not depend on `timeMs`, so scrubbing the static
  // slider must not re-render it. Memoizing the element lets React skip the
  // subtree entirely — otherwise `dangerouslySetInnerHTML` re-inserts the SVG on
  // every scrub, restarting its native CSS animation and causing visible flicker.
  const declarativePreview = useMemo(
    () =>
      vnode ? (
        <BoundSvg
          key={`${presetKey}-${declarativeRestart}-${reducedMotion ? "static" : "native"}`}
          vnode={vnode}
          className="rendered-content"
          renderOptions={declarativeOptions}
          fallback={<p className="placeholder-text">Rendering…</p>}
        />
      ) : null,
    [vnode, declarativeOptions, presetKey, declarativeRestart, reducedMotion],
  );

  return (
    <div className="animation-layout">
      <aside className="panel controls-panel animation-controls">
        <Section title="Preset">
          <SelectField
            id="animation-preset"
            label="Scene"
            value={presetKey}
            options={ANIMATION_PAGE_PRESET_OPTIONS}
            onChange={(value) => changePreset(value as AnimationPagePresetKey)}
          />
          <p className="animation-note">{preset.description}</p>
        </Section>

        {isTextUnitPreset && (
          <TextUnitControlsSection
            controls={unitControls}
            supportsWritingMode={animationPreset?.supportsWritingMode ?? false}
            showUnitOverlay={showUnitOverlay}
            onUpdate={updateUnitControls}
            onShowUnitOverlay={setShowUnitOverlay}
          />
        )}

        {isLayoutReactivePreset && (
          <Section title="Layout-reactive frame">
            <NumberField
              id="animation-layout-duration"
              label="duration"
              value={layoutControls.durationMs}
              min={400}
              max={6_000}
              step={100}
              unit="ms"
              onChange={(durationMsValue) => updateLayoutControls({ durationMs: durationMsValue })}
            />
            {layoutPreset?.supportsTextControls && (
              <>
                <SelectField
                  id="animation-layout-fit"
                  label="fit mode"
                  value={layoutControls.fit}
                  options={[
                    { value: "shrink", label: "Shrink" },
                    { value: "none", label: "None" },
                  ]}
                  onChange={(value) =>
                    updateLayoutControls({
                      fit: value as LayoutReactivePlaygroundControls["fit"],
                    })
                  }
                />
                <SelectField
                  id="animation-layout-wrap"
                  label="wrap"
                  value={layoutControls.wrap}
                  options={[
                    { value: "char", label: "Character" },
                    { value: "word", label: "Word" },
                  ]}
                  onChange={(value) =>
                    updateLayoutControls({
                      wrap: value as LayoutReactivePlaygroundControls["wrap"],
                    })
                  }
                />
                <SelectField
                  id="animation-layout-writing-mode"
                  label="writing mode"
                  value={layoutControls.writingMode}
                  options={[
                    { value: "horizontal-tb", label: "Horizontal" },
                    { value: "vertical-rl", label: "Vertical" },
                  ]}
                  onChange={(value) =>
                    updateLayoutControls({
                      writingMode: value as LayoutReactivePlaygroundControls["writingMode"],
                    })
                  }
                />
              </>
            )}
            <SelectField
              id="animation-layout-canvas-fit"
              label="preview fit"
              value={layoutControls.canvasFit}
              options={[
                { value: "pad", label: "Downstream pad / contain" },
                { value: "crop", label: "Downstream crop / cover" },
              ]}
              onChange={(value) =>
                updateLayoutControls({
                  canvasFit: value as LayoutReactivePlaygroundControls["canvasFit"],
                })
              }
            />
            <p className="animation-note">
              The frame generator accepts only timeMs. It materializes ordinary static props; no
              local refit callback or layout animation API is involved.
            </p>
            <p className="animation-note">
              Every scene stays 640 × 360. Pad / crop is only the downstream preview wrapper, not a
              core layout mode.
            </p>
          </Section>
        )}

        {!isLayoutReactivePreset && (
          <Section title="Declarative SVG">
            <p className="animation-note">
              Emitted once. The browser interpolates the SVG's native CSS animation without a
              JavaScript frame loop.
            </p>
            <button
              type="button"
              className="animation-action"
              disabled={reducedMotion}
              onClick={restartDeclarative}
            >
              Restart browser playback
            </button>
          </Section>
        )}

        <Section
          title="Static sampling"
          className={staticSamplingMobileClass(isLayoutReactivePreset)}
        >
          <div className="animation-time-heading">
            <label htmlFor="animation-time">timeMs</label>
            <output
              ref={timeOutputRef}
              data-testid="animation-time-value"
              htmlFor="animation-time"
              aria-live="off"
            >
              {timeMs} ms
            </output>
          </div>
          <input
            id="animation-time"
            ref={timeSliderRef}
            className="animation-time-slider"
            type="range"
            min={0}
            max={durationMs}
            step={20}
            value={timeMs}
            onInput={(event) => scrubTo(Number(event.currentTarget.value))}
            onChange={(event) => scrubTo(Number(event.currentTarget.value))}
          />
          <div className="animation-time-scale" aria-hidden="true">
            <span>0</span>
            <span>{durationMs / 2}</span>
            <span>{durationMs} ms</span>
          </div>
          <details
            className="animation-timeline"
            data-testid="animation-timeline"
            onToggle={(event) => setTimelineOpen(event.currentTarget.open)}
          >
            <summary>Timeline</summary>
            <p className="animation-timeline-note">
              Viewing and scrubbing only. Track bars come from each spec's delay, duration, and
              iteration count; the inspector reads resolved values from the engine at the current
              time. Editing keyframes is a downstream editor's job, not this demo's.
            </p>
            <TimelineTracks
              onSelect={setSelectedTrackId}
              selectedNodeId={selectedTrackId}
              timeMs={timeMs}
              totalMs={durationMs}
              tracks={timelineTracks}
            />
            <ValueInspector
              error={animationStateResult.error}
              samples={animationStateResult.samples}
              selectedNodeId={selectedTrackId}
              timeMs={timeMs}
            />
          </details>
          <div className="animation-action-row">
            <button
              type="button"
              className="animation-action"
              disabled={reducedMotion}
              aria-label={staticPlayback ? "Pause static samples" : "Play static samples"}
              onClick={toggleStaticPlayback}
            >
              {staticPlayback ? "Pause samples" : "Play samples"}
            </button>
            <button type="button" className="animation-action" onClick={() => scrubTo(0)}>
              Reset to 0
            </button>
            <button
              type="button"
              className="animation-action"
              onClick={() => scrubTo(posterTimeMs)}
            >
              Poster frame
            </button>
          </div>
          <p className="animation-note">{samplingDescription(isLayoutReactivePreset)}</p>
          {staticPlaybackError && (
            <p className="error-text" role="alert">
              Playback failed: {staticPlaybackError.message}
            </p>
          )}
        </Section>

        {isTextUnitPreset && staticMetrics && (
          <ShapingParitySection
            metrics={staticMetrics}
            comparisonAvailable={shapingComparisonAvailable}
            shapingIsStable={shapingIsStable}
            staticSvgByteLength={new TextEncoder().encode(staticArtifacts?.svg ?? "").byteLength}
            comparisonError={animationOffRenderResult.error}
          />
        )}

        {isLayoutReactivePreset && layoutFrameResult.frame && (
          <LayoutReactiveMetricsSection
            frame={layoutFrameResult.frame}
            rigidRenderResult={rigidRenderResult}
            materializedRenderResult={materializedRenderResult}
            canvasFit={layoutControls.canvasFit}
          />
        )}

        <output
          className={`animation-motion-note${reducedMotion ? " is-reduced" : ""}`}
          data-testid="animation-motion-note"
        >
          {motionDescription(isLayoutReactivePreset, reducedMotion)}
        </output>
      </aside>

      {isLayoutReactivePreset ? (
        <LayoutReactivePreviewPanels
          mobileViewer={mobileViewer}
          presetKey={presetKey as LayoutReactivePresetKey}
          timeMs={timeMs}
          canvasFit={layoutControls.canvasFit}
          rigidRenderResult={rigidRenderResult}
          materializedRenderResult={materializedRenderResult}
          rigidPreviewContentRef={rigidPreviewContentRef}
          materializedPreviewContentRef={materializedPreviewContentRef}
          staticPreviewRevision={staticPreviewRevision}
        />
      ) : (
        <A1PreviewPanels
          mobileViewer={mobileViewer}
          reducedMotion={reducedMotion}
          posterTimeMs={posterTimeMs}
          declarativeStartTimeMs={declarativeStartTimeMs}
          runtime={animationPreset?.runtime ?? "Node animation"}
          declarativePreview={declarativePreview}
          timeMs={timeMs}
          staticRenderResult={staticRenderResult}
          staticMetrics={staticMetrics}
          showUnitOverlay={showUnitOverlay && !staticPlayback}
          onDownloadAnimated={downloadAnimated}
          onDownloadMp4={downloadMp4}
          mp4Supported={mp4Supported}
          onDownloadStill={downloadStill}
          animatedExportError={animatedExportError}
          animatedExportPending={animatedExportPending}
          staticPreviewContentRef={staticPreviewContentRef}
          staticPreviewRevision={staticPreviewRevision}
        />
      )}
    </div>
  );
}
