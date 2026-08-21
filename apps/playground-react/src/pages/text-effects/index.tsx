import type { VNode } from "@boundsvg/core";
import { Box, Canvas, Text, toVNode } from "@boundsvg/react";
import { useMemo, useState } from "react";
import { CheckField, Section } from "../../components/fields";
import { RenderSurface } from "../../components/RenderSurface";

const FONT = "NotoSansJP-woff2";

function buildTelopVNode(showShadows: boolean): VNode {
  return toVNode(
    <Canvas width={920} height={420} background="#0b1120">
      <Box
        position="absolute"
        left={0}
        top={0}
        width={920}
        height={420}
        background="linear-gradient(135deg, #3e5c76, #4a4e69)"
      />
      <Box
        position="absolute"
        left={610}
        top={-80}
        width={340}
        height={340}
        borderRadius={999}
        background="#ffffff"
        opacity={0.07}
      />

      {/* A/B: multi-layer vs single stroke, straight on the footage */}
      <Text
        font={FONT}
        fontSizePx={58}
        color="#facc15"
        width={300}
        wrap="none"
        position="absolute"
        left={96}
        top={56}
        textStrokes={[
          { color: "#1e293b", widthPx: 16 },
          { color: "#ffffff", widthPx: 8 },
        ]}
        textShadows={showShadows ? [{ dx: 6, dy: 7, blurPx: 8, color: "#000000" }] : undefined}
      >
        OUTLINE
      </Text>
      <Text
        font={FONT}
        fontSizePx={12}
        color="#e2e8f0"
        opacity={0.85}
        width={380}
        wrap="none"
        position="absolute"
        left={96}
        top={132}
      >
        textStrokes x2 + textShadows - edges hold on busy footage
      </Text>
      <Text
        font={FONT}
        fontSizePx={58}
        color="#facc15"
        width={300}
        wrap="none"
        position="absolute"
        left={520}
        top={56}
        textStroke="#1e293b"
        textStrokeWidth={8}
      >
        OUTLINE
      </Text>
      <Text
        font={FONT}
        fontSizePx={12}
        color="#e2e8f0"
        opacity={0.85}
        width={300}
        wrap="none"
        position="absolute"
        left={520}
        top={132}
      >
        single textStroke - flat by comparison
      </Text>

      {/* Bright base bar + fit:shrink (single-line shrink needs Text width) */}
      <Box
        position="absolute"
        left={96}
        top={188}
        width={728}
        height={64}
        borderRadius={12}
        background="linear-gradient(90deg, #f8fafc, #cbd5f5)"
        boxShadow="0 6 18 0 rgba(2, 6, 23, 0.35)"
      />
      <Text
        font={FONT}
        fontSizePx={44}
        color="#0f172a"
        width={680}
        fit="shrink"
        wrap="none"
        position="absolute"
        left={120}
        top={202}
      >
        fit:shrink - strokes and shadows never change layout metrics
      </Text>

      {/* Lower third: breaking chip + baseless multi-layer headline */}
      <Box
        position="absolute"
        left={96}
        top={312}
        width={152}
        height={52}
        borderRadius={8}
        background="linear-gradient(180deg, #ef4444, #b91c1c)"
        boxShadow="0 4 12 0 rgba(2, 6, 23, 0.4)"
      />
      <Text
        font={FONT}
        fontSizePx={22}
        color="#ffffff"
        width={120}
        wrap="none"
        position="absolute"
        left={118}
        top={326}
        textStroke="#7f1d1d"
        textStrokeWidth={3}
      >
        BREAKING
      </Text>
      <Text
        font={FONT}
        fontSizePx={40}
        color="#ffffff"
        width={560}
        fit="shrink"
        wrap="none"
        position="absolute"
        left={268}
        top={316}
        textStrokes={[
          { color: "#0f172a", widthPx: 12 },
          { color: "#38bdf8", widthPx: 5 },
        ]}
        textShadows={showShadows ? [{ dx: 5, dy: 6, blurPx: 7, color: "#000000" }] : undefined}
      >
        Field Report - Shibuya, Tokyo
      </Text>
    </Canvas>,
  );
}

export function TextEffectsPage() {
  const [showShadows, setShowShadows] = useState(true);
  const vnode = useMemo(() => buildTelopVNode(showShadows), [showShadows]);

  return (
    <div className="split-layout">
      <aside className="panel controls-panel">
        <Section title="Text Effects">
          <CheckField
            id="text-effects-shadows"
            label="textShadows"
            checked={showShadows}
            onChange={setShowShadows}
          />
          <p className="hint">
            <code>textStrokes</code> (index 0 = outermost) and <code>textShadows</code> are
            paint-only - layout never changes.
          </p>
        </Section>
      </aside>
      <main className="panel preview-panel">
        <RenderSurface renderer="boundsvg" vnode={vnode} />
      </main>
    </div>
  );
}
