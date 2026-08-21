import type { AnimationSpec, AnimationStateSample, AnyVNode } from "@boundsvg/core";

/**
 * Read-only timeline: track bars, selection, and a value inspector.
 *
 * Viewing and scrubbing only. There is no keyframe editing, auto-keyframing, or
 * dragging here — authoring UI belongs to a downstream editor, not the demo.
 *
 * Track geometry comes from the scene's own `AnimationSpec` values, computed in
 * TypeScript. The engine is only consulted for resolved values at the current
 * time, which is what `sampleAnimationState` exists for.
 */

type TimelineTrack = {
  nodeId: string;
  label: string;
  kind: "node" | "units";
  delayMs: number;
  durationMs: number;
  iterations: number | "infinite";
  /** Total span in ms, or null when the track never ends. */
  endMs: number | null;
};

type VNodeLike = {
  type: string;
  props: Record<string, unknown>;
  children?: unknown;
};

function isVNodeLike(value: unknown): value is VNodeLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { props?: unknown }).props === "object"
  );
}

function isAnimationSpec(value: unknown): value is AnimationSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { keyframes?: unknown }).keyframes) &&
    typeof (value as { durationMs?: unknown }).durationMs === "number"
  );
}

function trackFromSpec(
  nodeId: string,
  kind: TimelineTrack["kind"],
  spec: AnimationSpec,
): TimelineTrack {
  const delayMs = spec.delayMs ?? 0;
  const iterations = spec.iterations ?? 1;
  return {
    nodeId,
    label: nodeId,
    kind,
    delayMs,
    durationMs: spec.durationMs,
    iterations,
    endMs: iterations === "infinite" ? null : delayMs + spec.durationMs * iterations,
  };
}

/** Collect every animated node in document order. */
export function collectTimelineTracks(root: AnyVNode | null): TimelineTrack[] {
  const tracks: TimelineTrack[] = [];
  let anonymousIndex = 0;

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) {
        walk(child);
      }
      return;
    }
    if (!isVNodeLike(node)) {
      return;
    }
    const { props } = node;
    const explicitId = typeof props.id === "string" ? props.id : undefined;
    const animate = props.animate;
    const animateUnits = props.animateUnits;

    if (isAnimationSpec(animate)) {
      anonymousIndex += 1;
      tracks.push(trackFromSpec(explicitId ?? `${node.type}#${anonymousIndex}`, "node", animate));
    }
    if (
      typeof animateUnits === "object" &&
      animateUnits !== null &&
      isAnimationSpec((animateUnits as { animation?: unknown }).animation)
    ) {
      const unitTrack = animateUnits as { animation: AnimationSpec; delayStepMs?: number };
      anonymousIndex += 1;
      // The bar shows the base spec only. The stagger pushes later units past
      // it, but the unit count is a shaping result the engine owns, so the
      // span is reported per unit in the label rather than guessed here.
      tracks.push({
        ...trackFromSpec(
          explicitId ?? `${node.type}#${anonymousIndex}`,
          "units",
          unitTrack.animation,
        ),
        label: `${explicitId ?? node.type} (units, +${unitTrack.delayStepMs ?? 0}ms step)`,
      });
    }
    walk(node.children);
  };

  walk(root);
  return tracks;
}

function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

function formatMatrixValue(value: number): string {
  return value.toFixed(3);
}

export function TimelineTracks({
  tracks,
  totalMs,
  timeMs,
  selectedNodeId,
  onSelect,
}: {
  tracks: readonly TimelineTrack[];
  totalMs: number;
  timeMs: number;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  if (tracks.length === 0) {
    return <p className="timeline-empty">This preset has no declarative animation tracks.</p>;
  }
  const span = Math.max(totalMs, 1);
  return (
    <div className="timeline-tracks">
      <div className="timeline-playhead-row">
        <span
          className="timeline-playhead"
          style={{ left: `${Math.min((timeMs / span) * 100, 100)}%` }}
        />
      </div>
      {tracks.map((track) => {
        const leftPercent = Math.min((track.delayMs / span) * 100, 100);
        const widthPercent =
          track.endMs === null
            ? 100 - leftPercent
            : Math.min(((track.endMs - track.delayMs) / span) * 100, 100 - leftPercent);
        const isSelected = track.nodeId === selectedNodeId;
        return (
          <button
            className={`timeline-track${isSelected ? " is-selected" : ""}`}
            key={`${track.kind}:${track.nodeId}`}
            onClick={() => onSelect(track.nodeId)}
            type="button"
          >
            <span className="timeline-track-label">{track.label}</span>
            <span className="timeline-track-lane">
              <span
                className={`timeline-track-bar${track.kind === "units" ? " is-units" : ""}`}
                style={{ left: `${leftPercent}%`, width: `${Math.max(widthPercent, 1)}%` }}
              >
                {track.iterations === "infinite" ? "∞" : null}
              </span>
            </span>
            <span className="timeline-track-meta">
              {formatMs(track.delayMs)} + {formatMs(track.durationMs)}
              {track.iterations === "infinite" ? " × ∞" : ` × ${track.iterations}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ValueInspector({
  samples,
  selectedNodeId,
  timeMs,
  error,
}: {
  samples: readonly AnimationStateSample[];
  selectedNodeId: string | null;
  timeMs: number;
  error: string | null;
}) {
  if (error) {
    return <p className="timeline-inspector-error">{error}</p>;
  }
  const sample = samples.find((entry) => entry.nodeId === selectedNodeId) ?? samples[0];
  if (!sample) {
    return (
      <p className="timeline-empty">
        No node-level animation resolved at {formatMs(timeMs)}. Text unit tracks resolve per paint
        unit and are not reported here.
      </p>
    );
  }
  const matrix = sample.transform;
  return (
    <dl className="timeline-inspector">
      <dt>node</dt>
      <dd>{sample.nodeId}</dd>
      <dt>time</dt>
      <dd>{formatMs(timeMs)}</dd>
      <dt>opacity</dt>
      <dd>{sample.opacity === null ? "—" : sample.opacity.toFixed(4)}</dd>
      <dt>transform</dt>
      <dd>
        {matrix === null
          ? "—"
          : `matrix(${formatMatrixValue(matrix.a)}, ${formatMatrixValue(matrix.b)}, ${formatMatrixValue(matrix.c)}, ${formatMatrixValue(matrix.d)}, ${formatMatrixValue(matrix.e)}, ${formatMatrixValue(matrix.f)})`}
      </dd>
    </dl>
  );
}
