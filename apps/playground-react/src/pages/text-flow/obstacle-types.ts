export type CircleObstacle = { cx: number; cy: number; r: number };
export type RectObstacle = { x: number; y: number; w: number; h: number };

export type FlowObstacles = {
  leftRect: RectObstacle;
  leftCirc: CircleObstacle;
  rightRect: RectObstacle;
};

export type FlowRichObstacles = {
  richCirc: CircleObstacle;
  verticalRect: RectObstacle;
  rubyRect: RectObstacle;
};

export const INITIAL_FLOW_OBSTACLES: FlowObstacles = {
  leftRect: { x: 260, y: 40, w: 130, h: 70 },
  leftCirc: { cx: 100, cy: 180, r: 55 },
  rightRect: { x: 580, y: 60, w: 130, h: 80 },
};

export const INITIAL_FLOW_RICH_OBSTACLES: FlowRichObstacles = {
  richCirc: { cx: 200, cy: 100, r: 40 },
  verticalRect: { x: 460, y: 100, w: 60, h: 70 },
  rubyRect: { x: 720, y: 60, w: 90, h: 50 },
};

export type HitResult = { section: string; offsetX: number; offsetY: number };

function hitCircle(
  x: number,
  y: number,
  circle: CircleObstacle,
  section: string,
): HitResult | null {
  if ((x - circle.cx) ** 2 + (y - circle.cy) ** 2 <= circle.r ** 2) {
    return { section, offsetX: x - circle.cx, offsetY: y - circle.cy };
  }
  return null;
}

function hitRect(x: number, y: number, r: RectObstacle, section: string): HitResult | null {
  if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
    return { section, offsetX: x - r.x, offsetY: y - r.y };
  }
  return null;
}

export function hitTestFlowObstacles(
  x: number,
  y: number,
  obstacles: FlowObstacles,
): HitResult | null {
  return (
    hitRect(x, y, obstacles.leftRect, "left-rect") ??
    hitCircle(x, y, obstacles.leftCirc, "left-circ") ??
    hitRect(x, y, obstacles.rightRect, "right-rect")
  );
}

export function hitTestFlowRichObstacles(
  x: number,
  y: number,
  obstacles: FlowRichObstacles,
): HitResult | null {
  return (
    hitCircle(x, y, obstacles.richCirc, "rich-circ") ??
    hitRect(x, y, obstacles.verticalRect, "vert-rect") ??
    hitRect(x, y, obstacles.rubyRect, "ruby-rect")
  );
}

export function applyFlowDrag(
  obstacles: FlowObstacles,
  section: string,
  x: number,
  y: number,
): FlowObstacles {
  const next = { ...obstacles };
  if (section === "left-rect") {
    next.leftRect = { ...next.leftRect, x, y };
  } else if (section === "left-circ") {
    next.leftCirc = { ...next.leftCirc, cx: x, cy: y };
  } else if (section === "right-rect") {
    next.rightRect = { ...next.rightRect, x, y };
  }
  return next;
}

export function applyFlowRichDrag(
  obstacles: FlowRichObstacles,
  section: string,
  x: number,
  y: number,
): FlowRichObstacles {
  const next = { ...obstacles };
  if (section === "rich-circ") {
    next.richCirc = { ...next.richCirc, cx: x, cy: y };
  } else if (section === "vert-rect") {
    next.verticalRect = { ...next.verticalRect, x, y };
  } else if (section === "ruby-rect") {
    next.rubyRect = { ...next.rubyRect, x, y };
  }
  return next;
}
