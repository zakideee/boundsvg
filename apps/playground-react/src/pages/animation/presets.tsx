import {
  type AnimationSpec,
  Box,
  Canvas,
  Flex,
  Inline,
  Rt,
  Ruby,
  Text,
  toVNode,
  type VNode,
} from "@boundsvg/react";
import {
  DEFAULT_TEXT_UNIT_PLAYGROUND_CONTROLS,
  type TextUnitPlaygroundControls,
} from "../../../../playground-shared/animation-playground.js";

const FONT = "NotoSansJP-woff2";

export type AnimationPresetKey =
  | "hero-card"
  | "signal-orbit"
  | "title-sequence"
  | "cluster-entrance"
  | "cluster-bounce"
  | "line-reveal"
  | "ruby-vertical";

type AnimationPreset = {
  label: string;
  description: string;
  durationMs: number;
  posterTimeMs: number;
  runtime: "Node animation" | "Text-unit animation";
  defaultControls?: TextUnitPlaygroundControls;
  supportsWritingMode?: boolean;
  build: (controls: TextUnitPlaygroundControls, animationEnabled?: boolean) => VNode;
};

const DEFAULT_UNIT_CONTROLS = DEFAULT_TEXT_UNIT_PLAYGROUND_CONTROLS;
/**
 * Long enough that the staggered cascade finishes and holds before the loop
 * resets. At the default 900 ms every cluster restarts before the last one has
 * arrived, which reads as a permanent flicker rather than an entrance.
 */
const CLUSTER_ENTRANCE_CONTROLS: TextUnitPlaygroundControls = {
  ...DEFAULT_UNIT_CONTROLS,
  delayStepMs: 34,
  durationMs: 3_200,
  easing: "ease-out",
};
const CLUSTER_BOUNCE_CONTROLS: TextUnitPlaygroundControls = {
  ...DEFAULT_UNIT_CONTROLS,
  delayStepMs: 72,
  durationMs: 800,
  easing: "ease-in-out",
};
const LINE_REVEAL_CONTROLS: TextUnitPlaygroundControls = {
  ...DEFAULT_UNIT_CONTROLS,
  by: "line",
  delayStepMs: 190,
  durationMs: 760,
  easing: "ease-out",
};
const RUBY_VERTICAL_CONTROLS: TextUnitPlaygroundControls = {
  ...DEFAULT_UNIT_CONTROLS,
  delayStepMs: 68,
  ruby: "separate",
  durationMs: 1_000,
};

function unitAnimation(
  controls: TextUnitPlaygroundControls,
  keyframes: AnimationSpec["keyframes"],
): AnimationSpec {
  return {
    keyframes,
    durationMs: controls.durationMs,
    easing: controls.easing,
    iterations: "infinite",
    fill: "both",
  };
}

function unitProps(
  controls: TextUnitPlaygroundControls,
  keyframes: AnimationSpec["keyframes"],
  animationEnabled: boolean,
) {
  return animationEnabled
    ? {
        animateUnits: {
          by: controls.by,
          animation: unitAnimation(controls, keyframes),
          delayStepMs: controls.delayStepMs,
          order: controls.order,
          ruby: controls.ruby,
        },
      }
    : {};
}

const HERO_CARD_ANIMATION: AnimationSpec = {
  keyframes: [
    {
      at: 0,
      opacity: 0.28,
      transform: { translateY: 34, rotateDeg: -4, scaleX: 0.9, scaleY: 0.9 },
    },
    {
      at: 0.46,
      opacity: 1,
      transform: { translateY: 0, rotateDeg: 0, scaleX: 1, scaleY: 1 },
    },
    {
      at: 1,
      opacity: 0.64,
      transform: { translateY: -24, rotateDeg: 3, scaleX: 0.96, scaleY: 0.96 },
    },
  ],
  durationMs: 2400,
  easing: [0.22, 1, 0.36, 1],
  iterations: "infinite",
  fill: "both",
};

