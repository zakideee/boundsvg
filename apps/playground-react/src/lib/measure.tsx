const DEPTH_COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#a855f7"];

export type MeasuredRect = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  domX: number;
  domY: number;
  kind: "box" | "text";
};

export const MEASURE_KINDS: Array<{ kind: MeasuredRect["kind"]; label: string }> = [
  { kind: "box", label: "Box" },
  { kind: "text", label: "Text" },
];

export function measureHtmlDescendants(container: HTMLElement): MeasuredRect[] {
  const base = container.getBoundingClientRect();
  const result: Array<Omit<MeasuredRect, "id">> = [];

  const walk = (element: Element, depth: number) => {
    const boundingRect = element.getBoundingClientRect();
    const w = Math.round(boundingRect.width);
    const h = Math.round(boundingRect.height);
    if (w >= 4 && h >= 4) {
      const dx = Math.round(boundingRect.left - base.left);
      const dy = Math.round(boundingRect.top - base.top);
      result.push({ x: dx, y: dy, w, h, depth, domX: dx, domY: dy, kind: "box" });
    }

    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const textRect = range.getBoundingClientRect();
        const textWidth = Math.round(textRect.width);
        const textHeight = Math.round(textRect.height);
        if (textWidth >= 2 && textHeight >= 2) {
          const tx = Math.round(textRect.left - base.left);
          const ty = Math.round(textRect.top - base.top);
          result.push({
            x: tx,
            y: ty,
            w: textWidth,
            h: textHeight,
            depth: depth + 1,
            domX: tx,
            domY: ty,
            kind: "text",
          });
        }
      }
    }

    for (const child of element.children) {
      walk(child, depth + 1);
    }
  };

  for (const child of container.children) {
    walk(child, 0);
  }
  return result.map((r, i) => ({ ...r, id: i }));
}

export function MeasureLabels({
  rects,
  hiddenKinds,
}: {
  rects: MeasuredRect[];
  hiddenKinds: Set<string>;
}) {
  return (
    <>
      {rects
        .filter((r) => !hiddenKinds.has(r.kind))
        .map((r) => (
          <div
            key={r.id}
            className="debug-measure-label"
            style={{
              left: r.domX,
              top: r.domY,
              color: DEPTH_COLORS[r.depth % DEPTH_COLORS.length],
              borderColor: DEPTH_COLORS[r.depth % DEPTH_COLORS.length],
            }}
          >
            {r.w}×{r.h}
            <span className="debug-measure-pos">
              {" "}
              ({r.x},{r.y})
            </span>
          </div>
        ))}
    </>
  );
}
