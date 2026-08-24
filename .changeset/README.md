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

When changesets have accumulated on `main`, dispatch the release workflow with
`publish` disabled. It opens a **"chore(tools): version packages"** PR that:

- Bumps versions in `package.json`
- Syncs the four versioned Rust crate manifests, their path dependency ranges,
  and `Cargo.lock` with `@boundsvg/core`
- Updates `CHANGELOG.md` for each affected package
- Removes consumed changeset files

Merging that PR applies the version bumps. After the version PR is merged,
dispatch the workflow with `publish` enabled to rebuild and verify every
artifact, then publish every package version not yet present on npm. The
`npm-publish` environment supplies the required approval and credentials; tags
are created separately with `pnpm changeset tag`.