const ORBIT_HORIZONTAL: AnimationSpec = {
  keyframes: [
    {
      at: 0,
      opacity: 0.35,
      transform: { translateX: -150, rotateDeg: -18, scaleX: 0.72, scaleY: 0.72 },
    },
    {
      at: 0.5,
      opacity: 1,
      transform: { translateX: 0, rotateDeg: 0, scaleX: 1.08, scaleY: 1.08 },
    },
    {
      at: 1,
      opacity: 0.35,
      transform: { translateX: 150, rotateDeg: 18, scaleX: 0.72, scaleY: 0.72 },
    },
  ],
  // Matches HERO_CARD_ANIMATION so the exported loop has no seam.
  durationMs: 2400,
  easing: "ease-in-out",
  iterations: "infinite",
  fill: "both",
};

const ORBIT_VERTICAL: AnimationSpec = {
  keyframes: [
    {
      at: 0,
      opacity: 0.4,
      transform: { translateY: 96, rotateDeg: 14, scaleX: 0.78, scaleY: 0.78 },
    },
    {
      at: 0.5,
      opacity: 1,
      transform: { translateY: -72, rotateDeg: -14, scaleX: 1.04, scaleY: 1.04 },
    },
    {
      at: 1,
      opacity: 0.4,
      transform: { translateY: 96, rotateDeg: 14, scaleX: 0.78, scaleY: 0.78 },
    },
  ],
  // Matches HERO_CARD_ANIMATION so the exported loop has no seam.
  durationMs: 2400,
  easing: "ease-in-out",
  iterations: "infinite",
  fill: "both",
};

const TITLE_ANIMATION: AnimationSpec = {
  keyframes: [
    {
      at: 0,
      opacity: 0,
      transform: { translateX: -180, rotateDeg: -6, scaleX: 0.82, scaleY: 0.82 },
    },
    {
      at: 0.32,
      opacity: 1,
      transform: { translateX: 0, rotateDeg: 0, scaleX: 1, scaleY: 1 },
    },
    {
      at: 0.72,
      opacity: 1,
      transform: { translateX: 0, rotateDeg: 0, scaleX: 1, scaleY: 1 },
    },
    {
      at: 1,
      opacity: 0,
      transform: { translateX: 180, rotateDeg: 6, scaleX: 0.82, scaleY: 0.82 },
    },
  ],
  durationMs: 2800,
  easing: "ease-in-out",
  iterations: "infinite",
  fill: "both",
};

