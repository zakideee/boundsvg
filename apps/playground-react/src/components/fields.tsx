import type { DebugOverlayPart } from "@boundsvg/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BBOX_OVERLAY_OPTIONS, formatBBoxOverlaySummary } from "../lib/debug-overlay";

export function Section({
  title,
  defaultOpen = true,
  className,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`section${className ? ` ${className}` : ""}`}>
      <button type="button" className="section-header" onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span className="section-chevron">{open ? "\u25BE" : "\u25B8"}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="number-group">
      <label htmlFor={id}>{label}</label>
      <div className="number-input-wrap">
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const numValue = Number(e.target.value);
            if (!Number.isNaN(numValue)) {
              onChange(numValue);
            }
          }}
        />
        {unit && <span className="number-unit">{unit}</span>}
      </div>
    </div>
  );
}

export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const selectedOptionLabel = options.find((option) => option.value === value)?.label ?? value;
  return (
    <div
      className="control-group control-group-select"
      data-playground-locator-level="control"
      data-playground-locator-segment={`Control: ${label} = ${selectedOptionLabel} [${id}=${value}]`}
    >
      <div className="control-head">
        <label htmlFor={id}>{label}</label>
      </div>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function BBoxOverlayField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: readonly DebugOverlayPart[];
  onChange: (value: DebugOverlayPart[]) => void;
}) {
  const detailsRef = useCloseDetailsOnOutsidePointer();
  const selected = new Set(value);
  const togglePart = (part: DebugOverlayPart, checked: boolean): void => {
    const next = new Set(value);
    if (checked) {
      next.add(part);
    } else {
      next.delete(part);
    }
    onChange(BBOX_OVERLAY_OPTIONS.map((option) => option.value).filter((entry) => next.has(entry)));
  };

  return (
    <div className="control-group control-group-bbox">
      <div className="control-head">
        <span>BBox Overlay</span>
      </div>
      <details ref={detailsRef} className="bbox-overlay-menu">
        <summary id={id}>{`BBox Overlay: ${formatBBoxOverlaySummary(value)}`}</summary>
        <fieldset className="bbox-overlay-options" aria-labelledby={id}>
          {BBOX_OVERLAY_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={selected.has(option.value)}
                onChange={(event) => togglePart(option.value, event.target.checked)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      </details>
    </div>
  );
}

export function useCloseDetailsOnOutsidePointer() {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  return detailsRef;
}

export function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="color-group">
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <label htmlFor={id}>{label}</label>
      <span>{value}</span>
    </div>
  );
}

export function TextAreaField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="control-group control-group-textarea">
      <div className="control-head">
        <label htmlFor={id}>{label}</label>
      </div>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
    </div>
  );
}

export function CheckField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check-row" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Font Feature Settings — structured toggle grid
// ---------------------------------------------------------------------------

/** Well-known OpenType feature presets shown as toggle chips. */
const FEATURE_PRESETS: Array<{ tag: string; label: string }> = [
  { tag: "liga", label: "Ligatures" },
  { tag: "kern", label: "Kerning" },
  { tag: "tnum", label: "Tabular Nums" },
  { tag: "pnum", label: "Proportional Nums" },
  { tag: "lnum", label: "Lining Nums" },
  { tag: "onum", label: "Oldstyle Nums" },
  { tag: "zero", label: "Slashed Zero" },
  { tag: "smcp", label: "Small Caps" },
  { tag: "frac", label: "Fractions" },
  { tag: "salt", label: "Stylistic Alt" },
];

type FeatureState = "default" | "on" | "off";

