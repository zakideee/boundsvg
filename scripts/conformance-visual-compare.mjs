/**
 * Compares current conformance PNG hashes against the pinned baseline with a
 * stale-exception-aware known-diffs ledger.
 *
 * Usage:
 *   node scripts/conformance-visual-compare.mjs \
 *     --baseline fixtures/conformance/visual-hashes.sha256 \
 *     --current <rendered hashes file> \
 *     --ledger fixtures/conformance/known-diffs.json \
 *     [--today YYYY-MM-DD]
 *
 * Ledger entries waive exactly one anticipated hash, not the scene:
 *   { id, reason, recordedAt, expires, acceptedHash }
 *
 * Verdicts per scene:
 *   - hash matches, no ledger entry              -> pass
 *   - hash matches, ledger entry present         -> FAIL (resolved exception left in the ledger)
 *   - hash differs, entry with that acceptedHash -> pass with warning
 *   - hash differs, entry with a different hash  -> FAIL (drift the exception never anticipated)
 *   - hash differs, no ledger entry              -> FAIL
 *   - ledger entry expired or malformed          -> FAIL
 */

import * as fs from "node:fs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** Longest exception window; the ledger is a bridge, not a mute button. */
const EXCEPTION_WINDOW_DAYS_MAX = 93;

/** True for a real calendar date in YYYY-MM-DD (rejects 2026-13-45). */
function isCalendarDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function daysBetween(fromDate, toDate) {
  const [fromYear, fromMonth, fromDay] = fromDate.split("-").map(Number);
  const [toYear, toMonth, toDay] = toDate.split("-").map(Number);
  return (
    (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000
  );
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (
      flag === "--baseline" ||
      flag === "--current" ||
      flag === "--ledger" ||
      flag === "--today"
    ) {
      args[flag.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  if (!args.baseline || !args.current || !args.ledger) {
    throw new Error(
      "Usage: conformance-visual-compare.mjs --baseline <file> --current <file> --ledger <file> [--today YYYY-MM-DD]",
    );
  }
  return args;
}

function parseHashListing(filePath) {
  const entries = new Map();
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    const match = /^([0-9a-f]{64})\s+(\S+)$/.exec(trimmed);
    if (!match) {
      throw new Error(`Malformed hash line in ${filePath}: "${trimmed}"`);
    }
    entries.set(match[2], match[1]);
  }
  return entries;
}

function loadLedger(filePath, failures) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(raw)) {
    failures.push(`ledger ${filePath} must be a JSON array`);
    return new Map();
  }
  const byId = new Map();
  for (const entry of raw) {
    const id = typeof entry?.id === "string" ? entry.id : null;
    if (
      !id ||
      typeof entry.reason !== "string" ||
      entry.reason === "" ||
      !isCalendarDate(entry?.recordedAt) ||
      !isCalendarDate(entry?.expires) ||
      !SHA256_PATTERN.test(entry?.acceptedHash ?? "")
    ) {
      failures.push(
        `malformed ledger entry: ${JSON.stringify(entry)} (need id, reason, recordedAt/expires as real YYYY-MM-DD dates, acceptedHash as sha256 hex)`,
      );
      continue;
    }
    const windowDays = daysBetween(entry.recordedAt, entry.expires);
    if (windowDays < 0 || windowDays > EXCEPTION_WINDOW_DAYS_MAX) {
      failures.push(
        `ledger entry "${id}": exception window ${entry.recordedAt}..${entry.expires} outside 0..${EXCEPTION_WINDOW_DAYS_MAX} days`,
      );
      continue;
    }
    if (byId.has(id)) {
      failures.push(`duplicate ledger entries for id "${id}"`);
      continue;
    }
    byId.set(id, entry);
  }
  return byId;
}

/** Returns { failure } or { warning } or {} for one scene's hash pair. */
function evaluateScene({ name, id, pinned, rendered, exception, today }) {
  if (pinned === undefined) {
    return {
      failure: `${name}: not in baseline (new scene? re-pin with --update after visual review)`,
    };
  }
  if (rendered === undefined) {
    return { failure: `${name}: present in baseline but not rendered` };
  }
  if (pinned === rendered) {
    if (exception) {
      return {
        failure: `${id}: baseline matches again but a known-diffs entry remains (remove the resolved exception)`,
      };
    }
    return {};
  }
  if (!exception) {
    return {
      failure: `${name}: hash mismatch with no known-diffs entry (${pinned} -> ${rendered})`,
    };
  }
  if (exception.expires < today) {
    return {
      failure: `${id}: known-diffs entry expired on ${exception.expires} (resolve or re-record)`,
    };
  }
  if (exception.acceptedHash !== rendered) {
    return {
      failure: `${id}: hash mismatch beyond the recorded exception (accepted ${exception.acceptedHash}, got ${rendered})`,
    };
  }
  return { warning: `${id}: known diff accepted until ${exception.expires} (${exception.reason})` };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  if (!isCalendarDate(today)) {
    throw new Error(`--today must be a real YYYY-MM-DD date, got "${today}"`);
  }

  const failures = [];
  const warnings = [];
  const baseline = parseHashListing(args.baseline);
  const current = parseHashListing(args.current);
  const ledger = loadLedger(args.ledger, failures);

  const names = [...new Set([...baseline.keys(), ...current.keys()])].sort();
  const knownIds = new Set(names.map((name) => name.replace(/\.png$/, "")));

  for (const name of names) {
    const id = name.replace(/\.png$/, "");
    const verdict = evaluateScene({
      name,
      id,
      pinned: baseline.get(name),
      rendered: current.get(name),
      exception: ledger.get(id),
      today,
    });
    if (verdict.failure) {
      failures.push(verdict.failure);
    } else if (verdict.warning) {
      warnings.push(verdict.warning);
    }
  }

  for (const id of ledger.keys()) {
    if (!knownIds.has(id)) {
      failures.push(`ledger entry "${id}" does not match any conformance scene`);
    }
  }

  for (const warning of warnings) {
    console.warn(`WARN ${warning}`);
  }
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  if (failures.length > 0) {
    console.error(
      `conformance visual check failed (${failures.length} problem${failures.length === 1 ? "" : "s"})`,
    );
    process.exit(1);
  }
  console.info(
    `conformance visual check passed (${names.length} scenes, ${warnings.length} accepted diffs)`,
  );
}

main();
