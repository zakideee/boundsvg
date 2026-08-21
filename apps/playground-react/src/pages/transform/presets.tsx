import {
  Box,
  Canvas,
  Flex,
  type GeometryDoc,
  Grid,
  Image,
  Path,
  Shape,
  Svg,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: matches core API name
  Symbol,
  type SymbolDefinition,
  Text,
  type Transform2D,
  toVNode,
} from "@boundsvg/react";
import type { TransformPageState, TransformPresetDef, TransformPresetKey } from "./types";

const FONT = "NotoSansJP-woff2";

const ROUNDED_SQUARE_GEOMETRY: GeometryDoc = {
  viewBox: { width: 100, height: 100 },
  root: {
    kind: "path",
    d: "M 10 0 H 90 A 10 10 0 0 1 100 10 V 90 A 10 10 0 0 1 90 100 H 10 A 10 10 0 0 1 0 90 V 10 A 10 10 0 0 1 10 0 Z",
  },
};

const STAR_SYMBOL: SymbolDefinition = {
  geometry: {
    viewBox: { width: 100, height: 100 },
    root: {
      kind: "path",
      d: "M 50 4 L 61 38 H 96 L 68 58 L 79 92 L 50 72 L 21 92 L 32 58 L 4 38 H 39 Z",
    },
  },
};

const SAMPLE_IMAGE_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <rect width="96" height="96" fill="#1f2937"/>
    <circle cx="32" cy="32" r="20" fill="#fbbf24"/>
    <rect x="48" y="48" width="40" height="40" rx="8" fill="#60a5fa"/>
    <path d="M12 84 L84 12" stroke="#f87171" stroke-width="6" stroke-linecap="round"/>
  </svg>`,
)}`;

function buildTransform(state: TransformPageState): Transform2D {
  return {
    translateX: state.translateX,
    translateY: state.translateY,
    scaleX: state.scaleX,
    scaleY: state.scaleY,
    rotateDeg: state.rotateDeg,
    originX: state.originX,
    originY: state.originY,
  };
}

const translateOnly: TransformPresetDef = {
  label: "Translate only",
  description:
    "Left box has translateX/Y; the right sibling stays at its pre-transform layout position.",
  overrides: {
    canvasWidth: 520,
    canvasHeight: 320,
    bgColor: "#0f172a",
    translateX: 48,
    translateY: 24,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 0,
    originX: 0,
    originY: 0,
  },
  build: (state) =>
    toVNode(
      <Canvas width={state.canvasWidth} height={state.canvasHeight} background={state.bgColor}>
        <Flex
          direction="row"
          justifyContent="center"
          alignItems="center"
          width={state.canvasWidth}
          height={state.canvasHeight}
          gap={32}
        >
          <Box
            id="translated"
            width={160}
            height={120}
            background="#6366f1"
            borderRadius={16}
            transform={{ translateX: state.translateX, translateY: state.translateY }}
          />
          <Box
            id="sibling"
            width={160}
            height={120}
            background="#334155"
            borderWidth={1}
            borderColor="#64748b"
            borderRadius={16}
          />
        </Flex>
      </Canvas>,
    ),
};

const rotateWithOrigin: TransformPresetDef = {
  label: "Rotate with origin",
  description: "Origin (originX/Y) is node-local. Move it to see the pivot shift around the bbox.",
  overrides: {
    canvasWidth: 520,
    canvasHeight: 360,
    bgColor: "#0f172a",
    translateX: 0,
    translateY: 0,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 30,
    originX: 0,
    originY: 0,
  },
  build: (state) =>
    toVNode(
      <Canvas width={state.canvasWidth} height={state.canvasHeight} background={state.bgColor}>
        <Flex
          direction="column"
          justifyContent="center"
          alignItems="center"
          width={state.canvasWidth}
          height={state.canvasHeight}
          gap={24}
        >
          <Box
            id="ghost"
            width={200}
            height={120}
            background="#1e293b"
            borderWidth={1}
            borderColor="#475569"
            borderRadius={12}
            position="absolute"
            top={(state.canvasHeight - 120) / 2}
            left={(state.canvasWidth - 200) / 2}
          />
          <Box
            id="rotated"
            width={200}
            height={120}
            background="#ec4899"
            borderRadius={12}
            position="absolute"
            top={(state.canvasHeight - 120) / 2}
            left={(state.canvasWidth - 200) / 2}
            transform={buildTransform(state)}
          />
          <Text
            font={FONT}
            fontSizePx={14}
            color="#94a3b8"
            position="absolute"
            top={state.canvasHeight - 32}
            left={16}
          >
            Grey outline = pre-transform layout; pink = rendered (paint only).
          </Text>
        </Flex>
      </Canvas>,
    ),
};

