# Security Policy

## Reporting a vulnerability

Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/zakideee/boundsvg/security/advisories/new).
Please do not open a public issue for anything you believe is a security
problem.

You can expect an acknowledgement within a week. There is no bug bounty.

## Supported versions

Only the latest published version of the `@boundsvg/*` packages receives
security fixes.

## Scope

Rendering is driven by caller-supplied input: JSX scenes, fonts, and SVG
files. Crashes, memory-safety issues, and output injection reachable from
that input are in scope. The CLI and the playgrounds fetch and execute no
remote content.
