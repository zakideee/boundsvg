# playground-react mobile viewer audit

Status: implementation and WebKit regression completed; physical iOS verification pending

Scope: `apps/playground-react` only

## Objective

The React playground is a sample viewer first. On phones it must prioritize:

1. seeing the rendered result;
2. reaching every essential control without clipped or overlapping UI;
3. retaining the browser's native page scroll;
4. offering simple tap-based controls while leaving complex editing to larger screens.

The phone layout does not promise parity for multi-selection, drag reordering,
hover inspection, keyboard shortcuts, or simultaneous comparison of multiple
large render surfaces. Dedicated transform and composition drag surfaces remain
available where they have coarse-pointer regression coverage.

## Reproduction and findings

The current source and the deployed GitHub Pages build were inspected at 390 x
844 (portrait) and 844 x 390 (landscape). All fourteen routes were checked
locally; Templates, Controls, Animation, Interactive Events, Hit Test, and the
Multi-SVG Editor were also compared with the deployed build.

At 390 x 844 the header consumes 263-292 px and leaves 552-581 px for the main
area. The fixed-height shell then compresses content into nested scrollports:

| Route            | Visible panel height / content height |
| ---------------- | ------------------------------------: |
| Templates        |          90 / 1736 px and 28 / 301 px |
| Transform        |                          65 / 1275 px |
| Animation        |                          93 / 1559 px |
| Layout Compare   |           59 / 850 px and 28 / 122 px |
| Multi-SVG Editor |          49 / 583 px and 49 / 1059 px |
| Layered          |                           80 / 826 px |

The failures are structural rather than isolated component bugs:

- `.example-shell` and `.example-main` prevent document scrolling;
- desktop grids are converted to rows while their fixed-height parent remains;
- navigation wraps into several rows instead of becoming a compact rail;
- preview headings keep title, description, and tabs in one unshrinkable row;
- controls are generally 28-34 px high and inputs use 11-13 px text;
- Text Flow and the visual editor disable native touch gestures over their
  complete canvas surfaces;
- hover, right-click, double-click, Shift, Delete, and Escape are presented as
  required interactions on several routes;
- the Animation mobile grid leaves `.animation-export-actions` assigned to an
  implicit second column;
- every route is statically imported and all configured fonts are loaded by the
  root provider. The deployed cold start transferred about 9.5 MB.

## Reusable mobile-viewer lessons

The following layout practices address the comparable iOS problems:

- Below 820 px, the page is the only vertical scroller; panel scrollports are
  changed to visible overflow.
- The preview is ordered before the controls. In the editor product it is also
  sticky so edits remain visible while the page scrolls.
- Width resizers and desktop-only inspectors are removed on a stacked layout.
- Header reassurance copy and secondary hints are hidden rather than wrapped.
- Tabs and tool rails scroll horizontally without breaking labels.
- Layout is selected by viewport width, while interaction copy and target sizing
  use `(hover: none) and (pointer: coarse)`.
- Normal one-finger movement stays available to the browser. `touch-action:
none` is applied only to a dedicated grip or while a custom zoom is active.
- Single-line fields use 16 px text at phone width, touch actions become 40-44
  px, and `100dvh` is used where the dynamic viewport matters.
- `visualViewport` is used to repair focus state after the iOS software keyboard
  closes, and page pinning is reserved for real overlays.

The playground is intentionally simpler than the studio. It should adopt the
scroll ownership, ordering, capability queries, form sizing, and selective
feature removal. It should not adopt the studio's pinch/pan engine, long-press
editor, draggable preview sheet, or viewport-locking overlay machinery unless a
future playground requirement explicitly needs them.

## Adjusted implementation policy

### Shared phone shell

- Use `min-height: 100dvh` and allow the document to grow.
- Make the document the sole primary vertical scroller.
- Convert route grids to normal one-column flow and clear panel height caps.
- Order the preview before controls on viewer routes.
- Keep navigation in two single-line, horizontally scrollable rails, with the
  category rail rendered as compact 32 px chips.
- Omit rendered-source and generated-code tabs on phones. Reset only their
  presentation state when entering viewer mode so the page returns to Preview
  without losing the selected sample, edits, controls, or animation state.
- Respect safe-area insets and keep focused controls visible above the keyboard.
- Make form text 16 px at phone width and make coarse-pointer targets at least
  40 px, with 44 px for primary actions.
- Use compact horizontal rows for short labels paired with selects, numbers,
  and colors. Keep textarea, feature grids, diagnostics, and other compound
  controls vertically stacked.

### Page policy

| Route class                                                             | Phone support                                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Templates, Shapes, Text Effects, Transform, Text Flow, Worker, Hit Test | Full viewer plus simple controls                                                                                                |
| Animation, Layout Compare, Layered, Interactive Events                  | Simplified viewer; one primary surface and touch-relevant controls                                                              |
| Controls visual editor, Multi-SVG Editor                                | Compact editor; touch transforms and composition dragging remain, while advanced sidebars and desktop-only gestures are omitted |
| API Examples                                                            | Desktop-oriented; omitted from phone navigation, but direct links retain a preview-only fallback                                |

### Explicit non-goals

- mobile parity for keyboard shortcuts or modifier-key selection;
- multi-selection transforms and keyboard-assisted editing on a phone;
- hover-only layer inspection without a tap fallback;
- simultaneous large preview surfaces when one selected surface conveys the
  sample;
- unrestricted 4x raster or long animated export on memory-constrained phones.

