import type { IR, VNode } from "@boundsvg/core";
import { AnimatedBoundSvg, BoundSvg } from "@boundsvg/react";
import { type EventCallback, InteractiveBoundSvg } from "@boundsvg/react/interactive";
import { BoundSvgProvider } from "@boundsvg/react/provider";
import { StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

// Preview uses production React; the mounted unit tests exercise development StrictMode.

/** Display responsibilities exercised through the actual provider and browser WASM. */
type DisplayMode = "interactive" | "static" | "animated";
/** Inputs changed by a parent update without replacing the React root. */
type DisplayState = {
  vnode: VNode;
  mode: DisplayMode;
  isAnimated: boolean;
  timeMs?: number;
  callbackGeneration: number;
  revision: number;
};
/** Native event deliveries tagged with the callback generation that received them. */
type Delivery = { nodeId: string; type: string; generation: number; at: number };
/** Animation and DOM observations collected together on the browser clock. */
type DisplaySnapshot = {
  at: number;
  svgId: number | null;
  pathId: number | null;
  pathRect: { x: number; y: number; width: number; height: number } | null;
  animations: Array<{ id: number | null; time: number | null; state: AnimationPlayState }>;
  touchAction: string | null;
  callbacks: Delivery[];
  irNodeIds: string[];
  error: string | null;
};

/** Root and update callback owned by this local-only test page. */
let mountedRoot: Root | null = null;
/** Latest parent state updater, installed by the mounted fixture. */
let updateDisplay: ((changes: Partial<DisplayState>) => void) | null = null;
/** Callback log is outside React state so reading it cannot trigger a render. */
let deliveries: Delivery[] = [];
/** Latest committed IR allows callback and displayed-scene correspondence checks. */
let committedIr: IR | null = null;
/** Browser-object identities distinguish clock recreation from normal time progression. */
const identities = new WeakMap<object, number>();
/** Monotonic identifier source for this test page's observed browser objects. */
let identityCount = 0;

/** Assign a stable test identity without modifying the observed DOM or animation. */
function identity(subject: object | null): number | null {
  if (subject === null) {
    return null;
  }
  let subjectId = identities.get(subject);
  if (subjectId === undefined) {
    subjectId = ++identityCount;
    identities.set(subject, subjectId);
  }
  return subjectId;
}

/** Parent state updates and actual display components share one mounted provider. */
function DisplayFixture({ initial }: { initial: DisplayState }) {
  const [state, setState] = useState(initial);
  updateDisplay = (changes) => setState((previous) => ({ ...previous, ...changes }));
  const handlers = new Map<string, EventCallback>();
  for (const nodeId of ["path", "changed", "underlay", "card"]) {
    for (const eventName of ["click", "move"]) {
      handlers.set(`${nodeId}-${eventName}`, (event) => {
        deliveries.push({
          nodeId: event.nodeId,
          type: event.nativeEvent.type,
          generation: state.callbackGeneration,
          at: performance.now(),
        });
      });
    }
  }
  const shared = {
    vnode: state.vnode,
    className: `revision-${state.revision}`,
    fallback: <output data-testid="loading">Loading</output>,
    errorFallback: (error: Error) => <output data-testid="error">{error.message}</output>,
  };
  return (
    <BoundSvgProvider config={{ fonts: [] }}>
      {state.mode === "interactive" ? (
        <InteractiveBoundSvg
          {...shared}
          handlers={handlers}
          {...(state.isAnimated
            ? { renderMode: "animated", renderOptions: { playback: { mode: "independent" } } }
            : { renderOptions: { timeMs: state.timeMs } })}
          onRender={(ir) => {
            committedIr = ir;
          }}
        />
      ) : state.mode === "animated" ? (
        <AnimatedBoundSvg {...shared} renderOptions={{ playback: { mode: "independent" } }} />
      ) : (
        <BoundSvg {...shared} renderOptions={{ timeMs: state.timeMs }} />
      )}
    </BoundSvgProvider>
  );
}

/**
 * Start one real mounted scene; later parent updates use the same root.
 * @throws When this test page's mount element is missing.
 */
function mountScene(vnode: VNode, options: Partial<Omit<DisplayState, "vnode">> = {}): void {
  const container = document.getElementById("mount");
  if (!container) {
    throw new Error("SVG stability fixture requires its mount element");
  }
  mountedRoot?.unmount();
  deliveries = [];
  committedIr = null;
  mountedRoot = createRoot(container);
  mountedRoot.render(
    <StrictMode>
      <DisplayFixture
        initial={{
          vnode,
          mode: "interactive",
          isAnimated: true,
          callbackGeneration: 0,
          revision: 0,
          ...options,
        }}
      />
    </StrictMode>,
  );
}

/** Read identity, geometry, clock, and deliveries on the same observation timeline. */
function readSnapshot(): DisplaySnapshot {
  const svg = document.querySelector("#mount svg");
  const path = svg?.querySelector("path") ?? null;
  const rectangle = path?.getBoundingClientRect();
  return {
    at: performance.now(),
    svgId: identity(svg),
    pathId: identity(path),
    pathRect: rectangle
      ? { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height }
      : null,
    animations: document.getAnimations().map((animation) => ({
      id: identity(animation),
      time: typeof animation.currentTime === "number" ? animation.currentTime : null,
      state: animation.playState,
    })),
    touchAction: (svg as SVGSVGElement | null)?.style.touchAction ?? null,
    callbacks: [...deliveries],
    irNodeIds: committedIr?.drawOrder ?? [],
    error: document.querySelector('[data-testid="error"]')?.textContent ?? null,
  };
}

/** Test-only browser interface, absent from the distributed React API. */
type SvgStabilityHarness = {
  mount: typeof mountScene;
  update: (changes: Partial<DisplayState>) => void;
  read: typeof readSnapshot;
  clearCallbacks: () => void;
};

declare global {
  /** Local fixture controls are excluded from deployed playground builds. */
  // biome-ignore lint/style/useConsistentTypeDefinitions: Window augmentation requires an interface.
  interface Window {
    boundsvgSvgStability: SvgStabilityHarness;
  }
}

window.boundsvgSvgStability = {
  mount: mountScene,
  update: (changes) => updateDisplay?.(changes),
  read: readSnapshot,
  clearCallbacks: () => {
    deliveries = [];
  },
};