const scaleNegative: TransformPresetDef = {
  label: "Scale negative (mirror)",
  description: "scaleX: -1 with originX at the node center flips text horizontally.",
  overrides: {
    canvasWidth: 520,
    canvasHeight: 300,
    bgColor: "#0f172a",
    translateX: 0,
    translateY: 0,
    scaleX: -1,
    scaleY: 1,
    rotateDeg: 0,
    originX: 140,
    originY: 0,
  },
  build: (state) =>
    toVNode(
      <Canvas width={state.canvasWidth} height={state.canvasHeight} background={state.bgColor}>
        <Flex
          direction="column"
          justifyContent="center"
          alignItems="center"
          width={state.canvasWidth}
          height={state.canvasHeight}
          gap={24}
        >
          <Text id="label-orig" font={FONT} fontSizePx={48} color="#94a3b8">
            BoundSvg
          </Text>
          <Text
            id="label-mirror"
            font={FONT}
            fontSizePx={48}
            color="#f97316"
            transform={buildTransform(state)}
          >
            BoundSvg
          </Text>
          <Text font={FONT} fontSizePx={12} color="#64748b">
            Top: original — Bottom: transformed (scaleX={state.scaleX} scaleY={state.scaleY})
          </Text>
        </Flex>
      </Canvas>,
    ),
};

const nestedTransform: TransformPresetDef = {
  label: "Nested transform",
  description:
    "Parent rotates by rotateDeg; child rotates by 2×rotateDeg. Transforms compose paint-only.",
  overrides: {
    canvasWidth: 520,
    canvasHeight: 360,
    bgColor: "#0f172a",
    translateX: 0,
    translateY: 0,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 10,
    originX: 100,
    originY: 60,
  },
  build: (state) => {
    const parentTransform: Transform2D = {
      rotateDeg: state.rotateDeg,
      originX: state.originX,
      originY: state.originY,
    };
    const childTransform: Transform2D = {
      rotateDeg: state.rotateDeg * 2,
      originX: 50,
      originY: 30,
    };
    return toVNode(
      <Canvas width={state.canvasWidth} height={state.canvasHeight} background={state.bgColor}>
        <Flex
          direction="column"
          justifyContent="center"
          alignItems="center"
          width={state.canvasWidth}
          height={state.canvasHeight}
        >
          <Box
            id="parent"
            width={200}
            height={120}
            background="#1d4ed8"
            borderRadius={14}
            padding={16}
            transform={parentTransform}
          >
            <Box
              id="child"
              width={100}
              height={60}
              background="#f59e0b"
              borderRadius={10}
              transform={childTransform}
            />
          </Box>
        </Flex>
      </Canvas>,
    );
  },
};

