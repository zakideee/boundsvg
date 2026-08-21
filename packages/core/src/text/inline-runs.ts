import { DEFAULT_FONT_WEIGHT } from "../font/types.js";
import type {
  InlineBoxVNode,
  InlineRectVNode,
  InlineVNode,
  RtVNode,
  RubyVNode,
  TextOnPathVNode,
  TextVNode,
  VNode,
} from "../vnode/types.js";
import { assertVNodeRichTextDepth } from "./rich-text-limits.js";
import type {
  FlattenedRichText,
  RichTextNode,
  RichTextStyle,
  TextDecoration,
  TextDecorationLine,
  TextRun,
  TextRunStyle,
} from "./types.js";

const TEXT_DECORATION_LINE_ORDER: readonly TextDecorationLine[] = [
  "underline",
  "overline",
  "line-through",
];

const TEXT_DECORATION_OWNER_IDENTITIES = new WeakMap<object, number>();
let nextTextDecorationOwnerIdentity = 1;

function textDecorationOwnerIdentity(value: TextDecoration | undefined): number {
  if (value === undefined || value === "none") {
    return 0;
  }
  const existingIdentity = TEXT_DECORATION_OWNER_IDENTITIES.get(value);
  if (existingIdentity !== undefined) {
    return existingIdentity;
  }
  const identity = nextTextDecorationOwnerIdentity;
  nextTextDecorationOwnerIdentity += 1;
  TEXT_DECORATION_OWNER_IDENTITIES.set(value, identity);
  return identity;
}

function normalizeTextDecoration(value: TextDecoration | undefined): TextDecoration {
  if (value === undefined || value === "none") {
    return "none";
  }
  const authoredLines = Array.isArray(value.line) ? value.line : [value.line];
  const lines = [
    ...TEXT_DECORATION_LINE_ORDER.flatMap((line) =>
      authoredLines.filter((authoredLine) => authoredLine === line),
    ),
    ...authoredLines.filter((line) => !TEXT_DECORATION_LINE_ORDER.includes(line)),
  ];
  return {
    ...value,
    line: lines,
    color: value.color,
    style: value.style,
    thicknessPx: value.thicknessPx,
    offsetPx: value.offsetPx,
  };
}

function pushStyleFontAliases(style: RichTextStyle, target: string[]): void {
  target.push(style.font, ...(style.fallback ?? []));
}

function makeStyleKey(style: TextRunStyle): string {
  return JSON.stringify({
    font: style.font,
    fallback: style.fallback ?? null,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontVariationSettings: style.fontVariationSettings ?? null,
    fontFeatureSettings: style.fontFeatureSettings ?? null,
    color: style.color,
    textStrokes: style.textStrokes ?? [],
    textShadows: style.textShadows ?? [],
    language: style.language ?? null,
    fontSizePx: style.fontSizePx,
    lineHeight: style.lineHeight ?? null,
    lineHeightPx: style.lineHeightPx ?? null,
    letterSpacingPx: style.letterSpacingPx,
    textOrientation: style.textOrientation ?? null,
    textDecoration: style.textDecoration ?? "none",
    textDecorationOwnerIdentity: textDecorationOwnerIdentity(style.textDecoration),
  });
}

function resolveRootTextStrokes(
  textNode: TextVNode | TextOnPathVNode,
): RichTextStyle["textStrokes"] {
  const props = textNode.props;
  if (props.textStrokes !== undefined) {
    return props.textStrokes;
  }
  if (props.textStroke === undefined || props.textStroke === "") {
    return textNode.type === "TextOnPath" ? [] : undefined;
  }
  return [
    {
      color: props.textStroke,
      widthPx: props.textStrokeWidth ?? 1,
      linejoin: props.textStrokeLinejoin,
      linecap: props.textStrokeLinecap,
      dasharray: props.textStrokeDasharray,
      miterlimit: props.textStrokeMiterlimit,
    },
  ];
}

function normalizeLanguage(value: unknown): "ja" | "en" | "auto" | undefined {
  if (value === "ja" || value === "en" || value === "auto") {
    return value;
  }
  return undefined;
}