export const ANIMATION_PRESETS: Record<AnimationPresetKey, AnimationPreset> = {
  "hero-card": {
    label: "Hero card",
    description:
      "A parent Flex animates its complete subtree with opacity, translation, rotation, and scale.",
    durationMs: HERO_CARD_ANIMATION.durationMs,
    posterTimeMs: 1_200,
    runtime: "Node animation",
    build: () =>
      toVNode(
        <Canvas width={640} height={360} background="linear-gradient(135deg, #07162f, #312e81)">
          <Box
            id="hero-glow-a"
            position="absolute"
            left={68}
            top={54}
            width={104}
            height={104}
            borderRadius={28}
            background="#22d3ee"
            opacity={0.16}
            animate={ORBIT_VERTICAL}
          />
          <Box
            id="hero-glow-b"
            position="absolute"
            right={72}
            bottom={48}
            width={92}
            height={92}
            borderRadius={46}
            background="#f472b6"
            opacity={0.18}
            animate={ORBIT_HORIZONTAL}
          />
          <Flex
            id="hero-card"
            position="absolute"
            left={145}
            top={78}
            width={350}
            height={204}
            direction="column"
            justifyContent="center"
            gap={10}
            padding={[28, 30, 28, 30]}
            borderRadius={26}
            background="#111827"
            borderWidth={1}
            borderColor="#475569"
            animate={HERO_CARD_ANIMATION}
          >
            <Text font={FONT} fontSizePx={14} color="#67e8f9" letterSpacingPx={2.4}>
              DECLARATIVE MOTION
            </Text>
            <Text font={FONT} fontSizePx={42} color="#f8fafc" fontWeight={700}>
              One scene, any time.
            </Text>
            <Text font={FONT} fontSizePx={16} color="#a5b4fc">
              Native SVG playback and deterministic static sampling.
            </Text>
          </Flex>
        </Canvas>,
      ),
  },
  "signal-orbit": {
    label: "Signal orbit",
    description:
      "Independent nodes share a duration while following different opacity and transform tracks.",
    durationMs: ORBIT_HORIZONTAL.durationMs,
    posterTimeMs: 1_000,
    runtime: "Node animation",
    build: () =>
      toVNode(
        <Canvas width={640} height={360} background="linear-gradient(145deg, #020617, #172554)">
          <Flex
            width={640}
            height={360}
            direction="column"
            alignItems="center"
            justifyContent="center"
            gap={8}
          >
            <Box
              width={128}
              height={128}
              borderRadius={64}
              background="#0f172a"
              borderWidth={2}
              borderColor="#38bdf8"
            />
            <Text font={FONT} fontSizePx={18} color="#e0f2fe" letterSpacingPx={3}>
              SIGNAL
            </Text>
          </Flex>
          <Box
            id="signal-horizontal"
            position="absolute"
            left={280}
            top={144}
            width={80}
            height={80}
            borderRadius={24}
            background="#22d3ee"
            animate={ORBIT_HORIZONTAL}
          />
          <Box
            id="signal-vertical"
            position="absolute"
            left={288}
            top={140}
            width={64}
            height={64}
            borderRadius={32}
            background="#f472b6"
            animate={ORBIT_VERTICAL}
          />
        </Canvas>,
      ),
  },
  "title-sequence": {
    label: "Title sequence",
    description:
      "A broadcast-style title enters, holds, and exits on one explicit keyframe timeline.",
    durationMs: TITLE_ANIMATION.durationMs,
    posterTimeMs: 1_400,
    runtime: "Node animation",
    build: () =>
      toVNode(
        <Canvas width={640} height={360} background="linear-gradient(120deg, #18181b, #450a0a)">
          <Box
            position="absolute"
            left={0}
            top={260}
            width={640}
            height={100}
            background="#09090b"
            opacity={0.72}
          />
          <Flex
            id="title-sequence"
            position="absolute"
            left={68}
            top={96}
            width={504}
            height={156}
            direction="column"
            justifyContent="center"
            alignItems="center"
            gap={8}
            borderWidth={1}
            borderColor="#fb7185"
            borderRadius={18}
            background="#18181b"
            animate={TITLE_ANIMATION}
          >
            <Text font={FONT} fontSizePx={17} color="#fda4af" letterSpacingPx={4}>
              LIVE FROM TOKYO
            </Text>
            <Text font={FONT} fontSizePx={48} fontWeight={700} color="#fff7ed">
              boundsvg Motion
            </Text>
          </Flex>
        </Canvas>,
      ),
  },
  "cluster-entrance": {
    label: "Cluster Entrance",
    description:
      "A specimen line rises cluster by cluster without splitting the resolved Text. The ffi ligature, the combining acute in café, the CJK pair, and the © presentation sequence each stay one paint unit.",
    durationMs: CLUSTER_ENTRANCE_CONTROLS.durationMs,
    posterTimeMs: 1_100,
    runtime: "Text-unit animation",
    defaultControls: { ...CLUSTER_ENTRANCE_CONTROLS },
    build: (controls, animationEnabled = true) =>
      toVNode(
        <Canvas width={640} height={360} background="linear-gradient(135deg, #07111f, #172554)">
          <Flex
            width={640}
            height={360}
            direction="column"
            justifyContent="center"
            padding={[54, 58, 54, 58]}
            gap={18}
          >
            <Text
              id="cluster-entrance-caption"
              font={FONT}
              fontSizePx={13}
              letterSpacingPx={2.8}
              color="#67e8f9"
            >
              RESOLVED TEXT · PAINT UNITS
            </Text>
            <Text
              id="cluster-entrance-text"
              width={524}
              font={FONT}
              fontSizePx={32}
              lineHeight={1.45}
              wrap="char"
              language="ja"
              color="#f8fafc"
              textShadows={[
                { dx: 4, dy: 5, blurPx: 0, color: "#020617" },
                { dx: -2, dy: 2, blurPx: 0, color: "#155e75" },
              ]}
              textStrokes={[
                { color: "#0e7490", widthPx: 4 },
                { color: "#cffafe", widthPx: 1 },
              ]}
              {...unitProps(
                controls,
                [
                  { at: 0, opacity: 0, transform: { translateY: 26, scaleX: 0.82, scaleY: 0.82 } },
                  { at: 0.18, opacity: 1, transform: { translateY: 0, scaleX: 1, scaleY: 1 } },
                  { at: 0.88, opacity: 1, transform: { translateY: 0, scaleX: 1, scaleY: 1 } },
                  { at: 1, opacity: 0, transform: { translateY: -14, scaleX: 0.94, scaleY: 0.94 } },
                ],
                animationEnabled,
              )}
            >
              {"The office cafe\u0301 in 東京 — ©️ 2026"}
            </Text>
            <Text id="cluster-entrance-note" font={FONT} fontSizePx={15} color="#94a3b8">
              One Text node. Stable shaping and paint order.
            </Text>
          </Flex>
        </Canvas>,
      ),
  },
  "cluster-bounce": {
    label: "Cluster Bounce",
    description:
      "A deterministic multi-keyframe bounce staggers translateY and scale across resolved clusters; no spring runtime is involved.",
    durationMs: 800,
    posterTimeMs: 360,
    runtime: "Text-unit animation",
    defaultControls: { ...CLUSTER_BOUNCE_CONTROLS },
    build: (controls, animationEnabled = true) =>
      toVNode(
        <Canvas width={640} height={360} background="linear-gradient(145deg, #1f1235, #09090b)">
          <Flex
            width={640}
            height={360}
            direction="column"
            alignItems="center"
            justifyContent="center"
            gap={20}
          >
            <Text
              id="cluster-bounce-text"
              font={FONT}
              fontSizePx={58}
              fontWeight={700}
              color="#fdf4ff"
              letterSpacingPx={3}
              {...unitProps(
                controls,
                [
                  { at: 0, opacity: 1, transform: { translateY: 0, scaleX: 1, scaleY: 1 } },
                  {
                    at: 0.32,
                    opacity: 1,
                    transform: { translateY: -28, scaleX: 0.9, scaleY: 1.16 },
                  },
                  {
                    at: 0.58,
                    opacity: 1,
                    transform: { translateY: 7, scaleX: 1.08, scaleY: 0.9 },
                  },
                  { at: 1, opacity: 1, transform: { translateY: 0, scaleX: 1, scaleY: 1 } },
                ],
                animationEnabled,
              )}
            >
              BOUNCE! 跳ねる
            </Text>
            <Text font={FONT} fontSizePx={15} color="#d8b4fe">
              delayStepMs + explicit keyframes
            </Text>
          </Flex>
        </Canvas>,
      ),
  },
  "line-reveal": {
    label: "Line Reveal",
    description:
      "Resolved horizontal lines or vertical columns reveal as paint units while the underlying wrap result stays fixed.",
    durationMs: 760,
    posterTimeMs: 520,
    runtime: "Text-unit animation",
    supportsWritingMode: true,
    defaultControls: { ...LINE_REVEAL_CONTROLS },
    build: (controls, animationEnabled = true) => {
      const vertical = controls.writingMode === "vertical-rl";
      return toVNode(
        <Canvas width={640} height={360} background="linear-gradient(125deg, #0c1b33, #164e63)">
          <Flex width={640} height={360} direction="column" padding={[34, 44, 34, 44]} gap={14}>
            <Text font={FONT} fontSizePx={13} letterSpacingPx={2.4} color="#67e8f9">
              {vertical ? "VERTICAL COLUMNS" : "HORIZONTAL LINES"}
            </Text>
            <Flex
              width={552}
              height={258}
              alignItems="center"
              justifyContent="center"
              borderRadius={18}
              background="#082f49"
            >
              <Text
                id="line-reveal-text"
                width={vertical ? 260 : 468}
                height={vertical ? 218 : 190}
                font={FONT}
                fontSizePx={vertical ? 27 : 29}
                lineHeight={1.55}
                wrap="char"
                language="ja"
                writingMode={controls.writingMode}
                color="#ecfeff"
                {...unitProps(
                  controls,
                  [
                    {
                      at: 0,
                      opacity: 0,
                      transform: vertical ? { translateX: 18 } : { translateY: 16 },
                    },
                    { at: 1, opacity: 1, transform: { translateX: 0, translateY: 0 } },
                  ],
                  animationEnabled,
                )}
              >
                {vertical
                  ? "朝の光が街を包み、縦組みの列が静かに現れます。"
                  : "Resolved lines arrive together.\n改行とglyph配置は、そのまま。\nSampling stays deterministic."}
              </Text>
            </Flex>
          </Flex>
        </Canvas>,
      );
    },
  },
  "ruby-vertical": {
    label: "Ruby & Vertical",
    description:
      "Japanese vertical text combines ruby, rotated European text, and logical/visual stagger order in one resolved Text.",
    durationMs: 1_000,
    posterTimeMs: 680,
    runtime: "Text-unit animation",
    defaultControls: { ...RUBY_VERTICAL_CONTROLS },
    build: (controls, animationEnabled = true) =>
      toVNode(
        <Canvas width={640} height={360} background="linear-gradient(140deg, #20110b, #451a03)">
          <Flex width={640} height={360} direction="row" padding={[34, 46, 34, 46]} gap={28}>
            <Flex width={248} direction="column" justifyContent="center" gap={12}>
              <Text font={FONT} fontSizePx={13} letterSpacingPx={2.2} color="#fdba74">
                RUBY UNIT SEMANTICS
              </Text>
              <Text font={FONT} fontSizePx={28} fontWeight={700} color="#fff7ed" wrap="char">
                Base and annotation can move together—or separately.
              </Text>
              <Text font={FONT} fontSizePx={14} color="#fed7aa" wrap="char">
                Paint order remains unchanged; order only selects the stagger index.
              </Text>
            </Flex>
            <Flex
              width={272}
              height={292}
              alignItems="center"
              justifyContent="center"
              borderRadius={20}
              background="#431407"
            >
              <Text
                id="ruby-vertical-text"
                width={178}
                height={250}
                font={FONT}
                fontSizePx={28}
                lineHeight={1.6}
                writingMode="vertical-rl"
                wrap="char"
                language="ja"
                color="#ffedd5"
                {...unitProps(
                  controls,
                  [
                    {
                      at: 0,
                      opacity: 0.15,
                      transform: { translateX: 13, rotateDeg: -5, scaleX: 0.9, scaleY: 0.9 },
                    },
                    {
                      at: 0.7,
                      opacity: 1,
                      transform: { translateX: 0, rotateDeg: 0, scaleX: 1, scaleY: 1 },
                    },
                    {
                      at: 1,
                      opacity: 1,
                      transform: { translateX: 0, rotateDeg: 0, scaleX: 1, scaleY: 1 },
                    },
                  ],
                  animationEnabled,
                )}
              >
                <Ruby rubyPosition="over" rubyAlign="center">
                  東京<Rt fontSizePx={12}>とうきょう</Rt>
                </Ruby>
                から
                <Inline textOrientation="mixed" color="#fdba74">
                  SVG
                </Inline>
                を届ける。
              </Text>
            </Flex>
          </Flex>
        </Canvas>,
      ),
  },
};

export const ANIMATION_PRESET_OPTIONS = Object.entries(ANIMATION_PRESETS).map(
  ([value, preset]) => ({ value, label: preset.label }),
);
