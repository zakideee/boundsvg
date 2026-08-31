---
"@boundsvg/core": minor
"@boundsvg/react": minor
"@boundsvg/video": minor
---

Make `CompiledScene` an opaque, immutable runtime artifact that can only be
used with the exact `Engine` that created it. Remove the public `.ir` field and
structural construction; use `snapshotCompiledIR` for a detached, editable
inspection copy that is not renderable.

Cloned or hand-built values now fail with `COMPILED_SCENE_INVALID`, while an
authentic artifact passed to another Engine fails with
`COMPILED_SCENE_WRONG_ENGINE`. React asset hooks retain their Provider Engine
ownership, and `renderCompiledToMp4` requires the same supplied Engine.