function normalizeTextOrientation(value: unknown): "mixed" | "upright" | undefined {
  if (value === "mixed" || value === "upright") {
    return value;
  }
  return undefined;
}

function normalizeTextCombine(value: unknown): "none" | "all" | undefined {
  if (value === "none" || value === "all") {
    return value;
  }
  return undefined;
}

function normalizeRubyAlign(
  value: unknown,
): "start" | "center" | "space-between" | "space-around" | undefined {
  if (
    value === "start" ||
    value === "center" ||
    value === "space-between" ||
    value === "space-around"
  ) {
    return value;
  }
  return undefined;
}

function normalizeRubyPosition(
  value: unknown,
): "over" | "under" | "alternate" | "inter-character" | undefined {
  if (
    value === "over" ||
    value === "under" ||
    value === "alternate" ||
    value === "inter-character"
  ) {
    return value;
  }
  return undefined;
}

function normalizeRubyLineSizing(value: unknown): "stable" | "css" | undefined {
  if (value === "stable" || value === "css") {
    return value;
  }
  return undefined;
}

type RichChild = string | InlineVNode | InlineBoxVNode | InlineRectVNode | RubyVNode | RtVNode;

function resolveTextBaseStyle(
  textNode: TextVNode | TextOnPathVNode,
  canvasLanguage?: "ja" | "en" | "auto",
): RichTextStyle {
  const props = textNode.props;
  return {
    font: props.font,
    fallback: props.fallback,
    fontWeight: props.fontWeight ?? DEFAULT_FONT_WEIGHT,
    fontStyle: props.fontStyle ?? "normal",
    fontVariationSettings: props.fontVariationSettings,
    fontFeatureSettings: props.fontFeatureSettings,
    color: props.color ?? "#000000",
    textStrokes: resolveRootTextStrokes(textNode),
    textShadows: props.textShadows ?? (textNode.type === "TextOnPath" ? [] : undefined),
    language: normalizeLanguage(props.language) ?? canvasLanguage,
    fontSizePx: props.fontSizePx,
    lineHeight: textNode.type === "Text" ? textNode.props.lineHeight : undefined,
    lineHeightPx: textNode.type === "Text" ? textNode.props.lineHeightPx : undefined,
    letterSpacingPx: props.letterSpacingPx ?? 0,
    textOrientation:
      textNode.type === "Text"
        ? (normalizeTextOrientation(textNode.props.textOrientation) ?? "mixed")
        : "mixed",
    textDecoration: normalizeTextDecoration(textNode.props.textDecoration),
  };
}

function resolveInlineStyle(parent: RichTextStyle, inlineNode: InlineVNode): RichTextStyle {
  const props = inlineNode.props;
  return {
    font: props.font ?? parent.font,
    fallback: props.fallback ?? parent.fallback,
    fontWeight: props.fontWeight ?? parent.fontWeight,
    fontStyle: props.fontStyle ?? parent.fontStyle,
    fontVariationSettings: props.fontVariationSettings ?? parent.fontVariationSettings,
    fontFeatureSettings: props.fontFeatureSettings ?? parent.fontFeatureSettings,
    color: props.color ?? parent.color,
    textStrokes: props.textStrokes ?? parent.textStrokes,
    textShadows: props.textShadows ?? parent.textShadows,
    language: normalizeLanguage(props.language) ?? parent.language,
    fontSizePx: props.fontSizePx ?? parent.fontSizePx,
    lineHeight: parent.lineHeight,
    lineHeightPx: parent.lineHeightPx,
    letterSpacingPx: props.letterSpacingPx ?? parent.letterSpacingPx,
    textOrientation: normalizeTextOrientation(props.textOrientation) ?? parent.textOrientation,
    textDecoration:
      props.textDecoration === undefined
        ? parent.textDecoration
        : normalizeTextDecoration(props.textDecoration),
  };
}

