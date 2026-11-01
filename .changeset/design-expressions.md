---
"@boundsvg/core": minor
"@boundsvg/react": minor
"@boundsvg/shape": minor
---

Add shared-frame Text/Inline gradients, sequential X/Y skew transforms, four-sided layout borders, and automatically sized container outlines.

OUTPUT_AFFECTING: Container borders now reserve space before padding and paint an inset surface. Absolute child placement and small fixed sizes follow the border box. Move the removed container stroke fields to `outline`, using `stroke` and `strokeWidth`; remove border widths when only a line frame is intended. Path stroke props remain available.

Skew angles are bounded to [-60, 60] degrees with a finite geometry/animation chain envelope. Border and outline widths are finite and at most 1,048,576 px; border-bearing layout lengths are bounded to the same magnitude. Containers using border or outline require nonnegative radii.

IR schema 36 uses explicit empty or elliptical box clips through `group.clip`. Regenerate IR using the matching engine. Text outline fills are solid strings or gradient indices into the parent Text's resolved resource table.

Box and Text gradients now share resolved endpoint/ellipse geometry in IR. Raw IR angle forms and omitted radial geometry are removed; scene CSS gradient strings retain the same authoring syntax.

Generated JSX preserves string and structured array props, including text stroke and shadow layers.
