import {
  Box,
  Canvas,
  Flex,
  Grid,
  Image,
  Inline,
  InlineBox,
  Path,
  Rt,
  Ruby,
  Text,
  toVNode,
} from "@boundsvg/react";
import { buildMeasurementsVNode } from "./engine-builders/measurements";
import { buildShrinkwrapVNode } from "./engine-builders/shrinkwrap";
import { TEMPLATE_IMAGE_DATA_URL, TERMINAL_TEMPLATE } from "./terminal-assets";
import { TEXT_MOTION_TEMPLATE_DEFINITIONS } from "./text-motion-templates";
import type { TemplateDef } from "./types";

export const TEMPLATE_DEFINITIONS: Record<string, TemplateDef> = {
  terminal: {
    title: "Terminal Prism",
    description:
      "Split-pane terminal with syntax-highlighted source and char-wrapped output for narrow panes.",
    licenseNotice: TERMINAL_TEMPLATE.licenseNotice,
    vnode: TERMINAL_TEMPLATE.vnode,
  },
  fit: {
    title: "Fit + Stroke",
    description: "Auto-shrinking text with ellipsis and text stroke outline.",
    vnode: toVNode(
      <Canvas width={920} height={320} background="#1a1a1a">
        <Flex direction="column" width={920} height={320} padding={20}>
          <Flex
            direction="column"
            justifyContent="center"
            alignItems="center"
            flexGrow={1}
            padding={24}
            background="#252526"
            borderWidth={1}
            borderColor="#474747"
            borderRadius={16}
            strokeDasharray="8,4"
            strokeLinecap="round"
            overflow="clip"
          >
            <Text
              font="NotoSansJP-woff2"
              fontSizePx={64}
              minFontSizePx={18}
              fit="shrink"
              wrap="char"
              maxLines={2}
              ellipsis
              lineHeight={1.15}
              color="#e2e8f0"
              textAlign="center"
              textStroke="#f59e0b"
              textStrokeWidth={2}
            >
              This is an example of a very long title. Even when the text exceeds the available
              area, it automatically shrinks to fit, adding an ellipsis if needed.
            </Text>
          </Flex>
        </Flex>
      </Canvas>,
    ),
  },
  grapheme: {
    title: "Grapheme Clusters",
    description:
      "UAX#29 segmentation: precomposed and combining-mark rows wrap and truncate at identical cluster positions.",
    vnode: toVNode(
      <Canvas width={920} height={300} background="#1a1a1a">
        <Flex direction="column" width={920} height={300} padding={24} gap={10}>
          <Text font="NotoSansJP-woff2" fontSizePx={12} color="#64748b" width={872} wrap="none">
            precomposed が (1 code point)
          </Text>
          <Text
            font="NotoSansJP-woff2"
            fontSizePx={18}
            color="#f8fafc"
            width={430}
            wrap="char"
            maxLines={2}
            language="ja"
          >
            {"がぎぐげご".repeat(5)}
          </Text>
          <Text font="NotoSansJP-woff2" fontSizePx={12} color="#64748b" width={872} wrap="none">
            {"combining か+\u3099 (2 code points) - identical wrap positions"}
          </Text>
          <Text
            font="NotoSansJP-woff2"
            fontSizePx={18}
            color="#f8fafc"
            width={430}
            wrap="char"
            maxLines={2}
            language="ja"
          >
            {"か\u{3099}き\u{3099}く\u{3099}け\u{3099}こ\u{3099}".repeat(5)}
          </Text>
          <Text
            font="NotoSansJP-woff2"
            fontSizePx={18}
            color="#facc15"
            width={430}
            wrap="char"
            maxLines={1}
            ellipsis
            language="ja"
          >
            {"か\u{3099}き\u{3099}く\u{3099}け\u{3099}こ\u{3099}".repeat(6)}
          </Text>
        </Flex>
      </Canvas>,
    ),
  },
  "font-fallback": {
    title: "Font Fallback",
    description:
      "Glyphs missing from a Latin-only font are resolved via the fallback chain to a CJK font.",
    licenseNotice:
      "Fonts: JetBrains Mono / Monaspace Neon (SIL OFL 1.1), Noto Sans JP (SIL OFL 1.1).",
    vnode: toVNode(
      <Canvas width={920} height={420} background="#1e1e1e">
        <Flex
          direction="column"
          justifyContent="center"
          alignItems="start"
          width={920}
          height={420}
          padding={40}
          gap={20}
        >
          <Text font="NotoSansJP-woff2" fontSizePx={14} color="#64748b">
            Primary: JetBrains Mono → Fallback: Noto Sans JP
          </Text>
          <Text
            font="JetBrainsMono-woff2"
            fallback={["NotoSansJP-woff2", "monospace"]}
            fontSizePx={32}
            color="#f8fafc"
            wrap="char"
            lineHeight={1.5}
          >
            English glyphs from JetBrains Mono. 日本語グリフは Noto Sans JP から解決される。
          </Text>
          <Text font="NotoSansJP-woff2" fontSizePx={14} color="#64748b">
            Primary: Monaspace Neon → Fallback: Noto Sans JP
          </Text>
          <Text
            font="MonaspaceNeon-woff2"
            fallback={["NotoSansJP-woff2", "monospace"]}
            fontSizePx={32}
            color="#a5f3fc"
            wrap="char"
            lineHeight={1.5}
          >
            Latin from Monaspace. 混在テキストの fallback 確認。ABC123 と漢字カナ。
          </Text>
        </Flex>
      </Canvas>,
    ),
  },
  "variable-font": {
    title: "Variable Font",
    description:
      "Weight variation axis on Inter and Noto Sans CJK JP variable fonts. Same font file, different weights.",
    licenseNotice: "Fonts: Inter (SIL OFL 1.1), Noto Sans CJK JP (SIL OFL 1.1).",
    vnode: toVNode(
      <Canvas width={920} height={480} background="#1e1e1e">
        <Flex
          direction="column"
          justifyContent="center"
          alignItems="start"
          width={920}
          height={480}
          padding={40}
          gap={16}
        >
          <Text font="Inter-ttf" fontSizePx={14} color="#64748b">
            Inter Variable — wght axis
          </Text>
          <Text
            font="Inter-ttf"
            fontSizePx={40}
            color="#f8fafc"
            fontVariationSettings="'wght' 300"
            wrap="char"
          >
            Light 300 — The quick brown fox
          </Text>
          <Text
            font="Inter-ttf"
            fontSizePx={40}
            color="#f8fafc"
            fontVariationSettings="'wght' 700"
            wrap="char"
          >
            Bold 700 — The quick brown fox
          </Text>
          <Text
            font="Inter-ttf"
            fontSizePx={40}
            color="#f8fafc"
            fontVariationSettings="'wght' 900"
            wrap="char"
          >
            Black 900 — The quick brown fox
          </Text>
          <Box height={8} />
          <Text font="NotoSansCJKjp-ttf" fontSizePx={14} color="#64748b">
            Noto Sans CJK JP Variable — wght axis
          </Text>
          <Text
            font="NotoSansCJKjp-ttf"
            fontSizePx={36}
            color="#a5f3fc"
            fontVariationSettings="'wght' 300"
            wrap="char"
          >
            Light 300 — 日本語バリアブルフォント
          </Text>
          <Text
            font="NotoSansCJKjp-ttf"
            fontSizePx={36}
            color="#a5f3fc"
            fontVariationSettings="'wght' 700"
            wrap="char"
          >
            Bold 700 — 日本語バリアブルフォント
          </Text>
        </Flex>
      </Canvas>,
    ),
  },
  grid: {
    title: "Grid Layout",
    description: "Info cards using Grid + Box + Text.",
    vnode: toVNode(
      <Canvas width={920} height={420} background="#161616">
        <Grid
          templateColumns="2fr 1fr"
          templateRows="1fr 1fr"
          rowGap={20}
          columnGap={12}
          width={920}
          height={420}
          padding={24}
        >
          <Box
            gridColumn="1 / 2"
            gridRow="1 / 3"
            background="#2d2d2d"
            borderRadius={16}
            padding={20}
            boxShadow="0 4 12 0 rgba(0,0,0,0.3)"
          >
            <Text
              font="NotoSansJP-woff2"
              fontSizePx={34}
              color="#f8fafc"
              wrap="char"
              flexBasis={80}
              flexShrink={0}
            >
              Main Content
            </Text>
          </Box>
          <Box
            gridColumn="2 / 3"
            gridRow="1 / 2"
            background="#0f766e"
            borderRadius={16}
            padding={16}
          >
            <Text font="NotoSansJP-woff2" fontSizePx={24} color="#ecfeff" wrap="char">
              Stats A
            </Text>
          </Box>
          <Box
            gridColumn="2 / 3"
            gridRow="2 / 3"
            background="#7c2d12"
            borderRadius={16}
            padding={16}
            margin={[16, 0, 0, 0]}
          >
            <Text font="NotoSansJP-woff2" fontSizePx={24} color="#ffedd5" wrap="char">
              Stats B
            </Text>
          </Box>
        </Grid>
      </Canvas>,
    ),
  },
  media: {
    title: "Image + Path",
    description: "Mixed composition with Image / Path / Text.",
    vnode: toVNode(
      <Canvas width={920} height={360} background="#1e1e1e">
        <Flex
          direction="row"
          justifyContent="center"
          alignItems="center"
          width={920}
          height={360}
          gap={24}
          padding={24}
        >
          <Image
            src={TEMPLATE_IMAGE_DATA_URL}
            width={240}
            height={240}
            objectFit="cover"
            objectPosition="top"
            borderRadius={12}
            opacity={0.75}
          />
          <Flex
            direction="column"
            justifyContent="center"
            alignItems="start"
            width={560}
            height={260}
            gap={12}
          >
            <Flex direction="row" gap={16} alignItems="center">
              <Path
                d="M 0 60 C 120 0, 260 0, 380 60 C 500 120, 620 120, 760 60"
                width={420}
                height={100}
                stroke="#38bdf8"
                strokeWidth={4}
                strokeDasharray="12,6"
                strokeLinecap="round"
              />
              <Path
                d="M 50 0 L 79 91 L 2 35 L 98 35 L 21 91 Z"
                width={100}
                height={100}
                fill="#facc15"
                fillRule="evenodd"
              />
            </Flex>
            <Text font="NotoSansJP-woff2" fontSizePx={28} color="#e2e8f0" wrap="char">
              Combine images and path drawings within the same layout.
            </Text>
          </Flex>
        </Flex>
      </Canvas>,
    ),
  },
  "white-space": {
    title: "White Space",
    description:
      "Whitespace handling modes: normal (collapse), pre-wrap (preserve), and nowrap (no break).",
    licenseNotice: "Fonts: JetBrains Mono (SIL OFL 1.1).",
    vnode: toVNode(
      <Canvas width={920} height={480} background="#1e1e1e">
        <Flex direction="column" width={920} height={480} padding={32} gap={16}>
          <Text font="JetBrainsMono-woff2" fontSizePx={14} color="#64748b">
            whiteSpace property comparison
          </Text>
          <Flex direction="column" gap={6}>
            <Text font="JetBrainsMono-woff2" fontSizePx={13} color="#94a3b8">
              normal — multiple spaces collapsed, newlines ignored
            </Text>
            <Box background="#2d2d2d" borderRadius={8} padding={16}>
              <Text
                font="JetBrainsMono-woff2"
                fontSizePx={20}
                color="#e2e8f0"
                wrap="char"
                lineHeight={1.5}
                whiteSpace="normal"
              >
                {"multiple   spaces   collapse.   Newlines\nare   also   ignored."}
              </Text>
            </Box>
          </Flex>
          <Flex direction="column" gap={6}>
            <Text font="JetBrainsMono-woff2" fontSizePx={13} color="#94a3b8">
              pre-wrap — spaces and newlines preserved
            </Text>
            <Box background="#2d2d2d" borderRadius={8} padding={16}>
              <Text
                font="JetBrainsMono-woff2"
                fontSizePx={20}
                color="#a5f3fc"
                wrap="char"
                lineHeight={1.5}
                whiteSpace="pre-wrap"
              >
                {"multiple   spaces   preserved.\nNewlines\nare also preserved as-is."}
              </Text>
            </Box>
          </Flex>
          <Flex direction="column" gap={6}>
            <Text font="JetBrainsMono-woff2" fontSizePx={13} color="#94a3b8">
              nowrap — stays on a single line, clipped by container
            </Text>
            <Box background="#2d2d2d" borderRadius={8} padding={16} overflow="clip">
              <Text font="JetBrainsMono-woff2" fontSizePx={20} color="#fde68a" whiteSpace="nowrap">
                {
                  "This text stays on one line regardless of container width. It never wraps — overflowing content is clipped by the parent box. Keep reading to see the clip in action."
                }
              </Text>
            </Box>
          </Flex>
        </Flex>
      </Canvas>,
    ),
  },
  "inline-primitives": {
    title: "Inline Primitives",
    description:
      "Inline style overrides, atomic InlineBox decoration, and vertical text behavior in one comparison.",
    licenseNotice: "Fonts: JetBrains Mono (SIL OFL 1.1), Noto Sans JP (SIL OFL 1.1).",
    vnode: toVNode(
      <Canvas width={600} height={520} background="#1a1a1a">
        <Flex direction="row" width={600} height={520} padding={18} gap={14}>
          <Flex
            direction="column"
            width={124}
            height={484}
            background="#1e1e1e"
            borderRadius={10}
            padding={14}
            gap={8}
          >
            <Text font="NotoSansJP-woff2" fontSizePx={11} color="#64748b" wrap="char">
              Vertical + Inline
            </Text>
            <Text
              font="NotoSansJP-woff2"
              fontSizePx={26}
              color="#fef3c7"
              writingMode="vertical-rl"
              lineHeight={1.28}
              wrap="char"
              language="ja"
              flexGrow={1}
            >
              西暦
              <Inline textCombineUpright="all" color="#fca5a5">
                2026
              </Inline>
              年の
              <Inline textOrientation="upright" color="#93c5fd" letterSpacingPx={2}>
                API
              </Inline>
              設計を縦組みで確認します。
            </Text>
          </Flex>

          <Flex direction="column" width={426} gap={12}>
            <Flex direction="row" gap={12}>
              <Flex
                direction="column"
                width={207}
                background="#1e1e1e"
                borderRadius={10}
                padding={14}
                gap={8}
              >
                <Text font="NotoSansJP-woff2" fontSizePx={11} color="#64748b" wrap="char">
                  Inline — style override only
                </Text>
                <Text
                  font="NotoSansJP-woff2"
                  fontSizePx={18}
                  color="#e2e8f0"
                  wrap="char"
                  lineHeight={1.55}
                >
                  Version{" "}
                  <Inline color="#fca5a5" fontWeight={700}>
                    beta
                  </Inline>{" "}
                  uses the{" "}
                  <Inline
                    font="JetBrainsMono-woff2"
                    color="#c4b5fd"
                    fontSizePx={18}
                    letterSpacingPx={1}
                  >
                    API
                  </Inline>{" "}
                  endpoint with code <Inline color="#fde68a">WARN</Inline>.
                </Text>
              </Flex>
              <Flex
                direction="column"
                width={207}
                background="#1e1e1e"
                borderRadius={10}
                padding={14}
                gap={8}
              >
                <Text font="NotoSansJP-woff2" fontSizePx={11} color="#64748b" wrap="char">
                  InlineBox — decoration + atomic
                </Text>
                <Text
                  font="NotoSansJP-woff2"
                  fontSizePx={18}
                  color="#e2e8f0"
                  wrap="char"
                  lineHeight={1.55}
                >
                  Version{" "}
                  <InlineBox
                    background="#7f1d1d"
                    paddingInline={[6, 6]}
                    borderRadius={4}
                    color="#fca5a5"
                  >
                    beta
                  </InlineBox>{" "}
                  uses the{" "}
                  <InlineBox
                    font="JetBrainsMono-woff2"
                    background="#1e1b4b"
                    paddingInline={[6, 6]}
                    borderRadius={4}
                    color="#c4b5fd"
                    fontSizePx={18}
                  >
                    API
                  </InlineBox>{" "}
                  endpoint with code{" "}
                  <InlineBox
                    background="#422006"
                    paddingInline={[6, 6]}
                    borderRadius={4}
                    color="#fde68a"
                  >
                    WARN
                  </InlineBox>
                  .
                </Text>
              </Flex>
            </Flex>

            <Flex direction="row" gap={12}>
              <Flex
                direction="column"
                width={207}
                background="#1e1e1e"
                borderRadius={10}
                padding={14}
                gap={8}
              >
                <Text font="NotoSansJP-woff2" fontSizePx={11} color="#64748b" wrap="char">
                  Inline wraps mid-token
                </Text>
                <Text
                  font="NotoSansJP-woff2"
                  fontSizePx={17}
                  color="#94a3b8"
                  wrap="char"
                  lineHeight={1.6}
                >
                  Prefix{" "}
                  <Inline color="#a5f3fc" fontWeight={700}>
                    inline-token-can-break
                  </Inline>{" "}
                  suffix.
                </Text>
              </Flex>
              <Flex
                direction="column"
                width={207}
                background="#1e1e1e"
                borderRadius={10}
                padding={14}
                gap={8}
              >
                <Text font="NotoSansJP-woff2" fontSizePx={11} color="#64748b" wrap="char">
                  InlineBox stays atomic
                </Text>
                <Text
                  font="NotoSansJP-woff2"
                  fontSizePx={17}
                  color="#94a3b8"
                  wrap="char"
                  lineHeight={1.6}
                >
                  Prefix{" "}
                  <InlineBox
                    background="#164e63"
                    paddingInline={[6, 6]}
                    borderRadius={4}
                    color="#a5f3fc"
                  >
                    atomic-inlinebox-token
                  </InlineBox>{" "}
                  suffix.
                </Text>
              </Flex>
            </Flex>
          </Flex>
        </Flex>
      </Canvas>,
    ),
  },
  "kinsoku-test": {
    title: "Kinsoku (Horizontal)",
    description:
      "Kinsoku engineered to act exactly at the wrap point: line one is 19 characters + a kuten, so the period is pulled in (oikomi) instead of starting line two; the dash pair straddles the boundary and moves down whole.",
    vnode: toVNode(
      <Canvas width={640} height={440} background="#1e1e1e">
        <Flex
          direction="column"
          justifyContent="center"
          alignItems="start"
          width={640}
          height={440}
          padding={32}
          gap={24}
        >
          <Text
            font="NotoSansJP-woff2"
            fontSizePx={28}
            color="#f8fafc"
            wrap="char"
            lineHeight={1.6}
            language="ja"
          >
            この行は十九文字で折り返すため句点が次。の行頭に来そうですが禁則が調整します
          </Text>
          <Text
            font="NotoSansJP-woff2"
            fontSizePx={28}
            color="#94a3b8"
            wrap="char"
            lineHeight={1.6}
            language="ja"
          >
            ダッシュ罫線は分離されません例えばこ——のように境界をまたいでも保たれます
          </Text>
          <Text
            font="NotoSansJP-woff2"
            fontSizePx={28}
            color="#7dd3fc"
            wrap="char"
            lineHeight={1.6}
            language="ja"
          >
            「閉じ括弧も行頭には置けません十八字目」で改行位置に達しても調整されます
          </Text>
        </Flex>
      </Canvas>,
    ),
  },
  ruby: {
    title: "Ruby Layout",
    description:
      "Over and under ruby annotations in horizontal/vertical layouts with constrained multi-char wrap.",
    vnode: toVNode(
      <Canvas width={920} height={540} background="#222222">
        <Flex direction="row" width={700} height={540} padding={24} gap={24}>
          <Flex direction="column" flexGrow={1} gap={16}>
            <Text
              font="NotoSansJP-woff2"
              fontSizePx={38}
              color="#f8fafc"
              wrap="char"
              lineHeight={1.45}
            >
              東
              <Ruby rubyPosition="over" rubyAlign="center" rubyOffsetPx={0}>
                京
                <Rt fontSizePx={15} color="#fca5a5">
                  きょう
                </Rt>
              </Ruby>
              都と
              <Ruby rubyPosition="under" rubyOffsetPx={0}>
                大
                <Rt fontSizePx={15} color="#93c5fd">
                  おお
                </Rt>
              </Ruby>
              阪を巡る散歩
            </Text>
            <Box width={400}>
              <Text
                font="NotoSansJP-woff2"
                fontSizePx={16}
                color="#94a3b8"
                wrap="char"
                lineHeight={1.6}
              >
                横組み・縦組みの over / under、gap/offset の微調整、読みと英訳を上下に分ける
                alternate ruby を確認できます。
              </Text>
            </Box>
            <Flex
              direction="column"
              width={340}
              gap={8}
              padding={14}
              background="#1e1e1e"
              borderRadius={14}
            >
              <Text font="NotoSansJP-woff2" fontSizePx={13} color="#64748b" wrap="char">
                Alternate ruby with translation.
              </Text>
              <Flex direction="row" width={312}>
                <Text
                  font="NotoSansJP-woff2"
                  fontSizePx={24}
                  color="#dbeafe"
                  wrap="char"
                  lineHeight={1.55}
                  flexGrow={1}
                  fit="shrink"
                  preferredFrame={{ w: 250 }}
                >
                  週末は
                  <Ruby rubyPosition="alternate" rubyAlign="center" rubyOffsetPx={0}>
                    東京
                    <Rt fontSizePx={10} lineHeight={1} color="#fca5a5">
                      とうきょう
                    </Rt>
                    <Rt fontSizePx={10} lineHeight={1} color="#93c5fd">
                      Tokyo
                    </Rt>
                  </Ruby>
                  <Ruby rubyPosition="alternate" rubyAlign="center" rubyOffsetPx={0}>
                    大学
                    <Rt fontSizePx={10} lineHeight={1} color="#fca5a5">
                      だいがく
                    </Rt>
                    <Rt fontSizePx={10} lineHeight={1} color="#93c5fd">
                      University
                    </Rt>
                  </Ruby>
                  の案内を巡ります。
                </Text>
              </Flex>
            </Flex>
            <Flex
              direction="column"
              width={340}
              gap={8}
              padding={12}
              background="#18181b"
              borderRadius={8}
            >
              <Text font="NotoSansJP-woff2" fontSizePx={13} color="#64748b" wrap="none">
                rubyLineSizing stable / default css.
              </Text>
              <Flex direction="row" width={316} gap={12}>
                <Box
                  position="relative"
                  width={152}
                  height={96}
                  background="#111827"
                  borderRadius={8}
                >
                  <Text
                    position="absolute"
                    top={8}
                    left={8}
                    font="NotoSansJP-woff2"
                    fontSizePx={12}
                    color="#94a3b8"
                    wrap="none"
                  >
                    stable
                  </Text>
                  <Text
                    position="absolute"
                    top={28}
                    left={8}
                    font="NotoSansJP-woff2"
                    fontSizePx={24}
                    color="#f8fafc"
                    lineHeight={1.25}
                  >
                    <Ruby rubyPosition="over" rubyAlign="center" rubyLineSizing="stable">
                      京都
                      <Rt fontSizePx={10} lineHeight={1} color="#fca5a5">
                        きょうと
                      </Rt>
                    </Ruby>
                    へ
                  </Text>
                </Box>
                <Box
                  position="relative"
                  width={152}
                  height={96}
                  background="#111827"
                  borderRadius={8}
                >
                  <Text
                    position="absolute"
                    top={8}
                    left={8}
                    font="NotoSansJP-woff2"
                    fontSizePx={12}
                    color="#94a3b8"
                    wrap="none"
                  >
                    default css
                  </Text>
                  <Text
                    position="absolute"
                    top={42}
                    left={8}
                    font="NotoSansJP-woff2"
                    fontSizePx={24}
                    color="#f8fafc"
                    lineHeight={1.25}
                  >
                    <Ruby rubyPosition="over" rubyAlign="center">
                      京都
                      <Rt fontSizePx={10} lineHeight={1} color="#fca5a5">
                        きょうと
                      </Rt>
                    </Ruby>
                    へ
                  </Text>
                </Box>
              </Flex>
            </Flex>
          </Flex>
          <Flex
            direction="column"
            width={208}
            height={412}
            gap={12}
            padding={14}
            background="#1e1e1e"
            borderRadius={14}
          >
            <Text font="NotoSansJP-woff2" fontSizePx={13} color="#64748b" wrap="char">
              Vertical rubyPosition over / under with constrained multi-character wrap.
            </Text>
            <Flex direction="row" width={180} height={334}>
              <Text
                font="NotoSansJP-woff2"
                fontSizePx={28}
                color="#fde68a"
                writingMode="vertical-rl"
                lineHeight={1.35}
                wrap="char"
                language="ja"
                flexGrow={1}
                preferredFrame={{ h: 334 }}
              >
                <Ruby rubyPosition="over" rubyAlign="space-around">
                  古都散策
                  <Rt fontSizePx={11} lineHeight={1} color="#fca5a5">
                    ことさんさく
                  </Rt>
                </Ruby>
                では
                <Ruby rubyPosition="under" rubyAlign="space-between">
                  都案内
                  <Rt fontSizePx={11} lineHeight={1} color="#93c5fd">
                    みやこあんない
                  </Rt>
                </Ruby>
                を片手に巡ります。
              </Text>
            </Flex>
          </Flex>
        </Flex>
      </Canvas>,
    ),
  },
  vertical: {
    title: "Vertical Japanese",
    description: "Vertical Japanese text with hanging punctuation.",
    vnode: toVNode(
      <Canvas width={800} height={300} background="#1a1a1a">
        <Flex direction="row" width={800} height={300} padding={[20, 24, 20, 24]}>
          <Flex flexGrow={1} />
          <Text
            font="NotoSansJP-woff2"
            fontSizePx={28}
            color="#fef3c7"
            writingMode="vertical-rl"
            wrap="char"
            language="ja"
            hangingPunctuation
          >
            {
              "この列は九文字です。句点は行頭に来ず、ぶら下げで処理されます。半角のABCや123は自動回転。「括弧」やダッシュ——も正しく扱われます。"
            }
          </Text>
        </Flex>
      </Canvas>,
    ),
  },
  "vertical-rich-ellipsis": {
    title: "Vertical Rich Ellipsis",
    description:
      "A three-column vertical rich-text frame. Ellipsis preserves grapheme, ruby, atomic inline, nested decoration, and source-style boundaries.",
    vnode: toVNode(
      <Canvas width={720} height={400} background="#111827">
        <Flex
          direction="row"
          alignItems="center"
          width={720}
          height={400}
          padding={[32, 40, 32, 40]}
          gap={32}
        >
          <Flex direction="column" width={280} gap={12}>
            <Text font="NotoSansJP-woff2" fontSizePx={14} color="#60a5fa" wrap="none">
              VERTICAL RICH TEXT
            </Text>
            <Text font="NotoSansJP-woff2" fontSizePx={28} color="#f8fafc" wrap="char">
              三列で安全に省略
            </Text>
            <Text
              font="NotoSansJP-woff2"
              fontSizePx={14}
              color="#94a3b8"
              wrap="char"
              lineHeight={1.55}
            >
              ルビや原子的なインラインを分断せず、装飾された最長の合法な接頭辞を選びます。
            </Text>
          </Flex>
          <Flex
            direction="row"
            justifyContent="center"
            alignItems="center"
            width={328}
            height={336}
            padding={18}
            background="#1e293b"
            borderWidth={1}
            borderColor="#334155"
            borderRadius={18}
            overflow="clip"
          >
            <Text
              font="NotoSansJP-woff2"
              fontSizePx={24}
              color="#e2e8f0"
              writingMode="vertical-rl"
              wrap="char"
              language="ja"
              lineHeight={1.35}
              maxLines={3}
              ellipsis
              width={278}
              height={286}
            >
              縦組みの
              <Inline color="#7dd3fc" fontWeight={700}>
                リッチ
              </Inline>
              文章は
              <Ruby rubyPosition="over" rubyAlign="center">
                境界
                <Rt fontSizePx={10} lineHeight={1} color="#fda4af">
                  きょうかい
                </Rt>
              </Ruby>
              と
              <InlineBox
                background="#164e63"
                paddingInline={[4, 4]}
                borderRadius={4}
                color="#a5f3fc"
              >
                原子
              </InlineBox>
              を保ち、
              <Inline
                color="#fde68a"
                textDecoration={{ line: "underline", color: "#f59e0b", thicknessPx: 2 }}
              >
                <Inline fontWeight={700}>最長の合法な接頭辞を選んで表示します。</Inline>
                省略された末尾の装飾や警告は採用されません。
              </Inline>
            </Text>
          </Flex>
        </Flex>
      </Canvas>,
    ),
  },
  "vertical-kinsoku": {
    title: "Vertical Kinsoku",
    description: "Kinsoku rules in vertical columns. Punctuation / bracket / dash placement.",
    vnode: toVNode(
      <Canvas width={720} height={480} background="#1a1a1a">
        <Flex
          direction="row"
          justifyContent="center"
          alignItems="center"
          width={720}
          height={480}
          padding={32}
        >
          <Text
            font="NotoSansJP-woff2"
            fontSizePx={36}
            color="#fef3c7"
            writingMode="vertical-rl"
            lineHeight={1.5}
            wrap="char"
            language="ja"
            hangingPunctuation
          >
            縦一列に十一字入ります。句点は行頭に置かれず、ぶら下げや追い出しで調整されます。「括弧」も同様に処理されます。
          </Text>
        </Flex>
      </Canvas>,
    ),
  },
  "nfc-mixed": {
    title: "NFC + Vertical Mixed",
    description: "NFC normalization (horizontal) and vertical CJK + ASCII alignment.",
    vnode: toVNode(
      <Canvas width={800} height={600} background="#1a1a1a">
        <Flex direction="row" alignItems="stretch" width={800} height={600} padding={40} gap={32}>
          <Flex direction="column" gap={12} width={440}>
            <Text font="NotoSansJP-woff2" fontSizePx={14} color="#64748b" language="ja">
              NFC正規化テスト (横書き)
            </Text>
            <Text
              font="NotoSansJP-woff2"
              fontSizePx={28}
              color="#fef3c7"
              wrap="char"
              lineHeight={1.6}
              language="ja"
            >
              NFD濁点テスト：か&#x3099;き&#x3099;く&#x3099;。波ダッシュ～変換テスト〜。
            </Text>
          </Flex>
          <Flex direction="column" gap={12} width={248}>
            <Text font="NotoSansJP-woff2" fontSizePx={14} color="#64748b" language="ja">
              縦書きCJK+ASCII混在
            </Text>
            <Text
              font="NotoSansJP-woff2"
              fontSizePx={22}
              color="#a5f3fc"
              writingMode="vertical-rl"
              wrap="char"
              lineHeight={1.5}
              language="ja"
            >
              縦書きでABCと123の位置を確認。句読点（。、）も正しく配置される。
            </Text>
          </Flex>
        </Flex>
      </Canvas>,
    ),
  },
  shrinkwrap: {
    title: "Shrinkwrap",
    description:
      "Minimum-size sizing for horizontal and vertical text, ruby caption, and vertical richText shrinkwrap.",
    build: buildShrinkwrapVNode,
  },
  measurements: {
    title: "Measurements",
    description:
      "measureTextBlock and measureIntrinsicInlineSize for horizontal, vertical, and rich text modes.",
    build: buildMeasurementsVNode,
  },
  ...TEXT_MOTION_TEMPLATE_DEFINITIONS,
};