## Acceptance criteria

- All fourteen routes are reachable at 390 x 844 and 844 x 390.
- No header, panel heading, tab, or primary action overlaps another.
- Every essential control can be reached through the document scroll; a panel
  does not trap vertical touch scrolling.
- The initial view contains a meaningful rendered preview where render output is
  the purpose of the page.
- Horizontal scrolling is limited to explicit tab/tool rails, code, and canvas
  surfaces where it is intentional.
- Touch instructions never require hover, right-click, or a hardware keyboard.
- Form focus does not trigger a persistent page zoom on iOS.
- Build, lint, and relevant playground/e2e checks pass.
- The final implementation is verified on an actual iOS Safari device before it
  is described as guaranteeing iOS behavior.

## Implemented baseline

The first implementation lives on `feat/playground-react-mobile-viewer` and
keeps the desktop experience unchanged. Its phone behavior is deliberately a
viewer profile rather than a responsive copy of the complete editor:

- the shell and every stacked route use document scrolling;
- the preview appears before controls and panels expand to their natural height;
- navigation uses compact horizontal rails, while rendered-source and
  generated-code tabs are omitted from the phone viewer. Crossing the viewer
  breakpoint resets only source presentation state, preserving samples,
  controls, editor documents, and animation state;
- short coarse-pointer landscape viewports omit the brand row, reducing the
  header from 141 px to 93 px; explanatory viewer banners were removed at all
  phone sizes once the restrictions became visible in the UI itself;
- Templates and Layout Compare replace long choice lists with grouped native
  selects;
- Templates fixes rendering to its default viewer path and omits the complete
  Render section, including Renderer API, Text Rendering, PNG scale, and BBox
  diagnostics;
- Shapes and Transform omit renderer/BBox/overlay diagnostics; Layout Compare
  keeps its two meaningful output panes but omits its inspection panel; API
  Examples is absent from phone navigation and keeps no API switcher when opened
  by a direct URL;
- shared sample selectors and simple numeric/select/color fields use compact
  label-control rows, while compound inputs retain their readable vertical
  layout. Native selects declare a dark color scheme so WebKit does not combine
  a light native surface with the playground's light text;
- preview stages no longer reserve a viewport-relative minimum height on
  phones. They follow the rendered SVG aspect ratio with 6 px insets; only
  components with intrinsic interaction space retain their own sizing. Text
  Flow and Layered use reduced, page-specific canvas insets;
- Animation mounts one primary surface, removes technical prose, and omits
  static-sampling diagnostics and misleading frame exports for declarative
  presets; layout-reactive presets retain the time control because it is their
  primary interaction;
- the visual editor retains sample selection and SVG/PNG export, fits the
  artboard to the available viewport, and hides mutation-oriented side panels.
  Dedicated coarse-pointer targets keep move, resize, and rotate usable without
  moving the document;
- the Multi-SVG page keeps the composed result and caps mobile raster export at
  2x. Its dedicated selection surface supports touch dragging, and an
  unselected asset can be selected and moved in one gesture without moving the
  document;
- Worker renders and displays only its SVG result on phones, removes its outer
  output labels, and reduces Provider Status to a compact Worker/SVG state row.
  Layered fixes its viewer to the stacked SVG surface and one scene selector.
  Worker PNG plus Layered single-SVG/PNG comparison paths receive no vnode on
  mobile, avoiding redundant work rather than merely hiding it;
- Text Flow replaces its descriptive preset cards with one native selector and
  omits BBox diagnostics; its canvas continues to reserve custom touch handling
  only for the draggable obstacles;
- Interactive Events uses four large, touch-relevant cards and omits the
  desktop-only hover, mouse, context-menu, and overlap demonstrations;
- Hit Test and Layered have tap alternatives. Text Flow gives vertical pan and
  pinch gestures back to the browser outside obstacles, while explicitly
  identified draggable obstacles alone use `touch-action: none` so a drag does
  not also move the page.

## Automated viewport verification

Chromium device emulation was rerun after implementation across all fourteen
routes at 390 x 844 and 844 x 390:

- document `scrollWidth` matched `clientWidth` on every route;
- the shell and main content reported visible vertical overflow, leaving the
  document as scroll owner;
- every primary preview preceded its corresponding controls;
- no visible panel had clipped vertical content;
- no preview-header children overlapped;
- portrait headers measured 133 px after compacting category chips; short
  landscape keeps the same compact policy;
- a synthesized touch on the Interactive `card-touch` node produced both
  `touchStart` and `touchEnd` log entries with SVG coordinates.
- a synthesized Text Flow obstacle drag moved the obstacle without changing
  `window.scrollY`.
- synthesized coarse-pointer drags moved, resized, and repeatedly rotated a
  Controls selection without changing `window.scrollY`.
- synthesized touch drags moved both the selected Multi-SVG asset and an
  unselected asset selected by that same gesture without changing
  `window.scrollY`.

Playwright WebKit at an iPhone 13-equivalent viewport was also rerun for the
native select, breakpoint transition, and Animation export policy. The select
painted a dark native surface, `Measurements` remained selected while source
view returned to Preview, and no inaccessible still-image action remained.

At 1440 x 900, Templates retained the full list, the visual editor retained its
sidebars and tools, Animation retained two preview surfaces and all export
formats, and Interactive retained the full event matrix. This is an emulation
and regression baseline only; the final iOS Safari acceptance item remains
open until it is exercised on physical hardware.
