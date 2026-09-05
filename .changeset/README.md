# Changesets

This directory is used by [changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

## For contributors

When your PR introduces user-facing changes to any of the nine publishable packages, add a changeset:

```bash
pnpm changeset
```

Follow the prompts to:

1. Select the affected package(s)
2. Choose the semver bump type (patch / minor / major)
3. Write a summary of the change (this becomes the CHANGELOG entry)

The changeset file (`.changeset/<random-name>.md`) should be committed with your PR.

## For maintainers

The public npm packages form one fixed release group. Public Rust crates use independent SemVer.
Target versions are maintainer decisions and are never inferred by the release tooling.

On a clean, freshly fetched `main`, create a read-only plan at a nonexistent path outside the
repository:

```bash
pnpm release:prepare -- preview --source <S> --npm-version <stable|current> \
  --crate-version boundshape=<stable|current> \
  --crate-version boundtext=<stable|current> \
  --crate-version boundsvg=<stable|current> \
  --output <path-outside-worktree>
```

Review the plan and its separately printed SHA-256. Apply and verify exactly those planned bytes on
the unchanged source commit:

```bash
pnpm release:prepare -- apply --plan <path> --plan-sha256 <64-lowercase-hex>
pnpm release:prepare -- verify --plan <path> --plan-sha256 <64-lowercase-hex>
```

Commit the generated version surfaces as one normal version PR. After its single-parent squash is
merged, run the verifier from the retained clean source checkout:

```bash
pnpm release:verify --commit <R> --plan <path> --plan-sha256 <64-lowercase-hex>
```

Publishing remains a separate manual operation. The release workflow accepts one registry target
(`npm` or `crates`) and the verified release commit. Audit each boundary before continuing:

```bash
pnpm release:audit -- --phase <pre-npm|post-npm|pre-crates|post-crates|pre-tag> \
  --release-commit <R> [--report <path>]
pnpm release:tag -- --release-commit <R>
```

Run npm before crates. Create local npm package tags only after both registries and docs.rs pass the
pre-tag audit; pushing those tags is a separate maintainer action.
