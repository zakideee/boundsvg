import {
  buildVerticalRichEllipsisVNode,
  VERTICAL_RICH_ELLIPSIS_SOURCE,
  verticalRichEllipsisPresetMetadata,
} from "../../../playground-shared/vertical-rich-ellipsis-preset.js";
import type { Preset } from "../types";

/** Core playground entry for the shared vertical rich-text ellipsis scene. */
export const verticalRichEllipsisPreset: Preset = {
  title: verticalRichEllipsisPresetMetadata.label,
  description: verticalRichEllipsisPresetMetadata.description,
  source: VERTICAL_RICH_ELLIPSIS_SOURCE,
  build: buildVerticalRichEllipsisVNode,
};
