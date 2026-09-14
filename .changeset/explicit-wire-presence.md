---
"@boundsvg/core": minor
"@boundsvg/browser": minor
"@boundsvg/worker": minor
---

Optional non-null WASM input fields now reject explicit `null`. Omit an optional
property to request its existing default or absence behavior. Nullable array
elements used for automatic insets and missing decoration owners remain supported.

The Core WASM schema is now 32. Update Core, Browser, Worker, and their matching
WASM artifacts together; schema-31 modules are rejected. The independent MP4
schema remains 1. Numeric output must be finite; invalid derived output fails
instead of emitting JSON `null`.

Layered SVG and PNG rendering obtain source metadata directly from the input and
no longer call a custom backend's `computeLayout` after compilation. If compilation
succeeds and `computeLayout` would throw, layered rendering can now succeed.
That extra call's side effects are also removed. Warning callbacks cannot change
the current request's captured options, backend functions, or layer metadata.
