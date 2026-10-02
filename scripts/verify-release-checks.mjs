/** Verify required checks against their exact main-push workflow provenance. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

/** Repository whose release checks may authorize publication. */
const REPOSITORY = "zakideee/boundsvg";
/** Maximum records per inventory, below GitHub's filtered-run cap. */
const RECORDS_MAX = 900;
/** Maximum pages including the mandatory terminal page. */
const PAGES_MAX = 10;
/** Maximum GET requests across both observations. */
const REQUESTS_MAX = 200;
/** Maximum elapsed time for the complete observation. */
const DEADLINE_MS = 120_000;
/** Maximum duration of one GitHub request. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Maximum response bytes for one GitHub request. */
const RESPONSE_BYTES_MAX = 4 * 1024 * 1024;
/** Maximum retained string field length in a projected record. */
const FIELD_LENGTH_MAX = 256;
/** GitHub page size; a shorter page proves traversal termination. */
const PAGE_SIZE = 100;
/** Required source contracts, independent of process configuration. */
const requiredSources = [
  { name: "Baseline Checks", path: ".github/workflows/render-regression.yml" },
  { name: "CI acceptance", path: ".github/workflows/ci.yml" },
];

function reject(reason) {
  throw new Error(`Release check verification failed: ${reason}`);
}

function assertObject(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    reject("expected an object");
  }
}

function assertId(identifier) {
  if (!Number.isSafeInteger(identifier) || identifier <= 0) {
    reject("invalid identifier");
  }
}

function timestamp(timestampText) {
  if (
    typeof timestampText !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(timestampText)
  ) {
    reject("invalid timestamp");
  }
  const epochMs = Date.parse(timestampText);
  if (
    !Number.isFinite(epochMs) ||
    new Date(epochMs).toISOString().replace(".000Z", "Z") !== timestampText.replace(".000Z", "Z")
  ) {
    reject("invalid timestamp");
  }
  return epochMs;
}

function assertSuccessful(record, releaseCommit) {
  assertObject(record);
  assertId(record.id);
  if (
    record.head_sha !== releaseCommit ||
    record.status !== "completed" ||
    record.conclusion !== "success"
  ) {
    reject("required authority is not a successful exact-head result");
  }
  const startedMs = timestamp(record.started_at);
  if (timestamp(record.completed_at) < startedMs) {
    reject("completion precedes start");
  }
}

function newest(records, timeField) {
  if (records.length === 0) {
    reject("required authority is missing");
  }
  return [...records].sort(
    (left, right) => timestamp(right[timeField]) - timestamp(left[timeField]) || right.id - left.id,
  )[0];
}

function projectRecord(record, collection) {
  const fields =
    collection === "check_suites"
      ? ["id", "head_sha"]
      : collection === "check_runs"
        ? ["id", "name", "head_sha", "status", "conclusion", "started_at", "completed_at"]
        : [
            "id",
            "path",
            "head_sha",
            "head_branch",
            "event",
            "status",
            "conclusion",
            "created_at",
            "run_started_at",
            "check_suite_id",
            "run_attempt",
          ];
  const projected = Object.fromEntries(fields.map((field) => [field, record[field]]));
  if (
    Object.values(projected).some(
      (field) => typeof field === "string" && field.length > FIELD_LENGTH_MAX,
    )
  ) {
    reject("inventory field is oversized");
  }
  if (collection === "check_runs") {
    if (typeof record.app?.slug === "string" && record.app.slug.length > FIELD_LENGTH_MAX) {
      reject("inventory field is oversized");
    }
    projected.app = { id: record.app?.id, slug: record.app?.slug };
    projected.check_suite = { id: record.check_suite?.id };
  }
  return projected;
}

function inventory(readJson, endpoint, collection) {
  const records = [];
  let expectedCount;
  for (let page = 1; page <= PAGES_MAX; page += 1) {
    const response = readJson(`${endpoint}&per_page=${PAGE_SIZE}&page=${page}`);
    assertObject(response);
    const pageRecords = response[collection];
    const totalCount = response.total_count;
    if (
      !Array.isArray(pageRecords) ||
      pageRecords.length > PAGE_SIZE ||
      !Number.isSafeInteger(totalCount) ||
      totalCount < 0 ||
      totalCount >= RECORDS_MAX
    ) {
      reject("incomplete or oversized inventory");
    }
    expectedCount ??= totalCount;
    if (totalCount !== expectedCount) {
      reject("inventory count changed during pagination");
    }
    for (const record of pageRecords) {
      assertObject(record);
      assertId(record.id);
      records.push(projectRecord(record, collection));
    }
    if (records.length >= RECORDS_MAX) {
      reject("inventory limit reached");
    }
    if (pageRecords.length < PAGE_SIZE) {
      if (
        records.length !== expectedCount ||
        new Set(records.map(({ id }) => id)).size !== records.length
      ) {
        reject("inventory is incomplete or duplicated");
      }
      return records;
    }
  }
  reject("page limit reached");
}