type TemplateGroupDef = {
  key: string;
  label: string;
  templateKeys: string[];
};

export const DEFAULT_TEMPLATE_KEY = "terminal";

export const TEMPLATE_GROUPS: TemplateGroupDef[] = [
  {
    key: "featured",
    label: "Featured",
    templateKeys: ["terminal"],
  },
  {
    key: "layout-basics",
    label: "Layout Basics",
    templateKeys: ["fit", "grid", "media"],
  },
  {
    key: "text-basics",
    label: "Text Basics",
    templateKeys: ["white-space", "grapheme", "font-fallback", "variable-font"],
  },
  {
    key: "advanced-typography",
    label: "Advanced Typography",
    templateKeys: [
      "inline-primitives",
      "kinsoku-test",
      "ruby",
      "vertical",
      "vertical-rich-ellipsis",
      "vertical-kinsoku",
      "nfc-mixed",
    ],
  },
  {
    key: "text-motion",
    label: "Text Motion",
    templateKeys: [
      "animated-svg-timeline",
      "typing-ime-timeline",
      "text-on-path-basics",
      "decoration-path-fit",
      "rich-text-on-path",
      "text-path-motion",
    ],
  },
  {
    key: "measurement-apis",
    label: "Measurement APIs",
    templateKeys: ["shrinkwrap", "measurements"],
  },
];
