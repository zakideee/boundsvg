import { bindIRToSvg, queryCurrentSvgHit } from "@boundsvg/browser/events";
import type { IR, VNode } from "@boundsvg/core";
import { buildHitTestIndex, buildIRSourceIndex, hitTest } from "@boundsvg/core/scene";
import { type EventCallback, InteractiveBoundSvg } from "@boundsvg/react/interactive";
import { BoundSvgProvider } from "@boundsvg/react/provider";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";

/** Public input variations exercised with a real mounted interactive component. */
type MountOptions = { shadow?: boolean; scale?: number; timeMs?: number; animated?: boolean };
/** Actual callback deliveries, independent of native SVG helper return values. */
type CallbackDelivery = {
  nodeId: string;
  handlerName: string;
  eventType: string;
  point: import("@boundsvg/core/scene").SvgPoint | null;
};
/** Snapshot exposed only by this local test page, which is excluded from Pages builds. */
type HarnessSnapshot = {
  ready: boolean;
  callbacks: CallbackDelivery[];
  sources: string[];
  hoverSource: import("@boundsvg/core/scene").IRSourceRef | null;
  svg: string | null;
  error: string | null;
};
/** Mounted root owned by the test page; replacing the scene disposes its listeners. */
let mountedRoot: Root | null = null;
/** Latest committed IR supplies independent Core candidate observations. */
let renderedIr: IR | null = null;
/** Current mount point also owns optional open-shadow-root interaction fixtures. */
let mountElement = document.getElementById("mount");
/** Mutable callback log avoids introducing event-driven scene rerenders into the test. */
let deliveries: CallbackDelivery[] = [];
/** Latest hover source belongs to the currently mounted snapshot. */
let hoveredSource: import("@boundsvg/core/scene").IRSourceRef | null = null;

/** One receiver records the unmodified event contract delivered by React. */
const recordDelivery: EventCallback = (info) => {
  deliveries.push({
    nodeId: info.nodeId,
    handlerName: info.handlerName,
    eventType: info.cause === "input" ? info.nativeEvent.type : "scene",
    point: info.point,
  });
};

/**
 * Render a Canvas with native SVG pointer events enabled and no mock engine.
 * @throws When the test fixture has no Canvas root.
 */
function mountScene(vnode: VNode, options: MountOptions = {}): void {
  if (vnode.type !== "Canvas") {
    throw new Error("Interactive fixture requires a Canvas root");
  }
  mountedRoot?.unmount();
  renderedIr = null;
  hoveredSource = null;
  deliveries = [];
  mountElement?.remove();
  mountElement = document.createElement("div");
  mountElement.id = "mount";
  document.body.append(mountElement);
  const container = options.shadow ? mountElement.attachShadow({ mode: "open" }) : mountElement;
  mountedRoot = createRoot(container);
  const handlers = new Map<string, EventCallback>();
  for (const nodeId of ["path", "underlay", "card"]) {
    for (const eventName of ["click", "down", "up", "move", "cancel"]) {
      handlers.set(`${nodeId}-${eventName}`, recordDelivery);
    }
  }
  mountedRoot.render(
    <StrictMode>
      {options.scale !== undefined && (
        <style>{`svg[viewBox] { width: ${Number(vnode.props.width) * options.scale}px; height: ${Number(vnode.props.height) * options.scale}px; }`}</style>
      )}
      <BoundSvgProvider config={{ fonts: [] }}>
        <InteractiveBoundSvg
          vnode={vnode}
          handlers={handlers}
          {...(options.animated
            ? { renderMode: "animated", renderOptions: { playback: { mode: "independent" } } }
            : { renderOptions: { timeMs: options.timeMs } })}
          onHoverChange={(source) => {
            hoveredSource = source;
          }}
          onRender={(ir) => {
            renderedIr = ir;
          }}
          errorFallback={(error) => <output data-testid="error">{error.message}</output>}
        />
      </BoundSvgProvider>
    </StrictMode>,
  );
}

/** Read the committed scene and event deliveries without mutating production state. */
function readSnapshot(): HarnessSnapshot {
  const scope = mountElement?.shadowRoot ?? mountElement;
  return {
    ready: renderedIr !== null,
    callbacks: [...deliveries],
    hoverSource: hoveredSource,
    sources: renderedIr
      ? [...buildIRSourceIndex(renderedIr).sources.values()].map((info) => info.source.nodeId)
      : [],
    svg: scope?.querySelector("svg")?.outerHTML ?? null,
    error: scope?.querySelector('[data-testid="error"]')?.textContent ?? null,
  };
}

/** Capture the real pointer from the actual container, rather than faking its event target. */
function armPointerCapture(): void {
  const scope = mountElement?.shadowRoot ?? mountElement;
  const container = scope?.querySelector("div");
  container?.addEventListener(
    "pointerdown",
    (event) => {
      container.setPointerCapture(event.pointerId);
    },
    { once: true },
  );
}

/** Test-page interface; never added to a distributed package's API. */
type ClipHitHarness = {
  mount: typeof mountScene;
  read: typeof readSnapshot;
  clearCallbacks: () => void;
  armCapture: typeof armPointerCapture;
  coreHit: (x: number, y: number) => string | null;
  coreCandidates: (x: number, y: number) => string[];
  currentHitMatchesSource: (
    sourceIndex: number,
    clientX: number,
    clientY: number,
  ) => boolean | null;
};

declare global {
  /** Local test-page interface, absent from distributed runtime modules. */
  // biome-ignore lint/style/useConsistentTypeDefinitions: Window augmentation requires an interface.
  interface Window {
    boundsvgClipHit: ClipHitHarness;
  }
}

window.boundsvgClipHit = {
  mount: mountScene,
  read: readSnapshot,
  clearCallbacks: () => {
    deliveries = [];
  },
  armCapture: armPointerCapture,
  currentHitMatchesSource: (sourceIndex, clientX, clientY) => {
    const scope = mountElement?.shadowRoot ?? mountElement;
    const svg = scope?.querySelector("svg");
    if (!renderedIr || !svg) {
      return null;
    }
    const index = buildIRSourceIndex(renderedIr);
    const query = queryCurrentSvgHit(bindIRToSvg(svg, index), clientX, clientY);
    return query.status === "ready" ? query.hit?.sourceIndex === sourceIndex : null;
  },
  coreHit: (x, y) => (renderedIr ? (hitTest(renderedIr, x, y)?.nodeId ?? null) : null),
  coreCandidates: (x, y) =>
    renderedIr
      ? buildHitTestIndex(renderedIr)
          .queryCandidates(x, y)
          .map((candidate) => candidate.source.nodeId)
      : [],
};
