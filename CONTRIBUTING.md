# Contributing to boundsvg

Thanks for your interest in boundsvg. This project is maintained by a single
maintainer with limited time, so the rules below exist to keep review load
manageable. Issues and PRs that follow them get attention much faster.

## Scope

boundsvg is a **deterministic frame renderer**: JSX → SVG/PNG/WebP/GIF with a
WASM text-layout engine, specializing in correct Japanese/CJK typography
(kinsoku, vertical writing, ruby) and output that renders identically across
environments (the Feature Matrix in the docs describes the boundaries).
Layout is resolved once; declarative animation rides on top of that single
resolved layout.

The following design invariants are not up for change via PR — a discussion
is the place to challenge them:

- Exposing raw SVG attributes (`x`, `y`, `style`, `transform` strings) in the
  public API — layout is the only positioning authority, and the emitted SVG
  structure is an implementation detail, not a contract
- Browser DOM or OS-font dependence inside render functions — the entire
  pipeline runs in WASM with fonts injected as data, which is what makes
  output byte-identical across runtimes
- HTML string input and Tailwind in `@boundsvg/core` — adapter-layer
  territory; core keeps a closed, fully validated input model

For what the engine currently does and does not do — animation channels,
Bidi/RTL, and everything else — the Feature Matrix and Known Limitations
pages in the docs are the source of truth. A feature request outside them is
best opened as a discussion first.

## Development setup

Prerequisites: Node.js and pnpm — exact versions are pinned by
`.node-version` and the `packageManager` field (`corepack enable` picks the
right pnpm automatically) — plus the Rust toolchain, which rustup installs
automatically from `rust-toolchain.toml` (including the wasm32 target), and
`wasm-pack`.

```bash
pnpm install
pnpm build:wasm        # nodejs target
pnpm build:wasm:web    # web target
pnpm build:wasm:mp4    # MP4 muxer; @boundsvg/video's tests load it
pnpm typecheck         # builds every package's dist and declarations, in order
```

`pnpm typecheck` is the whole TS build chain — `@boundsvg/shape` first, because
`@boundsvg/core`'s declaration build imports its types. Building only core is
enough to work on core, but not to run the suite: `@boundsvg/video`'s tests need
`packages/video/wasm-pkg/`, and `@boundsvg/react`'s need `@boundsvg/browser` and
`@boundsvg/worker` built.

Test:

```bash
pnpm --filter @boundsvg/core test
pnpm -r test           # every package that defines a test script
cargo test --workspace # all five Rust crates
```

E2E and the playgrounds need the browser-facing chain built first:

```bash
pnpm test:e2e:prepare      # builds every package the Playwright suite loads
pnpm test:e2e

pnpm dev:playground        # React playground -> http://localhost:5173
pnpm dev:playground:core   # core API playground (no React)
pnpm dev:playground:cli    # CLI codegen playground
```

Lint before pushing: `pnpm lint:fix` (pre-commit hooks enforce biome,
rustfmt, prettier, typecheck, and knip).

## Platform notes

Development checkouts use git symlinks (shared playground assets and
`AGENTS.md`). On Windows, enable Developer Mode (or clone with
`core.symlinks=true` from an elevated shell) so git can create them; without
symlink support those paths materialize as plain text files and the
playgrounds cannot resolve their assets. The published npm packages contain
no symlinks and are unaffected.

## Pull requests

- One logical change per PR. The PR title becomes the squash-merge commit
  message; Conventional Commits format (`type(scope): summary`) is
  appreciated, and the maintainer will adjust it at merge if needed.
- Changes to code with existing tests should update those tests, and new
  behavior needs new tests.
- Rust: no `unsafe` (workspace-level `forbid`), no `#[allow(clippy::*)]`
  without a written justification.
- TypeScript: strict mode, no `any` / `as any`, no `export *`.
- A user-facing change should come with a changeset (`pnpm changeset`)
  describing it for the release notes.
- Do not update CHANGELOG or version numbers — releases are handled by the
  maintainer via changesets.

### AI-generated contributions

AI-assisted PRs are welcome under the same rules as any PR, plus:

- Run the code and tests yourself, and say what you ran in the PR
  description.
- The PR description should explain _why_ in your own words, not just restate
  the diff.
- Bulk or speculative PRs (drive-by refactors, style sweeps, unrequested
  features) may be closed without detailed review.

## Issues

- Bugs: use the bug template. A minimal reproducible JSX snippet + font
  setup + expected/actual output (SVG or PNG) is required — reports without a
  repro are converted to discussions.
- Check the Known Limitations page in the docs before filing; limitations
  documented there are not bugs.

## Security

For security-relevant reports (e.g. SVG input sanitization bypasses), do not
open a public issue — use GitHub private vulnerability reporting.

## License

Unless you explicitly state otherwise, any contribution intentionally
submitted for inclusion in boundsvg by you shall be dual licensed under the
MIT and Apache-2.0 licenses, without any additional terms or conditions.
