---
"@boundsvg/cli": minor
---

Remove the `boundsvg-convert` executable and use the standard `boundsvg convert`
command instead. For example, replace `boundsvg-convert --input card.svg
--default-font Inter` with `boundsvg convert --input card.svg --default-font Inter`.
The old executable has no alias after upgrading. Conversion options, library
exports, and the `boundsvg` executable remain available.
