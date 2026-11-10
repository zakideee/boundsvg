import { loadWasmModule } from "@boundsvg/browser";
import {
  bindIRToSvg,
  createSvgInteractionController,
  type EventCallback,
  queryCurrentSvgHit,
  type SvgInteractionController,
} from "@boundsvg/browser/events";
import { preloadFonts } from "@boundsvg/browser/fonts";
import { createEngineAsync, type Engine, type IR, type VNode } from "@boundsvg/core";
import {
  buildIRSourceIndex,
  buildTextMap,
  findLineAtPoint,
  getNodeText,
  type IRSourceRef,
  type SvgPoint,
} from "@boundsvg/core/scene";
import { initWasm } from "@boundsvg/core/wasm";
import { InteractiveBoundSvg } from "@boundsvg/react/interactive";
import { BoundSvgProvider } from "@boundsvg/react/provider";
import { version as reactVersion, StrictMode, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

/** The existing OFL-licensed font is loaded only from this local test server. */
const FONT_DEFINITIONS = [{ alias: "Test", source: "/fonts/NotoSansJP-Regular.subset.woff2" }];

/** Adapters share the same public scene input and Browser controller. */
type MountOptions = {
  adapter: "react" | "vanilla";
  scope: "document" | "open" | "closed" | "slot" | "nested";
  animated: boolean;
  rerenderOnHover?: boolean;
  delayed?: boolean;
  reducedMotion?: "keep" | "pause";
};
/** Unmodified callback facts, including scene-only hover causes. */
type Delivery = {
  nodeId: string;
  handlerName: string;
  cause: "input" | "scene";
  nativeType: string | null;
  generation: number;
  pointerId: number | null;
  point: SvgPoint | null;
  isNativeEventTrusted: boolean | null;
  nativeConstructor: string | null;
};
/** Serializable copy-menu facts from the real adapter. */
type Menu = {
  nodeId: string;
  point: SvgPoint | null;
  nodeText: string | null;
  lineText: string | null;
};
/** React fixture updates are driven through actual state and commit. */
type DisplayState = { vnode: VNode; revision: number; visible: boolean; nodeKey: number };
/** Each mount owns its controller, engine and optional React root. */
let controller: SvgInteractionController | null = null;
/** Vanilla owns an Engine separately from the React provider. */
let engine: Engine | null = null;
/** React root is disposed before replacing its scope. */
let reactRoot: Root | null = null;
/** This reference also reaches a closed shadow scope without global traversal. */
let container: HTMLDivElement | null = null;
/** Rendered IR is the exact IR returned with the displayed SVG. */
let ir: IR | null = null;
/** Current committed target is recorded by the sole hover sink. */
let hovered: IRSourceRef | null = null;
/** Logical notifications are counted separately from canonical source updates. */
let hoverChanges: (string | null)[] = [];
/** Recording never causes a scene render. */
let deliveries: Delivery[] = [];
/** Copy menus are retained without invoking the clipboard. */
let menus: Menu[] = [];
/** Fixture-owned callback injection exercises reentrant application updates. */
let deliveryHook: ((delivery: Delivery) => void) | null = null;
/** React commits install their state updater here. */
let updateDisplay: ((changes: Partial<DisplayState>) => void) | null = null;
/** Latest vanilla input is reused for handler-only updates. */
let vanillaInput: VNode | null = null;
/** Active fixture family is explicit rather than inferred from native animations. */
let mountOptions: MountOptions | null = null;
/** The test counts callback generations independently of DOM identity. */
let generation = 0;
/** Byte equality preserves vanilla DOM on handler-only updates. */
let displayedSvg = "";
/** Development StrictMode lifecycle observations do not change rendered state. */
let reactEffects = { started: 0, cleaned: 0 };

/** Close only resources owned by this fixture mount. */
function unmount(): void {
  reactRoot?.unmount();
  reactRoot = null;
  controller?.dispose();
  controller = null;
  engine?.dispose();
  engine = null;
  container = null;
  ir = null;
  hovered = null;
  updateDisplay = null;
  deliveryHook = null;
  vanillaInput = null;
  mountOptions = null;
  displayedSvg = "";
}

/** Register the authored event references without deriving geometry in the harness. */
function handlersFor(vnode: VNode, callbackGeneration: number): Map<string, EventCallback> {
  const handlers = new Map<string, EventCallback>();
  function visit(node: VNode): void {
    for (const [key, reference] of Object.entries(node.props)) {
      if (key.startsWith("on") && typeof reference === "string") {
        handlers.set(reference, (eventInfo) => {
          const delivery: Delivery = {
            nodeId: eventInfo.nodeId,
            handlerName: eventInfo.handlerName,
            cause: eventInfo.cause,
            nativeType: eventInfo.nativeEvent?.type ?? null,
            generation: callbackGeneration,
            pointerId: eventInfo.pointerId,
            point: eventInfo.point,
            isNativeEventTrusted: eventInfo.nativeEvent?.isTrusted ?? null,
            nativeConstructor: eventInfo.nativeEvent?.constructor.name ?? null,
          };
          deliveries.push(delivery);
          deliveryHook?.(delivery);
        });
      }
    }
    for (const child of node.children) {
      if (typeof child === "object" && child !== null) {
        visit(child);
      }
    }
  }
  visit(vnode);
  return handlers;
}

/** Inline callbacks and hover setState exercise normal React parent commits. */
function ReactFixture({ vnode, options }: { vnode: VNode; options: MountOptions }) {
  useEffect(() => {
    reactEffects.started++;
    return () => {
      reactEffects.cleaned++;
    };
  }, []);
  const [state, setState] = useState<DisplayState>({
    vnode,
    revision: 0,
    visible: !options.delayed,
    nodeKey: 0,
  });
  const [, setHoverRevision] = useState(0);
  updateDisplay = (changes) => setState((previous) => ({ ...previous, ...changes }));
  return (
    <BoundSvgProvider config={{ fonts: FONT_DEFINITIONS }}>
      {state.visible && (
        <InteractiveBoundSvg
          key={state.nodeKey}
          vnode={state.vnode}
          handlers={handlersFor(state.vnode, state.revision)}
          {...(options.animated
            ? {
                renderMode: "animated",
                renderOptions: {
                  playback: { mode: "independent" },
                  ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}),
                },
              }
            : { renderMode: "static" })}
          onRender={(rendered) => {
            ir = rendered;
          }}
          onHoverChange={(source) => {
            hovered = source;
            hoverChanges.push(source?.nodeId ?? null);
            if (options.rerenderOnHover) {
              setHoverRevision((previous) => previous + 1);
            }
          }}
          enableTextCopy
          onTextCopyMenu={(info) =>
            menus.push({
              nodeId: info.source.nodeId,
              point: info.point,
              nodeText: info.nodeText,
              lineText: info.lineText,
            })
          }
          errorFallback={(error) => <output data-testid="error">{error.message}</output>}
        />
      )}
    </BoundSvgProvider>
  );
}