function resolveInlineBoxStyle(parent: RichTextStyle, node: InlineBoxVNode): RichTextStyle {
  const props = node.props;
  return {
    font: props.font ?? parent.font,
    fallback: props.fallback ?? parent.fallback,
    fontWeight: props.fontWeight ?? parent.fontWeight,
    fontStyle: props.fontStyle ?? parent.fontStyle,
    fontVariationSettings: parent.fontVariationSettings,
    fontFeatureSettings: parent.fontFeatureSettings,
    color: props.color ?? parent.color,
    textStrokes: parent.textStrokes,
    textShadows: parent.textShadows,
    language: normalizeLanguage(props.language) ?? parent.language,
    fontSizePx: props.fontSizePx ?? parent.fontSizePx,
    lineHeight: parent.lineHeight,
    lineHeightPx: parent.lineHeightPx,
    letterSpacingPx: props.letterSpacingPx ?? parent.letterSpacingPx,
    textOrientation: parent.textOrientation,
    textDecoration:
      props.textDecoration === undefined
        ? parent.textDecoration
        : normalizeTextDecoration(props.textDecoration),
  };
}

function resolveRtStyle(parent: RichTextStyle, rtNode: RtVNode): RichTextStyle {
  const props = rtNode.props;
  return {
    font: props.font ?? parent.font,
    fallback: props.fallback ?? parent.fallback,
    fontWeight: props.fontWeight ?? parent.fontWeight,
    fontStyle: props.fontStyle ?? parent.fontStyle,
    fontVariationSettings: props.fontVariationSettings ?? parent.fontVariationSettings,
    fontFeatureSettings: props.fontFeatureSettings ?? parent.fontFeatureSettings,
    color: props.color ?? parent.color,
    textStrokes: parent.textStrokes,
    textShadows: parent.textShadows,
    language: normalizeLanguage(props.language) ?? parent.language,
    fontSizePx: props.fontSizePx ?? parent.fontSizePx * 0.5,
    lineHeight: props.lineHeight ?? 1,
    lineHeightPx: props.lineHeightPx,
    letterSpacingPx: props.letterSpacingPx ?? parent.letterSpacingPx,
    textOrientation: normalizeTextOrientation(props.textOrientation) ?? parent.textOrientation,
    textDecoration: normalizeTextDecoration(props.textDecoration),
  };
}

function collectFontAliasesFromChildren(
  children: RichChild[],
  style: RichTextStyle,
  target: string[],
): boolean {
  let hasText = false;
  for (const child of children) {
    hasText = collectFontAliasesFromChild(child, style, target) || hasText;
  }
  return hasText;
}

function collectFontAliasesFromChild(
  child: RichChild,
  style: RichTextStyle,
  target: string[],
): boolean {
  if (typeof child === "string") {
    if (!child) {
      return false;
    }
    pushStyleFontAliases(style, target);
    return true;
  }

  if (child.type === "Inline") {
    return collectFontAliasesFromChildren(child.children, resolveInlineStyle(style, child), target);
  }
  if (child.type === "InlineBox") {
    return collectFontAliasesFromChildren(
      child.children,
      resolveInlineBoxStyle(style, child),
      target,
    );
  }
  if (child.type === "Ruby") {
    return collectFontAliasesFromRuby(child, style, target);
  }
  if (child.type === "InlineRect") {
    return false;
  }
  return false;
}

function collectFontAliasesFromRuby(
  rubyNode: RubyVNode,
  style: RichTextStyle,
  target: string[],
): boolean {
  let hasText = false;
  for (const rubyChild of rubyNode.children) {
    const childHasText =
      typeof rubyChild !== "string" && rubyChild.type === "Rt"
        ? collectFontAliasesFromChildren(
            rubyChild.children,
            resolveRtStyle(style, rubyChild),
            target,
          )
        : collectFontAliasesFromChildren([rubyChild], style, target);
    hasText = childHasText || hasText;
  }
  return hasText;
}

function styleEquals(left: RichTextStyle, right: RichTextStyle): boolean {
  return makeStyleKey(left) === makeStyleKey(right);
}

