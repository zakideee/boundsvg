import type { OverlayDisplayMode } from "../../../playground-shared/event-effects.js";
import {
  INSPECTION_FRAME_LABEL,
  INSPECTION_FRAME_OPTIONS,
  INSPECTION_FRAME_UNAVAILABLE,
} from "../../../playground-shared/inspection-frame.js";

/** Select the inspection geometry independently of scene rendering. */
export function InspectionFrameField({
  id,
  mode,
  disabled = false,
  onChange,
}: {
  id: string;
  mode: OverlayDisplayMode;
  disabled?: boolean;
  onChange: (mode: OverlayDisplayMode) => void;
}) {
  const descriptionId = `${id}-description`;
  return (
    <div className="control-group control-group-select">
      <div className="control-head">
        <label htmlFor={id}>{INSPECTION_FRAME_LABEL}</label>
      </div>
      <select
        id={id}
        value={mode}
        disabled={disabled}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.target.value as OverlayDisplayMode)}
      >
        {Object.entries(INSPECTION_FRAME_OPTIONS).map(([modeValue, option]) => (
          <option key={modeValue} value={modeValue}>
            {option.label}
          </option>
        ))}
      </select>
      <p id={descriptionId} className="inspection-frame-help">
        {disabled ? INSPECTION_FRAME_UNAVAILABLE : INSPECTION_FRAME_OPTIONS[mode].description}
      </p>
    </div>
  );
}
