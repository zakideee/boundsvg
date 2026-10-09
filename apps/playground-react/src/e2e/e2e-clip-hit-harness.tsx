import type { IR, VNode } from "@boundsvg/core";
import { buildHitTestIndex, hitTest, hitTestCandidates } from "@boundsvg/core/scene";
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
  svgX: number;
  svgY: number;
};
/** Snapshot exposed only by this local test page, which is excluded from Pages builds. */
type HarnessSnapshot = {
  ready: boolean;
  callbacks: CallbackDelivery[];
  drawOrder: string[];
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

/** One receiver records the unmodified event contract delivered by React. */
const recordDelivery: EventCallback = (info) => {
  deliveries.push({
    nodeId: info.nodeId,
    handlerName: info.handlerName,
    eventType: info.nativeEvent.type,
    svgX: info.svgX,
    svgY: info.svgY,
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
    drawOrder: renderedIr?.drawOrder ?? [],
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
  coreHit: (x, y) => (renderedIr ? hitTest(renderedIr, x, y) : null),
  coreCandidates: (x, y) =>
    renderedIr ? hitTestCandidates(buildHitTestIndex(renderedIr), x, y) : [],
};