function layoutStyleEquals(left: RichTextStyle, right: RichTextStyle): boolean {
  return (
    left.font === right.font &&
    JSON.stringify(left.fallback ?? []) === JSON.stringify(right.fallback ?? []) &&
    left.fontWeight === right.fontWeight &&
    left.fontStyle === right.fontStyle &&
    left.fontSizePx === right.fontSizePx &&
    left.fontVariationSettings === right.fontVariationSettings &&
    left.fontFeatureSettings === right.fontFeatureSettings &&
    left.color === right.color &&
    JSON.stringify(left.textStrokes ?? []) === JSON.stringify(right.textStrokes ?? []) &&
    JSON.stringify(left.textShadows ?? []) === JSON.stringify(right.textShadows ?? []) &&
    left.language === right.language &&
    left.lineHeight === right.lineHeight &&
    left.lineHeightPx === right.lineHeightPx &&
    left.letterSpacingPx === right.letterSpacingPx &&
    left.textOrientation === right.textOrientation
  );
}

function pushRun(target: TextRun[], text: string, style: TextRunStyle): void {
  if (!text) {
    return;
  }
  const styleKey = makeStyleKey(style);
  const last = target[target.length - 1];
  if (!last) {
    target.push({ text, style });
    return;
  }
  if (makeStyleKey(last.style) === styleKey) {
    last.text += text;
    return;
  }
  target.push({ text, style });
}

function pushRichNode(
  target: RichTextNode[],
  text: string,
  options: { style: RichTextStyle; rootStyle: RichTextStyle; combine: boolean },
): void {
  const { style, rootStyle, combine } = options;
  if (!text) {
    return;
  }

  const rootHasTextEffects =
    (rootStyle.textStrokes?.length ?? 0) > 0 || (rootStyle.textShadows?.length ?? 0) > 0;

  const node: RichTextNode = combine
    ? { kind: "combine", text, style }
    : styleEquals(style, rootStyle) && style.textDecoration === "none" && !rootHasTextEffects
      ? { kind: "text", text }
      : { kind: "span", text, style };

  const last = target[target.length - 1];
  if (
    last &&
    node.kind !== "combine" &&
    last.kind === node.kind &&
    ((last.kind === "text" && node.kind === "text") ||
      (last.kind !== "text" &&
        node.kind !== "text" &&
        "style" in last &&
        "style" in node &&
        makeStyleKey(last.style) === makeStyleKey(node.style)))
  ) {
    last.text += text;
    return;
  }

  target.push(node);
}

function collectPlainText(
  children: Array<string | InlineVNode | InlineRectVNode | RubyVNode>,
  style: RichTextStyle,
): { text: string; style: RichTextStyle; runs: TextRun[] } | null {
  const parts: string[] = [];
  const runs: TextRun[] = [];
  for (const child of children) {
    if (typeof child === "string") {
      parts.push(child);
      pushRun(runs, child, style);
      continue;
    }
    if (child.type !== "Inline") {
      return null;
    }
    const nested = collectPlainText(child.children, resolveInlineStyle(style, child));
    if (!nested || !layoutStyleEquals(nested.style, style)) {
      return null;
    }
    for (const run of nested.runs) {
      pushRun(runs, run.text, run.style);
    }
    parts.push(nested.text);
  }
  return { text: parts.join(""), style, runs };
}

type CollectContext = {
  rootStyle: RichTextStyle;
  targetRuns: TextRun[];
  targetRichNodes: RichTextNode[];
  writingMode: "horizontal-tb" | "vertical-rl";
  inlineRectState: {
    textNodeId: string;
    nextIndex: number;
    animations: Record<string, NonNullable<InlineRectVNode["props"]["animate"]>>;
  };
  decorationSpanState: {
    nextIndex: number;
    animations: Record<string, NonNullable<InlineVNode["props"]["animate"]>>;
  };
};

function processInlineRectChild(child: InlineRectVNode, ctx: CollectContext): void {
  const fragmentId = `${ctx.inlineRectState.textNodeId}:inline-rect:${ctx.inlineRectState.nextIndex}`;
  ctx.inlineRectState.nextIndex += 1;
  if (child.props.animate) {
    ctx.inlineRectState.animations[fragmentId] = child.props.animate;
  }
  ctx.targetRichNodes.push({
    kind: "inlineRect",
    fragmentId,
    inlineSizePx: child.props.inlineSizePx,
    blockSizePx: child.props.blockSizePx,
    advancePx: child.props.advancePx,
    blockAlign: child.props.blockAlign,
    color: child.props.color,
    borderRadiusPx: child.props.borderRadiusPx,
    opacity: child.props.opacity,
    paintOrder: child.props.paintOrder,
  });
}

