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

The nine public npm packages form one fixed release group. When changesets have accumulated on
`main`, dispatching the release workflow with publishing disabled opens a
**"chore: version packages"** PR that:

- Bumps all nine public package versions together
- Updates `CHANGELOG.md` for each affected package
- Removes consumed changeset files

The public Rust crates use independent SemVer. Update their package versions and internal dependency
requirements explicitly in the same release PR, then run `pnpm check:release-coherence`.

After that PR is merged and verified, dispatching the workflow with publishing enabled publishes the
npm packages through the protected `npm-publish` environment. A separate crate-publishing dispatch
publishes the Rust crates in dependency order through the protected `crates-publish` environment.
