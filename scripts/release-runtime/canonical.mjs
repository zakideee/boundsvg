import { createHash } from "node:crypto";

import { failRelease } from "./errors.mjs";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function compareCanonicalStrings(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function normalizeCanonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      failRelease("CANONICAL_NUMBER_INVALID", "canonical JSON cannot contain non-finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeCanonicalValue);
  }
  if (typeof value === "object") {
    const normalized = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        failRelease("CANONICAL_UNDEFINED", `canonical JSON cannot contain undefined at ${key}`);
      }
      normalized[key] = normalizeCanonicalValue(value[key]);
    }
    return normalized;
  }
  failRelease("CANONICAL_VALUE_INVALID", `unsupported canonical JSON value type: ${typeof value}`);
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeCanonicalValue(value));
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function deepEqualCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
