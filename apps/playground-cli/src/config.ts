import { asset } from "./asset";
import type { PresetGroupDefinition } from "./types";

export const FONT_ALIAS = "NotoSansJP-woff2";
export const FONT_URL = asset("/fonts/NotoSansJP-Regular.subset.woff2");
export const DEFAULT_PREVIEW_PNG_SCALE = 2;

const FLUENT_FIXTURE_BASE = asset("/third-party-svg/fluentui-emoji");
const FLUENT_SOURCE_LABEL = "Microsoft Fluent UI Emoji";
const FLUENT_SOURCE_REPO = "https://github.com/microsoft/fluentui-emoji";
const FLUENT_SOURCE_COMMIT = "62ecdc0d7ca5c6df32148c169556bc8d3782fca4";
const FLUENT_SOURCE_LICENSE = "MIT";

const NATURAL_EARTH_FIXTURE_BASE = asset("/third-party-svg/natural-earth");
const NATURAL_EARTH_SOURCE_LABEL = "Natural Earth";
const NATURAL_EARTH_SOURCE_REPO = "https://github.com/zakideee/natural-earth-svg";
const NATURAL_EARTH_SOURCE_COMMIT = "da149d13ede557543da378fb8add3233ed4b74fa";
const NATURAL_EARTH_SOURCE_LICENSE = "Public Domain";