function requiredCandidates(checks, releaseCommit) {
  return checks
    .filter((check) => {
      if (typeof check.name !== "string") {
        reject("check name is missing");
      }
      return requiredSources.some(({ name }) => check.name === name);
    })
    .map((check) => {
      assertObject(check);
      assertId(check.id);
      if (
        check.head_sha !== releaseCommit ||
        check.status !== "completed" ||
        typeof check.conclusion !== "string"
      ) {
        reject("required check is pending or malformed");
      }
      if (timestamp(check.completed_at) < timestamp(check.started_at)) {
        reject("completion precedes start");
      }
      assertObject(check.app);
      assertObject(check.check_suite);
      assertId(check.check_suite.id);
      if (check.app.id !== 15368 || check.app.slug !== "github-actions") {
        reject("required check has the wrong App");
      }
      return check;
    });
}

function assertMain(readJson, mainCommit) {
  const main = readJson(`repos/${REPOSITORY}/git/ref/heads/main`);
  assertObject(main);
  assertObject(main.object);
  if (
    main.ref !== "refs/heads/main" ||
    main.object.type !== "commit" ||
    main.object.sha !== mainCommit
  ) {
    reject("main does not identify the exact release commit");
  }
}

function assertRunTimes(run) {
  const createdMs = timestamp(run.created_at);
  if (timestamp(run.run_started_at) < createdMs) {
    reject("workflow attempt precedes run creation");
  }
}

function selectedAuthority(readJson, { check, source, runs, releaseCommit }) {
  assertSuccessful(check, releaseCommit);
  const job = readJson(`repos/${REPOSITORY}/actions/jobs/${check.id}`);
  assertSuccessful(job, releaseCommit);
  assertId(job.run_id);
  assertId(job.run_attempt);
  if (
    job.id !== check.id ||
    job.name !== check.name ||
    job.check_run_url !== `https://api.github.com/repos/${REPOSITORY}/check-runs/${check.id}`
  ) {
    reject("job does not identify the selected check");
  }
  const run = readJson(`repos/${REPOSITORY}/actions/runs/${job.run_id}`);
  assertObject(run);
  assertId(run.id);
  assertId(run.run_attempt);
  assertId(run.check_suite_id);
  assertRunTimes(run);
  if (
    run.id !== job.run_id ||
    run.run_attempt !== job.run_attempt ||
    run.check_suite_id !== check.check_suite.id ||
    run.head_sha !== releaseCommit ||
    run.path !== source.path ||
    run.event !== "push" ||
    run.head_branch !== "main" ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  ) {
    reject("latest workflow run has the wrong provenance or state");
  }
  const sourceRuns = runs.filter(({ path }) => path === source.path);
  // Re-runs retain their creation time, so recency belongs to the current attempt.
  const latestRun = newest(sourceRuns, "run_started_at");
  if (
    latestRun.id !== run.id ||
    latestRun.run_attempt !== run.run_attempt ||
    latestRun.run_started_at !== run.run_started_at ||
    latestRun.created_at !== run.created_at ||
    latestRun.head_sha !== releaseCommit ||
    latestRun.event !== "push" ||
    latestRun.head_branch !== "main" ||
    latestRun.status !== "completed" ||
    latestRun.conclusion !== "success" ||
    latestRun.check_suite_id !== run.check_suite_id
  ) {
    reject("a newer workflow run lacks successful required authority");
  }
  return {
    name: source.name,
    path: source.path,
    checkId: check.id,
    suiteId: run.check_suite_id,
    runId: run.id,
    runAttempt: run.run_attempt,
  };
}

