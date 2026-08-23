import { Canvas } from "@boundsvg/core";
import type { Engine, RenderOptions, VNode } from "@boundsvg/react";
import { useBoundSvg } from "@boundsvg/react/provider";
import Prism from "prismjs";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import { getPrismGrammar } from "../../../../playground-shared/prism.js";
import {
  BBoxOverlayField,
  CheckField,
  ColorField,
  NumberField,
  Section,
  SelectField,
} from "../../components/fields";
import { RenderSurface } from "../../components/RenderSurface";
import { useMobileViewer, useResetPreviewForMobile } from "../../hooks/use-mobile-viewer";
import { useSvgInspect } from "../../hooks/use-svg-inspect";
import { generateFullComponent, generateJsxSnippet } from "../../lib/codegen";
import { resolveDebugOverlayConfig } from "../../lib/debug-overlay";
import type { RendererMode, TextPathModeOption } from "../../types";
import {
  applyTemplateOverrides,
  extractTemplateDefaults,
  type TemplateOverrides,
} from "../template-overrides";
import { DEFAULT_TEMPLATE_KEY, TEMPLATE_DEFINITIONS, TEMPLATE_GROUPS } from "./definitions";
import type { CodeLayout, ViewTab } from "./types";

function resolveVNode(def: (typeof TEMPLATE_DEFINITIONS)[string], engine: Engine | null): VNode {
  if (def.build) {
    if (!engine) {
      return Canvas({ width: 400, height: 200, background: "#1a1a1a" });
    }
    return def.build(engine);
  }
  return def.vnode;
}

type TemplateMenuProps = {
  templateKey: string;
  onSelect: (key: string) => void;
};

