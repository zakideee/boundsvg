import { Box, type BoxPosition, Canvas, type RelativePosition, Text } from "../../dist/index.js";
import type { BoxPosition as ScenePosition } from "../../dist/scene.js";
import type { BoxPosition as VNodePosition } from "../../dist/vnode.js";

const ratio: RelativePosition = { x: 0.3, y: 0.5 };
const position: BoxPosition = "center";
const scenePosition: ScenePosition = ratio;
const vnodePosition: VNodePosition = position;
Box({ transformOrigin: ratio, transform: { rotateDeg: 90 } });
Text({ font: "F", fontSizePx: 12, transformOrigin: position }, "text");
void scenePosition;
void vnodePosition;
// @ts-expect-error Unsupported keyword order is not part of the closed vocabulary.
Box({ transformOrigin: "left top" });
// @ts-expect-error Both explicit axes are required.
Box({ transformOrigin: { x: 0.3 } });
// @ts-expect-error Canvas does not own static transforms.
Canvas({ width: 10, height: 10, transformOrigin: "center" });
Box({
  animate: {
    durationMs: 100,
    keyframes: [
      {
        at: 0,
        transform: {
          // @ts-expect-error Animation transforms retain their fixed center origin.
          transformOrigin: "center",
        },
      },
      { at: 1, transform: {} },
    ],
  },
});