function observe(readJson, releaseCommit, mainCommit) {
  assertMain(readJson, mainCommit);
  const endpoint = `repos/${REPOSITORY}/commits/${releaseCommit}`;
  const suites = inventory(readJson, `${endpoint}/check-suites?`, "check_suites");
  const suiteChecks = [];
  for (const suite of suites) {
    if (suite.head_sha !== releaseCommit) {
      reject("suite has the wrong head");
    }
    const checks = inventory(
      readJson,
      `repos/${REPOSITORY}/check-suites/${suite.id}/check-runs?filter=all`,
      "check_runs",
    );
    for (const check of checks) {
      if (check.check_suite?.id !== suite.id) {
        reject("check belongs to a different suite");
      }
      suiteChecks.push(check);
    }
  }
  if (new Set(suiteChecks.map(({ id }) => id)).size !== suiteChecks.length) {
    reject("check is duplicated across suites");
  }
  const commitChecks = inventory(readJson, `${endpoint}/check-runs?filter=all`, "check_runs");
  const consumerChecks = inventory(readJson, `${endpoint}/check-runs?`, "check_runs");
  const requiredSuiteChecks = requiredCandidates(suiteChecks, releaseCommit);
  const requiredCommitChecks = requiredCandidates(commitChecks, releaseCommit);
  const requiredConsumerChecks = requiredCandidates(consumerChecks, releaseCommit);
  const suiteIds = requiredSuiteChecks.map(({ id }) => id).sort((left, right) => left - right);
  const commitIds = requiredCommitChecks.map(({ id }) => id).sort((left, right) => left - right);
  if (
    JSON.stringify(suiteIds) !== JSON.stringify(commitIds) ||
    JSON.stringify([...requiredSuiteChecks].sort((left, right) => left.id - right.id)) !==
      JSON.stringify([...requiredCommitChecks].sort((left, right) => left.id - right.id))
  ) {
    reject("suite and commit required-check inventories disagree");
  }
  const runs = inventory(
    readJson,
    `repos/${REPOSITORY}/actions/runs?head_sha=${releaseCommit}`,
    "workflow_runs",
  );
  for (const run of runs) {
    if (typeof run.path !== "string" || run.head_sha !== releaseCommit) {
      reject("workflow inventory has invalid identity");
    }
    assertRunTimes(run);
    assertId(run.run_attempt);
  }
  const selected = requiredSources.map((source) => {
    const selectedCheck = newest(
      requiredSuiteChecks.filter(({ name }) => name === source.name),
      "started_at",
    );
    const consumerCheck = newest(
      requiredConsumerChecks.filter(({ name }) => name === source.name),
      "started_at",
    );
    if (
      selectedCheck.id !== consumerCheck.id ||
      JSON.stringify(selectedCheck) !== JSON.stringify(consumerCheck)
    ) {
      reject("current consumer selected a different check");
    }
    assertSuccessful(consumerCheck, releaseCommit);
    return selectedAuthority(readJson, { check: selectedCheck, source, runs, releaseCommit });
  });
  assertMain(readJson, mainCommit);
  return { suites, suiteChecks, commitChecks, consumerChecks, runs, selected };
}

/**
 * Return exact source identities after two unchanged complete observations.
 * Callers evaluating retained checks supply their independently verified main commit.
 * The publication CLI always requires main to equal the release commit.
 */
export function verifyReleaseChecks(releaseCommit, { readJson, mainCommit = releaseCommit }) {
  if (
    typeof releaseCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(releaseCommit) ||
    typeof mainCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(mainCommit) ||
    typeof readJson !== "function"
  ) {
    reject("expected one exact lowercase commit");
  }
  const first = observe(readJson, releaseCommit, mainCommit);
  const final = observe(readJson, releaseCommit, mainCommit);
  if (JSON.stringify(first) !== JSON.stringify(final)) {
    reject("authority changed during observation");
  }
  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    releaseCommit,
    mainCommit,
    checks: final.selected,
  };
}

/** Construct a bounded, fixed-host GET reader without inherited debug settings. */
export function createGitHubReader({
  spawn = spawnSync,
  now = () => performance.now(),
  environment = process.env,
} = {}) {
  const startedMs = now();
  let requestCount = 0;
  const childEnvironment = Object.fromEntries([
    ["GH_PROMPT_DISABLED", "1"],
    ["GH_PAGER", "cat"],
  ]);
  for (const field of ["HOME", "PATH", "GH_TOKEN", "GITHUB_TOKEN"]) {
    if (typeof environment[field] === "string") {
      childEnvironment[field] = environment[field];
    }
  }
  return (endpoint) => {
    if (!endpoint.startsWith(`repos/${REPOSITORY}/`) || !/^[A-Za-z0-9_./?=&-]+$/.test(endpoint)) {
      reject("unexpected endpoint");
    }
    requestCount += 1;
    const remainingMs = DEADLINE_MS - (now() - startedMs);
    if (requestCount > REQUESTS_MAX || remainingMs <= 0) {
      reject("request budget exhausted");
    }
    const response = spawn(
      "gh",
      [
        "api",
        "--method",
        "GET",
        "--hostname",
        "github.com",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "X-GitHub-Api-Version: 2022-11-28",
        endpoint,
      ],
      {
        env: childEnvironment,
        encoding: "utf8",
        shell: false,
        timeout: Math.min(REQUEST_TIMEOUT_MS, Math.ceil(remainingMs)),
        maxBuffer: RESPONSE_BYTES_MAX,
        stdio: ["ignore", "pipe", "pipe"],
        killSignal: "SIGKILL",
      },
    );
    if (
      response.error !== undefined ||
      response.signal !== null ||
      response.status !== 0 ||
      typeof response.stdout !== "string" ||
      Buffer.byteLength(response.stdout) > RESPONSE_BYTES_MAX ||
      now() - startedMs >= DEADLINE_MS
    ) {
      reject("GitHub request failed");
    }
    try {
      return JSON.parse(response.stdout);
    } catch {
      reject("GitHub response is not JSON");
    }
  };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3) {
      reject("expected one exact commit argument");
    }
    process.stdout.write(
      `${JSON.stringify(verifyReleaseChecks(process.argv[2], { readJson: createGitHubReader() }))}\n`,
    );
  } catch {
    process.stderr.write("Release check provenance verification failed.\n");
    process.exitCode = 1;
  }
}
