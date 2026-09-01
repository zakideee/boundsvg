---
"@boundsvg/browser": minor
"@boundsvg/core": minor
"@boundsvg/extras": minor
"@boundsvg/react": minor
"@boundsvg/video": minor
"@boundsvg/worker": minor
---

Replace the shared diagnostic shape with strict severity-specific fatal and
recoverable contracts. Diagnostic constructors now take explicit options,
recoverable warnings require `fallback` and `stage`, and malformed boundary
values are rejected instead of being normalized through legacy adapters.

Make operation envelopes the single warning authority across WASM, Core, and
Worker routes. Structural IR no longer carries nested warnings, public IR
retains detached `RecoverableError` values, Worker responses use one top-level
warning list, and the WASM schema advances to version 29.
