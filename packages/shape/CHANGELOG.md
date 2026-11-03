# @boundsvg/shape

## 0.10.0

### Minor Changes

- [#56](https://github.com/zakideee/boundsvg/pull/56) [`cf30f4b`](https://github.com/zakideee/boundsvg/commit/cf30f4becbd59ce7253c4270ddec540a3506a987) Thanks [@zakideee](https://github.com/zakideee)! - Add shared-frame Text/Inline gradients, sequential X/Y skew transforms, four-sided layout borders, and automatically sized container outlines.

  **Output-affecting:** Container borders now reserve space before padding and paint an inset surface. Absolute child placement and small fixed sizes follow the border box. Move the removed container stroke fields to `outline`, using `stroke` and `strokeWidth`; remove border widths when only a line frame is intended. Path stroke props remain available.

  **Output-affecting:** Overflow and rounded Image clips now emit SVG `<path>` elements instead of `<rect>`, changing their SVG bytes.

  Skew angles are bounded to [-60, 60] degrees with a finite geometry/animation chain envelope. Border and outline widths are finite and at most 1,048,576 px; border-bearing layout lengths are bounded to the same magnitude. Containers using border or outline require nonnegative radii.

  IR schema 37 uses explicit empty or elliptical box clips through `group.clip`. Regenerate IR using the matching engine. Text outline fills are solid strings or gradient indices into the parent Text's resolved resource table.

  Box and Text gradients now share resolved endpoint/ellipse geometry in IR. Raw IR angle forms and omitted radial geometry are removed; scene CSS gradient strings retain the same authoring syntax.

  Generated JSX preserves string and structured array props, including text stroke and shadow layers.

  IR nodes now require explicit source/content/decoration/wrapper ownership. Source ownership alone carries handlers and metadata; tree order replaces serialized `drawOrder`. Hit, text selection, inspection and layer manifests use snapshot-local source occurrences, allowing raw IR labels to repeat. Update direct IR consumers to the new ownership and SourceRef contracts; former handler/type maps and order-list query adapters are removed.

  **Output-affecting:** The SVG viewport contains the ordinary IR root element, so root transforms, clipping, opacity and animation apply. Source identity appears only on source anchors; endpoint metadata and generated resource identifiers use physical occurrences. Empty paint retains an empty endpoint. These changes alter SVG bytes and resource IDs. Layer extraction retains original ancestor structure and maps original source references to layer-local indices.

  When multiple SVG documents share one HTML document, supply distinct, normalized,
  pairwise prefix-free `resourceIdPrefix` scopes. This includes a single SVG shown
  alongside its extracted layers: occurrence-local resource IDs can otherwise
  refer to different clips, gradients or filters in another output.

  Inspection and text projections now take one prepared `IRSourceIndex` rather
  than an IR/index pair. Share that index across hit, copy and selection queries;
  text query methods reject source refs from a different prepared snapshot.

## 0.9.0

## 0.8.0

## 0.7.0

## 0.6.0

## 0.5.0

## 0.4.0

## 0.3.0

## 0.2.0

## 0.1.0

Initial public release.
