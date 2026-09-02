---
"@boundsvg/browser": minor
"@boundsvg/cli": minor
"@boundsvg/core": minor
"@boundsvg/react": minor
"@boundsvg/video": minor
"@boundsvg/worker": minor
---

Make shape failures stable structured diagnostics across native rendering,
standalone WASM operations, Browser, Worker, React, CLI, and Video observers.
The low-level `@boundsvg/core/wasm` entry now exports all nine shape operations,
and Browser requires the same complete capability set. The bundled WASM schema
advances to version 31.

Change the public Rust `ShapeError` contract to a closed 15-variant enum and
make `region_to_path`, `region_to_svg`, and `transform_to_svg` return
`Result<String, ShapeError>`. Generated non-finite path, SVG, transform, JSON,
or compiled-bound output now fails explicitly instead of emitting invalid
numeric text or `null`.

Validate all shape success payloads at the Core boundary. Malformed JSON,
wrong field types, and explicit `null` values in optional compiled-path fields
now fail with `SHAPE_OUTPUT_INVALID`; omitted optional fields stay omitted.
Evaluated `GeometryPart` values now expose required `strokeRegion` geometry.