/** Commit Engine SVG/IR to the vanilla adapter, preserving identical SVG bytes. */
function commitVanilla(vnode: VNode): void {
  if (!engine || !container || !mountOptions) {
    throw new Error("Vanilla fixture is not mounted");
  }
  vanillaInput = vnode;
  const rendered = mountOptions.animated
    ? engine.renderToAnimatedSvgAndIR(vnode, {
        nodeIdMetadata: "include",
        playback: { mode: "independent" },
        ...(mountOptions.reducedMotion ? { reducedMotion: mountOptions.reducedMotion } : {}),
      })
    : engine.renderToSvgAndIR(vnode, { nodeIdMetadata: "include" });
  ir = rendered.ir;
  if (rendered.svg !== displayedSvg) {
    container.innerHTML = rendered.svg;
    displayedSvg = rendered.svg;
  }
  const root = container.querySelector("svg");
  if (!root) {
    throw new Error("Engine output did not contain an SVG root");
  }
  const index = buildIRSourceIndex(ir);
  const textMap = buildTextMap(index);
  controller ??= createSvgInteractionController(container);
  controller.setScene({
    binding: bindIRToSvg(root, index),
    renderMode: mountOptions.animated ? "animated" : "static",
    handlers: handlersFor(vnode, generation),
    textMap,
    onHoverState: () => {},
    onHoverChange: (source) => {
      hovered = source;
      hoverChanges.push(source?.nodeId ?? null);
    },
    enableTextCopy: true,
    onTextContextMenu: (info) =>
      menus.push({
        nodeId: info.source.nodeId,
        point: info.point,
        nodeText: getNodeText(textMap, info.source),
        lineText: info.point
          ? (findLineAtPoint(textMap, info.source, info.point)?.text ?? null)
          : null,
      }),
  });
}

/** Update application state synchronously only when the test explicitly requests flushSync. */
function update(
  vnode: VNode | null,
  options: { flush?: boolean; replaceNode?: boolean; visible?: boolean } = {},
): void {
  generation++;
  const commit = () => {
    if (updateDisplay) {
      updateDisplay({
        ...(vnode ? { vnode } : {}),
        revision: generation,
        ...(options.replaceNode ? { nodeKey: generation } : {}),
        ...(options.visible !== undefined ? { visible: options.visible } : {}),
      });
    } else {
      const input = vnode ?? vanillaInput;
      if (input) {
        commitVanilla(input);
      }
    }
  };
  if (options.flush) {
    flushSync(commit);
  } else {
    commit();
  }
}

