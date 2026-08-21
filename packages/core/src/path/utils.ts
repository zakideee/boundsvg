type PathBounds = {
  minX: number;
  maxX: number;
};

type PathBBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type PathCursor = {
  currentX: number;
  currentY: number;
  subpathStartX: number;
  subpathStartY: number;
};

const PATH_TOKEN_RE = /[MLHVQCZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

function formatPathNumber(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function rotatePoint(
  point: { x: number; y: number },
  center: { x: number; y: number },
  degrees: number,
): {
  x: number;
  y: number;
} {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function readFloats(tokens: string[], startIdx: number, count: number): number[] | null {
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const parsed = Number.parseFloat(tokens[startIdx + i] ?? "");
    if (!Number.isFinite(parsed)) {
      return null;
    }
    result.push(parsed);
  }
  return result;
}

export function parsePathBounds(pathData: string): PathBounds | null {
  const bbox = parsePathBBox(pathData);
  if (!bbox) {
    return null;
  }
  return { minX: bbox.minX, maxX: bbox.maxX };
}

/**
 * Return the number of numeric parameters for a given SVG path command.
 * Returns -1 for unknown commands, 0 for Z (no params).
 */
function getParamCount(cmd: string): number {
  switch (cmd) {
    case "M":
    case "L":
      return 2;
    case "H":
    case "V":
      return 1;
    case "Q":
      return 4;
    case "C":
      return 6;
    case "Z":
      return 0;
    default:
      return -1;
  }
}

function readCommandParams(
  tokens: string[],
  startIdx: number,
  cmd: string,
): { params: number[]; nextIdx: number } | null {
  const paramCount = getParamCount(cmd);
  if (paramCount < 0) {
    return null;
  }
  if (paramCount === 0) {
    return { params: [], nextIdx: startIdx };
  }
  const params = readFloats(tokens, startIdx, paramCount);
  if (!params) {
    return null;
  }
  return { params, nextIdx: startIdx + paramCount };
}

function applyBBoxCommand(options: {
  cmd: string;
  params: number[];
  cursor: PathCursor;
  visitPoint: (x: number, y: number) => void;
}): boolean {
  const { cmd, params, cursor, visitPoint } = options;
  switch (cmd) {
    case "M":
    case "L": {
      const px = params[0] ?? 0;
      const py = params[1] ?? 0;
      visitPoint(px, py);
      cursor.currentX = px;
      cursor.currentY = py;
      if (cmd === "M") {
        cursor.subpathStartX = px;
        cursor.subpathStartY = py;
      }
      return true;
    }
    case "H": {
      const px = params[0] ?? 0;
      visitPoint(px, cursor.currentY);
      cursor.currentX = px;
      return true;
    }
    case "V": {
      const py = params[0] ?? 0;
      visitPoint(cursor.currentX, py);
      cursor.currentY = py;
      return true;
    }
    case "Q": {
      const cpx = params[0] ?? 0;
      const cpy = params[1] ?? 0;
      const px = params[2] ?? 0;
      const py = params[3] ?? 0;
      visitPoint(cpx, cpy);
      visitPoint(px, py);
      cursor.currentX = px;
      cursor.currentY = py;
      return true;
    }
    case "C": {
      const cp1x = params[0] ?? 0;
      const cp1y = params[1] ?? 0;
      const cp2x = params[2] ?? 0;
      const cp2y = params[3] ?? 0;
      const px = params[4] ?? 0;
      const py = params[5] ?? 0;
      visitPoint(cp1x, cp1y);
      visitPoint(cp2x, cp2y);
      visitPoint(px, py);
      cursor.currentX = px;
      cursor.currentY = py;
      return true;
    }
    case "Z":
      cursor.currentX = cursor.subpathStartX;
      cursor.currentY = cursor.subpathStartY;
      return true;
    default:
      return false;
  }
}

export function parsePathBBox(pathData: string): PathBBox | null {
  const tokens = pathData.match(PATH_TOKEN_RE);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let idx = 0;
  const cursor: PathCursor = {
    currentX: 0,
    currentY: 0,
    subpathStartX: 0,
    subpathStartY: 0,
  };

  const visitPoint = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };

  while (idx < tokens.length) {
    const cmd = tokens[idx++];
    if (!cmd) {
      break;
    }

    const parsed = readCommandParams(tokens, idx, cmd);
    if (!parsed) {
      return null;
    }
    idx = parsed.nextIdx;

    if (!applyBBoxCommand({ cmd, params: parsed.params, cursor, visitPoint })) {
      return null;
    }
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function readPathPoint(
  tokens: string[],
  startIdx: number,
): { point: { x: number; y: number }; nextIdx: number } | null {
  const values = readFloats(tokens, startIdx, 2);
  if (!values) {
    return null;
  }
  return {
    point: { x: values[0] ?? 0, y: values[1] ?? 0 },
    nextIdx: startIdx + 2,
  };
}

function readPathNumber(
  tokens: string[],
  startIdx: number,
): { value: number; nextIdx: number } | null {
  const values = readFloats(tokens, startIdx, 1);
  if (!values) {
    return null;
  }
  return {
    value: values[0] ?? 0,
    nextIdx: startIdx + 1,
  };
}

function formatTransformedPoint(
  point: { x: number; y: number },
  transformPoint: (x: number, y: number) => { x: number; y: number },
): string {
  const transformed = transformPoint(point.x, point.y);
  return `${formatPathNumber(transformed.x)},${formatPathNumber(transformed.y)}`;
}

function transformCommandSegment(options: {
  cmd: string;
  tokens: string[];
  startIdx: number;
  cursor: PathCursor;
  transformPoint: (x: number, y: number) => { x: number; y: number };
}): { segment: string; nextIdx: number } | null {
  const { cmd, tokens, startIdx, cursor, transformPoint } = options;
  switch (cmd) {
    case "M":
    case "L": {
      const parsed = readPathPoint(tokens, startIdx);
      if (!parsed) {
        return null;
      }
      cursor.currentX = parsed.point.x;
      cursor.currentY = parsed.point.y;
      if (cmd === "M") {
        cursor.subpathStartX = parsed.point.x;
        cursor.subpathStartY = parsed.point.y;
      }
      return {
        segment: `${cmd}${formatTransformedPoint(parsed.point, transformPoint)}`,
        nextIdx: parsed.nextIdx,
      };
    }
    case "H": {
      const parsed = readPathNumber(tokens, startIdx);
      if (!parsed) {
        return null;
      }
      cursor.currentX = parsed.value;
      return {
        segment: `L${formatTransformedPoint(
          { x: cursor.currentX, y: cursor.currentY },
          transformPoint,
        )}`,
        nextIdx: parsed.nextIdx,
      };
    }
    case "V": {
      const parsed = readPathNumber(tokens, startIdx);
      if (!parsed) {
        return null;
      }
      cursor.currentY = parsed.value;
      return {
        segment: `L${formatTransformedPoint(
          { x: cursor.currentX, y: cursor.currentY },
          transformPoint,
        )}`,
        nextIdx: parsed.nextIdx,
      };
    }
    case "Q": {
      const control = readPathPoint(tokens, startIdx);
      if (!control) {
        return null;
      }
      const endPoint = readPathPoint(tokens, control.nextIdx);
      if (!endPoint) {
        return null;
      }
      cursor.currentX = endPoint.point.x;
      cursor.currentY = endPoint.point.y;
      return {
        segment: `Q${formatTransformedPoint(control.point, transformPoint)} ${formatTransformedPoint(
          endPoint.point,
          transformPoint,
        )}`,
        nextIdx: endPoint.nextIdx,
      };
    }
    case "C": {
      const control1 = readPathPoint(tokens, startIdx);
      if (!control1) {
        return null;
      }
      const control2 = readPathPoint(tokens, control1.nextIdx);
      if (!control2) {
        return null;
      }
      const endPoint = readPathPoint(tokens, control2.nextIdx);
      if (!endPoint) {
        return null;
      }
      cursor.currentX = endPoint.point.x;
      cursor.currentY = endPoint.point.y;
      return {
        segment:
          `C${formatTransformedPoint(control1.point, transformPoint)} ` +
          `${formatTransformedPoint(control2.point, transformPoint)} ` +
          `${formatTransformedPoint(endPoint.point, transformPoint)}`,
        nextIdx: endPoint.nextIdx,
      };
    }
    case "Z":
      cursor.currentX = cursor.subpathStartX;
      cursor.currentY = cursor.subpathStartY;
      return { segment: "Z", nextIdx: startIdx };
    default:
      return null;
  }
}

export function transformPathData(
  pathData: string,
  transformPoint: (x: number, y: number) => { x: number; y: number },
): string {
  const tokens = pathData.match(PATH_TOKEN_RE);
  if (!tokens || tokens.length === 0) {
    return pathData;
  }

  let idx = 0;
  const out: string[] = [];
  const cursor: PathCursor = {
    currentX: 0,
    currentY: 0,
    subpathStartX: 0,
    subpathStartY: 0,
  };

  while (idx < tokens.length) {
    const cmd = tokens[idx++];
    if (!cmd) {
      break;
    }

    const transformed = transformCommandSegment({
      cmd,
      tokens,
      startIdx: idx,
      cursor,
      transformPoint,
    });
    if (!transformed) {
      return pathData;
    }
    idx = transformed.nextIdx;
    out.push(transformed.segment);
  }

  return out.join("");
}
