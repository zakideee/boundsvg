import { failRelease } from "./errors.mjs";

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseStableVersion(value) {
  if (typeof value !== "string") {
    failRelease("INVALID_STABLE_VERSION", "version must be a stable semantic-version string");
  }
  const match = stableVersionPattern.exec(value);
  if (match === null) {
    failRelease("INVALID_STABLE_VERSION", `invalid stable semantic version: ${value}`);
  }
  return { major: match[1], minor: match[2], patch: match[3], text: value };
}

function compareDecimalIdentifiers(left, right) {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function compareStableVersions(leftValue, rightValue) {
  const left = typeof leftValue === "string" ? parseStableVersion(leftValue) : leftValue;
  const right = typeof rightValue === "string" ? parseStableVersion(rightValue) : rightValue;
  for (const part of ["major", "minor", "patch"]) {
    const comparison = compareDecimalIdentifiers(left[part], right[part]);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

function incrementDecimalIdentifier(value) {
  const digits = [...value];
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry === 1; index -= 1) {
    const next = Number(digits[index]) + carry;
    digits[index] = String(next % 10);
    carry = next === 10 ? 1 : 0;
  }
  if (carry === 1) {
    digits.unshift("1");
  }
  return digits.join("");
}

export function incrementStableVersion(value, bumpType) {
  const version = parseStableVersion(value);
  if (!new Set(["major", "minor", "patch"]).has(bumpType)) {
    failRelease("CHANGESET_BUMP_INVALID", `unsupported Changeset bump: ${bumpType}`);
  }
  if (bumpType === "major") {
    return `${incrementDecimalIdentifier(version.major)}.0.0`;
  }
  if (bumpType === "minor") {
    return `${version.major}.${incrementDecimalIdentifier(version.minor)}.0`;
  }
  return `${version.major}.${version.minor}.${incrementDecimalIdentifier(version.patch)}`;
}

export function formatMinorLine(value) {
  const version = parseStableVersion(value);
  return `>=${version.major}.${version.minor}.0 <${version.major}.${incrementDecimalIdentifier(version.minor)}.0`;
}

export function resolveExplicitTarget(targetInput, current) {
  parseStableVersion(current);
  if (targetInput === "current") {
    return { advances: false, current, target: current };
  }
  parseStableVersion(targetInput);
  if (compareStableVersions(targetInput, current) <= 0) {
    failRelease(
      "TARGET_NOT_GREATER",
      `explicit target ${targetInput} must be strictly greater than current ${current}`,
    );
  }
  return { advances: true, current, target: targetInput };
}

export function maximumStableVersion(versions) {
  if (versions.length === 0) {
    return undefined;
  }
  return [...versions].sort(compareStableVersions).at(-1);
}
