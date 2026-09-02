---
"@boundsvg/browser": minor
"@boundsvg/cli": minor
"@boundsvg/core": minor
"@boundsvg/react": minor
"@boundsvg/video": minor
"@boundsvg/worker": minor
---

Make text layout failures structured fatal diagnostics across render, Core,
Browser, Worker, React, CLI, and Video routes. Font resolution now uses the
actual registered fallback chain, so a missing primary or unused missing
fallback is accepted when another requested alias resolves, while an entirely
unresolved chain reports `TEXT_FONT_UNAVAILABLE`.

Replace the ambiguous `TEXT_NO_LAYOUT` family and the six measurement
`WASM_INVALID_*_OUTPUT` codes with operation-aware text layout diagnostics.
Malformed output retains a bounded operation, protocol path, and received-type
descriptor; true render intrinsic failures now abort instead of silently using
a bounding-box fallback.

Move the public Rust layout and flow APIs to `Result` and closed error/reason
types, including fallible region providers, rich-depth validation, fit and
ellipsis budgets, and checked invariants. The bundled WASM schema advances to
version 30.