const allNodeTypes: TransformPresetDef = {
  label: "All node types",
  description: "Text / Image / Path / Box / Svg / Shape / Symbol each receive the same transform.",
  overrides: {
    canvasWidth: 720,
    canvasHeight: 360,
    bgColor: "#0f172a",
    translateX: 0,
    translateY: 0,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 12,
    originX: 50,
    originY: 50,
  },
  build: (state) => {
    const transform = buildTransform(state);
    const cellStyle = {
      width: 160 as const,
      height: 120 as const,
    };
    return toVNode(
      <Canvas width={state.canvasWidth} height={state.canvasHeight} background={state.bgColor}>
        <Grid
          templateColumns="160px 160px 160px 160px"
          templateRows="120px 120px"
          gap={16}
          padding={20}
          width={state.canvasWidth}
          height={state.canvasHeight}
        >
          <Box
            id="cell-text"
            width={cellStyle.width}
            height={cellStyle.height}
            background="#1e293b"
            borderRadius={8}
          >
            <Flex
              direction="column"
              justifyContent="center"
              alignItems="center"
              width={cellStyle.width}
              height={cellStyle.height}
            >
              <Text font={FONT} fontSizePx={24} color="#f8fafc" transform={transform}>
                Text
              </Text>
            </Flex>
          </Box>

          <Box
            id="cell-image"
            width={cellStyle.width}
            height={cellStyle.height}
            background="#1e293b"
            borderRadius={8}
          >
            <Flex
              direction="column"
              justifyContent="center"
              alignItems="center"
              width={cellStyle.width}
              height={cellStyle.height}
            >
              <Image src={SAMPLE_IMAGE_DATA_URL} width={80} height={80} transform={transform} />
            </Flex>
          </Box>

          <Box
            id="cell-path"
            width={cellStyle.width}
            height={cellStyle.height}
            background="#1e293b"
            borderRadius={8}
          >
            <Flex
              direction="column"
              justifyContent="center"
              alignItems="center"
              width={cellStyle.width}
              height={cellStyle.height}
            >
              <Path
                d="M 10 50 L 50 10 L 90 50 L 50 90 Z"
                width={100}
                height={100}
                fill="#34d399"
                stroke="#a7f3d0"
                strokeWidth={2}
                transform={transform}
              />
            </Flex>
          </Box>

          <Box
            id="cell-box"
            width={cellStyle.width}
            height={cellStyle.height}
            background="#1e293b"
            borderRadius={8}
          >
            <Flex
              direction="column"
              justifyContent="center"
              alignItems="center"
              width={cellStyle.width}
              height={cellStyle.height}
            >
              <Box
                width={80}
                height={80}
                background="#f472b6"
                borderRadius={10}
                transform={transform}
              />
            </Flex>
          </Box>

          <Box
            id="cell-svg"
            width={cellStyle.width}
            height={cellStyle.height}
            background="#1e293b"
            borderRadius={8}
          >
            <Flex
              direction="column"
              justifyContent="center"
              alignItems="center"
              width={cellStyle.width}
              height={cellStyle.height}
            >
              <Svg
                width={80}
                height={80}
                content={`<g><circle cx="50" cy="50" r="40" fill="#38bdf8"/></g>`}
                transform={transform}
              />
            </Flex>
          </Box>

          <Box
            id="cell-shape"
            width={cellStyle.width}
            height={cellStyle.height}
            background="#1e293b"
            borderRadius={8}
          >
            <Flex
              direction="column"
              justifyContent="center"
              alignItems="center"
              width={cellStyle.width}
              height={cellStyle.height}
            >
              <Shape
                geometry={ROUNDED_SQUARE_GEOMETRY}
                width={80}
                height={80}
                fill="#fb923c"
                stroke="#fdba74"
                strokeWidth={2}
                transform={transform}
              />
            </Flex>
          </Box>

          <Box
            id="cell-symbol"
            width={cellStyle.width}
            height={cellStyle.height}
            background="#1e293b"
            borderRadius={8}
          >
            <Flex
              direction="column"
              justifyContent="center"
              alignItems="center"
              width={cellStyle.width}
              height={cellStyle.height}
            >
              <Symbol
                symbol={STAR_SYMBOL}
                width={80}
                height={80}
                fill="#fde047"
                stroke="#fef08a"
                strokeWidth={2}
                transform={transform}
              />
            </Flex>
          </Box>

          <Box
            id="cell-label"
            width={cellStyle.width}
            height={cellStyle.height}
            background="#111827"
            borderRadius={8}
            borderWidth={1}
            borderColor="#334155"
          >
            <Flex
              direction="column"
              justifyContent="center"
              alignItems="center"
              width={cellStyle.width}
              height={cellStyle.height}
              padding={12}
              gap={4}
            >
              <Text font={FONT} fontSizePx={13} color="#cbd5f5">
                Same transform,
              </Text>
              <Text font={FONT} fontSizePx={13} color="#cbd5f5">
                every node type.
              </Text>
            </Flex>
          </Box>
        </Grid>
      </Canvas>,
    );
  },
};

export const TRANSFORM_PRESETS: Record<TransformPresetKey, TransformPresetDef> = {
  "translate-only": translateOnly,
  "rotate-with-origin": rotateWithOrigin,
  "scale-negative": scaleNegative,
  "nested-transform": nestedTransform,
  "all-node-types": allNodeTypes,
};

const PRESET_ORDER: TransformPresetKey[] = [
  "translate-only",
  "rotate-with-origin",
  "scale-negative",
  "nested-transform",
  "all-node-types",
];

export const TRANSFORM_PRESET_OPTIONS = PRESET_ORDER.map((key) => ({
  value: key,
  label: TRANSFORM_PRESETS[key].label,
}));
