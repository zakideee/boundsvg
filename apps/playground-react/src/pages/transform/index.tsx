import type { RenderOptions, VNode } from "@boundsvg/react";
import { useBoundSvg } from "@boundsvg/react/provider";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import type { EventEffectOverlayDisplayOptions } from "../../../../playground-shared/inspect-hover.js";
import { getPrismGrammar } from "../../../../playground-shared/prism.js";
import { CheckField, ColorField, NumberField, Section, SelectField } from "../../components/fields";
import { RenderSurface } from "../../components/RenderSurface";
import { useMobileViewer, useResetPreviewForMobile } from "../../hooks/use-mobile-viewer";
import { useSvgInspect } from "../../hooks/use-svg-inspect";
import { generateFullComponent, generateJsxSnippet } from "../../lib/codegen";
import type { RendererMode } from "../../types";
import { TRANSFORM_PRESET_OPTIONS, TRANSFORM_PRESETS } from "./presets";
import type { TransformPageState, TransformPresetKey } from "./types";

const DEFAULT_PRESET: TransformPresetKey = "translate-only";

const RENDERER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "boundsvg", label: "BoundSvg" },
  { value: "svg-hook", label: "useRenderToSvg" },
  { value: "png-hook", label: "useRenderToPng" },
];

const OVERLAY_MODE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "off", label: "Off" },
  { value: "layout", label: "Layout BBox" },
  { value: "transform", label: "Transform Box" },
  { value: "visual", label: "Visual Bounds" },
  { value: "all", label: "All" },
];

type ExtendedState = TransformPageState & {
  renderer: RendererMode;
  overlayMode: NonNullable<EventEffectOverlayDisplayOptions["mode"]>;
  showOrigin: boolean;
};

function initialStateFor(key: TransformPresetKey): ExtendedState {
  const preset = TRANSFORM_PRESETS[key];
  const base: TransformPageState = {
    preset: key,
    canvasWidth: 520,
    canvasHeight: 320,
    bgColor: "#0f172a",
    translateX: 0,
    translateY: 0,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 0,
    originX: 0,
    originY: 0,
  };
  return {
    ...base,
    ...preset.overrides,
    preset: key,
    renderer: "boundsvg",
    overlayMode: "all",
    showOrigin: true,
  };
}

function buildVNode(state: ExtendedState): VNode {
  return TRANSFORM_PRESETS[state.preset].build(state);
}

type ViewTab = "preview" | "svg" | "jsx" | "component";
type CodeLayout = "tab" | "panel";

