const LOCATOR_SEGMENT_ATTRIBUTE = "data-playground-locator-segment";
const LOCATOR_LEVEL_ATTRIBUTE = "data-playground-locator-level";
const LOCATOR_TARGET_SELECTOR = [
  `[${LOCATOR_SEGMENT_ATTRIBUTE}]`,
  ".preview-header h3",
  ".preview-view-tabs button",
  ".code-area-tabs button",
  ".code-tab",
  "select",
].join(",");

type LocatorLevel = "category" | "page" | "source" | "sample" | "tab" | "control";

export type PlaygroundLocatorCopyOptions = {
  playground: "playground-core" | "playground-react" | "playground-cli";
};

export type SvgLocatorDetails = {
  index: number;
  total: number;
  viewBox: string;
  x: number;
  y: number;
  nodeId?: string;
  partId?: string;
};

export function formatPlaygroundLocator(playground: string, segments: readonly string[]): string {
  const uniqueSegments = segments.filter(
    (segment, segmentIndex) => segment.length > 0 && segments.indexOf(segment) === segmentIndex,
  );
  return [playground, ...uniqueSegments].join(" > ");
}

export function formatSvgLocatorSegment(details: SvgLocatorDetails): string {
  const identity = [`SVG: ${details.index}/${details.total}`, `viewBox=${details.viewBox}`];
  if (details.nodeId) {
    identity.push(`node=${details.nodeId}`);
  }
  if (details.partId) {
    identity.push(`part=${details.partId}`);
  }
  identity.push(`point=(${formatCoordinate(details.x)}, ${formatCoordinate(details.y)})`);
  return identity.join(" | ");
}

export function installPlaygroundLocatorCopy(options: PlaygroundLocatorCopyOptions): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const clickedSvg = event.target.closest<SVGSVGElement>("svg");
    const previewSvg = clickedSvg ? resolveRootPreviewSvg(clickedSvg) : undefined;
    if (previewSvg && isInteractionContextMenuDemo()) {
      return;
    }
    const target = previewSvg ?? event.target.closest<HTMLElement>(LOCATOR_TARGET_SELECTOR);
    if (!target) {
      return;
    }

    const targetLevel = previewSvg ? "tab" : resolveLocatorLevel(target);
    const segments = resolveActivePath(targetLevel);
    const currentSample = resolveCurrentSample(target, targetLevel);
    if (currentSample) {
      segments.push(currentSample);
    }
    const targetSegment = previewSvg
      ? resolveSvgTargetSegment(previewSvg, event.target, event)
      : resolveTargetSegment(target, targetLevel);
    if (!targetSegment) {
      return;
    }
    segments.push(targetSegment);

    event.preventDefault();
    event.stopPropagation();
    const locator = formatPlaygroundLocator(options.playground, segments);
    void copyText(locator).then(
      () => showCopyToast(`Copied: ${locator}`),
      () => showCopyToast("Could not copy sample locator"),
    );
  };

  document.addEventListener("contextmenu", onContextMenu);
  return () => document.removeEventListener("contextmenu", onContextMenu);
}

function resolveRootPreviewSvg(clickedSvg: SVGSVGElement): SVGSVGElement | undefined {
  let rootSvg = clickedSvg;
  while (rootSvg.ownerSVGElement) {
    rootSvg = rootSvg.ownerSVGElement;
  }
  return rootSvg.closest("#svg-output, #preview-output, .preview-stage, .asset-preview-stage")
    ? rootSvg
    : undefined;
}

function isInteractionContextMenuDemo(): boolean {
  const activePage = document.querySelector<HTMLElement>(
    `[${LOCATOR_LEVEL_ATTRIBUTE}="page"].active[${LOCATOR_SEGMENT_ATTRIBUTE}]`,
  );
  const activeSample = document.querySelector<HTMLElement>(
    `[${LOCATOR_LEVEL_ATTRIBUTE}="sample"].active[${LOCATOR_SEGMENT_ATTRIBUTE}]`,
  );
  return (
    activePage?.getAttribute(LOCATOR_SEGMENT_ATTRIBUTE)?.includes("[interactive]") === true ||
    activeSample?.getAttribute(LOCATOR_SEGMENT_ATTRIBUTE)?.includes("[mouse]") === true
  );
}

function resolveSvgTargetSegment(
  svg: SVGSVGElement,
  eventTarget: Element,
  event: MouseEvent,
): string {
  const previewSvgs = Array.from(document.querySelectorAll<SVGSVGElement>("svg")).filter(
    (candidate) =>
      candidate.ownerSVGElement === null &&
      candidate.getClientRects().length > 0 &&
      candidate.closest("#svg-output, #preview-output, .preview-stage, .asset-preview-stage"),
  );
  const svgIndex = Math.max(previewSvgs.indexOf(svg), 0);
  const viewBox = svg.getAttribute("viewBox") ?? "none";
  const point = resolveSvgPoint(svg, event.clientX, event.clientY);
  const identifiedElement = eventTarget.closest<SVGElement>(
    "[data-boundsvg-node-id], [data-boundsvg-part-id]",
  );
  return formatSvgLocatorSegment({
    index: svgIndex + 1,
    total: Math.max(previewSvgs.length, 1),
    viewBox,
    x: point.x,
    y: point.y,
    nodeId: identifiedElement?.getAttribute("data-boundsvg-node-id") ?? undefined,
    partId: identifiedElement?.getAttribute("data-boundsvg-part-id") ?? undefined,
  });
}

function resolveSvgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const screenMatrix = svg.getScreenCTM();
  if (screenMatrix) {
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = clientX;
    svgPoint.y = clientY;
    const transformedPoint = svgPoint.matrixTransform(screenMatrix.inverse());
    return { x: transformedPoint.x, y: transformedPoint.y };
  }
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  if (rect.width > 0 && rect.height > 0 && viewBox.width > 0 && viewBox.height > 0) {
    return {
      x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.width,
      y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.height,
    };
  }
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function resolveActivePath(targetLevel: LocatorLevel): string[] {
  const levels: LocatorLevel[] = ["category", "page", "source", "sample"];
  const targetLevelIndex = levels.indexOf(targetLevel);
  const activeSegments: string[] = [];
  for (const [levelIndex, level] of levels.entries()) {
    if (targetLevelIndex >= 0 && levelIndex >= targetLevelIndex) {
      break;
    }
    const active = document.querySelector<HTMLElement>(
      `[${LOCATOR_LEVEL_ATTRIBUTE}="${level}"].active[${LOCATOR_SEGMENT_ATTRIBUTE}]`,
    );
    const segment = active?.getAttribute(LOCATOR_SEGMENT_ATTRIBUTE);
    if (segment) {
      activeSegments.push(segment);
    }
  }
  return activeSegments;
}

function resolveCurrentSample(target: Element, targetLevel: LocatorLevel): string | undefined {
  if (targetLevel === "category" || targetLevel === "page" || targetLevel === "source") {
    return undefined;
  }
  if (target.matches(".preview-header h3")) {
    return undefined;
  }
  if (
    document.querySelector(
      `[${LOCATOR_LEVEL_ATTRIBUTE}="sample"].active[${LOCATOR_SEGMENT_ATTRIBUTE}]`,
    )
  ) {
    return undefined;
  }
  const sampleHeading = document.querySelector<HTMLElement>(".preview-header h3");
  const sampleLabel = sampleHeading?.textContent?.trim();
  return sampleLabel ? `Sample: ${sampleLabel}` : undefined;
}

function resolveLocatorLevel(target: Element): LocatorLevel {
  const explicitLevel = target.getAttribute(LOCATOR_LEVEL_ATTRIBUTE) as LocatorLevel | null;
  if (explicitLevel) {
    return explicitLevel;
  }
  if (target.matches("select")) {
    return "control";
  }
  if (target.matches(".preview-header h3")) {
    return "sample";
  }
  return "tab";
}

function resolveTargetSegment(target: Element, level: LocatorLevel): string | undefined {
  const explicitSegment = target.getAttribute(LOCATOR_SEGMENT_ATTRIBUTE);
  if (explicitSegment) {
    return explicitSegment;
  }
  if (target instanceof HTMLSelectElement) {
    const selectedLabel = target.selectedOptions[0]?.textContent?.trim() ?? target.value;
    const label = resolveControlLabel(target);
    const stableValue = target.id ? `${target.id}=${target.value}` : target.value;
    return `Control: ${label} = ${selectedLabel} [${stableValue}]`;
  }
  if (target.matches(".preview-header h3")) {
    const activeSample = document.querySelector<HTMLElement>(
      `[${LOCATOR_LEVEL_ATTRIBUTE}="sample"].active[${LOCATOR_SEGMENT_ATTRIBUTE}]`,
    );
    const activeSampleSegment = activeSample?.getAttribute(LOCATOR_SEGMENT_ATTRIBUTE);
    if (activeSampleSegment) {
      return activeSampleSegment;
    }
  }
  const label = target.textContent?.trim();
  if (!label) {
    return undefined;
  }
  if (level === "sample") {
    return `Sample: ${label}`;
  }
  return `Tab: ${label}`;
}

function resolveControlLabel(select: HTMLSelectElement): string {
  if (select.id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(select.id)}"]`);
    if (label?.textContent?.trim()) {
      return label.textContent.trim();
    }
  }
  return select.closest(".control-group")?.querySelector("label")?.textContent?.trim() ?? "select";
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through for localhost configurations where Clipboard API is denied.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("copy command failed");
  }
}

function showCopyToast(message: string): void {
  const toastId = "playground-locator-copy-toast";
  document.getElementById(toastId)?.remove();
  const toast = document.createElement("div");
  toast.id = toastId;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "10000",
    maxWidth: "min(720px, calc(100vw - 32px))",
    padding: "9px 12px",
    border: "1px solid #38bdf8",
    borderRadius: "7px",
    background: "#18181b",
    color: "#e2e8f0",
    font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
  });
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2400);
}