/** Parse a CSS font-feature-settings string into a Map<tag, value>. */
function parseFFS(css: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!css.trim()) {
    return map;
  }
  for (const part of css.split(",")) {
    const matched = part.trim().match(/^['"](\w{4})['"]\s*(.*)$/);
    if (!matched) {
      continue;
    }
    const [, tag = "", rawGroup = ""] = matched;
    const rawVal = rawGroup.trim();
    let value = 1;
    if (rawVal === "off" || rawVal === "0") {
      value = 0;
    } else if (rawVal !== "" && rawVal !== "on") {
      const parsed = parseInt(rawVal, 10);
      if (!Number.isNaN(parsed)) {
        value = parsed;
      }
    }
    map.set(tag, value);
  }
  return map;
}

/** Serialize a Map<tag, value> back to CSS string, skipping entries with value -1 (default). */
function serializeFFS(map: Map<string, number>): string {
  const parts: string[] = [];
  for (const [tag, value] of map) {
    parts.push(`'${tag}' ${value}`);
  }
  return parts.join(", ");
}

export function FeatureSettingsField({
  value,
  supportedFeatures,
  onChange,
}: {
  value: string;
  /** Feature tags the current font supports. If undefined, all are enabled. */
  supportedFeatures?: string[];
  onChange: (value: string) => void;
}) {
  const [customTag, setCustomTag] = useState("");
  const parsed = useMemo(() => parseFFS(value), [value]);
  const supported = useMemo(
    () => (supportedFeatures ? new Set(supportedFeatures) : null),
    [supportedFeatures],
  );

  const getState = useCallback(
    (tag: string): FeatureState => {
      if (!parsed.has(tag)) {
        return "default";
      }
      const featureValue = parsed.get(tag);
      return featureValue !== undefined && featureValue > 0 ? "on" : "off";
    },
    [parsed],
  );

  const cycleState = useCallback(
    (tag: string) => {
      const current = getState(tag);
      const next = new Map(parsed);
      if (current === "default") {
        next.set(tag, 1);
      } else if (current === "on") {
        next.set(tag, 0);
      } else {
        next.delete(tag);
      }
      onChange(serializeFFS(next));
    },
    [parsed, getState, onChange],
  );

  const addCustomTag = useCallback(() => {
    const tag = customTag.trim().toLowerCase();
    if (tag.length !== 4 || parsed.has(tag)) {
      return;
    }
    const next = new Map(parsed);
    next.set(tag, 1);
    onChange(serializeFFS(next));
    setCustomTag("");
  }, [customTag, parsed, onChange]);

  // Separate preset tags from custom tags (tags in parsed but not in presets)
  const presetTags = new Set(FEATURE_PRESETS.map((preset) => preset.tag));
  const customTags = [...parsed.keys()].filter((tag) => !presetTags.has(tag));

  return (
    <div className="control-group control-group-features">
      <div className="control-head">
        <label htmlFor="ffs-custom-tag">Font Feature Settings</label>
      </div>
      <div className="ffs-grid">
        {FEATURE_PRESETS.map((preset) => {
          const state = getState(preset.tag);
          const unsupported = supported !== null && !supported.has(preset.tag);
          return (
            <button
              key={preset.tag}
              type="button"
              className={`ffs-chip ffs-chip--${state}${unsupported ? " ffs-chip--unsupported" : ""}`}
              onClick={() => cycleState(preset.tag)}
              disabled={unsupported}
              title={
                unsupported
                  ? `${preset.label} (${preset.tag}): not supported by this font`
                  : `${preset.label} (${preset.tag}): ${state}\nClick to cycle: default \u2192 on \u2192 off`
              }
            >
              <code>{preset.tag}</code>
              <span className="ffs-chip-state">
                {state === "on" ? "ON" : state === "off" ? "OFF" : "\u2013"}
              </span>
            </button>
          );
        })}
        {customTags.map((tag) => {
          const state = getState(tag);
          return (
            <button
              key={tag}
              type="button"
              className={`ffs-chip ffs-chip--${state}`}
              onClick={() => cycleState(tag)}
              title={`${tag}: ${state}`}
            >
              <code>{tag}</code>
              <span className="ffs-chip-state">
                {state === "on" ? "ON" : state === "off" ? "OFF" : "\u2013"}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ffs-custom-row">
        <input
          id="ffs-custom-tag"
          type="text"
          placeholder="tag (4 chars)"
          maxLength={4}
          value={customTag}
          onChange={(e) => setCustomTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              addCustomTag();
            }
          }}
        />
        <button
          type="button"
          className="ffs-add-btn"
          onClick={addCustomTag}
          disabled={customTag.trim().length !== 4}
        >
          +
        </button>
      </div>
    </div>
  );
}
