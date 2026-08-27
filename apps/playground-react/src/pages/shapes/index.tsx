import {
  computeGeometryIntersections,
  divideGeometryRegions,
  evaluateGeometryParts,
  type GeometryIntersection,
  type GeometryViewBox,
  type Region,
} from "@boundsvg/core";
import { wasmRenderShapeRegionSvg } from "@boundsvg/core/wasm";
import {
  Box,
  Canvas,
  type CompileOptions,
  Flex,
  type OutputCommonOptions,
  Shape,
  Svg,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: matches core API name
  Symbol,
  Text,
  toVNode,
  type VNode,
} from "@boundsvg/react";
import { useBoundSvg } from "@boundsvg/react/provider";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import type { ReactNode } from "react";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { getPrismGrammar } from "../../../../playground-shared/prism.js";
import {
  BBoxOverlayField,
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
import type { RendererMode } from "../../types";
import {
  ARC_RELATIVE_GEOMETRY,
  ARROW_SYMBOL,
  CALLOUT_GEOMETRY,
  DIVIDE_LHS_GEOMETRY,
  DIVIDE_RHS_GEOMETRY,
  DIVIDE_SOURCE_VIEWBOX,
  NOTCH_CARD_GEOMETRY,
  PILL_GEOMETRY,
  SELF_INTERSECT_GEOMETRY,
} from "./defs";
import type { ShapePresetKey, ShapesPageState } from "./types";

const CANVAS_WIDTH = 920;
const CANVAS_HEIGHT = 420;
const FONT = "NotoSansJP-woff2";

const INITIAL_STATE: ShapesPageState = {
  preset: "pill",
  width: 280,
  height: 128,
  fill: "#2563eb",
  stroke: "#60a5fa",
  strokeWidth: 2,
  debugOverlayParts: [],
  renderer: "boundsvg",
};

const PRESET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "pill", label: "Pill (inline geometry)" },
  { value: "notch-card", label: "Notch Card (subtract border)" },
  { value: "arrow", label: "Arrow (elastic outline)" },
  { value: "callout", label: "Callout (border quality)" },
  { value: "opacity", label: "Opacity (single application)" },
  { value: "parts", label: "Part Inspection (emitPartIds + meta)" },
  { value: "part-paint", label: "Part Paint (state variants)" },
  { value: "boolean-analysis", label: "Boolean Analysis (divide + hits)" },
  { value: "normalize-paths", label: "Normalize Paths (relative / arc / self-intersect)" },
];

const RENDERER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "boundsvg", label: "BoundSvg" },
  { value: "svg-hook", label: "useRenderToSvg" },
  { value: "png-hook", label: "useRenderToPng" },
];

type RegionPaint = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
};

type TargetRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type RegionBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

