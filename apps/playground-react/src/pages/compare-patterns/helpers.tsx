import { Flex, Text } from "@boundsvg/react";
import type { CSSProperties } from "react";
import { FONT, FONT_CSS, FS, R, TEXT_COLOR } from "./tokens";

// ---------------------------------------------------------------------------
// VNode helpers
// ---------------------------------------------------------------------------

/** Box + Text label (fixed or auto sized) */
export function labelBox(
  color: string,
  label: string,
  options?: {
    w?: number;
    h?: number;
    r?: number;
    fs?: number;
    gridColumn?: string;
    gridRow?: string;
  },
) {
  return (
    <Flex
      direction="column"
      alignItems="center"
      justifyContent="center"
      width={options?.w}
      height={options?.h}
      background={color}
      borderRadius={options?.r ?? R}
      gridColumn={options?.gridColumn}
      gridRow={options?.gridRow}
      padding={8}
      minWidth={0}
      minHeight={0}
    >
      <Text font={FONT} fontSizePx={options?.fs ?? FS} color={TEXT_COLOR} wrap="none">
        {label}
      </Text>
    </Flex>
  );
}

/** Flex + Text (stretches with flexGrow) */
export function growBox(color: string, label: string, grow = 1, fontSize = FS) {
  return (
    <Flex
      direction="column"
      alignItems="center"
      justifyContent="center"
      flexGrow={grow}
      background={color}
      borderRadius={R}
      padding={8}
      minWidth={0}
      minHeight={0}
    >
      <Text font={FONT} fontSizePx={fontSize} color={TEXT_COLOR} wrap="none">
        {label}
      </Text>
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/** flex container base style */
export function flexBox(extra: CSSProperties): CSSProperties {
  return { display: "flex", boxSizing: "border-box", ...extra };
}

/** grid container base style */
export function gridBox(extra: CSSProperties): CSSProperties {
  return { display: "grid", boxSizing: "border-box", ...extra };
}

/** Colored placeholder box used in layout demos */
export function ColorBox({
  color,
  width,
  height,
  label,
  flexGrow,
  gridColumn,
  gridRow,
}: {
  color: string;
  width?: number;
  height?: number;
  label?: string;
  flexGrow?: number;
  gridColumn?: string;
  gridRow?: string;
}) {
  return (
    <div
      style={{
        background: color,
        borderRadius: R,
        width: width != null ? width : undefined,
        height: height != null ? height : undefined,
        flexGrow: flexGrow ?? undefined,
        gridColumn: gridColumn ?? undefined,
        gridRow: gridRow ?? undefined,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT_CSS,
        fontSize: FS,
        color: TEXT_COLOR,
        padding: 8,
        minWidth: 0,
        minHeight: 0,
        boxSizing: "border-box" as const,
      }}
    >
      {label}
    </div>
  );
}
