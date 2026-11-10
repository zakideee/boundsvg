import { Box, Canvas, Path, Text, toVNode } from "@boundsvg/react";
import type { TemplateDef } from "./types";

/** Mirrored motion from the Core live-interaction sample. */
const MOTION = {
  keyframes: [
    { at: 0, transform: { translateX: 0, scaleX: 1 } },
    { at: 0.5, transform: { translateX: 80, scaleX: 0 } },
    { at: 1, transform: { translateX: 0, scaleX: 1 } },
  ],
  durationMs: 2400,
  iterations: "infinite",
  easing: "linear",
} as const;
/** Source references are connected to callbacks by the interactive page. */
const HANDLERS = {
  onPointerEnter: "live-enter",
  onPointerLeave: "live-leave",
  onClick: "live-click",
};

/** JSX counterpart of the Core sample, also available in the template selector. */
export const LIVE_INTERACTION_TEMPLATE: TemplateDef = {
  title: "Live paint and Frames",
  description:
    "Stationary hover follows native paint and rectangular Frames with current endpoint poses and strict clip/viewport interiors. The midpoint has zero Frame width. External individual transforms/3D and clip/mask/style mutations are outside the Frame guarantee.",
  animatedSvgOptions: { playback: { mode: "independent" } },
  vnode: toVNode(
    <Canvas width={780} height={220} background="#101827">
      <Text
        position="absolute"
        left={20}
        top={12}
        font="NotoSansJP-woff2"
        fontSizePx={16}
        color="white"
      >
        Stationary pointer: native paint / Frame / rounded BoxClip
      </Text>
      <Path
        id="live-paint"
        position="absolute"
        left={20}
        top={60}
        width={120}
        height={70}
        d="M28 0H92Q120 0 120 28V42Q120 70 92 70H28Q0 70 0 42V28Q0 0 28 0Z"
        fill="#38bdf8"
        animate={MOTION}
        {...HANDLERS}
      />
      <Box
        id="live-frame"
        position="absolute"
        left={270}
        top={60}
        width={120}
        height={70}
        borderRadius={28}
        animate={MOTION}
        {...HANDLERS}
      >
        <Text font="NotoSansJP-woff2" fontSizePx={18} color="#a78bfa">
          Frame
        </Text>
      </Box>
      <Box
        id="live-clip"
        position="absolute"
        left={520}
        top={60}
        width={120}
        height={70}
        borderRadius={28}
        overflow="clip"
        animate={MOTION}
        {...HANDLERS}
      >
        <Text font="NotoSansJP-woff2" fontSizePx={18} color="#34d399">
          BoxClip
        </Text>
      </Box>
      <Text
        position="absolute"
        left={20}
        top={160}
        width={740}
        font="NotoSansJP-woff2"
        fontSizePx={13}
        color="#cbd5e1"
      >
        Frame corners are rectangular unless clipped. External individual transforms/3D and
        clip/mask/pointer-events/visibility/display changes are outside Frame support.
      </Text>
    </Canvas>,
  ),
};
