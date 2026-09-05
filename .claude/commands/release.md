# Release command

Assemble only the tracked release commands below from values explicitly supplied in `$ARGUMENTS`.
If a source commit, target version, output path, plan path, plan SHA-256, release commit, phase, or
report path is missing, ask for it. Never infer a target, edit a file, dispatch a workflow, publish an
artifact, create or push a tag, or refer to machine-local tooling.

```text
pnpm release:prepare -- preview --source <S> --npm-version <stable|current> --crate-version boundshape=<stable|current> --crate-version boundtext=<stable|current> --crate-version boundsvg=<stable|current> --output <path-outside-worktree>
pnpm release:prepare -- apply --plan <path> --plan-sha256 <64-lowercase-hex>
pnpm release:prepare -- verify --plan <path> --plan-sha256 <64-lowercase-hex>
pnpm release:verify --commit <R> --plan <path> --plan-sha256 <64-lowercase-hex>
pnpm release:audit -- --phase <pre-npm|post-npm|pre-crates|post-crates|pre-tag> --release-commit <R> [--report <path>]
pnpm release:tag -- --release-commit <R>
```

Keep the order preview, apply, verify, post-merge verification, npm audit/publish/audit, crates
audit/publish/audit, pre-tag audit, then local tag creation. Return the assembled commands without
executing them.
