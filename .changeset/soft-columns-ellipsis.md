---
"@boundsvg/core": patch
---

**Output-affecting:** End overflowing vertical rich text with U+2026 when `maxLines` and `ellipsis` are enabled, while preserving atomic rich children, inherited styling, Japanese tail prohibition, non-truncating kinsoku diagnostics, and decorated-span output. Inline backgrounds and borders now follow the aligned rich-text bounds in horizontal and vertical layouts.