function hasDecorationProps(props: InlineVNode["props"]): boolean {
  return (
    props.background !== undefined ||
    props.borderColor !== undefined ||
    props.borderWidth !== undefined ||
    props.borderRadius !== undefined ||
    props.paddingInline !== undefined
  );
}

function processInlineChild(
  child: InlineVNode,
  style: RichTextStyle,
  ctx: CollectContext,
): { hasInline: boolean; hasRichContent: boolean } {
  const { rootStyle, targetRuns, targetRichNodes, writingMode } = ctx;
  const nextStyle = resolveInlineStyle(style, child);

  // Decorated Inline: emit as decoratedSpan container (fragmentable decoration).
  // Ruby children inside a decorated Inline are passed through to Rust,
  // which rejects them with a warning.
  if (hasDecorationProps(child.props)) {
    const childRichNodes: RichTextNode[] = [];
    const childRuns: TextRun[] = [];
    collectRichNodesFromChildren(child.children, nextStyle, {
      rootStyle: nextStyle,
      targetRuns: childRuns,
      targetRichNodes: childRichNodes,
      writingMode,
      inlineRectState: ctx.inlineRectState,
      decorationSpanState: ctx.decorationSpanState,
    });
    for (const run of childRuns) {
      pushRun(targetRuns, run.text, run.style);
    }
    // Keys are only assigned to animated spans so unanimated output stays
    // byte-identical to the pre-animation format.
    const spanKey =
      child.props.animate !== undefined
        ? `${ctx.inlineRectState.textNodeId}:dspan:${ctx.decorationSpanState.nextIndex}`
        : undefined;
    ctx.decorationSpanState.nextIndex += 1;
    if (spanKey !== undefined && child.props.animate !== undefined) {
      ctx.decorationSpanState.animations[spanKey] = child.props.animate;
    }
    targetRichNodes.push({
      kind: "decoratedSpan",
      style: nextStyle,
      children: childRichNodes,
      paddingInline: child.props.paddingInline,
      background: child.props.background,
      borderColor: child.props.borderColor,
      borderWidth: child.props.borderWidth,
      borderRadius: child.props.borderRadius,
      ...(spanKey !== undefined ? { spanKey } : {}),
    });
    return { hasInline: true, hasRichContent: true };
  }

  const combine =
    writingMode === "vertical-rl"
      ? normalizeTextCombine(child.props.textCombineUpright) === "all"
      : false;

  if (combine) {
    const combined = collectPlainText(child.children, nextStyle);
    if (combined) {
      for (const run of combined.runs) {
        pushRun(targetRuns, run.text, run.style);
      }
      targetRichNodes.push({
        kind: "combine",
        text: combined.text,
        style: combined.style,
        decorationRuns: combined.runs,
      });
      return { hasInline: true, hasRichContent: true };
    }
  }

  const nested = collectRichNodesFromChildren(child.children, nextStyle, ctx);
  const hasRichContent = !layoutStyleEquals(nextStyle, rootStyle) || nested.hasRichContent;
  return { hasInline: true, hasRichContent };
}

type ProcessRubyOptions = Pick<
  CollectContext,
  "writingMode" | "inlineRectState" | "decorationSpanState"
> & {
  style: RichTextStyle;
};

