import { satisfies } from "semver";

const exactDependencyFields = ["dependencies", "optionalDependencies"];

/** Validate packed workspace dependencies against the candidate release set. */
export function auditPackedWorkspaceDependencyVersions(manifest, candidateVersions) {
  const violations = [];

  for (const fieldName of exactDependencyFields) {
    for (const [dependencyName, specification] of Object.entries(manifest[fieldName] ?? {})) {
      const candidateVersion = candidateVersions.get(dependencyName);
      if (candidateVersion && specification !== candidateVersion) {
        violations.push(
          `${manifest.name} requires ${dependencyName}@${String(specification)}, expected candidate ${candidateVersion}`,
        );
      }
    }
  }

  for (const [dependencyName, specification] of Object.entries(manifest.peerDependencies ?? {})) {
    const candidateVersion = candidateVersions.get(dependencyName);
    if (
      candidateVersion &&
      (typeof specification !== "string" ||
        !satisfies(candidateVersion, specification, { includePrerelease: true }))
    ) {
      violations.push(
        `${manifest.name} requires ${dependencyName}@${String(specification)}, which excludes candidate ${candidateVersion}`,
      );
    }
  }

  return violations;
}
