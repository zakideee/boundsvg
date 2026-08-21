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

When changesets have accumulated on `main`, dispatching the release workflow (manual `workflow_dispatch`) opens a **"chore: version packages"** PR that:

- Bumps versions in `package.json`
- Syncs `crates/boundsvg/Cargo.toml` version with `@boundsvg/core`
- Updates `CHANGELOG.md` for each affected package
- Removes consumed changeset files

Merging that PR applies the version bumps. Publishing to npm is not yet enabled.
