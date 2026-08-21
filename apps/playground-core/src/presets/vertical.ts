import { Canvas, Flex, Text } from "@boundsvg/core";
import { FONT_ALIAS as FA } from "../config";
import type { Preset } from "../types";

export const verticalPreset: Preset = {
  title: "Vertical Japanese",
  description:
    "Vertical Japanese where kinsoku is visible at the column breaks: the first column is exactly one character over capacity, so its kuten hangs past the box (burasage); the second column hangs a comma the same way. Half-width runs rotate and the dash pair never splits.",
  source: `import { Canvas, Flex, Text } from "@boundsvg/core";

const vnode = Canvas(
  { width: 800, height: 300, background: "#1a1a1a" },
  Flex(
    { direction: "row", width: 800, height: 300, padding: [20, 24, 20, 24] },
    Flex({ flexGrow: 1 }),
    Text(
      { font: "${FA}", fontSizePx: 28, color: "#fef3c7",
        writingMode: "vertical-rl", wrap: "char",
        language: "ja", hangingPunctuation: true },
      "この列は九文字です。句点は行頭に来ず、ぶら下げで処理されます。半角のABCや123は自動回転。「括弧」やダッシュ——も正しく扱われます。",
    ),
  ),
);

const svg = engine.renderToSvg(vnode);`,
  build: () =>
    Canvas(
      { width: 800, height: 300, background: "#1a1a1a" },
      Flex(
        {
          direction: "row",
          width: 800,
          height: 300,
          padding: [20, 24, 20, 24],
        },
        Flex({ flexGrow: 1 }),
        Text(
          {
            font: FA,
            fontSizePx: 28,
            color: "#fef3c7",
            writingMode: "vertical-rl",
            wrap: "char",
            language: "ja",
            hangingPunctuation: true,
          },
          "この列は九文字です。句点は行頭に来ず、ぶら下げで処理されます。半角のABCや123は自動回転。「括弧」やダッシュ——も正しく扱われます。",
        ),
      ),
    ),
};
