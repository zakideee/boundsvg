import { Box, Canvas, Flex, Text, toVNode } from "@boundsvg/react";
import { ColorBox, flexBox, growBox, labelBox } from "./helpers";
import { BG, BG_DARK, FONT, FONT_CSS, FS_XS, P, R_LG, R_SM } from "./tokens";
import type { ComparePattern } from "./types";

export const compositePatterns: ComparePattern[] = [
  // 11. holy-grail
  {
    id: "holy-grail",
    title: "Holy Grail",
    description: "Header + Sidebar + Main + Footer",
    category: "composite",
    canvasWidth: 500,
    canvasHeight: 350,
    buildVNode: () =>
      toVNode(
        <Canvas width={500} height={350} background={BG}>
          <Flex direction="column" width={500} height={350}>
            {labelBox(P.blue, "Header", { h: 50 })}
            <Flex direction="row" flexGrow={1} minHeight={0}>
              {labelBox(P.purple, "Sidebar", { w: 100 })}
              {growBox(P.slate, "Main")}
            </Flex>
            {labelBox(P.pink, "Footer", { h: 40 })}
          </Flex>
        </Canvas>,
      ),
    buildHtml: () => (
      <div style={flexBox({ flexDirection: "column", width: 500, height: 350, background: BG })}>
        <ColorBox color={P.blue} height={50} label="Header" />
        <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
          <ColorBox color={P.purple} width={100} label="Sidebar" />
          <ColorBox color={P.slate} label="Main" flexGrow={1} />
        </div>
        <ColorBox color={P.pink} height={40} label="Footer" />
      </div>
    ),
  },

  // 12. card-layout
  {
    id: "card-layout",
    title: "Card Layout",
    description: "Card-style wrap layout",
    category: "composite",
    canvasWidth: 400,
    canvasHeight: 320,
    buildVNode: () => {
      const card = (color: string, label: string) => (
        <Box
          width={110}
          height={130}
          background={BG}
          borderRadius={R_LG}
          borderWidth={1}
          borderColor={P.slate}
          padding={10}
        >
          <Flex direction="column" gap={6} width={88} height={108}>
            <Box height={60} background={color} borderRadius={R_SM} />
            <Text font={FONT} fontSizePx={FS_XS} color="#e2e8f0" wrap="char">
              {label}
            </Text>
          </Flex>
        </Box>
      );
      return toVNode(
        <Canvas width={400} height={320} background={BG_DARK}>
          <Flex
            direction="row"
            wrap="wrap"
            alignItems="start"
            width={400}
            height={320}
            padding={16}
            gap={12}
          >
            {card(P.blue, "Card A")}
            {card(P.purple, "Card B")}
            {card(P.pink, "Card C")}
            {card(P.amber, "Card D")}
            {card(P.green, "Card E")}
          </Flex>
        </Canvas>,
      );
    },
    buildHtml: () => {
      const card = (color: string, label: string) => (
        <div
          style={{
            width: 110,
            height: 130,
            background: BG,
            borderRadius: R_LG,
            border: `1px solid ${P.slate}`,
            padding: 10,
            boxSizing: "border-box" as const,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column" as const,
              gap: 6,
              width: 88,
              height: 108,
            }}
          >
            <div style={{ height: 60, background: color, borderRadius: R_SM }} />
            <div style={{ fontFamily: FONT_CSS, fontSize: FS_XS, color: "#e2e8f0" }}>{label}</div>
          </div>
        </div>
      );
      return (
        <div
          style={flexBox({
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "flex-start",
            width: 400,
            height: 320,
            padding: 16,
            gap: 12,
            background: BG_DARK,
          })}
        >
          {card(P.blue, "Card A")}
          {card(P.purple, "Card B")}
          {card(P.pink, "Card C")}
          {card(P.amber, "Card D")}
          {card(P.green, "Card E")}
        </div>
      );
    },
  },

  // 13. sidebar-layout
  {
    id: "sidebar-layout",
    title: "Sidebar Layout",
    description: "Fixed sidebar + flexible content",
    category: "composite",
    canvasWidth: 500,
    canvasHeight: 300,
    buildVNode: () =>
      toVNode(
        <Canvas width={500} height={300} background={BG_DARK}>
          <Flex direction="row" width={500} height={300} gap={0}>
            <Flex direction="column" width={140} height={300} background={BG} padding={12} gap={8}>
              {labelBox(P.blue, "Nav 1", { h: 32, r: R_SM })}
              {labelBox(P.blue, "Nav 2", { h: 32, r: R_SM })}
              {labelBox(P.blue, "Nav 3", { h: 32, r: R_SM })}
            </Flex>
            <Flex
              direction="column"
              flexGrow={1}
              minWidth={0}
              background={P.slate}
              padding={16}
              gap={8}
            >
              <Text font={FONT} fontSizePx={18} color="#f8fafc">
                Content Area
              </Text>
              <Text font={FONT} fontSizePx={13} color="#94a3b8" wrap="char">
                This is the main content that expands to fill the remaining space.
              </Text>
            </Flex>
          </Flex>
        </Canvas>,
      ),
    buildHtml: () => (
      <div
        style={flexBox({
          flexDirection: "row",
          width: 500,
          height: 300,
          gap: 0,
          background: BG_DARK,
        })}
      >
        <div
          style={flexBox({
            flexDirection: "column",
            width: 140,
            height: 300,
            background: BG,
            padding: 12,
            gap: 8,
          })}
        >
          <ColorBox color={P.blue} height={32} label="Nav 1" />
          <ColorBox color={P.blue} height={32} label="Nav 2" />
          <ColorBox color={P.blue} height={32} label="Nav 3" />
        </div>
        <div
          style={flexBox({
            flexGrow: 1,
            background: P.slate,
            padding: 16,
            flexDirection: "column",
            gap: 8,
            minWidth: 0,
          })}
        >
          <div style={{ fontFamily: FONT_CSS, fontSize: 18, color: "#f8fafc" }}>Content Area</div>
          <div
            style={{
              fontFamily: FONT_CSS,
              fontSize: 13,
              color: "#94a3b8",
              overflowWrap: "break-word",
            }}
          >
            This is the main content that expands to fill the remaining space.
          </div>
        </div>
      </div>
    ),
  },
];
