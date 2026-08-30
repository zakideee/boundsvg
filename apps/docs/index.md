---
layout: home
hero:
  name: boundsvg
  text: Font Measurement & Layout Library for SVG
  tagline: Version-pinned text shaping and layout in WASM.
  image:
    src: /logo/boundsvg-logo-violet-muted.svg
    alt: boundsvg logo
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/introduction
    - theme: alt
      text: Try the Playground
      link: /playground/react/
      target: _blank
      rel: noreferrer
    - theme: alt
      text: API Reference
      link: /api/core
features:
  - title: Precise Text Measurement
    details: rustybuzz-based shaping gives precise glyph bounds in WASM.
  - title: Auto-fit & Layout System
    details: Auto-fit text and use Flexbox/Grid layouts via Taffy.
  - title: Deterministic Output
    details: Accepted owned inputs produce the same covered SVG, PNG, WebP, and GIF artifacts across supported runtimes, after documented normalization.
    link: /reference/determinism
    linkText: Read the contract
  - title: Try It in the Browser
    details: Edit JSX, SVG, or CLI input and see rendered output live in the interactive playgrounds.
    link: /playground/react/
    linkText: Open Playground
    target: _blank
    rel: noreferrer
---

## Rendered by boundsvg

Every image below is a single SVG file generated from JSX — the first one animates
with no JavaScript and no GIF.

<div class="example-output">
  <img src="/generated/terminal-typing.svg" alt="A terminal window that types a command one character at a time, prints colored runner output, advances a progress bar, and reports PASS" />
</div>

<div class="example-output">
  <img src="/generated/figure-flow.svg" alt="A heading that shrink-fits its row while Japanese body copy wraps around a donut chart via a circular text-flow exclusion" />
</div>

<div class="example-output">
  <img src="/generated/vertical-ruby-ja.svg" alt="Vertical Japanese text with Ruby annotations" />
</div>

More examples, with the JSX that produced them, start in the
[introduction](/getting-started/introduction) and run live in the
<a href="./playground/react/" target="_blank" rel="noreferrer">playground</a>.
