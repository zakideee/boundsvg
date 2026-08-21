# @boundsvg/shape

Low-level geometry and symbol builders for `boundsvg`.

## Installation

> Not yet published to npm — build from source. See the [monorepo README](https://github.com/zakideee/boundsvg) for setup instructions.

This package is the single source of the geometry authoring types and builder
functions; `@boundsvg/core` depends on it and re-exports the types. It has no
runtime dependencies and never imports other `@boundsvg/*` packages - rendering
belongs to `@boundsvg/core`.

This package intentionally stays below chart semantics. It provides plain data structures for:

- geometry documents
- boolean nodes
- transforms
- symbol definitions
- elastic segments

Use these documents with `Shape` and `Symbol` in `@boundsvg/core`.
