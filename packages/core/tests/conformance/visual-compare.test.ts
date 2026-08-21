/**
 * Tests for scripts/conformance-visual-compare.mjs — the stale-exception-aware
 * hash comparison behind `pnpm test:conformance:visual`. Spawns the script with
 * synthetic baseline/current/ledger files; no WASM or rendering involved.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const compareScript = path.resolve(testDir, "../../../../scripts/conformance-visual-compare.mjs");

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const TODAY = "2026-07-16";

type CompareRun = {
  status: number | null;
  stdout: string;
  stderr: string;
};

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "conformance-compare-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function writeInputs(options: {
  baseline: Record<string, string>;
  current: Record<string, string>;
  ledger: unknown;
}): { baselinePath: string; currentPath: string; ledgerPath: string } {
  const toListing = (entries: Record<string, string>): string =>
    `${Object.entries(entries)
      .map(([name, hash]) => `${hash}  ${name}`)
      .join("\n")}\n`;

  const baselinePath = path.join(workDir, "baseline.sha256");
  const currentPath = path.join(workDir, "current.sha256");
  const ledgerPath = path.join(workDir, "known-diffs.json");
  fs.writeFileSync(baselinePath, toListing(options.baseline));
  fs.writeFileSync(currentPath, toListing(options.current));
  fs.writeFileSync(ledgerPath, JSON.stringify(options.ledger));
  return { baselinePath, currentPath, ledgerPath };
}

function runCompare(paths: {
  baselinePath: string;
  currentPath: string;
  ledgerPath: string;
}): CompareRun {
  const result = spawnSync(
    process.execPath,
    [
      compareScript,
      "--baseline",
      paths.baselinePath,
      "--current",
      paths.currentPath,
      "--ledger",
      paths.ledgerPath,
      "--today",
      TODAY,
    ],
    { encoding: "utf8" },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("conformance-visual-compare", () => {
  it("passes when all hashes match and the ledger is empty", () => {
    const run = runCompare(
      writeInputs({
        baseline: { "a.png": HASH_A, "b.png": HASH_B },
        current: { "a.png": HASH_A, "b.png": HASH_B },
        ledger: [],
      }),
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("passed (2 scenes, 0 accepted diffs)");
  });

  it("passes with a warning when a mismatch has a valid ledger entry", () => {
    const run = runCompare(
      writeInputs({
        baseline: { "a.png": HASH_A },
        current: { "a.png": HASH_B },
        ledger: [
          {
            id: "a",
            reason: "resvg bump",
            recordedAt: "2026-07-01",
            expires: "2026-08-31",
            acceptedHash: HASH_B,
          },
        ],
      }),
    );
    expect(run.status).toBe(0);
    expect(run.stderr).toContain("WARN a: known diff accepted until 2026-08-31");
  });

  it("fails when a mismatch has no ledger entry", () => {
    const run = runCompare(
      writeInputs({
        baseline: { "a.png": HASH_A },
        current: { "a.png": HASH_B },
        ledger: [],
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("a.png: hash mismatch with no known-diffs entry");
  });

  it("fails when a resolved exception is left in the ledger (stale-exception check)", () => {
    const run = runCompare(
      writeInputs({
        baseline: { "a.png": HASH_A },
        current: { "a.png": HASH_A },
        ledger: [
          {
            id: "a",
            reason: "resvg bump",
            recordedAt: "2026-07-01",
            expires: "2026-08-31",
            acceptedHash: HASH_B,
          },
        ],
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("a: baseline matches again but a known-diffs entry remains");
  });

  it("fails when a ledger entry is expired", () => {
    const run = runCompare(
      writeInputs({
        baseline: { "a.png": HASH_A },
        current: { "a.png": HASH_B },
        ledger: [
          {
            id: "a",
            reason: "resvg bump",
            recordedAt: "2026-05-01",
            expires: "2026-07-15",
            acceptedHash: HASH_B,
          },
        ],
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("a: known-diffs entry expired on 2026-07-15");
  });

  it("fails when scenes are missing from either side", () => {
    const run = runCompare(
      writeInputs({
        baseline: { "a.png": HASH_A, "gone.png": HASH_C },
        current: { "a.png": HASH_A, "new.png": HASH_B },
        ledger: [],
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("new.png: not in baseline");
    expect(run.stderr).toContain("gone.png: present in baseline but not rendered");
  });

  it("fails on ledger entries that reference no scene or are malformed", () => {
    const run = runCompare(
      writeInputs({
        baseline: { "a.png": HASH_A },
        current: { "a.png": HASH_A },
        ledger: [
          {
            id: "ghost",
            reason: "left behind",
            recordedAt: "2026-07-01",
            expires: "2026-08-31",
            acceptedHash: HASH_A,
          },
          { id: "a", reason: "", recordedAt: "2026-07-01", expires: "not-a-date" },
        ],
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ledger entry "ghost" does not match any conformance scene');
    expect(run.stderr).toContain("malformed ledger entry");
  });

  it("fails when the mismatch is not the hash the exception accepted", () => {
    const run = runCompare(
      writeInputs({
        baseline: { "a.png": HASH_A },
        current: { "a.png": HASH_C },
        ledger: [
          {
            id: "a",
            reason: "resvg bump",
            recordedAt: "2026-07-01",
            expires: "2026-08-31",
            acceptedHash: HASH_B,
          },
        ],
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("a: hash mismatch beyond the recorded exception");
  });

  it("fails on impossible calendar dates and oversized exception windows", () => {
    const run = runCompare(
      writeInputs({
        baseline: { "a.png": HASH_A, "b.png": HASH_B },
        current: { "a.png": HASH_C, "b.png": HASH_C },
        ledger: [
          {
            id: "a",
            reason: "typo month",
            recordedAt: "2026-07-01",
            expires: "2026-13-45",
            acceptedHash: HASH_C,
          },
          {
            id: "b",
            reason: "forever",
            recordedAt: "2026-07-01",
            expires: "2027-07-01",
            acceptedHash: HASH_C,
          },
        ],
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("malformed ledger entry");
    expect(run.stderr).toContain('ledger entry "b": exception window');
  });

  it("checks the repository ledger stays a well-formed array", () => {
    const repoLedgerPath = path.resolve(
      testDir,
      "../../../../fixtures/conformance/known-diffs.json",
    );
    const ledger = JSON.parse(fs.readFileSync(repoLedgerPath, "utf8")) as unknown;
    expect(Array.isArray(ledger)).toBe(true);
  });
});
