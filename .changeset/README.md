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
