#!/usr/bin/env bash
# check-output-affecting-changeset.sh — require a declared changeset whenever a
# rendered-output baseline moves.
#
# The docs promise that output-affecting changes are called out in release
# notes. Prose cannot enforce that, but the baselines can: a change that alters
# emitted SVG or raster bytes cannot pass the determinism, conformance, or jlreq
# gates without re-recording one of the pinned hash files below. So the trigger
# is a file diff, not a judgement about whether something "affects output" —
# there is no judgement call involved.
#
# Rule: if the diff touches a baseline, at least one changeset added or modified
# in the same diff must carry the OUTPUT_AFFECTING_MARKER. The marker is plain
# prose so it also renders as a callout in the generated CHANGELOG.
#
# Limits, stated so nobody reads more into a pass than it carries:
# - Coverage is the golden suite's coverage. An output change in a scene shape
#   no baseline pins will not move a baseline and will not trip this check.
# - It enforces that a declaration exists, not that the declaration is useful.
#
# Usage: check-output-affecting-changeset.sh [base-ref]   (default: origin/main)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# An empty argument, not just a missing one: a workflow expression that does not
# resolve (a runner without step-output support) would otherwise be passed as
# "" and fail the ref check instead of falling back.
BASE_REF="${1:-}"
[ -n "$BASE_REF" ] || BASE_REF="origin/main"
OUTPUT_AFFECTING_MARKER="**Output-affecting:**"

# Hash/layout baselines that a rendered-output change must re-record.
BASELINES=(
  "packages/core/tests/determinism/goldens.json"
  "packages/core/tests/determinism/animated-goldens.json"
  "fixtures/conformance/visual-hashes.sha256"
  "crates/boundtext/tests/fixtures/jlreq_regression/public/baseline.json"
  "crates/boundtext/tests/fixtures/jlreq_regression/public/visual-hashes.sha256"
)

# A baseline that is renamed or deleted without updating this list would make
# the check silently vacuous, which is worse than not having it.
missing=()
for baseline in "${BASELINES[@]}"; do
  [ -f "$baseline" ] || missing+=("$baseline")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "ERROR: baseline files no longer exist; update BASELINES in $(basename "${BASH_SOURCE[0]}"):" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  echo "ERROR: base ref '${BASE_REF}' is not available (fetch it first)." >&2
  exit 1
fi

changed_files="$(git diff --name-only "${BASE_REF}...HEAD")"

touched_baselines=()
for baseline in "${BASELINES[@]}"; do
  if printf '%s\n' "$changed_files" | grep -qxF "$baseline"; then
    touched_baselines+=("$baseline")
  fi
done

if [ "${#touched_baselines[@]}" -eq 0 ]; then
  echo "No rendered-output baseline changed; no output-affecting changeset required."
  exit 0
fi

echo "Rendered-output baselines changed in this diff:"
printf '  %s\n' "${touched_baselines[@]}"

# Only changesets from this diff count. A pre-existing one describes earlier
# work and would let a re-baseline ride in undeclared.
changed_changesets="$(printf '%s\n' "$changed_files" | grep -E '^\.changeset/.+\.md$' || true)"

declared=()
while IFS= read -r changeset; do
  [ -n "$changeset" ] || continue
  # Deleted during a release cut: nothing left to read.
  [ -f "$changeset" ] || continue
  if grep -qF -e "$OUTPUT_AFFECTING_MARKER" "$changeset"; then
    declared+=("$changeset")
  fi
done <<<"$changed_changesets"

if [ "${#declared[@]}" -gt 0 ]; then
  echo "Declared by:"
  printf '  %s\n' "${declared[@]}"
  exit 0
fi

cat >&2 <<EOF

ERROR: a rendered-output baseline moved without an output-affecting changeset.

Re-recording a baseline means the emitted SVG or raster bytes changed, so
consumers pinning snapshots will see a diff on upgrade. Add a changeset that
says so, with a line starting:

    ${OUTPUT_AFFECTING_MARKER} <what visibly changes, and for which inputs>

If the baseline moved for a reason that does NOT change what users render
(a fixture scene was edited, a case was added), say that in the same line —
the declaration is what reaches the release notes either way.
EOF
exit 1