/** Mount real Engine output in one explicitly owned DOM scope. */
async function mount(vnode: VNode, options: MountOptions): Promise<void> {
  unmount();
  deliveries = [];
  menus = [];
  hoverChanges = [];
  generation = 0;
  reactEffects = { started: 0, cleaned: 0 };
  mountOptions = options;
  const host = document.createElement("div");
  host.id = "mount";
  document.getElementById("mount")?.replaceWith(host);
  container = document.createElement("div");
  if (options.scope === "document") {
    host.append(container);
  } else if (options.scope === "slot") {
    host.attachShadow({ mode: "open" }).append(document.createElement("slot"));
    host.append(container);
  } else if (options.scope === "nested") {
    const innerHost = document.createElement("div");
    host.attachShadow({ mode: "closed" }).append(innerHost);
    innerHost.attachShadow({ mode: "open" }).append(container);
  } else {
    host.attachShadow({ mode: options.scope }).append(container);
  }
  if (options.adapter === "react") {
    reactRoot = createRoot(container);
    reactRoot.render(
      <StrictMode>
        <ReactFixture vnode={vnode} options={options} />
      </StrictMode>,
    );
  } else {
    await initWasm(await loadWasmModule());
    engine = await createEngineAsync({ fonts: await preloadFonts(FONT_DEFINITIONS) });
    commitVanilla(vnode);
  }
}

/** Seek only native animations; no authored style or local clock replaces playback. */
function seek(timeMs: number | null): number {
  const animations = container?.querySelector("svg")?.getAnimations({ subtree: true }) ?? [];
  for (const animation of animations) {
    if (timeMs === null) {
      animation.play();
    } else {
      animation.pause();
      animation.currentTime = timeMs;
    }
  }
  return animations.length;
}

/** Read the public query and a separate native top without implementing a resolver. */
function read(clientX = 20, clientY = 40) {
  const root = container?.querySelector("svg");
  const index = ir ? buildIRSourceIndex(ir) : null;
  const scope = root?.getRootNode();
  const top =
    scope && "elementsFromPoint" in scope
      ? (scope as Document | ShadowRoot).elementsFromPoint(clientX, clientY)[0]
      : null;
  return {
    ready: !!root && !!ir,
    error: container?.querySelector('[data-testid="error"]')?.textContent ?? null,
    hover: hovered?.nodeId ?? null,
    hoverChanges: [...hoverChanges],
    deliveries: [...deliveries],
    menus: [...menus],
    reactVersion,
    reactEffects: { ...reactEffects },
    sourceKinds: index
      ? [...index.nodes.values()].map((occurrence) => ({
          nodeId: occurrence.node.nodeId,
          type: occurrence.node.type,
          role: occurrence.node.ownership.role,
        }))
      : [],
    sources: index
      ? [...index.sources.values()].map((info) => ({
          nodeId: info.source.nodeId,
          primaryNodeIndex: info.primaryNodeIndex,
          bbox: {
            x: info.node.bbox.x,
            y: info.node.bbox.y,
            w: info.node.bbox.w,
            h: info.node.bbox.h,
          },
        }))
      : [],
    query: root && index ? queryCurrentSvgHit(bindIRToSvg(root, index), clientX, clientY) : null,
    nativeSource:
      top?.closest("[data-boundsvg-node-id]")?.getAttribute("data-boundsvg-node-id") ?? null,
    nativeTag: top?.localName ?? null,
    animationTimes:
      root?.getAnimations({ subtree: true }).map((animation) => animation.currentTime) ?? [],
  };
}

/** Query the same actual endpoint after native detachment, without a mocked getter. */
function queryDetached() {
  const root = container?.querySelector("svg");
  if (!root || !ir || !container) {
    throw new Error("No committed SVG to detach");
  }
  const binding = bindIRToSvg(root, buildIRSourceIndex(ir));
  root.remove();
  const result = queryCurrentSvgHit(binding, 50, 50);
  container.append(root);
  return result;
}

/** Local-only interface for the product E2E suite. */
type LiveInteractionHarness = {
  mount: typeof mount;
  read: typeof read;
  seek: typeof seek;
  unmount: typeof unmount;
  clear: () => void;
  update: typeof update;
  element: (selector: string) => Element | null;
  setDeliveryHook: (callback: ((delivery: Delivery) => void) | null) => void;
  queryDetached: typeof queryDetached;
};

declare global {
  /** These fixture controls are excluded from deployed playground builds. */
  // biome-ignore lint/style/useConsistentTypeDefinitions: Window augmentation requires an interface.
  interface Window {
    boundsvgLive: LiveInteractionHarness;
  }
}

window.boundsvgLive = {
  mount,
  read,
  seek,
  unmount,
  update,
  element: (selector) => container?.querySelector(selector) ?? null,
  setDeliveryHook: (callback) => {
    deliveryHook = callback;
  },
  queryDetached,
  clear: () => {
    deliveries = [];
    menus = [];
  },
};