function computeRegionBounds(region: Region): RegionBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const updatePoint = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const contour of region.contours) {
    for (const segment of contour.segments) {
      updatePoint(segment.p0.x, segment.p0.y);
      if (segment.kind === "line") {
        updatePoint(segment.p1.x, segment.p1.y);
      } else if (segment.kind === "quad") {
        updatePoint(segment.p1.x, segment.p1.y);
        updatePoint(segment.p2.x, segment.p2.y);
      } else {
        updatePoint(segment.p1.x, segment.p1.y);
        updatePoint(segment.p2.x, segment.p2.y);
        updatePoint(segment.p3.x, segment.p3.y);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

function extractSvgInnerContent(svgDocument: string): string {
  const start = svgDocument.indexOf(">");
  const end = svgDocument.lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end <= start) {
    return svgDocument;
  }
  return svgDocument.slice(start + 1, end);
}

function renderRegionToSvgContent(region: Region, paint: RegionPaint): string {
  const svgDocument = wasmRenderShapeRegionSvg(region, {
    paint,
  });
  const bounds = computeRegionBounds(region);
  const innerContent = extractSvgInnerContent(svgDocument);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}">${innerContent}</svg>`;
}

function dedupeIntersections(
  intersections: readonly GeometryIntersection[],
  epsilon = 0.75,
): GeometryIntersection[] {
  const deduped: GeometryIntersection[] = [];
  for (const intersection of intersections) {
    const duplicate = deduped.some((existing) => {
      const dx = existing.point.x - intersection.point.x;
      const dy = existing.point.y - intersection.point.y;
      return Math.abs(dx) <= epsilon && Math.abs(dy) <= epsilon;
    });
    if (!duplicate) {
      deduped.push(intersection);
    }
  }
  return deduped;
}

function buildIntersectionMarkers(
  intersections: readonly GeometryIntersection[],
  sourceViewBox: GeometryViewBox,
  targetRect: TargetRect,
): ReactNode[] {
  const markerSize = 8;
  const sourceX = sourceViewBox.x ?? 0;
  const sourceY = sourceViewBox.y ?? 0;

  return dedupeIntersections(intersections).map((intersection, index) => (
    <Box
      key={`intersection-${index}-${intersection.segmentIndexA}-${intersection.segmentIndexB}`}
      width={markerSize}
      height={markerSize}
      background="#f8fafc"
      borderWidth={2}
      borderColor="#ef4444"
      borderRadius={999}
      position="absolute"
      left={
        targetRect.left +
        ((intersection.point.x - sourceX) / sourceViewBox.width) * targetRect.width -
        markerSize / 2
      }
      top={
        targetRect.top +
        ((intersection.point.y - sourceY) / sourceViewBox.height) * targetRect.height -
        markerSize / 2
      }
    />
  ));
}

function DemoCard(props: {
  title: string;
  subtitle: string;
  children: ReactNode;
  width?: number;
}): ReactNode {
  const width = props.width ?? 208;

  return (
    <Box
      width={width}
      height={208}
      padding={12}
      background="#0f172a"
      borderWidth={1}
      borderColor="#334155"
      borderRadius={18}
    >
      <Flex
        direction="column"
        width={width - 24}
        height={184}
        alignItems="center"
        justifyContent="space-between"
      >
        <Box
          width={width - 24}
          height={136}
          borderWidth={1}
          borderColor="#1e293b"
          borderRadius={14}
          background="#111827"
        >
          {props.children}
        </Box>
        <Flex direction="column" width={width - 24} gap={4}>
          <Text font={FONT} fontSizePx={14} color="#e2e8f0">
            {props.title}
          </Text>
          <Text font={FONT} fontSizePx={11} color="#64748b" wrap="char" lineHeight={1.35}>
            {props.subtitle}
          </Text>
        </Flex>
      </Flex>
    </Box>
  );
}

function SharedOperandPreview(props: {
  width: number;
  height: number;
  showMarkers?: boolean;
}): ReactNode {
  const sourceX = DIVIDE_SOURCE_VIEWBOX.x ?? 0;
  const sourceY = DIVIDE_SOURCE_VIEWBOX.y ?? 0;
  const sourceWidth = DIVIDE_SOURCE_VIEWBOX.width;
  const sourceHeight = DIVIDE_SOURCE_VIEWBOX.height;
  const cardHeight = (200 / sourceHeight) * props.height;
  const cardTop = ((0 - sourceY) / sourceHeight) * props.height;
  const notchLeft = (((DIVIDE_RHS_GEOMETRY.viewBox.x ?? 0) - sourceX) / sourceWidth) * props.width;
  const notchTop = (((DIVIDE_RHS_GEOMETRY.viewBox.y ?? 0) - sourceY) / sourceHeight) * props.height;
  const notchWidth = (DIVIDE_RHS_GEOMETRY.viewBox.width / sourceWidth) * props.width;
  const notchHeight = (DIVIDE_RHS_GEOMETRY.viewBox.height / sourceHeight) * props.height;
  const intersections = props.showMarkers
    ? computeGeometryIntersections(DIVIDE_LHS_GEOMETRY, DIVIDE_RHS_GEOMETRY)
    : [];

  return (
    <Box width={props.width} height={props.height} position="relative">
      <Shape
        geometry={DIVIDE_LHS_GEOMETRY}
        width={props.width}
        height={cardHeight}
        fill="#1e293b"
        stroke="#475569"
        strokeWidth={2}
        position="absolute"
        top={cardTop}
        left={0}
      />
      <Shape
        geometry={DIVIDE_RHS_GEOMETRY}
        width={notchWidth}
        height={notchHeight}
        fill="#38bdf8"
        stroke="#7dd3fc"
        strokeWidth={2}
        opacity={0.45}
        position="absolute"
        top={notchTop}
        left={notchLeft}
      />
      {buildIntersectionMarkers(intersections, DIVIDE_SOURCE_VIEWBOX, {
        left: 0,
        top: 0,
        width: props.width,
        height: props.height,
      })}
    </Box>
  );
}

function buildVNode(state: ShapesPageState): VNode {
  const { preset, width, height, fill, stroke, strokeWidth } = state;
  const sampleWidth = Math.max(160, Math.min(width, 300));
  const sampleHeight = Math.max(72, Math.min(height, 180));

  switch (preset) {
    case "pill":
      return toVNode(
        <Canvas width={CANVAS_WIDTH} height={400} background="#1a1a1a">
          <Flex
            direction="column"
            justifyContent="center"
            alignItems="center"
            width={CANVAS_WIDTH}
            height={400}
            gap={16}
          >
            <Shape
              geometry={PILL_GEOMETRY}
              width={sampleWidth}
              height={sampleHeight}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
            <Text font={FONT} fontSizePx={18} color="#94a3b8">
              Inline geometry — pill shape
            </Text>
          </Flex>
        </Canvas>,
      );

    case "notch-card":
      return toVNode(
        <Canvas width={CANVAS_WIDTH} height={400} background="#1a1a1a">
          <Flex
            direction="column"
            justifyContent="center"
            alignItems="center"
            width={CANVAS_WIDTH}
            height={400}
            gap={16}
          >
            <Shape
              geometry={NOTCH_CARD_GEOMETRY}
              width={sampleWidth}
              height={sampleHeight}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
            <Text font={FONT} fontSizePx={18} color="#94a3b8">
              Boolean subtract — fill and border share the same notch outline
            </Text>
          </Flex>
        </Canvas>,
      );

    case "arrow": {
      const arrowHeight = Math.max(20, Math.min(height, 48));

      return toVNode(
        <Canvas width={CANVAS_WIDTH} height={400} background="#1a1a1a">
          <Flex
            direction="column"
            justifyContent="center"
            alignItems="center"
            width={CANVAS_WIDTH}
            height={400}
            gap={24}
          >
            <Symbol
              symbol={ARROW_SYMBOL}
              width={200}
              height={arrowHeight}
              fill="#f59e0b"
              stroke="#fcd34d"
              strokeWidth={strokeWidth}
            />
            <Symbol
              symbol={ARROW_SYMBOL}
              width={360}
              height={arrowHeight}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
            <Symbol
              symbol={ARROW_SYMBOL}
              width={560}
              height={arrowHeight}
              fill="#6366f1"
              stroke="#a5b4fc"
              strokeWidth={strokeWidth}
            />
            <Text font={FONT} fontSizePx={18} color="#94a3b8">
              Elastic segments — fill and outline both keep the head fixed while the shaft stretches
            </Text>
          </Flex>
        </Canvas>,
      );
    }

    case "callout":
      return toVNode(
        <Canvas width={CANVAS_WIDTH} height={400} background="#1a1a1a">
          <Flex
            direction="row"
            justifyContent="center"
            alignItems="center"
            width={CANVAS_WIDTH}
            height={400}
            gap={32}
          >
            <Shape
              geometry={CALLOUT_GEOMETRY}
              width={sampleWidth}
              height={sampleHeight}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
            <Flex direction="column" gap={8}>
              <Text font={FONT} fontSizePx={28} color="#e2e8f0">
                Shape + Text
              </Text>
              <Text font={FONT} fontSizePx={16} color="#94a3b8">
                Closed-region border rendering stays consistent across the bubble body and tail.
              </Text>
            </Flex>
          </Flex>
        </Canvas>,
      );

    case "opacity":
      return toVNode(
        <Canvas width={CANVAS_WIDTH} height={400} background="#1a1a1a">
          <Flex
            direction="row"
            justifyContent="center"
            alignItems="center"
            width={CANVAS_WIDTH}
            height={400}
            gap={40}
          >
            <Flex direction="column" gap={10} alignItems="center">
              <Shape geometry={PILL_GEOMETRY} width={180} height={82} fill={fill} opacity={0.5} />
              <Text font={FONT} fontSizePx={14} color="#94a3b8">
                Shape opacity 0.5
              </Text>
            </Flex>
            <Flex direction="column" gap={10} alignItems="center">
              <Box width={180} height={82} background={fill} borderRadius={41} opacity={0.5} />
              <Text font={FONT} fontSizePx={14} color="#94a3b8">
                Box opacity 0.5 (must match)
              </Text>
            </Flex>
            <Flex direction="column" gap={10} alignItems="center">
              <Shape geometry={PILL_GEOMETRY} width={180} height={82} fill={fill} />
              <Text font={FONT} fontSizePx={14} color="#94a3b8">
                Shape opacity 1.0
              </Text>
            </Flex>
          </Flex>
        </Canvas>,
      );

    case "part-paint": {
      const paintGeometry = {
        viewBox: { width: 300, height: 200 },
        root: {
          kind: "group" as const,
          nodeId: "badge",
          children: [
            {
              kind: "path" as const,
              nodeId: "bg",
              d: "M20 0H280C291 0 300 9 300 20V180C300 191 291 200 280 200H20C9 200 0 191 0 180V20C0 9 9 0 20 0Z",
            },
            {
              kind: "boolean" as const,
              nodeId: "ribbon",
              op: "union" as const,
              children: [
                { kind: "path" as const, d: "M20 80H160V120H20Z" },
                { kind: "path" as const, d: "M140 70H280V110H140Z" },
              ],
            },
            { kind: "path" as const, nodeId: "gem", d: "M240 20H280V60H240Z" },
          ],
        },
      };
      const states: Array<{
        label: string;
        partPaint?: Record<string, { fill?: string; stroke?: string; strokeWidth?: number }>;
      }> = [
        { label: "normal" },
        { label: "hover", partPaint: { ribbon: { fill: "#f59e0b" } } },
        {
          label: "active",
          partPaint: {
            ribbon: { fill: "#f97316" },
            gem: { fill: "#facc15", stroke: "#fde68a", strokeWidth: 3 },
          },
        },
      ];
      return toVNode(
        <Canvas width={CANVAS_WIDTH} height={330} background="#1a1a1a">
          <Text
            font={FONT}
            fontSizePx={13}
            color="#94a3b8"
            width={700}
            wrap="none"
            position="absolute"
            left={40}
            top={32}
          >
            One geometry, three states: partPaint merges per-part overrides over the base paint
          </Text>
          {states.map((state, index) => (
            <Shape
              key={state.label}
              geometry={paintGeometry}
              width={220}
              height={147}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              {...(state.partPaint ? { partPaint: state.partPaint } : {})}
              position="absolute"
              left={40 + index * 250}
              top={84}
            />
          ))}
          {states.map((state, index) => (
            <Text
              key={state.label}
              font={FONT}
              fontSizePx={15}
              color="#e2e8f0"
              width={220}
              wrap="none"
              position="absolute"
              left={40 + index * 250}
              top={248}
            >
              {state.label}
            </Text>
          ))}
        </Canvas>,
      );
    }

    case "parts": {
      const partsGeometry = {
        viewBox: { width: 300, height: 200 },
        root: {
          kind: "group" as const,
          nodeId: "badge",
          children: [
            {
              kind: "path" as const,
              nodeId: "bg",
              d: "M20 0H280C291 0 300 9 300 20V180C300 191 291 200 280 200H20C9 200 0 191 0 180V20C0 9 9 0 20 0Z",
            },
            {
              kind: "boolean" as const,
              nodeId: "ribbon",
              op: "union" as const,
              children: [
                { kind: "path" as const, d: "M20 80H160V120H20Z" },
                { kind: "path" as const, d: "M140 70H280V110H140Z" },
              ],
            },
            { kind: "path" as const, d: "M240 20H280V60H240Z" },
          ],
        },
      };
      const parts = evaluateGeometryParts(partsGeometry);
      const display = { left: 70, top: 70, width: 420, height: 280 };
      const scaleX = display.width / 300;
      const scaleY = display.height / 200;
      const partColors = ["#38bdf8", "#facc15", "#34d399"];
      return toVNode(
        <Canvas width={CANVAS_WIDTH} height={420} background="#1a1a1a">
          <Text
            font={FONT}
            fontSizePx={13}
            color="#94a3b8"
            width={700}
            wrap="none"
            position="absolute"
            left={70}
            top={30}
          >
            emitPartIds + meta - inspect data-boundsvg-part-id / data-boundsvg-meta-* in the SVG
          </Text>
          <Shape
            geometry={partsGeometry}
            width={display.width}
            height={display.height}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            emitPartIds
            meta={{ role: "badge", variant: "demo" }}
            position="absolute"
            left={display.left}
            top={display.top}
          />
          {parts.map((part, index) =>
            part.bounds ? (
              <Box
                key={part.partId}
                position="absolute"
                left={display.left + part.bounds.x * scaleX}
                top={display.top + part.bounds.y * scaleY}
                width={part.bounds.width * scaleX}
                height={part.bounds.height * scaleY}
                borderWidth={1}
                borderColor={partColors[index % partColors.length]}
                strokeDasharray="5,4"
              />
            ) : null,
          )}
          <Flex direction="column" gap={8} position="absolute" left={540} top={90} width={230}>
            <Text font={FONT} fontSizePx={14} color="#e2e8f0" width={230} wrap="none">
              Addressable parts
            </Text>
            {parts.map((part, index) => (
              <Text
                key={part.partId}
                font={FONT}
                fontSizePx={13}
                color={partColors[index % partColors.length]}
                width={230}
                wrap="none"
              >
                {part.partId}
              </Text>
            ))}
          </Flex>
        </Canvas>,
      );
    }

    case "boolean-analysis": {
      const divided = divideGeometryRegions(DIVIDE_LHS_GEOMETRY, DIVIDE_RHS_GEOMETRY);
      return toVNode(
        <Canvas width={CANVAS_WIDTH} height={CANVAS_HEIGHT} background="#1a1a1a">
          <Flex
            direction="column"
            justifyContent="center"
            alignItems="center"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            gap={18}
          >
            <Flex direction="row" gap={16} width={896} justifyContent="center">
              {DemoCard({
                title: "Operands",
                subtitle: "Original card and notch circle before the divide/intersection queries.",
                children: (
                  <Flex width={184} height={136} justifyContent="center" alignItems="center">
                    {SharedOperandPreview({ width: 162, height: 104 })}
                  </Flex>
                ),
              })}
              {DemoCard({
                title: "Divide / Subtract",
                subtitle: "The subtract region is rendered independently as its own closed fill.",
                children: (
                  <Flex width={184} height={136} justifyContent="center" alignItems="center">
                    <Svg
                      content={renderRegionToSvgContent(divided.subtract, {
                        fill,
                        stroke,
                        strokeWidth,
                      })}
                      width={172}
                      height={104}
                      preserveAspectRatio="meet"
                    />
                  </Flex>
                ),
              })}
              {DemoCard({
                title: "Divide / Intersect",
                subtitle:
                  "The overlap can be inspected as a separate region without rebuilding the scene.",
                children: (
                  <Flex width={184} height={136} justifyContent="center" alignItems="center">
                    <Svg
                      content={renderRegionToSvgContent(divided.intersect, {
                        fill: "#0ea5e9",
                        stroke: "#7dd3fc",
                        strokeWidth,
                        opacity: 0.95,
                      })}
                      width={172}
                      height={104}
                      preserveAspectRatio="meet"
                    />
                  </Flex>
                ),
              })}
              {DemoCard({
                title: "Intersection markers",
                subtitle:
                  "Marker dots come from computeGeometryIntersections() on the same operands.",
                children: (
                  <Flex width={184} height={136} justifyContent="center" alignItems="center">
                    {SharedOperandPreview({ width: 162, height: 104, showMarkers: true })}
                  </Flex>
                ),
              })}
            </Flex>
            <Text font={FONT} fontSizePx={18} color="#94a3b8">
              Boolean analysis — compare operands, divide results, and hit points in one view
            </Text>
          </Flex>
        </Canvas>,
      );
    }

    case "normalize-paths":
      return toVNode(
        <Canvas width={CANVAS_WIDTH} height={CANVAS_HEIGHT} background="#1a1a1a">
          <Flex
            direction="column"
            justifyContent="center"
            alignItems="center"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            gap={18}
          >
            <Flex direction="row" gap={16} width={896} justifyContent="center">
              {DemoCard({
                title: "Relative + Arc",
                subtitle:
                  "Lowercase commands and arc segments are normalized before they reach the renderer.",
                width: 440,
                children: (
                  <Flex width={416} height={136} justifyContent="center" alignItems="center">
                    <Shape
                      geometry={ARC_RELATIVE_GEOMETRY}
                      width={Math.max(220, Math.min(width, 320))}
                      height={Math.max(88, Math.min(height, 160))}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                    />
                  </Flex>
                ),
              })}
              {DemoCard({
                title: "Self-Intersection",
                subtitle:
                  "Self-crossing input is normalized instead of rejected in the current kernel.",
                width: 440,
                children: (
                  <Flex width={416} height={136} justifyContent="center" alignItems="center">
                    <Shape
                      geometry={SELF_INTERSECT_GEOMETRY}
                      width={Math.max(180, Math.min(width, 260))}
                      height={Math.max(88, Math.min(height, 160))}
                      fill="#7c3aed"
                      stroke="#c4b5fd"
                      strokeWidth={strokeWidth}
                    />
                  </Flex>
                ),
              })}
            </Flex>
            <Text font={FONT} fontSizePx={18} color="#94a3b8">
              Normalize paths — complex inputs are accepted, normalized, and then rendered as usual
            </Text>
          </Flex>
        </Canvas>,
      );
  }
}

type ViewTab = "preview" | "svg" | "jsx" | "component";
type CodeLayout = "tab" | "panel";

export function ShapesPage() {
  const { engine, status } = useBoundSvg();
  const [state, setState] = useState(INITIAL_STATE);
  const [isPending, startTransition] = useTransition();
  const [viewTab, setViewTab] = useState<ViewTab>("preview");
  const [codeLayout, setCodeLayout] = useState<CodeLayout>("tab");
  const mobileViewer = useMobileViewer();
  useResetPreviewForMobile(mobileViewer, setViewTab, setCodeLayout);
  const deferred = useDeferredValue(state);

  const update = <K extends keyof ShapesPageState>(key: K, value: ShapesPageState[K]) => {
    startTransition(() => {
      setState((prev) => ({ ...prev, [key]: value }));
    });
  };

  const vnode = useMemo(() => (engine ? buildVNode(deferred) : null), [engine, deferred]);

  const renderOptions = useMemo<CompileOptions & OutputCommonOptions>(
    () => ({ debug: resolveDebugOverlayConfig(deferred.debugOverlayParts) }),
    [deferred.debugOverlayParts],
  );

  const activePresetOption = PRESET_OPTIONS.find((option) => option.value === state.preset);

  // Rendered SVG tab + inspect hover
  const {
    highlightedSvg: highlightedRenderedSvg,
    setPreviewEl,
    setCodeEl,
  } = useSvgInspect(engine, status, vnode, renderOptions);

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
            id="shape-preset"
            label="Shape"
            value={state.preset}
            options={PRESET_OPTIONS}
            onChange={(v) => update("preset", v as ShapePresetKey)}
          />
        </Section>

        <Section title="Dimensions">
          <NumberField
            id="shape-w"
            label="Width"
            value={state.width}
            min={20}
            max={900}
            unit="px"
            onChange={(v) => update("width", v)}
          />
          <NumberField
            id="shape-h"
            label="Height"
            value={state.height}
            min={20}
            max={400}
            unit="px"
            onChange={(v) => update("height", v)}
          />
        </Section>

        <Section title="Paint">
          <ColorField
            id="shape-fill"
            label="Fill"
            value={state.fill}
            onChange={(v) => update("fill", v)}
          />
          <ColorField
            id="shape-stroke"
            label="Stroke"
            value={state.stroke}
            onChange={(v) => update("stroke", v)}
          />
          <NumberField
            id="shape-sw"
            label="Stroke Width"
            value={state.strokeWidth}
            min={0}
            max={20}
            step={0.5}
            unit="px"
            onChange={(v) => update("strokeWidth", v)}
          />
        </Section>

        <Section title="Render" className="mobile-viewer-secondary">
          <SelectField
            id="shape-renderer"
            label="Renderer"
            value={state.renderer}
            options={RENDERER_OPTIONS}
            onChange={(v) => update("renderer", v as RendererMode)}
          />
          <BBoxOverlayField
            id="shape-debug"
            value={state.debugOverlayParts}
            onChange={(v) => update("debugOverlayParts", v)}
          />
        </Section>
      </aside>

      <section
        className={`panel preview-panel has-code-area layout-${codeLayout}${showCode ? " show-code" : ""}`}
      >
        <div className="preview-header">
          <div className="preview-header-meta">
            <h3>{activePresetOption?.label ?? "Shapes"}</h3>
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