function processRubyCore(
  rubyVNode: RubyVNode,
  options: ProcessRubyOptions,
): {
  rubyPosition: "over" | "under" | "alternate" | "inter-character";
  rubyAlign: "start" | "center" | "space-between" | "space-around" | undefined;
  rubyGapPx: number | undefined;
  rubyOffsetPx: number | undefined;
  rubyLineSizing: "stable" | "css" | undefined;
  baseRuns: TextRun[];
  baseRich: RichTextNode[];
  rtLevels: RichTextNode[][];
} {
  const { style, writingMode, inlineRectState, decorationSpanState } = options;
  const rubyPosition = normalizeRubyPosition(rubyVNode.props.rubyPosition) ?? "alternate";
  const rubyAlign = normalizeRubyAlign(rubyVNode.props.rubyAlign);
  const rubyGapPx = rubyVNode.props.rubyGapPx;
  const rubyOffsetPx = rubyVNode.props.rubyOffsetPx;
  const rubyLineSizing = normalizeRubyLineSizing(rubyVNode.props.rubyLineSizing);
  const baseRuns: TextRun[] = [];
  const baseRich: RichTextNode[] = [];
  const rtNodes: RtVNode[] = [];

  for (const child of rubyVNode.children) {
    if (typeof child !== "string" && child.type === "Rt") {
      rtNodes.push(child);
      continue;
    }
    collectRichNodesFromChildren([child], style, {
      rootStyle: style,
      targetRuns: baseRuns,
      targetRichNodes: baseRich,
      writingMode,
      inlineRectState,
      decorationSpanState,
    });
  }

  const rtLevels = rtNodes.map((rtNode) => {
    const rtStyle = resolveRtStyle(style, rtNode);
    const rtRich: RichTextNode[] = [];
    collectRichNodesFromChildren(rtNode.children, rtStyle, {
      rootStyle: style,
      targetRuns: [],
      targetRichNodes: rtRich,
      writingMode,
      inlineRectState,
      decorationSpanState,
    });
    return rtRich;
  });

  return {
    rubyPosition,
    rubyAlign,
    rubyGapPx,
    rubyOffsetPx,
    rubyLineSizing,
    baseRuns,
    baseRich,
    rtLevels,
  };
}

function processRubyChild(child: RubyVNode, style: RichTextStyle, ctx: CollectContext): void {
  const { targetRuns, targetRichNodes } = ctx;
  const result = processRubyCore(child, {
    style,
    writingMode: ctx.writingMode,
    inlineRectState: ctx.inlineRectState,
    decorationSpanState: ctx.decorationSpanState,
  });

  for (const run of result.baseRuns) {
    pushRun(targetRuns, run.text, run.style);
  }

  targetRichNodes.push({
    kind: "ruby",
    rubyPosition: result.rubyPosition,
    rubyAlign: result.rubyAlign,
    rubyGapPx: result.rubyGapPx,
    rubyOffsetPx: result.rubyOffsetPx,
    rubyLineSizing: result.rubyLineSizing,
    style,
    base: result.baseRich,
    rt: result.rtLevels[0] ?? [],
    rtLevels: result.rtLevels,
  });
}

function processInlineBoxChild(
  child: InlineBoxVNode,
  parentStyle: RichTextStyle,
  ctx: CollectContext,
): void {
  const { rootStyle, targetRuns, targetRichNodes } = ctx;
  const boxStyle = resolveInlineBoxStyle(parentStyle, child);
  const childRichNodes: RichTextNode[] = [];
  const childRuns: TextRun[] = [];

  for (const grandchild of child.children) {
    if (typeof grandchild === "string") {
      pushRun(childRuns, grandchild, boxStyle);
      pushRichNode(childRichNodes, grandchild, {
        style: boxStyle,
        rootStyle,
        combine: false,
      });
    } else if (grandchild.type === "Inline") {
      processInlineChild(grandchild, boxStyle, {
        rootStyle,
        targetRuns: childRuns,
        targetRichNodes: childRichNodes,
        writingMode: ctx.writingMode,
        inlineRectState: ctx.inlineRectState,
        decorationSpanState: ctx.decorationSpanState,
      });
    } else if (grandchild.type === "InlineBox") {
      processInlineBoxChild(grandchild, boxStyle, {
        ...ctx,
        targetRuns: childRuns,
        targetRichNodes: childRichNodes,
      });
    } else if (grandchild.type === "Ruby") {
      processRubyIntoInlineBox(grandchild, boxStyle, {
        ...ctx,
        boxRuns: childRuns,
        boxRichNodes: childRichNodes,
      });
    } else if (grandchild.type === "InlineRect") {
      processInlineRectChild(grandchild, {
        ...ctx,
        targetRuns: childRuns,
        targetRichNodes: childRichNodes,
      });
    }
  }

  // Append child runs to the parent runs (for plain text extraction)
  for (const run of childRuns) {
    pushRun(targetRuns, run.text, run.style);
  }

  // Keys are only assigned to animated boxes so unanimated output stays
  // byte-identical to the pre-animation format.
  const spanKey =
    child.props.animate !== undefined
      ? `${ctx.inlineRectState.textNodeId}:ibox:${ctx.decorationSpanState.nextIndex}`
      : undefined;
  ctx.decorationSpanState.nextIndex += 1;
  if (spanKey !== undefined && child.props.animate !== undefined) {
    ctx.decorationSpanState.animations[spanKey] = child.props.animate;
  }
  targetRichNodes.push({
    kind: "inlineBox",
    style: boxStyle,
    children: childRichNodes,
    paddingInline: child.props.paddingInline,
    background: child.props.background,
    borderColor: child.props.borderColor,
    borderWidth: child.props.borderWidth,
    borderRadius: child.props.borderRadius,
    ...(spanKey !== undefined ? { spanKey } : {}),
  });
}

