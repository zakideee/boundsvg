import { Box, Canvas, Image, Shape, Svg, Text, toVNode, type VNode } from "@boundsvg/react";

type LayeredFixtureDefinition = {
  id: string;
  label: string;
  description: string;
  vnode: VNode;
};

const TEST_IMAGE_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <rect width="96" height="96" fill="#f3f4f6"/>
    <circle cx="32" cy="32" r="18" fill="#ef4444"/>
    <rect x="42" y="46" width="34" height="26" rx="8" fill="#2563eb"/>
    <path d="M10 76 L86 18" stroke="#111827" stroke-width="8" stroke-linecap="round"/>
  </svg>`,
)}`;

/**
 * Shared layered-composition fixtures.
 *
 * Used by both the internal E2E harness (`src/e2e/e2e-layered-composition-harness.tsx`)
 * and the public-facing Layered playground page (`#/layered`).
 *
 * Each fixture exercises a distinct layer-resolution path (explicit id,
 * inheritance, compositing islands, atomic promotion, Svg subtree). The
 * layered renderer should match `renderToSvg` pixel-for-pixel on each.
 */
export function buildLayeredFixtures(): LayeredFixtureDefinition[] {
  return [
    {
      id: "shape-parts",
      label: "Shape parts in manifest",
      description:
        "A Shape rendered with emitPartIds + meta: the Manifest JSON tab lists the layer's parts (partId per addressable part) and nodeMeta alongside nodeIds.",
      vnode: toVNode(
        <Canvas width={320} height={180}>
          <Box
            id="parts-bg"
            layer="background"
            position="absolute"
            left={0}
            top={0}
            width={320}
            height={180}
            background="#0f172a"
          />
          <Shape
            id="parts-badge"
            layer="badge"
            geometry={{
              viewBox: { width: 300, height: 200 },
              root: {
                kind: "group",
                nodeId: "badge",
                children: [
                  {
                    kind: "path",
                    nodeId: "bg",
                    d: "M20 0H280C291 0 300 9 300 20V180C300 191 291 200 280 200H20C9 200 0 191 0 180V20C0 9 9 0 20 0Z",
                  },
                  {
                    kind: "boolean",
                    nodeId: "ribbon",
                    op: "union",
                    children: [
                      { kind: "path", d: "M20 80H160V120H20Z" },
                      { kind: "path", d: "M140 70H280V110H140Z" },
                    ],
                  },
                  { kind: "path", d: "M240 20H280V60H240Z" },
                ],
              },
            }}
            width={240}
            height={160}
            fill="#38bdf8"
            emitPartIds
            meta={{ role: "badge", variant: "layered-demo" }}
            position="absolute"
            left={40}
            top={10}
          />
        </Canvas>,
      ),
    },
    {
      id: "z-index-order",
      label: "zIndex paint order",
      description:
        "Sibling zIndex reorders painting; layered output preserves the same paint order.",
      vnode: toVNode(
        <Canvas width={320} height={180}>
          <Box
            id="z-back"
            layer="background"
            zIndex={3}
            position="absolute"
            left={24}
            top={24}
            width={160}
            height={100}
            background="#2563eb"
            borderRadius={10}
          />
          <Box
            id="z-mid"
            layer="content"
            zIndex={2}
            position="absolute"
            left={88}
            top={48}
            width={160}
            height={100}
            background="#f97316"
            borderRadius={10}
          />
          <Box
            id="z-front"
            layer="content"
            zIndex={1}
            position="absolute"
            left={152}
            top={72}
            width={140}
            height={84}
            background="#10b981"
            borderRadius={10}
          />
        </Canvas>,
      ),
    },
    {
      id: "basic-layers",
      label: "Basic layers",
      description: "Explicit background / textBox / text layers in a flat scene.",
      vnode: toVNode(
        <Canvas width={320} height={180}>
          <Box
            id="bg"
            layer="background"
            position="absolute"
            top={0}
            left={0}
            width={320}
            height={180}
            background="#e5e7eb"
          />
          <Box
            id="panel"
            layer="textBox"
            position="absolute"
            top={48}
            left={40}
            width={240}
            height={84}
            background="#111827"
            borderRadius={18}
          />
          <Text
            id="title"
            layer="text"
            position="absolute"
            top={70}
            left={108}
            font="NotoSansJP-woff2"
            fontSizePx={28}
            color="#f9fafb"
          >
            Layered
          </Text>
        </Canvas>,
      ),
    },
    {
      id: "interleaved-layer-id",
      label: "Interleaved layer ids",
      description:
        "Same logical layer id repeated around a different id produces separate segments.",
      vnode: toVNode(
        <Canvas width={280} height={140}>
          <Box id="text-a1" layer="text" width={180} height={52} background="#111827" />
          <Box id="box-b1" layer="textBox" width={220} height={52} background="#f97316" />
          <Box id="text-a2" layer="text" width={140} height={52} background="#2563eb" />
        </Canvas>,
      ),
    },
    {
      id: "parent-opacity",
      label: "Parent opacity",
      description:
        "opacity != 1 on the parent forces an atomic island that collapses child layers.",
      vnode: toVNode(
        <Canvas width={320} height={180} background="#f3f4f6">
          <Box
            id="opacity-panel"
            layer="textBox"
            position="absolute"
            left={40}
            top={42}
            width={240}
            height={96}
            background="#0f172a"
            opacity={0.6}
            borderRadius={20}
            padding={[30, 28, 30, 28]}
          >
            <Text
              id="opacity-title"
              layer="text"
              font="NotoSansJP-woff2"
              fontSizePx={24}
              color="#f8fafc"
            >
              opacity
            </Text>
          </Box>
        </Canvas>,
      ),
    },
    {
      id: "overflow-clip",
      label: "Overflow clip",
      description: "overflow='clip' + borderRadius forces an atomic clip island.",
      vnode: toVNode(
        <Canvas width={320} height={180} background="#eef2ff">
          <Box
            id="clip-panel"
            layer="textBox"
            width={180}
            height={72}
            background="#1d4ed8"
            borderRadius={16}
            overflow="clip"
          >
            <Text
              id="clip-title"
              layer="text"
              font="NotoSansJP-woff2"
              fontSizePx={28}
              color="#ffffff"
            >
              clipping demo
            </Text>
          </Box>
        </Canvas>,
      ),
    },
    {
      id: "image-border-radius",
      label: "Image borderRadius",
      description: "Image with borderRadius triggers a clip-island for the photo layer.",
      vnode: toVNode(
        <Canvas width={260} height={228} background="#ffffff">
          <Image
            id="photo"
            layer="photo"
            position="absolute"
            left={60}
            top={26}
            src={TEST_IMAGE_DATA_URL}
            width={140}
            height={140}
            borderRadius={26}
          />
          <Text
            id="caption"
            layer="text"
            position="absolute"
            left={26}
            top={184}
            width={208}
            wrap="none"
            font="NotoSansJP-woff2"
            fontSizePx={18}
            color="#111827"
          >
            rounded image
          </Text>
        </Canvas>,
      ),
    },
    {
      id: "box-shadow",
      label: "Box shadow",
      description: "boxShadow promotes the card to an atomic island.",
      vnode: toVNode(
        <Canvas width={320} height={200} background="#fafaf9">
          <Box
            id="shadow-card"
            layer="card"
            position="absolute"
            left={44}
            top={40}
            width={220}
            height={100}
            background="#ffffff"
            borderRadius={18}
            boxShadow="0 12 24 0 rgba(15,23,42,0.28)"
            padding={[30, 28, 30, 28]}
          >
            <Text
              id="shadow-label"
              layer="text"
              font="NotoSansJP-woff2"
              fontSizePx={22}
              color="#111827"
            >
              shadow
            </Text>
          </Box>
        </Canvas>,
      ),
    },
    {
      id: "transform-layered",
      label: "Transform ancestor",
      description:
        "Parent Box has rotateDeg=10 with originX/Y at center. Each child layer inherits the ancestor transform while its bbox in the manifest stays pre-transform.",
      vnode: toVNode(
        <Canvas width={320} height={200} background="#f8fafc">
          <Box
            id="rotated-card"
            position="absolute"
            left={50}
            top={40}
            width={220}
            height={120}
            background="#e2e8f0"
            borderRadius={18}
            transform={{ rotateDeg: 10, originX: 110, originY: 60 }}
          >
            <Box
              id="card-bg"
              layer="background"
              position="absolute"
              left={10}
              top={10}
              width={200}
              height={100}
              background="#1d4ed8"
              borderRadius={14}
            />
            <Text
              id="card-title"
              layer="text"
              position="absolute"
              left={30}
              top={46}
              width={170}
              wrap="none"
              font="NotoSansJP-woff2"
              fontSizePx={22}
              color="#f8fafc"
            >
              transform
            </Text>
          </Box>
        </Canvas>,
      ),
    },
    {
      id: "nested-svg",
      label: "Nested Svg subtree",
      description: "An <Svg> subtree is always atomic regardless of layer prop.",
      vnode: toVNode(
        <Canvas width={240} height={200} background="#f8fafc">
          <Box
            id="svg-bg"
            layer="background"
            position="absolute"
            left={0}
            top={0}
            width={240}
            height={200}
            background="#e2e8f0"
          />
          <Svg
            id="logo"
            layer="vector"
            position="absolute"
            left={60}
            top={40}
            width={120}
            height={120}
            content={`
              <g>
                <circle cx="60" cy="60" r="44" fill="#0ea5e9"/>
                <path d="M30 68 L52 40 L66 56 L92 26" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
              </g>
            `}
          />
        </Canvas>,
      ),
    },
  ];
}
