import { nativeAnimatedScene } from "./native-animated.js";
import { nativeGlyphSelectionScene } from "./native-glyph-selection.js";
import { nativeInlineRectScene } from "./native-inline-rect.js";
import { nativeLayeredPartsScene } from "./native-layered-parts.js";
import { nativeRichInlineScene } from "./native-rich-inline.js";
import { nativeSpringEasingScene } from "./native-spring-easing.js";
import { nativeStepEasingScene } from "./native-step-easing.js";
import { nativeTextDecorationScene } from "./native-text-decoration.js";
import { nativeTextOnPathScene } from "./native-text-on-path.js";
import { nativeTextUnitAnimationScene } from "./native-text-unit-animation.js";
import { nativeTypingCompositionScene } from "./native-typing-composition.js";
import { nativeVerticalRubyScene } from "./native-vertical-ruby.js";
import type { ConformanceScene } from "./types.js";

export type { ConformanceScene } from "./types.js";

/**
 * Render-conformance scenes covering engine-specific paths (vertical/ruby,
 * rich inline, glyph source metadata, layered parts). Every suite (SVG
 * snapshot, IR assertion, PNG hash) iterates this list.
 */
export const CONFORMANCE_SCENES: readonly ConformanceScene[] = [
  nativeVerticalRubyScene,
  nativeRichInlineScene,
  nativeGlyphSelectionScene,
  nativeLayeredPartsScene,
  nativeAnimatedScene,
  nativeStepEasingScene,
  nativeSpringEasingScene,
  nativeInlineRectScene,
  nativeTextDecorationScene,
  nativeTypingCompositionScene,
  nativeTextUnitAnimationScene,
  nativeTextOnPathScene,
];