function processRubyIntoInlineBox(
  rubyChild: RubyVNode,
  parentStyle: RichTextStyle,
  ctx: CollectContext & { boxRuns: TextRun[]; boxRichNodes: RichTextNode[] },
): void {
  const { boxRuns, boxRichNodes } = ctx;
  const result = processRubyCore(rubyChild, {
    style: parentStyle,
    writingMode: ctx.writingMode,
    inlineRectState: ctx.inlineRectState,
    decorationSpanState: ctx.decorationSpanState,
  });

  for (const run of result.baseRuns) {
    pushRun(boxRuns, run.text, run.style);
  }

  boxRichNodes.push({
    kind: "ruby",
    rubyPosition: result.rubyPosition,
    rubyAlign: result.rubyAlign,
    rubyGapPx: result.rubyGapPx,
    rubyOffsetPx: result.rubyOffsetPx,
    rubyLineSizing: result.rubyLineSizing,
    style: parentStyle,
    base: result.baseRich,
    rt: result.rtLevels[0] ?? [],
    rtLevels: result.rtLevels,
  });
}

function collectRichNodesFromChildren(
  children: RichChild[],
  style: RichTextStyle,
  ctx: CollectContext,
): { hasInline: boolean; hasRichContent: boolean } {
  const { rootStyle, targetRuns, targetRichNodes } = ctx;
  let hasInline = false;
  let hasRichContent = false;

  for (const child of children) {
    if (typeof child === "string") {
      pushRun(targetRuns, child, style);
      pushRichNode(targetRichNodes, child, { style, rootStyle, combine: false });
      continue;
    }

    if (child.type === "Inline") {
      const result = processInlineChild(child, style, ctx);
      hasInline = true;
      if (result.hasRichContent) {
        hasRichContent = true;
      }
      continue;
    }

    if (child.type === "InlineBox") {
      hasInline = true;
      hasRichContent = true;
      processInlineBoxChild(child, style, ctx);
      continue;
    }

    if (child.type === "Ruby") {
      hasInline = true;
      hasRichContent = true;
      processRubyChild(child, style, ctx);
      continue;
    }

    if (child.type === "InlineRect") {
      hasInline = true;
      hasRichContent = true;
      processInlineRectChild(child, ctx);
    }
  }

  return { hasInline, hasRichContent };
}

type FlattenedRichTextWithInlineRects = FlattenedRichText & {
  inlineRectAnimations: Record<string, NonNullable<InlineRectVNode["props"]["animate"]>>;
  inlineDecorationAnimations: Record<string, NonNullable<InlineVNode["props"]["animate"]>>;
};

export function flattenRichText(
  textNode: VNode,
  canvasLanguage?: "ja" | "en" | "auto",
  textNodeId?: string,
): FlattenedRichTextWithInlineRects {
  if (textNode.type !== "Text") {
    return {
      text: "",
      runs: [],
      richText: undefined,
      hasInline: false,
      hasRichContent: false,
      inlineRectAnimations: {},
      inlineDecorationAnimations: {},
    };
  }

  assertVNodeRichTextDepth(textNode);

  const baseStyle = resolveTextBaseStyle(textNode, canvasLanguage);
  const runs: TextRun[] = [];
  const richText: RichTextNode[] = [];
  const writingMode = textNode.props.writingMode ?? "horizontal-tb";
  const inlineRectState = {
    textNodeId: textNodeId ?? textNode.props.id ?? "<Text>",
    nextIndex: 0,
    animations: {},
  };
  const decorationSpanState = {
    nextIndex: 0,
    animations: {},
  };
  const nested = collectRichNodesFromChildren(textNode.children, baseStyle, {
    rootStyle: baseStyle,
    targetRuns: runs,
    targetRichNodes: richText,
    writingMode,
    inlineRectState,
    decorationSpanState,
  });

  return {
    text: runs.map((run) => run.text).join(""),
    runs,
    richText: nested.hasRichContent ? richText : undefined,
    hasInline: nested.hasInline,
    hasRichContent: nested.hasRichContent,
    inlineRectAnimations: inlineRectState.animations,
    inlineDecorationAnimations: decorationSpanState.animations,
  };
}

