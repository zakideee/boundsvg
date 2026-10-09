---
"@boundsvg/cli": minor
---

Remove the `boundsvg-convert` executable and use the standard `boundsvg convert`
command instead. For example, replace `boundsvg-convert --input card.svg
--default-font Inter` with `boundsvg convert --input card.svg --default-font Inter`.
The old executable has no alias after upgrading. Conversion options, library
exports, and the `boundsvg` executable remain available.

The executable now dispatches each command once when started through its real
Node path as well as the installed launcher. Root and animation library imports
do not execute commands or produce CLI output.
