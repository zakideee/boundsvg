import { defineConfig } from "vitepress";

const guideSidebar = [
  {
    text: "Getting Started",
    items: [
      { text: "Introduction", link: "/getting-started/introduction" },
      { text: "Installation", link: "/getting-started/installation" },
      { text: "Quick Start", link: "/getting-started/quick-start" },
      { text: "Versioning & Stability", link: "/getting-started/versioning" },
    ],
  },
  {
    text: "Reference",
    items: [
      { text: "Feature Matrix", link: "/reference/feature-matrix" },
      { text: "Choosing an API", link: "/reference/api-selection" },
      { text: "Determinism Contract", link: "/reference/determinism" },
      { text: "Known Limitations", link: "/reference/known-limitations" },
    ],
  },
  {
    text: "Guides",
    items: [
      { text: "Overview", link: "/guides/" },
      { text: "Text & Fonts", link: "/guides/text-and-fonts" },
      { text: "Vertical Text", link: "/guides/vertical-text" },
      { text: "React Integration", link: "/guides/react-integration" },
      { text: "Animation", link: "/guides/animation" },
      { text: "Layout Transitions", link: "/guides/layout-transitions" },
      { text: "PNG, WebP & GIF Export", link: "/guides/png-export" },
      { text: "Video Export", link: "/guides/video-export" },
      { text: "Image Loading", link: "/guides/image-loading" },
      { text: "Documents & Codes", link: "/guides/documents-and-codes" },
      { text: "Layered Export", link: "/guides/layered-export" },
      { text: "Debugging & Diagnostics", link: "/guides/debugging-diagnostics" },
      { text: "Shape Registry", link: "/guides/shape-registry" },
      { text: "Chart Integration", link: "/guides/chart-integration" },
      { text: "Utility Components", link: "/guides/utility-components" },
    ],
  },
];

export default defineConfig({
  title: "boundsvg",
  description:
    "WASM-powered font measurement and layout library for SVG. Measure text bounding boxes, auto-fit fonts, and apply HTML-like layouts — without browser DOM or OS fonts.",
  lang: "en-US",

  // GitHub Pages project site is served under /<repo>/. Override with DOCS_BASE
  // (e.g. "/" for a user/organization site or custom domain at the root).
  base: process.env.DOCS_BASE ?? "/boundsvg/",

  themeConfig: {
    nav: [
      {
        text: "Guide",
        link: "/getting-started/introduction",
        activeMatch: "/getting-started/|/guides/",
      },
      { text: "Components", link: "/components/canvas" },
      { text: "API", link: "/api/core" },
      {
        // Playgrounds are separate static apps assembled under /playground/*
        // at deploy time (see .github/workflows/docs.yml). They are not part
        // of the VitePress dev server, so open them in a new tab.
        text: "Playground",
        items: [
          { text: "React", link: "/playground/react/", target: "_blank", rel: "noreferrer" },
          {
            text: "Core (SVG in / out)",
            link: "/playground/core/",
            target: "_blank",
            rel: "noreferrer",
          },
          { text: "CLI Preview", link: "/playground/cli/", target: "_blank", rel: "noreferrer" },
        ],
      },
      {
        text: "Links",
        items: [
          { text: "GitHub", link: "https://github.com/zakideee/boundsvg" },
          { text: "boundsvg Rust API", link: "https://docs.rs/boundsvg/latest/boundsvg/" },
          { text: "boundtext Rust API", link: "https://docs.rs/boundtext/latest/boundtext/" },
          { text: "boundshape Rust API", link: "https://docs.rs/boundshape/latest/boundshape/" },
        ],
      },
    ],

    sidebar: {
      "/getting-started/": guideSidebar,
      "/components/": [
        {
          text: "Components",
          items: [
            { text: "Canvas", link: "/components/canvas" },
            { text: "Flex", link: "/components/flex" },
            { text: "Grid", link: "/components/grid" },
            { text: "Box", link: "/components/box" },
            { text: "Text", link: "/components/text" },
            { text: "Inline / InlineBox", link: "/components/inline" },
            { text: "Ruby", link: "/components/ruby" },
            { text: "Rt", link: "/components/rt" },
            { text: "Image", link: "/components/image" },
            { text: "Path", link: "/components/path" },
            { text: "Svg", link: "/components/svg" },
            { text: "Shape", link: "/components/shape" },
            { text: "Symbol", link: "/components/symbol" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API Reference",
          items: [
            { text: "@boundsvg/core", link: "/api/core" },
            { text: "@boundsvg/react", link: "/api/react" },
            { text: "@boundsvg/browser", link: "/api/browser" },
            { text: "@boundsvg/worker", link: "/api/worker" },
            { text: "@boundsvg/testing", link: "/api/testing" },
            { text: "@boundsvg/extras", link: "/api/extras" },
            { text: "@boundsvg/shape", link: "/api/shape" },
            { text: "CLI Diagnostics", link: "/api/cli" },
            { text: "Rust crates", link: "/api/engine" },
          ],
        },
      ],
      "/guides/": guideSidebar,
      "/reference/": guideSidebar,
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/zakideee/boundsvg/edit/main/apps/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message:
        'Released under the <a href="https://github.com/zakideee/boundsvg/blob/main/LICENSE-MIT">MIT</a> or <a href="https://github.com/zakideee/boundsvg/blob/main/LICENSE-APACHE">Apache-2.0</a> License.',
    },
  },
});