export const PRESET_GROUPS: PresetGroupDefinition[] = [
  {
    key: "builtin",
    title: "Built-in",
    sources: [
      {
        key: "core",
        title: "Core Samples",
        presets: [
          {
            key: "simple",
            title: "Simple",
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="100">
  <defs>
    <linearGradient id="sbg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#1e1e1e"/>
      <stop offset="100%" stop-color="#2d2d2d"/>
    </linearGradient>
  </defs>
  <rect width="480" height="100" rx="12" fill="url(#sbg)"/>
  <rect x="0" y="0" width="480" height="4" rx="2" fill="#22d3ee"/>
  <line x1="24" y1="84" x2="456" y2="84" stroke="#474747" stroke-width="1"/>
  <rect x="24" y="20" width="432" height="52" fill="none" stroke="none"/>
  <text x="240" y="56" font-size="28" fill="#e2e8f0" text-anchor="middle">Hello boundsvg</text>
</svg>`,
          },
          {
            key: "multi",
            title: "Multi",
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200">
  <rect width="480" height="200" rx="12" fill="#1e1e1e"/>
  <line x1="24" y1="52" x2="456" y2="52" stroke="#2d2d2d" stroke-width="1"/>
  <line x1="24" y1="100" x2="456" y2="100" stroke="#2d2d2d" stroke-width="1"/>
  <line x1="24" y1="148" x2="456" y2="148" stroke="#2d2d2d" stroke-width="1"/>
  <circle cx="38" cy="120" r="5" fill="#f87171"/>
  <circle cx="256" cy="120" r="5" fill="#4ade80"/>
  <rect x="24" y="10" width="432" height="36" fill="none" stroke="none"/>
  <text x="240" y="36" font-size="22" fill="#f8fafc" text-anchor="middle">Dashboard</text>
  <rect x="24" y="62" width="432" height="30" fill="none" stroke="none"/>
  <text x="240" y="84" font-size="15" fill="#94a3b8" text-anchor="middle">Secondary text with muted color</text>
  <rect x="52" y="110" width="184" height="28" fill="none" stroke="none"/>
  <text x="144" y="130" font-size="14" fill="#fca5a5" text-anchor="middle">Alert: check config</text>
  <rect x="272" y="110" width="184" height="28" fill="none" stroke="none"/>
  <text x="364" y="130" font-size="14" fill="#86efac" text-anchor="middle">Status: operational</text>
  <rect x="24" y="158" width="432" height="26" fill="none" stroke="none"/>
  <text x="240" y="178" font-size="12" fill="#67e8f9" text-anchor="middle">Latency: 12 ms</text>
</svg>`,
          },
          {
            key: "rect",
            title: "Rect+Text",
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="150">
  <defs>
    <linearGradient id="rbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e1e1e"/>
      <stop offset="100%" stop-color="#2d2d2d"/>
    </linearGradient>
  </defs>
  <rect width="480" height="150" rx="12" fill="url(#rbg)"/>
  <line x1="240" y1="12" x2="240" y2="64" stroke="#474747" stroke-width="1"/>
  <line x1="24" y1="76" x2="456" y2="76" stroke="#474747" stroke-width="1"/>
  <rect x="24" y="14" width="200" height="48" fill="none" stroke="none"/>
  <text x="124" y="46" font-size="18" fill="#f8fafc" text-anchor="middle">Default Card</text>
  <rect x="256" y="14" width="200" height="48" fill="none" stroke="none"/>
  <text x="356" y="46" font-size="18" fill="#93c5fd" text-anchor="middle">Accent Card</text>
  <rect x="24" y="86" width="432" height="44" fill="none" stroke="none"/>
  <text x="240" y="116" font-size="20" fill="#c4b5fd" text-anchor="middle">Full-width card</text>
</svg>`,
          },
          {
            key: "complex",
            title: "Complex",
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#667eea"/>
      <stop offset="100%" stop-color="#764ba2"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#bg)" rx="16"/>
  <circle cx="340" cy="60" r="40" fill="rgba(255,255,255,0.15)"/>
  <path d="M20 250 Q100 200 200 240 T380 220" stroke="rgba(255,255,255,0.2)" stroke-width="2" fill="none"/>
  <rect x="30" y="40" width="340" height="50" fill="none" stroke="none"/>
  <text x="40" y="80" font-size="36" fill="#ffffff">Card Title</text>
  <rect x="30" y="95" width="340" height="35" fill="none" stroke="none"/>
  <text x="40" y="120" font-size="18" fill="rgba(255,255,255,0.8)">Description with gradient bg</text>
  <rect x="30" y="140" width="340" height="80" fill="none" stroke="none"/>
  <text x="40" y="180" font-size="14" fill="rgba(255,255,255,0.6)">Non-text elements (circle, path, gradient) are preserved as raw SVG passthrough.</text>
</svg>`,
          },
        ],
      },
    ],
  },
  {
    key: "third-party",
    title: "Third-party SVG",
    sources: [
      {
        key: "fluent",
        title: "Fluent UI Emoji (MIT)",
        presets: [
          {
            key: "sunset",
            title: "Sunset",
            svgUrl: `${FLUENT_FIXTURE_BASE}/sunset_color.svg`,
            sourceLabel: FLUENT_SOURCE_LABEL,
            sourceRepo: FLUENT_SOURCE_REPO,
            sourceCommit: FLUENT_SOURCE_COMMIT,
            sourcePath: "assets/Sunset/Color/sunset_color.svg",
            license: FLUENT_SOURCE_LICENSE,
          },
          {
            key: "sun-with-face",
            title: "Sun with face",
            svgUrl: `${FLUENT_FIXTURE_BASE}/sun_with_face_color.svg`,
            sourceLabel: FLUENT_SOURCE_LABEL,
            sourceRepo: FLUENT_SOURCE_REPO,
            sourceCommit: FLUENT_SOURCE_COMMIT,
            sourcePath: "assets/Sun with face/Color/sun_with_face_color.svg",
            license: FLUENT_SOURCE_LICENSE,
          },
          {
            key: "desktop-computer",
            title: "Desktop computer",
            svgUrl: `${FLUENT_FIXTURE_BASE}/desktop_computer_color.svg`,
            sourceLabel: FLUENT_SOURCE_LABEL,
            sourceRepo: FLUENT_SOURCE_REPO,
            sourceCommit: FLUENT_SOURCE_COMMIT,
            sourcePath: "assets/Desktop computer/Color/desktop_computer_color.svg",
            license: FLUENT_SOURCE_LICENSE,
          },
          {
            key: "laptop",
            title: "Laptop",
            svgUrl: `${FLUENT_FIXTURE_BASE}/laptop_color.svg`,
            sourceLabel: FLUENT_SOURCE_LABEL,
            sourceRepo: FLUENT_SOURCE_REPO,
            sourceCommit: FLUENT_SOURCE_COMMIT,
            sourcePath: "assets/Laptop/Color/laptop_color.svg",
            license: FLUENT_SOURCE_LICENSE,
          },
          {
            key: "chart-decreasing",
            title: "Chart decreasing",
            svgUrl: `${FLUENT_FIXTURE_BASE}/chart_decreasing_color.svg`,
            sourceLabel: FLUENT_SOURCE_LABEL,
            sourceRepo: FLUENT_SOURCE_REPO,
            sourceCommit: FLUENT_SOURCE_COMMIT,
            sourcePath: "assets/Chart decreasing/Color/chart_decreasing_color.svg",
            license: FLUENT_SOURCE_LICENSE,
          },
        ],
      },
      {
        key: "natural-earth",
        title: "Natural Earth (Public Domain)",
        presets: [
          {
            key: "world-terrain-borders",
            title: "World Terrain + Borders (50m)",
            svgUrl: `${NATURAL_EARTH_FIXTURE_BASE}/world-terrain-borders-50m.svg`,
            sourceLabel: NATURAL_EARTH_SOURCE_LABEL,
            sourceRepo: NATURAL_EARTH_SOURCE_REPO,
            sourceCommit: NATURAL_EARTH_SOURCE_COMMIT,
            sourcePath: "output/terrain/world-terrain-borders-50m.svg",
            license: NATURAL_EARTH_SOURCE_LICENSE,
          },
        ],
      },
    ],
  },
];
