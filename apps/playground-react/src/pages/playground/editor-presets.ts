import {
  createBoxLayer,
  createShapeLayer,
  createTextLayer,
  type EditorDocument,
} from "./editor-model";

type EditorPreset = {
  id: string;
  label: string;
  description: string;
  document: EditorDocument;
};

export const EDITOR_PRESETS: EditorPreset[] = [
  {
    id: "vertical-ruby",
    label: "Vertical Ruby Editorial",
    description: "Edit vertical text, multi-level Ruby, and upright runs.",
    document: {
      canvas: {
        width: 640,
        height: 960,
        background: "#f5efe3",
        sizeLocked: false,
        followWritingMode: true,
      },
      layers: [
        createTextLayer({
          id: "vertical-title",
          name: "Vertical body",
          x: 72,
          y: 72,
          width: 496,
          height: 816,
          font: "NotoSerifJP-woff2",
          fontSizePx: 34,
          color: "#292524",
          writingMode: "vertical-rl",
          fit: "shrink",
          runs: [
            { id: "vr-1", kind: "text", text: "春の朝、空が少しずつ明るくなり、" },
            {
              id: "vr-2",
              kind: "ruby",
              base: "山の端",
              rubyText: "やまのは",
              extraRubyText: "horizon",
              rubyPosition: "alternate",
              rubyAlign: "center",
              rubyGapPx: 1,
              rubyOffsetPx: 0,
              rubyLineSizing: "stable",
            },
            { id: "vr-3", kind: "text", text: "にやわらかな光が広がります。縦書きでも" },
            {
              id: "vr-4",
              kind: "inline",
              text: "API 2026",
              color: "#b45309",
              textOrientation: "upright",
            },
            { id: "vr-5", kind: "text", text: "の文字方向を確認できます。" },
          ],
        }),
      ],
    },
  },
  {
    id: "flow-magazine",
    label: "Magazine Text Flow",
    description: "Drag the Shape and watch the body text reflow in real time.",
    document: (() => {
      const obstacle = createShapeLayer({
        id: "flow-obstacle",
        name: "Flow obstacle",
        x: 540,
        y: 150,
        width: 230,
        height: 190,
        shapeKind: "callout",
        fill: "#0ea5e9",
        stroke: "#bae6fd",
      });
      const text = createTextLayer({
        id: "flow-text",
        name: "Magazine body",
        x: 70,
        y: 100,
        width: 800,
        height: 430,
        fontSizePx: 25,
        color: "#e2e8f0",
        fit: "shrink",
        maxLines: 12,
        ellipsis: true,
        runs: [
          {
            id: "flow-run",
            kind: "text",
            text: "実用的なレイアウトでは、写真や図版、引用ボックスを避けながら本文を流し込みます。障害物を動かすと、WASMの計測結果に従って行がリアルタイムに再構成されます。縦書きへの切り替え、禁則処理、fit shrink、ellipsisも同じ編集面から確認できます。",
          },
        ],
        flowBindings: [{ layerId: obstacle.id, marginPx: 18 }],
      });
      return {
        canvas: {
          width: 960,
          height: 640,
          background: "#172033",
          sizeLocked: false,
          followWritingMode: false,
        },
        layers: [text, obstacle],
      };
    })(),
  },
  {
    id: "telop",
    label: "Broadcast Lower Third",
    description: "A practical multi-stroke, shadow, and gradient Box composition.",
    document: {
      canvas: {
        width: 960,
        height: 540,
        background: "#1e293b",
        sizeLocked: true,
        followWritingMode: false,
      },
      layers: [
        createBoxLayer({
          id: "telop-bar",
          name: "Lower third",
          x: 60,
          y: 350,
          width: 840,
          height: 130,
          background: "linear-gradient(90deg, #be123c, #7c3aed)",
          borderWidth: 0,
          borderRadius: 16,
        }),
        createTextLayer({
          id: "telop-text",
          name: "Headline",
          x: 100,
          y: 372,
          width: 760,
          height: 90,
          fontSizePx: 54,
          fit: "shrink",
          wrap: "none",
          runs: [{ id: "telop-run", kind: "text", text: "BREAKING — boundsvg Editor" }],
          strokes: [
            { color: "#0f172a", widthPx: 16 },
            { color: "#ffffff", widthPx: 7 },
          ],
          shadows: [{ dx: 6, dy: 7, blurPx: 8, color: "#000000" }],
        }),
      ],
    },
  },
];
