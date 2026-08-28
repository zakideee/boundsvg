---
"@boundsvg/core": minor
---

Apply `resourceIdPrefix` to every boundsvg-generated, document-global SVG identifier and its references, including animation names, generated classes, shared Shape paths, canvas-stroke classes, and debug overlays.

Layered SVG exports now derive a stable, prefix-free sub-namespace for every layer when a non-empty prefix is supplied. For guaranteed separation across co-embedded outputs, use normalized prefixes that are non-empty and pairwise prefix-free; merely different values such as `doc-` and `doc-clip-` are not sufficient.
