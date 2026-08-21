import { Canvas, Flex, toVNode } from "@boundsvg/react";
import { ColorBox, flexBox, growBox, labelBox } from "./helpers";
import { BG, P, R_LG } from "./tokens";
import type { ComparePattern } from "./types";

export const flexPatterns: ComparePattern[] = [
  // 1. flex-row-basic
  {
    id: "flex-row-basic",
    title: "Flex Row Basic",
    description: "3 items in a row + gap",
    category: "flex",
    canvasWidth: 400,
    canvasHeight: 200,
    buildVNode: () =>
      toVNode(
        <Canvas width={400} height={200} background={BG}>
          <Flex
            direction="row"
            justifyContent="start"
            alignItems="center"
            width={400}
            height={200}
            padding={16}
            gap={12}
          >
            {labelBox(P.blue, "A", { w: 80, h: 80 })}
            {labelBox(P.purple, "B", { w: 80, h: 80 })}
            {labelBox(P.pink, "C", { w: 80, h: 80 })}
          </Flex>
        </Canvas>,
      ),
    buildHtml: () => (
      <div
        style={flexBox({
          flexDirection: "row",
          justifyContent: "flex-start",
          alignItems: "center",
          width: 400,
          height: 200,
          padding: 16,
          gap: 12,
          background: BG,
        })}
      >
        <ColorBox color={P.blue} width={80} height={80} label="A" />
        <ColorBox color={P.purple} width={80} height={80} label="B" />
        <ColorBox color={P.pink} width={80} height={80} label="C" />
      </div>
    ),
  },

  // 2. flex-column
  {
    id: "flex-column",
    title: "Flex Column",
    description: "Vertical stack: fixed height + flexGrow + fixed height",
    category: "flex",
    canvasWidth: 300,
    canvasHeight: 300,
    buildVNode: () =>
      toVNode(
        <Canvas width={300} height={300} background={BG}>
          <Flex direction="column" width={300} height={300} padding={12} gap={8}>
            {labelBox(P.blue, "Header", { h: 50 })}
            {growBox(P.purple, "Content (grow)")}
            {labelBox(P.pink, "Footer", { h: 50 })}
          </Flex>
        </Canvas>,
      ),
    buildHtml: () => (
      <div
        style={flexBox({
          flexDirection: "column",
          width: 300,
          height: 300,
          padding: 12,
          gap: 8,
          background: BG,
        })}
      >
        <ColorBox color={P.blue} height={50} label="Header" />
        <ColorBox color={P.purple} label="Content (grow)" flexGrow={1} />
        <ColorBox color={P.pink} height={50} label="Footer" />
      </div>
    ),
  },

  // 3. flex-center
  {
    id: "flex-center",
    title: "Flex Center",
    description: "Centered horizontally and vertically",
    category: "flex",
    canvasWidth: 300,
    canvasHeight: 300,
    buildVNode: () =>
      toVNode(
        <Canvas width={300} height={300} background={BG}>
          <Flex
            direction="column"
            justifyContent="center"
            alignItems="center"
            width={300}
            height={300}
          >
            {labelBox(P.amber, "Center", { w: 120, h: 120, r: R_LG })}
          </Flex>
        </Canvas>,
      ),
    buildHtml: () => (
      <div
        style={flexBox({
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          width: 300,
          height: 300,
          background: BG,
        })}
      >
        <ColorBox color={P.amber} width={120} height={120} label="Center" />
      </div>
    ),
  },

  // 4. flex-space-between
  {
    id: "flex-space-between",
    title: "Flex Space Between",
    description: "Even distribution with space-between",
    category: "flex",
    canvasWidth: 400,
    canvasHeight: 120,
    buildVNode: () =>
      toVNode(
        <Canvas width={400} height={120} background={BG}>
          <Flex
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            width={400}
            height={120}
            padding={16}
          >
            {labelBox(P.blue, "1", { w: 60, h: 60 })}
            {labelBox(P.purple, "2", { w: 60, h: 60 })}
            {labelBox(P.pink, "3", { w: 60, h: 60 })}
            {labelBox(P.amber, "4", { w: 60, h: 60 })}
          </Flex>
        </Canvas>,
      ),
    buildHtml: () => (
      <div
        style={flexBox({
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          width: 400,
          height: 120,
          padding: 16,
          background: BG,
        })}
      >
        <ColorBox color={P.blue} width={60} height={60} label="1" />
        <ColorBox color={P.purple} width={60} height={60} label="2" />
        <ColorBox color={P.pink} width={60} height={60} label="3" />
        <ColorBox color={P.amber} width={60} height={60} label="4" />
      </div>
    ),
  },

  // 5. flex-wrap
  {
    id: "flex-wrap",
    title: "Flex Wrap",
    description: "Wrapping with flex-wrap",
    category: "flex",
    canvasWidth: 300,
    canvasHeight: 300,
    buildVNode: () =>
      toVNode(
        <Canvas width={300} height={300} background={BG}>
          <Flex
            direction="row"
            alignItems="start"
            width={300}
            height={300}
            padding={12}
            gap={8}
            wrap="wrap"
          >
            {labelBox(P.blue, "1", { w: 80, h: 80 })}
            {labelBox(P.purple, "2", { w: 80, h: 80 })}
            {labelBox(P.pink, "3", { w: 80, h: 80 })}
            {labelBox(P.amber, "4", { w: 80, h: 80 })}
            {labelBox(P.green, "5", { w: 80, h: 80 })}
          </Flex>
        </Canvas>,
      ),
    buildHtml: () => (
      <div
        style={flexBox({
          flexDirection: "row",
          alignItems: "flex-start",
          flexWrap: "wrap",
          width: 300,
          height: 300,
          padding: 12,
          gap: 8,
          background: BG,
        })}
      >
        <ColorBox color={P.blue} width={80} height={80} label="1" />
        <ColorBox color={P.purple} width={80} height={80} label="2" />
        <ColorBox color={P.pink} width={80} height={80} label="3" />
        <ColorBox color={P.amber} width={80} height={80} label="4" />
        <ColorBox color={P.green} width={80} height={80} label="5" />
      </div>
    ),
  },

  // 6. flex-grow
  {
    id: "flex-grow",
    title: "Flex Grow Ratio",
    description: "Grow ratio 1:2:1",
    category: "flex",
    canvasWidth: 400,
    canvasHeight: 120,
    buildVNode: () =>
      toVNode(
        <Canvas width={400} height={120} background={BG}>
          <Flex direction="row" width={400} height={120} padding={12} gap={8}>
            {growBox(P.blue, "1", 1)}
            {growBox(P.purple, "2", 2)}
            {growBox(P.pink, "1", 1)}
          </Flex>
        </Canvas>,
      ),
    buildHtml: () => (
      <div
        style={flexBox({
          flexDirection: "row",
          width: 400,
          height: 120,
          padding: 12,
          gap: 8,
          background: BG,
        })}
      >
        <ColorBox color={P.blue} label="1" flexGrow={1} />
        <ColorBox color={P.purple} label="2" flexGrow={2} />
        <ColorBox color={P.pink} label="1" flexGrow={1} />
      </div>
    ),
  },

  // 7. flex-nested
  {
    id: "flex-nested",
    title: "Flex Nested",
    description: "Nested: row > column",
    category: "flex",
    canvasWidth: 400,
    canvasHeight: 250,
    buildVNode: () =>
      toVNode(
        <Canvas width={400} height={250} background={BG}>
          <Flex direction="row" width={400} height={250} padding={12} gap={12}>
            {labelBox(P.blue, "Sidebar", { w: 120 })}
            <Flex direction="column" flexGrow={1} gap={8}>
              {labelBox(P.purple, "Top", { h: 60 })}
              {growBox(P.pink, "Bottom (grow)")}
            </Flex>
          </Flex>
        </Canvas>,
      ),
    buildHtml: () => (
      <div
        style={flexBox({
          flexDirection: "row",
          width: 400,
          height: 250,
          padding: 12,
          gap: 12,
          background: BG,
        })}
      >
        <ColorBox color={P.blue} width={120} label="Sidebar" />
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: 8, minWidth: 0 }}>
          <ColorBox color={P.purple} height={60} label="Top" />
          <ColorBox color={P.pink} label="Bottom (grow)" flexGrow={1} />
        </div>
      </div>
    ),
  },
];
