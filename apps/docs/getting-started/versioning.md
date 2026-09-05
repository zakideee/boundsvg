---
title: Versioning & Stability
---

# Versioning & Stability

boundsvg follows [Semantic Versioning](https://semver.org/). All
`@boundsvg/*` packages are versioned together via changesets.

## 0.x expectations

While the major version is `0`:

- **Minor releases (`0.x.0`) may contain breaking API changes.** Every
  breaking change is listed in the release notes with a migration note.
- Patch releases (`0.x.y`) contain only fixes and non-breaking additions.
- Deprecated APIs keep working for at least one minor release after the
  deprecation is announced, with a `@deprecated` JSDoc tag pointing at the
  replacement.

## Stability tiers

The [feature matrix](/reference/feature-matrix) assigns each capability one
of three tiers:

| Tier              | Meaning                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ |
| **Supported**     | Covered by tests and the determinism contract; breaking changes follow SemVer rules. |
| **Experimental**  | Usable but may change or be removed in any minor release without deprecation.        |
| **Not supported** | Documented gap; requests are triaged via the feature-request template.               |

## Output stability

Rendered output (SVG markup and raster bytes) is part of the contract only as
described in the [Determinism Contract](/reference/determinism). In short:
accepted inputs on a declared surface produce identical covered artifacts
**within a given boundsvg version**, after any documented normalization;
delegated surfaces stop at their stated boundary. Output may change between
versions (e.g. improved line breaking), and such changes are called out in
release notes as _output-affecting_.

Snapshot-testing users should therefore pin an exact version and re-baseline
snapshots when upgrading.

### What backs that declaration

The declaration is enforced, not merely intended. Emitted SVG and raster bytes
are pinned by hash baselines that the determinism, conformance, and jlreq gates
compare against, so a change that alters output cannot merge without
re-recording one of them. CI requires any commit that re-records a baseline to
ship a changeset declaring the change, which is what carries it into the
release notes.

Two limits are worth knowing, because a green build means less than it looks
like otherwise:

- **Coverage is the baselines' coverage.** An output change confined to a scene
  shape no baseline pins does not move a baseline, so nothing forces a
  declaration for it.
- **Presence, not quality.** The check verifies that a declaration exists. It
  cannot judge whether the description is accurate or useful.

## Scene documents

Serialized scene documents (`toSceneDocument()` output, `.scene.json` files)
do not carry a format version field or envelope. A `version` property is not a
compatibility marker; the closed Scene schema rejects it as an unsupported
key. Decode external values with `decodeSceneDocument()` when a detached
`SceneNode` is needed, or `fromSceneDocument()` when a VNode is needed. Both
APIs validate the complete recursive structure, and `fromSceneDocument()`
decodes exactly once.

The current WASM schema remains version 31. That internal bridge number is not
a Scene document field and must not be added to `.scene.json` files. Any future
incompatible Scene format would require a separately documented migration;
there is no runtime version-dispatch mode today.

## Maintainer release flow

Version selection and publication are separate manual decisions. Start from a
clean, freshly fetched `main` commit and provide every npm and Rust target
explicitly. `current` means that an unchanged artifact must match the live
registry exactly.

```bash
pnpm release:prepare -- preview --source <S> --npm-version <stable|current> \
  --crate-version boundshape=<stable|current> \
  --crate-version boundtext=<stable|current> \
  --crate-version boundsvg=<stable|current> \
  --output <path-outside-worktree>
```

Preview writes only the external plan. Review its prospective tree and the
separately printed SHA-256, then apply and verify the exact planned bytes:

```bash
pnpm release:prepare -- apply --plan <path> --plan-sha256 <64-lowercase-hex>
pnpm release:prepare -- verify --plan <path> --plan-sha256 <64-lowercase-hex>
```

Submit those generated version surfaces as one version PR. After its
single-parent squash is merged, run the post-merge verifier from the retained
clean source checkout:

```bash
pnpm release:verify --commit <R> --plan <path> --plan-sha256 <64-lowercase-hex>
```

The release workflow takes the verified commit and exactly one target registry.
It cannot create a version PR. Publish npm before crates, with the protected
environment approving each registry independently. Run the read-only audit at
every boundary:

```bash
pnpm release:audit -- --phase <pre-npm|post-npm|pre-crates|post-crates|pre-tag> \
  --release-commit <R> [--report <path>]
```

Only after the pre-tag audit verifies npm, crates.io, provenance, and docs.rs may
the npm package tags be created locally:

```bash
pnpm release:tag -- --release-commit <R>
```

The tag command never pushes. Remote tag publication remains a separate
maintainer operation. The contributor-facing `pnpm changeset` command creates
feature declarations only; it is not a versioning or tagging frontdoor.

## What is never stable

- Anything under `internal` subpaths (blocked from import) or types marked
  `@internal` / "test seam" in JSDoc
- The WASM ABI between `@boundsvg/core` and the bundled `wasm-pkg` — always
  ship them together; mixing versions is unsupported
- Undocumented behavior observed from reading the source