function TemplateMenu({ templateKey, onSelect }: TemplateMenuProps) {
  const mobileViewer = useMobileViewer();
  return (
    <aside className="panel controls-panel">
      <Section title="Template" defaultOpen>
        {mobileViewer ? (
          <label className="mobile-sample-select">
            <span>Sample</span>
            <select value={templateKey} onChange={(event) => onSelect(event.target.value)}>
              {TEMPLATE_GROUPS.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.templateKeys.map((key) => {
                    const def = TEMPLATE_DEFINITIONS[key];
                    return def ? (
                      <option key={key} value={key}>
                        {def.title}
                      </option>
                    ) : null;
                  })}
                </optgroup>
              ))}
            </select>
          </label>
        ) : (
          <div className="stack-list">
            {TEMPLATE_GROUPS.map((group) => (
              <div key={group.key} className="template-group">
                <h4
                  className="template-group-heading"
                  data-playground-locator-level="source"
                  data-playground-locator-segment={`Group: ${group.label} [${group.key}]`}
                >
                  {group.label}
                </h4>
                {group.templateKeys.map((key) => {
                  const def = TEMPLATE_DEFINITIONS[key];
                  if (!def) {
                    return null;
                  }
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`template-button ${key === templateKey ? "active" : ""}`}
                      data-playground-locator-level="sample"
                      data-playground-locator-segment={`Sample: ${def.title} [${key}]`}
                      onClick={() => onSelect(key)}
                    >
                      <strong>{def.title}</strong>
                      <span>{def.description}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Section>
    </aside>
  );
}

type TemplateCodeAreaProps = {
  codeLayout: CodeLayout;
  activeCodeTab: "svg" | "jsx" | "component";
  highlightedRenderedSvg: string;
  highlightedJsxSnippet: string;
  highlightedFullComponent: string;
  setCodeEl: (element: HTMLDivElement | null) => void;
  onSelectTab: (tab: ViewTab) => void;
};

function TemplateCodeArea({
  codeLayout,
  activeCodeTab,
  highlightedRenderedSvg,
  highlightedJsxSnippet,
  highlightedFullComponent,
  setCodeEl,
  onSelectTab,
}: TemplateCodeAreaProps) {
  return (
    <div className="code-area">
      {codeLayout === "panel" && (
        <div className="code-area-tabs">
          {(["svg", "jsx", "component"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`preview-view-tab ${activeCodeTab === tab ? "active" : ""}`}
              onClick={() => onSelectTab(tab)}
            >
              {tab === "svg" ? "Rendered SVG" : tab === "jsx" ? "Generated JSX" : "React Component"}
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
              __html: activeCodeTab === "jsx" ? highlightedJsxSnippet : highlightedFullComponent,
            }}
          />
        </pre>
      )}
    </div>
  );
}

export function TemplatesPage() {
  const { engine, status } = useBoundSvg();
  const firstDef = TEMPLATE_DEFINITIONS[DEFAULT_TEMPLATE_KEY];
  if (!firstDef) {
    throw new Error("TEMPLATE_DEFINITIONS must contain the default template");
  }
  const [templateKey, setTemplateKey] = useState<string>(DEFAULT_TEMPLATE_KEY);
  const [overrides, setOverrides] = useState<TemplateOverrides>(() =>
    extractTemplateDefaults(resolveVNode(firstDef, engine)),
  );
  const [viewTab, setViewTab] = useState<ViewTab>("preview");
  const [codeLayout, setCodeLayout] = useState<CodeLayout>("tab");
  const mobileViewer = useMobileViewer();
  useResetPreviewForMobile(mobileViewer, setViewTab, setCodeLayout);
  const [isPending, startTransition] = useTransition();

  const showCode = viewTab !== "preview" && viewTab !== "svg";
  const activeCodeTab: "svg" | "jsx" | "component" =
    viewTab === "svg" || viewTab === "jsx" || viewTab === "component" ? viewTab : "jsx";

  const selectTemplate = (key: string) => {
    startTransition(() => {
      const def = TEMPLATE_DEFINITIONS[key];
      if (!def) {
        return;
      }

      setTemplateKey(key);
      setOverrides((prev) => {
        const next = extractTemplateDefaults(resolveVNode(def, engine));
        next.renderer = prev.renderer;
        next.textPathMode = prev.textPathMode;
        next.debugOverlayParts = prev.debugOverlayParts;
        return next;
      });
    });
  };

  const setOverrideField = <K extends keyof TemplateOverrides>(
    key: K,
    value: TemplateOverrides[K],
  ) => {
    startTransition(() => {
      setOverrides((prev) => ({ ...prev, [key]: value }));
    });
  };

  const template = TEMPLATE_DEFINITIONS[templateKey] ?? firstDef;

  const baseVNode = useMemo(() => resolveVNode(template, engine), [template, engine]);

  const effectiveVNode = useMemo(
    () => applyTemplateOverrides(baseVNode, overrides),
    [baseVNode, overrides],
  );

  const baseRenderOptions = useMemo<RenderOptions>(
    () => ({
      debug: resolveDebugOverlayConfig(overrides.debugOverlayParts),
      textPathMode: overrides.textPathMode,
    }),
    [overrides.debugOverlayParts, overrides.textPathMode],
  );

  const pngRenderOptions = useMemo<RenderOptions>(() => {
    const options: RenderOptions = {
      debug: resolveDebugOverlayConfig(overrides.debugOverlayParts),
      textPathMode: "merged",
    };
    if (overrides.pngScale > 1) {
      options.scale = overrides.pngScale;
    }
    return options;
  }, [overrides.debugOverlayParts, overrides.pngScale]);
  const renderOptions = overrides.renderer === "png-hook" ? pngRenderOptions : baseRenderOptions;

  const deferredVNode = useDeferredValue(effectiveVNode);
  const deferredRenderOptions = useDeferredValue(renderOptions);

  const jsxSnippetCode = useMemo(() => generateJsxSnippet(effectiveVNode), [effectiveVNode]);
  const fullComponentCode = useMemo(
    () => generateFullComponent(effectiveVNode, overrides.renderer),
    [effectiveVNode, overrides.renderer],
  );
  const highlightedJsxSnippet = useMemo(
    () => Prism.highlight(jsxSnippetCode, getPrismGrammar("tsx"), "tsx"),
    [jsxSnippetCode],
  );
  const highlightedFullComponent = useMemo(
    () => Prism.highlight(fullComponentCode, getPrismGrammar("tsx"), "tsx"),
    [fullComponentCode],
  );

  // Rendered SVG tab + inspect hover
  // Must use deferredVNode so the overlay IR matches the preview's rendered SVG
  // during transitions (effectiveVNode can be ahead of the DOM during startTransition).
  const {
    highlightedSvg: highlightedRenderedSvg,
    setPreviewEl,
    setCodeEl,
  } = useSvgInspect(engine, status, deferredVNode, baseRenderOptions);

  return (
    <div className="playground-layout">
      <TemplateMenu templateKey={templateKey} onSelect={selectTemplate} />

      <aside className="panel controls-panel">
        <Section title="Adjust" defaultOpen={false}>
          <div className="compact-row">
            <NumberField
              id="tpl-canvas-width"
              label="Width"
              value={overrides.canvasWidth}
              min={200}
              max={1920}
              step={10}
              unit="px"
              onChange={(v) => setOverrideField("canvasWidth", v)}
            />
            <NumberField
              id="tpl-canvas-height"
              label="Height"
              value={overrides.canvasHeight}
              min={80}
              max={1080}
              step={10}
              unit="px"
              onChange={(v) => setOverrideField("canvasHeight", v)}
            />
          </div>
          <ColorField
            id="tpl-bg"
            label="Background"
            value={overrides.background}
            onChange={(v) => setOverrideField("background", v)}
          />
          <NumberField
            id="tpl-font-scale"
            label="Font Scale"
            value={overrides.fontSizeScale}
            min={0.5}
            max={2.0}
            step={0.1}
            unit="x"
            onChange={(v) => setOverrideField("fontSizeScale", v)}
          />
          <div className="compact-row">
            <CheckField
              id="tpl-text-color-enable"
              label="Override color"
              checked={overrides.textColor !== ""}
              onChange={(checked) => setOverrideField("textColor", checked ? "#ffffff" : "")}
            />
            {overrides.textColor !== "" && (
              <ColorField
                id="tpl-text-color"
                label="Text Color"
                value={overrides.textColor}
                onChange={(v) => setOverrideField("textColor", v)}
              />
            )}
          </div>
          <NumberField
            id="tpl-line-height"
            label="Line Height (0=original)"
            value={overrides.lineHeight}
            min={0}
            max={3.0}
            step={0.1}
            onChange={(v) => setOverrideField("lineHeight", v)}
          />
        </Section>

        <div className="mobile-viewer-secondary">
          <Section title="Render" defaultOpen>
            <SelectField
              id="tpl-renderer"
              label="Renderer API"
              value={overrides.renderer}
              onChange={(v) => setOverrideField("renderer", v as RendererMode)}
              options={[
                { value: "boundsvg", label: "BoundSvg component" },
                { value: "svg-hook", label: "useRenderToSvg" },
                { value: "png-hook", label: "useRenderToPng" },
              ]}
            />
            <SelectField
              id="tpl-text-rendering"
              label="Text Rendering"
              value={overrides.textPathMode}
              onChange={(v) => setOverrideField("textPathMode", v as TextPathModeOption)}
              options={[
                { value: "merged", label: "merged paths" },
                { value: "glyphs", label: "per glyph" },
              ]}
            />
            {overrides.renderer === "png-hook" && (
              <SelectField
                id="tpl-png-scale"
                label="PNG Scale"
                value={String(overrides.pngScale)}
                onChange={(v) => setOverrideField("pngScale", Number(v))}
                options={[
                  { value: "1", label: "1x" },
                  { value: "2", label: "2x" },
                ]}
              />
            )}
            <BBoxOverlayField
              id="tpl-debug"
              value={overrides.debugOverlayParts}
              onChange={(v) => setOverrideField("debugOverlayParts", v)}
            />
          </Section>
        </div>
      </aside>

      <section
        className={`panel preview-panel has-code-area layout-${codeLayout}${showCode ? " show-code" : ""}`}
      >
        <div className="preview-header">
          <div className="preview-header-meta">
            <h3>{template.title}</h3>
            <span>{template.description}</span>
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
              startTransition(() =>
                setCodeLayout((layoutMode) => (layoutMode === "tab" ? "panel" : "tab")),
              )
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
            <>
              <RenderSurface
                renderer={overrides.renderer}
                vnode={deferredVNode}
                renderOptions={deferredRenderOptions}
                isPending={isPending}
              />
              {template.licenseNotice ? (
                <div
                  style={{
                    borderTop: "1px solid var(--line)",
                    padding: "8px 14px",
                    color: "var(--muted)",
                    fontSize: 11,
                  }}
                >
                  {template.licenseNotice}
                </div>
              ) : null}
            </>
          )}
        </div>

        <TemplateCodeArea
          codeLayout={codeLayout}
          activeCodeTab={activeCodeTab}
          highlightedRenderedSvg={highlightedRenderedSvg}
          highlightedJsxSnippet={highlightedJsxSnippet}
          highlightedFullComponent={highlightedFullComponent}
          setCodeEl={setCodeEl}
          onSelectTab={(tab) => startTransition(() => setViewTab(tab))}
        />
      </section>
    </div>
  );
}
