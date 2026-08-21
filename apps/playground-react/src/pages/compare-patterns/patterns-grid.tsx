import { Canvas, Grid, toVNode } from "@boundsvg/react";
import { ColorBox, gridBox, labelBox } from "./helpers";
import { BG, P } from "./tokens";
import type { ComparePattern } from "./types";

export const gridPatterns: ComparePattern[] = [
  // 8. grid-basic
  {
    id: "grid-basic",
    title: "Grid Basic",
    description: "3x2 uniform grid",
    category: "grid",
    canvasWidth: 400,
    canvasHeight: 280,
    buildVNode: () =>
      toVNode(
        <Canvas width={400} height={280} background={BG}>
          <Grid
            templateColumns="1fr 1fr 1fr"
            templateRows="1fr 1fr"
            gap={10}
            width={400}
            height={280}
            padding={12}
          >
            {labelBox(P.blue, "1")}
            {labelBox(P.purple, "2")}
            {labelBox(P.pink, "3")}
            {labelBox(P.amber, "4")}
            {labelBox(P.green, "5")}
            {labelBox(P.cyan, "6")}
          </Grid>
        </Canvas>,
      ),
    buildHtml: () => (
      <div
        style={gridBox({
          gridTemplateColumns: "1fr 1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 10,
          width: 400,
          height: 280,
          padding: 12,
          background: BG,
        })}
      >
        <ColorBox color={P.blue} label="1" />
        <ColorBox color={P.purple} label="2" />
        <ColorBox color={P.pink} label="3" />
        <ColorBox color={P.amber} label="4" />
        <ColorBox color={P.green} label="5" />
        <ColorBox color={P.cyan} label="6" />
      </div>
    ),
  },

  // 9. grid-span
  {
    id: "grid-span",
    title: "Grid Span",
    description: "gridColumn / gridRow span",
    category: "grid",
    canvasWidth: 400,
    canvasHeight: 300,
    buildVNode: () =>
      toVNode(
        <Canvas width={400} height={300} background={BG}>
          <Grid
            templateColumns="1fr 1fr 1fr"
            templateRows="1fr 1fr 1fr"
            gap={10}
            width={400}
            height={300}
            padding={12}
          >
            {labelBox(P.blue, "span 2 cols", { gridColumn: "1 / 3" })}
            {labelBox(P.purple, "span 2 rows", { gridRow: "1 / 3" })}
            {labelBox(P.pink, "A")}
            {labelBox(P.amber, "B")}
            {labelBox(P.green, "span full row", { gridColumn: "1 / 4" })}
          </Grid>
        </Canvas>,
      ),
    buildHtml: () => (
      <div
        style={gridBox({
          gridTemplateColumns: "1fr 1fr 1fr",
          gridTemplateRows: "1fr 1fr 1fr",
          gap: 10,
          width: 400,
          height: 300,
          padding: 12,
          background: BG,
        })}
      >
        <ColorBox color={P.blue} gridColumn="1 / 3" label="span 2 cols" />
        <ColorBox color={P.purple} gridRow="1 / 3" label="span 2 rows" />
        <ColorBox color={P.pink} label="A" />
        <ColorBox color={P.amber} label="B" />
        <ColorBox color={P.green} gridColumn="1 / 4" label="span full row" />
      </div>
    ),
  },

  // 10. grid-mixed
  {
    id: "grid-mixed",
    title: "Grid Mixed Columns",
    description: "Fixed + fr mixed columns",
    category: "grid",
    canvasWidth: 500,
    canvasHeight: 200,
    buildVNode: () =>
      toVNode(
        <Canvas width={500} height={200} background={BG}>
          <Grid
            templateColumns="100px 1fr 2fr"
            templateRows="1fr"
            gap={10}
            width={500}
            height={200}
            padding={12}
          >
            {labelBox(P.blue, "100px")}
            {labelBox(P.purple, "1fr")}
            {labelBox(P.pink, "2fr")}
          </Grid>
        </Canvas>,
      ),
    buildHtml: () => (
      <div
        style={gridBox({
          gridTemplateColumns: "100px 1fr 2fr",
          gridTemplateRows: "1fr",
          gap: 10,
          width: 500,
          height: 200,
          padding: 12,
          background: BG,
        })}
      >
        <ColorBox color={P.blue} label="100px" />
        <ColorBox color={P.purple} label="1fr" />
        <ColorBox color={P.pink} label="2fr" />
      </div>
    ),
  },
];
