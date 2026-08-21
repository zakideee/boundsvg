import { Canvas, Flex, Path, Text } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

export const mousePreset: Preset = {
  title: "Events",
  description:
    "21 event types: click, dblclick, contextMenu, pointerDown/Up/Move/Enter/Leave/Over/Out/Cancel, mouseDown/Up/Move/Enter/Leave/Over/Out, touchStart/End/Move.",
  source: `import { Canvas, Flex, Path, Text } from "@boundsvg/core";
import {
  buildHitTestIndex, buildHandlerMap,
  hitTestWithIndex,
} from "@boundsvg/core/scene";

// 1. Build VNode with event handler IDs
const vnode = Canvas(
  { width: 800, height: 680, background: "#1e1e1e" },
  Flex(
    { direction: "column", gap: 16, padding: 24,
      width: 800, height: 680 },
    // Row 1
    Flex(
      { direction: "row", gap: 16 },
      Flex(
        { id: "card-1", onClick: "card-1",
          direction: "column", gap: 6,
          background: "#2d2d2d", borderRadius: 12,
          padding: 16, width: 175, height: 140 },
        Text({ font: "${FA}", fontSizePx: 18,
          color: "#38bdf8", wrap: "char" }, "Click"),
        Text({ font: "${FA}", fontSizePx: 12,
          color: "#94a3b8", wrap: "char" }, "onClick only"),
      ),
      Flex(
        { id: "card-2",
          onPointerEnter: "card-2-enter",
          onPointerLeave: "card-2-leave",
          onPointerOver: "card-2-over",
          onPointerOut: "card-2-out",
          direction: "column", gap: 6,
          background: "#2d2d2d", borderRadius: 12,
          padding: 16, width: 175, height: 140 },
        Text({ font: "${FA}", fontSizePx: 18,
          color: "#a78bfa", wrap: "char" }, "Hover"),
        Text({ font: "${FA}", fontSizePx: 12,
          color: "#94a3b8", wrap: "char" },
          "pointer Enter/Leave/Over/Out"),
      ),
      Flex(
        { id: "card-3",
          onContextMenu: "card-3-ctx",
          onDoubleClick: "card-3-dbl",
          direction: "column", gap: 6,
          background: "#2d2d2d", borderRadius: 12,
          padding: 16, width: 175, height: 140 },
        Text({ font: "${FA}", fontSizePx: 18,
          color: "#fbbf24", wrap: "char" }, "Right / Dbl"),
        Text({ font: "${FA}", fontSizePx: 12,
          color: "#94a3b8", wrap: "char" },
          "contextMenu + doubleClick"),
      ),
      Flex(
        { id: "card-4",
          direction: "column", gap: 4,
          background: "#2d2d2d", borderRadius: 12,
          padding: 16, width: 175, height: 140,
          alignItems: "center" },
        Path({ id: "star", onClick: "star-click",
          onContextMenu: "star-ctx",
          d: "M43 0 L54 30 L85 30 L60 49 L68 81 L43 61 L17 81 L26 49 L0 30 L32 30 Z",
          width: 86, height: 82, fill: "#fbbf24" }),
        Text({ font: "${FA}", fontSizePx: 12,
          color: "#94a3b8", wrap: "none" }, "Path hit-test"),
      ),
    ),
    // Row 2
    Flex(
      { direction: "row", gap: 16 },
      Flex(
        { id: "card-5",
          onPointerDown: "card-5-ptrdown",
          onPointerUp: "card-5-ptrup",
          direction: "column", gap: 6,
          background: "#2d2d2d", borderRadius: 12,
          padding: 16, width: 175, height: 140 },
        Text({ font: "${FA}", fontSizePx: 18,
          color: "#f472b6", wrap: "char" }, "Press (ptr)"),
        Text({ font: "${FA}", fontSizePx: 12,
          color: "#94a3b8", wrap: "char" },
          "pointerDown / pointerUp"),
      ),
      Flex(
        { id: "card-6",
          onMouseDown: "card-6-mdown",
          onMouseUp: "card-6-mup",
          direction: "column", gap: 6,
          background: "#2d2d2d", borderRadius: 12,
          padding: 16, width: 175, height: 140 },
        Text({ font: "${FA}", fontSizePx: 18,
          color: "#c084fc", wrap: "char" }, "Press (mouse)"),
        Text({ font: "${FA}", fontSizePx: 12,
          color: "#94a3b8", wrap: "char" },
          "mouseDown / mouseUp"),
      ),
      Flex(
        { id: "card-7",
          onMouseEnter: "card-7-menter",
          onMouseLeave: "card-7-mleave",
          onMouseOver: "card-7-mover",
          onMouseOut: "card-7-mout",
          direction: "column", gap: 6,
          background: "#2d2d2d", borderRadius: 12,
          padding: 16, width: 175, height: 140 },
        Text({ font: "${FA}", fontSizePx: 18,
          color: "#34d399", wrap: "char" }, "Mouse Hover"),
        Text({ font: "${FA}", fontSizePx: 12,
          color: "#94a3b8", wrap: "char" },
          "mouseEnter/Leave/Over/Out"),
      ),
      Flex(
        { id: "card-8",
          onMouseMove: "card-8-mmove",
          onPointerMove: "card-8-ptrmove",
          direction: "column", gap: 6,
          background: "#2d2d2d", borderRadius: 12,
          padding: 16, width: 175, height: 140 },
        Text({ font: "${FA}", fontSizePx: 18,
          color: "#64748b", wrap: "char" }, "Move"),
        Text({ font: "${FA}", fontSizePx: 12,
          color: "#94a3b8", wrap: "char" },
          "mouseMove + pointerMove"),
      ),
    ),
    // Row 3 — Touch
    Flex(
      { direction: "row", gap: 16 },
      Flex(
        { id: "card-9",
          onTouchStart: "card-9-tstart",
          onTouchEnd: "card-9-tend",
          direction: "column", gap: 6,
          background: "#2d2d2d", borderRadius: 12,
          padding: 16, width: 175, height: 140 },
        Text({ font: "${FA}", fontSizePx: 18,
          color: "#ff6b6b", wrap: "char" }, "Touch"),
        Text({ font: "${FA}", fontSizePx: 12,
          color: "#94a3b8", wrap: "char" },
          "touchStart / touchEnd"),
      ),
      Flex(
        { id: "card-10",
          onTouchMove: "card-10-tmove",
          direction: "column", gap: 6,
          background: "#2d2d2d", borderRadius: 12,
          padding: 16, width: 175, height: 140 },
        Text({ font: "${FA}", fontSizePx: 18,
          color: "#f9ca24", wrap: "char" }, "Touch Move"),
        Text({ font: "${FA}", fontSizePx: 12,
          color: "#94a3b8", wrap: "char" },
          "touchMove (rAF throttled)"),
      ),
    ),
    // Footer
    Flex(
      { id: "github", onClick: "github-open",
        direction: "row", gap: 8, alignItems: "center" },
      Path({ id: "github-icon", onClick: "github-open",
        d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z",
        width: 16, height: 16, fill: "#64748b" }),
      Text({ font: "${FA}", fontSizePx: 13,
        color: "#64748b", wrap: "none",
        onClick: "github-open" }, "GitHub"),
    ),
    Text({ font: "${FA}", fontSizePx: 12,
      color: "#475569", wrap: "char" },
      "20 event types supported via Quadtree hit-test"),
  ),
);

// 2. Render with IR
const { svg, ir } = engine.renderToSvgAndIR(vnode);

// 3. Build hit-test index + handler map
const index = buildHitTestIndex(ir);
const handlers = buildHandlerMap(ir);

// 4. Dispatch events via SVG coordinate hit-test
const svgEl = document.querySelector("svg")!;
svgEl.addEventListener("click", (e) => {
  const { x, y } = svgCoords(e);
  const nodeId = hitTestWithIndex(index, x, y);
  if (nodeId) {
    const irHandlers = handlers.get(nodeId);
    if (irHandlers?.onClick) console.log("click", nodeId, x, y);
  }
});`,
  build: () =>
    Canvas(
      { width: 800, height: 680, background: "#1e1e1e" },
      Flex(
        {
          direction: "column",
          gap: 16,
          padding: 24,
          width: 800,
          height: 680,
        },
        // Row 1
        Flex(
          { direction: "row", gap: 16 },
          Flex(
            {
              id: "card-1",
              onClick: "card-1",
              direction: "column",
              gap: 6,
              background: "#2d2d2d",
              borderRadius: 12,
              padding: 16,
              width: 175,
              height: 140,
            },
            Text({ font: FA, fontSizePx: 18, color: "#38bdf8", wrap: "char" }, "Click"),
            Text({ font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "char" }, "onClick only"),
          ),
          Flex(
            {
              id: "card-2",
              onPointerEnter: "card-2-enter",
              onPointerLeave: "card-2-leave",
              onPointerOver: "card-2-over",
              onPointerOut: "card-2-out",
              direction: "column",
              gap: 6,
              background: "#2d2d2d",
              borderRadius: 12,
              padding: 16,
              width: 175,
              height: 140,
            },
            Text({ font: FA, fontSizePx: 18, color: "#a78bfa", wrap: "char" }, "Hover"),
            Text(
              { font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "char" },
              "pointer Enter/Leave/Over/Out",
            ),
          ),
          Flex(
            {
              id: "card-3",
              onContextMenu: "card-3-ctx",
              onDoubleClick: "card-3-dbl",
              direction: "column",
              gap: 6,
              background: "#2d2d2d",
              borderRadius: 12,
              padding: 16,
              width: 175,
              height: 140,
            },
            Text({ font: FA, fontSizePx: 18, color: "#fbbf24", wrap: "char" }, "Right / Dbl"),
            Text(
              { font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "char" },
              "contextMenu + doubleClick",
            ),
          ),
          Flex(
            {
              id: "card-4",
              direction: "column",
              gap: 4,
              background: "#2d2d2d",
              borderRadius: 12,
              padding: 16,
              width: 175,
              height: 140,
              alignItems: "center",
            },
            Path({
              id: "star",
              onClick: "star-click",
              onContextMenu: "star-ctx",
              d: "M43 0 L54 30 L85 30 L60 49 L68 81 L43 61 L17 81 L26 49 L0 30 L32 30 Z",
              width: 86,
              height: 82,
              fill: "#fbbf24",
            }),
            Text({ font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "none" }, "Path hit-test"),
          ),
        ),
        // Row 2
        Flex(
          { direction: "row", gap: 16 },
          Flex(
            {
              id: "card-5",
              onPointerDown: "card-5-ptrdown",
              onPointerUp: "card-5-ptrup",
              direction: "column",
              gap: 6,
              background: "#2d2d2d",
              borderRadius: 12,
              padding: 16,
              width: 175,
              height: 140,
            },
            Text({ font: FA, fontSizePx: 18, color: "#f472b6", wrap: "char" }, "Press (ptr)"),
            Text(
              { font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "char" },
              "pointerDown / pointerUp",
            ),
          ),
          Flex(
            {
              id: "card-6",
              onMouseDown: "card-6-mdown",
              onMouseUp: "card-6-mup",
              direction: "column",
              gap: 6,
              background: "#2d2d2d",
              borderRadius: 12,
              padding: 16,
              width: 175,
              height: 140,
            },
            Text({ font: FA, fontSizePx: 18, color: "#c084fc", wrap: "char" }, "Press (mouse)"),
            Text(
              { font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "char" },
              "mouseDown / mouseUp",
            ),
          ),
          Flex(
            {
              id: "card-7",
              onMouseEnter: "card-7-menter",
              onMouseLeave: "card-7-mleave",
              onMouseOver: "card-7-mover",
              onMouseOut: "card-7-mout",
              direction: "column",
              gap: 6,
              background: "#2d2d2d",
              borderRadius: 12,
              padding: 16,
              width: 175,
              height: 140,
            },
            Text({ font: FA, fontSizePx: 18, color: "#34d399", wrap: "char" }, "Mouse Hover"),
            Text(
              { font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "char" },
              "mouseEnter/Leave/Over/Out",
            ),
          ),
          Flex(
            {
              id: "card-8",
              onMouseMove: "card-8-mmove",
              onPointerMove: "card-8-ptrmove",
              direction: "column",
              gap: 6,
              background: "#2d2d2d",
              borderRadius: 12,
              padding: 16,
              width: 175,
              height: 140,
            },
            Text({ font: FA, fontSizePx: 18, color: "#64748b", wrap: "char" }, "Move"),
            Text(
              { font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "char" },
              "mouseMove + pointerMove",
            ),
          ),
        ),
        // Row 3 — Touch
        Flex(
          { direction: "row", gap: 16 },
          Flex(
            {
              id: "card-9",
              onTouchStart: "card-9-tstart",
              onTouchEnd: "card-9-tend",
              direction: "column",
              gap: 6,
              background: "#2d2d2d",
              borderRadius: 12,
              padding: 16,
              width: 175,
              height: 140,
            },
            Text({ font: FA, fontSizePx: 18, color: "#ff6b6b", wrap: "char" }, "Touch"),
            Text(
              { font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "char" },
              "touchStart / touchEnd",
            ),
          ),
          Flex(
            {
              id: "card-10",
              onTouchMove: "card-10-tmove",
              direction: "column",
              gap: 6,
              background: "#2d2d2d",
              borderRadius: 12,
              padding: 16,
              width: 175,
              height: 140,
            },
            Text({ font: FA, fontSizePx: 18, color: "#f9ca24", wrap: "char" }, "Touch Move"),
            Text(
              { font: FA, fontSizePx: 12, color: "#94a3b8", wrap: "char" },
              "touchMove (rAF throttled)",
            ),
          ),
        ),
        // Footer
        Flex(
          {
            id: "github",
            onClick: "github-open",
            direction: "row",
            gap: 8,
            alignItems: "center",
          },
          Path({
            id: "github-icon",
            onClick: "github-open",
            d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z",
            width: 16,
            height: 16,
            fill: "#64748b",
          }),
          Text(
            { font: FA, fontSizePx: 13, color: "#64748b", wrap: "none", onClick: "github-open" },
            "GitHub",
          ),
        ),
        Text(
          { font: FA, fontSizePx: 12, color: "#475569", wrap: "char" },
          "20 event types supported via Quadtree hit-test",
        ),
      ),
    ),
};