export function TransformPage() {
  const { engine, status } = useBoundSvg();
  const [state, setState] = useState<ExtendedState>(() => initialStateFor(DEFAULT_PRESET));
  const [isPending, startTransition] = useTransition();
  const [viewTab, setViewTab] = useState<ViewTab>("preview");
  const [codeLayout, setCodeLayout] = useState<CodeLayout>("tab");
  const mobileViewer = useMobileViewer();
  useResetPreviewForMobile(mobileViewer, setViewTab, setCodeLayout);
  const deferred = useDeferredValue(state);

  const update = <K extends keyof ExtendedState>(key: K, value: ExtendedState[K]) => {
    startTransition(() => {
      setState((prev) => ({ ...prev, [key]: value }));
    });
  };

  const changePreset = (nextKey: TransformPresetKey) => {
    startTransition(() => {
      setState((prev) => ({
        ...initialStateFor(nextKey),
        renderer: prev.renderer,
        overlayMode: prev.overlayMode,
        showOrigin: prev.showOrigin,
      }));
    });
  };

  const vnode = useMemo(() => (engine ? buildVNode(deferred) : null), [engine, deferred]);

  const renderOptions = useMemo<RenderOptions>(() => ({}), []);
  const overlayDisplay = useMemo<EventEffectOverlayDisplayOptions>(
    () => ({
      mode: deferred.overlayMode,
      showOrigin: deferred.showOrigin,
    }),
    [deferred.overlayMode, deferred.showOrigin],
  );

  const activePreset = TRANSFORM_PRESETS[state.preset];

  const {
    highlightedSvg: highlightedRenderedSvg,
    setPreviewEl,
    setCodeEl,
  } = useSvgInspect(engine, status, vnode, renderOptions, overlayDisplay);

  const showCode = viewTab !== "preview" && viewTab !== "svg";
  const activeCodeTab: "svg" | "jsx" | "component" =
    viewTab === "svg" || viewTab === "jsx" || viewTab === "component" ? viewTab : "jsx";

  const jsxSnippetCode = useMemo(() => (vnode ? generateJsxSnippet(vnode) : ""), [vnode]);
  const fullComponentCode = useMemo(
    () => (vnode ? generateFullComponent(vnode, state.renderer) : ""),
    [vnode, state.renderer],
  );
  const highlightedJsxSnippet = useMemo(
    () => (jsxSnippetCode ? Prism.highlight(jsxSnippetCode, getPrismGrammar("tsx"), "tsx") : ""),
    [jsxSnippetCode],
  );
  const highlightedFullComponent = useMemo(
    () =>
      fullComponentCode ? Prism.highlight(fullComponentCode, getPrismGrammar("tsx"), "tsx") : "",
    [fullComponentCode],
  );

  return (
    <div className="split-layout">
      <aside className="panel controls-panel">
        <Section title="Preset">
          <SelectField
            id="transform-preset"
            label="Preset"
            value={state.preset}
            options={TRANSFORM_PRESET_OPTIONS}
            onChange={(v) => changePreset(v as TransformPresetKey)}
          />
          <p className="section-note">{activePreset.description}</p>
        </Section>

        <Section title="Canvas">
          <NumberField
            id="transform-cw"
            label="Width"
            value={state.canvasWidth}
            min={200}
            max={1200}
            unit="px"
            onChange={(v) => update("canvasWidth", v)}
          />
          <NumberField
            id="transform-ch"
            label="Height"
            value={state.canvasHeight}
            min={160}
            max={800}
            unit="px"
            onChange={(v) => update("canvasHeight", v)}
          />
          <ColorField
            id="transform-bg"
            label="Background"
            value={state.bgColor}
            onChange={(v) => update("bgColor", v)}
          />
        </Section>

        <Section title="Translate">
          <NumberField
            id="transform-tx"
            label="translateX"
            value={state.translateX}
            min={-400}
            max={400}
            unit="px"
            onChange={(v) => update("translateX", v)}
          />
          <NumberField
            id="transform-ty"
            label="translateY"
            value={state.translateY}
            min={-400}
            max={400}
            unit="px"
            onChange={(v) => update("translateY", v)}
          />
        </Section>

        <Section title="Rotate">
          <NumberField
            id="transform-rot"
            label="rotateDeg"
            value={state.rotateDeg}
            min={-360}
            max={360}
            unit="deg"
            onChange={(v) => update("rotateDeg", v)}
          />
          <NumberField
            id="transform-ox"
            label="originX"
            value={state.originX}
            min={-400}
            max={400}
            unit="px"
            onChange={(v) => update("originX", v)}
          />
          <NumberField
            id="transform-oy"
            label="originY"
            value={state.originY}
            min={-400}
            max={400}
            unit="px"
            onChange={(v) => update("originY", v)}
          />
        </Section>

        <Section title="Scale">
          <NumberField
            id="transform-sx"
            label="scaleX"
            value={state.scaleX}
            min={-4}
            max={4}
            step={0.1}
            onChange={(v) => update("scaleX", v)}
          />
          <NumberField
            id="transform-sy"
            label="scaleY"
            value={state.scaleY}
            min={-4}
            max={4}
            step={0.1}
            onChange={(v) => update("scaleY", v)}
          />
        </Section>

        <Section title="Render" className="mobile-viewer-secondary">
          <SelectField
            id="transform-renderer"
            label="Renderer"
            value={state.renderer}
            options={RENDERER_OPTIONS}
            onChange={(v) => update("renderer", v as RendererMode)}
          />
          <SelectField
            id="transform-overlay-mode"
            label="Overlay"
            value={state.overlayMode}
            options={OVERLAY_MODE_OPTIONS}
            onChange={(v) => update("overlayMode", v as ExtendedState["overlayMode"])}
          />
          <CheckField
            id="transform-show-origin"
            label="Show origin anchor"
            checked={state.showOrigin}
            onChange={(v) => update("showOrigin", v)}
          />
          <p className="section-note">
            Slate dashed = layout / Cyan = transform / Pink corners = visual bounds / Amber = origin
          </p>
          <p className="section-note">
            Origin anchors only appear where the transform lands on a group. A transform on a leaf
            (Text / Path / Image / Shape) carries no origin in the IR yet, so presets built from
            leaves show none.
          </p>
        </Section>
      </aside>

      <section
        className={`panel preview-panel has-code-area layout-${codeLayout}${showCode ? " show-code" : ""}`}
      >
        <div className="preview-header">
          <div className="preview-header-meta">
            <h3>{activePreset.label}</h3>
            <p className="preview-subtitle">
              Layout bbox is pre-transform. Transform box follows rotation and mirroring. Visual
              bounds show the post-transform min/max frame.
            </p>
          </div>
          {codeLayout === "tab" && (
            <div className="preview-view-tabs">
              {(["preview", "svg", "jsx", "component"] as const).map((tab) => {
                const labels: Record<ViewTab, string> = {
                  preview: "Preview",
                  svg: "Rendered SVG",
                  jsx: "Generated JSX",
                  component: "React Component",
                };
                return (
                  <button
                    key={tab}
                    type="button"
                    className={`preview-view-tab ${viewTab === tab ? "active" : ""}`}
                    onClick={() => startTransition(() => setViewTab(tab))}
                  >
                    {labels[tab]}
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className="layout-toggle-btn"
            title={codeLayout === "tab" ? "Split view" : "Tab view"}
            onClick={() =>
              startTransition(() => setCodeLayout((layout) => (layout === "tab" ? "panel" : "tab")))
            }
          >
            {codeLayout === "tab" ? (
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="1.5" y="1.5" width="11" height="6" rx="1" />
                <rect x="1.5" y="9" width="11" height="3.5" rx="1" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="1.5" y="1.5" width="11" height="11" rx="1" />
              </svg>
            )}
          </button>
        </div>

        <div ref={setPreviewEl} className="preview-body">
          {viewTab === "svg" && codeLayout === "tab" ? (
            <div
              ref={codeLayout === "tab" ? setCodeEl : undefined}
              className="code-block"
              dangerouslySetInnerHTML={{ __html: highlightedRenderedSvg }}
            />
          ) : (
            <RenderSurface
              renderer={state.renderer}
              vnode={vnode}
              renderOptions={renderOptions}
              isPending={isPending}
            />
          )}
        </div>

        <div className="code-area">
          {codeLayout === "panel" && (
            <div className="code-area-tabs">
              {(["svg", "jsx", "component"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`preview-view-tab ${activeCodeTab === tab ? "active" : ""}`}
                  onClick={() => startTransition(() => setViewTab(tab))}
                >
                  {tab === "svg"
                    ? "Rendered SVG"
                    : tab === "jsx"
                      ? "Generated JSX"
                      : "React Component"}
                </button>
              ))}
            </div>
          )}
          {activeCodeTab === "svg" ? (
            <div
              ref={codeLayout === "panel" ? setCodeEl : undefined}
              className="code-block code-block-full"
              dangerouslySetInnerHTML={{ __html: highlightedRenderedSvg }}
            />
          ) : (
            <pre className="code-block code-block-full">
              <code
                dangerouslySetInnerHTML={{
                  __html:
                    activeCodeTab === "jsx" ? highlightedJsxSnippet : highlightedFullComponent,
                }}
              />
            </pre>
          )}
        </div>
      </section>
    </div>
  );
}