/** Flatten the shaping and paint Inline grammar accepted by TextOnPath. */
export function flattenTextOnPathRuns(
  textNode: TextOnPathVNode,
  canvasLanguage?: "ja" | "en" | "auto",
): FlattenedRichText {
  assertVNodeRichTextDepth(textNode);
  const baseStyle = resolveTextBaseStyle(textNode, canvasLanguage);
  const runs: TextRun[] = [];
  const richText: RichTextNode[] = [];
  const nested = collectRichNodesFromChildren(textNode.children, baseStyle, {
    rootStyle: baseStyle,
    targetRuns: runs,
    targetRichNodes: richText,
    writingMode: "horizontal-tb",
    inlineRectState: {
      textNodeId: textNode.props.id ?? "<TextOnPath>",
      nextIndex: 0,
      animations: {},
    },
    decorationSpanState: { nextIndex: 0, animations: {} },
  });
  return {
    text: runs.map((run) => run.text).join(""),
    runs,
    richText: undefined,
    hasInline: nested.hasInline,
    hasRichContent: nested.hasRichContent,
  };
}

function makeTextPathShapingKey(style: TextRunStyle): string {
  return JSON.stringify({
    font: style.font,
    fallback: style.fallback ?? [],
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontVariationSettings: style.fontVariationSettings ?? null,
    fontFeatureSettings: style.fontFeatureSettings ?? null,
    language: style.language ?? "auto",
    fontSizePx: style.fontSizePx,
    letterSpacingPx: style.letterSpacingPx,
  });
}

function makeTextPathPaintKey(style: TextRunStyle): string {
  return JSON.stringify({
    color: style.color,
    textStrokes: style.textStrokes ?? [],
    textShadows: style.textShadows ?? [],
  });
}

export function countTextOnPathRunResources(runs: readonly TextRun[]): {
  shapingRunCount: number;
  paintRangeCount: number;
  paintedLayerEstimate: number;
} {
  let shapingRunCount = 0;
  let paintRangeCount = 0;
  let paintedLayerEstimate = 0;
  let previousShapingKey: string | undefined;
  let previousPaintKey: string | undefined;
  for (const run of runs) {
    if (run.text.length === 0) {
      continue;
    }
    const shapingKey = makeTextPathShapingKey(run.style);
    if (shapingKey !== previousShapingKey) {
      shapingRunCount += 1;
      previousShapingKey = shapingKey;
    }
    const paintKey = makeTextPathPaintKey(run.style);
    if (paintKey !== previousPaintKey) {
      paintRangeCount += 1;
      paintedLayerEstimate +=
        1 + (run.style.textStrokes?.length ?? 0) + (run.style.textShadows?.length ?? 0);
      previousPaintKey = paintKey;
    }
  }
  return { shapingRunCount, paintRangeCount, paintedLayerEstimate };
}

export function collectTextFontAliases(
  textNode: VNode,
  canvasLanguage?: "ja" | "en" | "auto",
): { aliases: string[]; hasText: boolean } {
  if (textNode.type !== "Text" && textNode.type !== "TextOnPath") {
    return { aliases: [], hasText: false };
  }
  assertVNodeRichTextDepth(textNode);
  const fontAliases: string[] = [];
  const hasText = collectFontAliasesFromChildren(
    textNode.children,
    resolveTextBaseStyle(textNode, canvasLanguage),
    fontAliases,
  );
  return {
    aliases: fontAliases,
    hasText,
  };
}
