import {
  evaluateGeometryParts,
  type GeometryDoc,
  type GeometryPartHit,
  hitTestShapeAt,
} from "@boundsvg/core";
import { Canvas, Shape, Text, toVNode } from "@boundsvg/react";
import { useBoundSvg } from "@boundsvg/react/provider";
import { useMemo, useState } from "react";

const FONT = "NotoSansJP-woff2";
const CANVAS = { width: 800, height: 420 };
const PLACEMENT = { x: 70, y: 70, width: 420, height: 280 };

const BADGE_GEOMETRY: GeometryDoc = {
  viewBox: { width: 300, height: 200 },
  root: {
    kind: "group",
    nodeId: "badge",
    children: [
      {
        kind: "path",
        nodeId: "bg",
        d: "M20 0H280C291 0 300 9 300 20V180C300 191 291 200 280 200H20C9 200 0 191 0 180V20C0 9 9 0 20 0Z",
      },
      {
        kind: "boolean",
        nodeId: "ribbon",
        op: "union",
        children: [
          { kind: "path", d: "M20 80H160V120H20Z" },
          { kind: "path", d: "M140 70H280V110H140Z" },
        ],
      },
      { kind: "path", d: "M240 20H280V60H240Z" },
    ],
  },
};

const STROKE_WIDTH_PX = 6;
const PART_COLORS: Record<string, string> = {
  bg: "#f472b6",
  ribbon: "#facc15",
  "part:2": "#34d399",
};

export function HitTestPage() {
  const { engine } = useBoundSvg();
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hits, setHits] = useState<GeometryPartHit[]>([]);

  const svg = useMemo(() => {
    if (!engine) {
      return null;
    }
    return engine.renderToSvg(
      toVNode(
        <Canvas width={CANVAS.width} height={CANVAS.height} background="#1a1a1a">
          <Text
            font={FONT}
            fontSizePx={13}
            color="#94a3b8"
            width={660}
            wrap="none"
            position="absolute"
            left={PLACEMENT.x}
            top={30}
          >
            Point to or tap the badge - hitTestShapeAt reports every part under it (topmost last),
            stroke band included
          </Text>
          <Shape
            geometry={BADGE_GEOMETRY}
            width={PLACEMENT.width}
            height={PLACEMENT.height}
            fill="#0c1c33"
            stroke="#1d4ed8"
            strokeWidth={STROKE_WIDTH_PX}
            emitPartIds
            position="absolute"
            left={PLACEMENT.x}
            top={PLACEMENT.y}
          />
        </Canvas>,
      ),
    );
  }, [engine]);

  // The renderer bakes geometry into the box minus a strokeWidth/2 inset on
  // every side (so strokes never clip); mirror that transform or overlays
  // sit outside the painted parts by half the stroke, anisotropically.
  const bake = useMemo(() => {
    const inset = STROKE_WIDTH_PX / 2;
    return {
      inset,
      scaleX: (PLACEMENT.width - STROKE_WIDTH_PX) / BADGE_GEOMETRY.viewBox.width,
      scaleY: (PLACEMENT.height - STROKE_WIDTH_PX) / BADGE_GEOMETRY.viewBox.height,
    };
  }, []);

  const partBounds = useMemo(
    () =>
      evaluateGeometryParts(BADGE_GEOMETRY).flatMap((part) =>
        part.bounds
          ? [
              {
                partId: part.partId,
                left: PLACEMENT.x + bake.inset + part.bounds.x * bake.scaleX,
                top: PLACEMENT.y + bake.inset + part.bounds.y * bake.scaleY,
                width: part.bounds.width * bake.scaleX,
                height: part.bounds.height * bake.scaleY,
              },
            ]
          : [],
      ),
    [bake],
  );

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS.width,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS.height,
    };
    setCursor(point);
    setHits(
      hitTestShapeAt(BADGE_GEOMETRY, point, { ...PLACEMENT, strokeWidthPx: STROKE_WIDTH_PX }),
    );
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      return;
    }
    setCursor(null);
    setHits([]);
  };

  const topHit = hits.at(-1);

  return (
    <section className="page-section">
      <h2>Precise hit-test</h2>
      <p className="page-note">
        Kernel-precise <code>hitTestShapeAt</code>: fill containment on the boolean-resolved outline
        (not the bbox), plus a stroke band that wins over fill. The dashed boxes are only the part
        bounds - notice hits track the actual geometry inside them.
      </p>
      <div
        style={{
          position: "relative",
          width: CANVAS.width,
          maxWidth: "100%",
          cursor: "crosshair",
        }}
        onPointerDown={handlePointerMove}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        {svg ? (
          // lineHeight 0 removes the inline-svg baseline gap so the wrapper
          // height equals the svg height - overlays and pointer mapping align.
          <div
            style={{ lineHeight: 0 }}
            // Make the injected svg track the container width (it carries
            // width="800" attributes); otherwise overlays and pointer mapping
            // drift horizontally on viewports narrower than the canvas.
            dangerouslySetInnerHTML={{
              __html: svg.replace("<svg ", '<svg style="width:100%;height:auto" '),
            }}
          />
        ) : (
          <p>Rendering…</p>
        )}
        {partBounds.map((part) => {
          const isHit = hits.some((hit) => hit.partId === part.partId);
          const isTop = topHit?.partId === part.partId;
          const color = PART_COLORS[part.partId] ?? "#64748b";
          return (
            <div
              key={part.partId}
              style={{
                position: "absolute",
                left: `${(part.left / CANVAS.width) * 100}%`,
                top: `${(part.top / CANVAS.height) * 100}%`,
                width: `${(part.width / CANVAS.width) * 100}%`,
                height: `${(part.height / CANVAS.height) * 100}%`,
                border: `${isHit ? (isTop ? 3 : 2) : 2}px ${isHit ? "solid" : "dashed"} ${color}`,
                // Hairline dark edging (no blur) keeps the colored line
                // readable where it crosses the badge's bright stroke.
                boxShadow: "0 0 0 1px rgba(2, 6, 23, 0.85), inset 0 0 0 1px rgba(2, 6, 23, 0.85)",
                opacity: isHit ? 1 : 0.55,
                pointerEvents: "none",
                boxSizing: "border-box",
              }}
            />
          );
        })}
      </div>
      <div className="hit-test-readout" style={{ marginTop: 12, fontFamily: "monospace" }}>
        <div>cursor: {cursor ? `${cursor.x.toFixed(1)}, ${cursor.y.toFixed(1)}` : "(outside)"}</div>
        <div>
          hits (bottom → top):{" "}
          {hits.length > 0 ? hits.map((hit) => `${hit.partId} [${hit.hit}]`).join(" → ") : "none"}
        </div>
        <div>
          topmost:{" "}
          <strong style={{ color: topHit ? (PART_COLORS[topHit.partId] ?? "#e2e8f0") : "#64748b" }}>
            {topHit ? `${topHit.partId} (${topHit.hit})` : "—"}
          </strong>
        </div>
      </div>
    </section>
  );
}
