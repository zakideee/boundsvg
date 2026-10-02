/** Exercise release provenance with complete and contradictory API observations. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createGitHubReader, verifyReleaseChecks } from "./verify-release-checks.mjs";

/** Exact synthetic release identity shared by the fixture observations. */
const RELEASE_COMMIT = "a".repeat(40);

function fixture() {
  const checks = ["Baseline Checks", "CI acceptance"].map((name, index) => {
    const check = JSON.parse(
      `{"id":${index + 1},"head_sha":"${RELEASE_COMMIT}","name":"${name}","check_suite":{"id":${index + 11}},"app":{"id":15368,"slug":"github-actions"},"started_at":"2026-01-01T00:00:00Z","completed_at":"2026-01-01T00:01:00Z","status":"completed","conclusion":"success"}`,
    );
    return check;
  });
  const suites = checks.map((check) =>
    JSON.parse(`{"id":${check.check_suite.id},"head_sha":"${RELEASE_COMMIT}"}`),
  );
  const jobs = checks.map((check, index) => {
    const job = { ...check };
    job.run_id = index + 21;
    job.run_attempt = 1;
    job.check_run_url = `https://api.github.com/repos/zakideee/boundsvg/check-runs/${check.id}`;
    return job;
  });
  const runs = jobs.map((job, index) =>
    JSON.parse(
      `{"id":${job.run_id},"check_suite_id":${job.check_suite.id},"run_attempt":1,"head_sha":"${RELEASE_COMMIT}","path":".github/workflows/${index === 0 ? "render-regression" : "ci"}.yml","created_at":"2026-01-01T00:00:00Z","run_started_at":"2026-01-01T00:00:00Z","event":"push","head_branch":"main","status":"completed","conclusion":"success"}`,
    ),
  );
  return { suites, checks, jobs, runs };
}

function reader(model, intercept = () => undefined) {
  return (endpoint) => {
    const intercepted = intercept(endpoint);
    if (intercepted !== undefined) {
      return intercepted;
    }
    const query = new URL(endpoint, "https://api.github.com/");
    const path = query.pathname;
    if (path.endsWith("/git/ref/heads/main")) {
      return { ref: "refs/heads/main", object: { type: "commit", sha: RELEASE_COMMIT } };
    }
    const jobMatch = /\/actions\/jobs\/(\d+)$/.exec(path);
    if (jobMatch) {
      return structuredClone(model.jobs.find(({ id }) => id === Number(jobMatch[1])));
    }
    const runMatch = /\/actions\/runs\/(\d+)$/.exec(path);
    if (runMatch) {
      return structuredClone(model.runs.find(({ id }) => id === Number(runMatch[1])));
    }
    let records;
    let collection;
    if (path.endsWith("/check-suites")) {
      records = model.suites;
      collection = "check_suites";
    } else if (path.endsWith("/check-runs")) {
      const suiteMatch = /\/check-suites\/(\d+)\//.exec(path);
      records = suiteMatch
        ? model.checks.filter((check) => check.check_suite.id === Number(suiteMatch[1]))
        : (model.consumerChecks ?? model.checks);
      collection = "check_runs";
    } else if (path.endsWith("/actions/runs")) {
      records = model.runs;
      collection = "workflow_runs";
    } else {
      throw new Error("Unexpected fixture endpoint");
    }
    const page = Number(query.searchParams.get("page"));
    return Object.fromEntries([
      ["total_count", records.length],
      [collection, structuredClone(records.slice((page - 1) * 100, page * 100))],
    ]);
  };
}

function verify(model, intercept) {
  return verifyReleaseChecks(RELEASE_COMMIT, { readJson: reader(model, intercept) });
}

test("two complete observations identify both exact main-push sources", () => {
  const proof = verify(fixture());
  assert.equal(proof.repository, "zakideee/boundsvg");
  assert.equal(proof.releaseCommit, RELEASE_COMMIT);
  assert.deepEqual(
    proof.checks.map(({ name, runAttempt }) => [name, runAttempt]),
    [
      ["Baseline Checks", 1],
      ["CI acceptance", 1],
    ],
  );
});

test("wrong check, job and latest run provenance are rejected", () => {
  const mutations = [
    (model) => {
      model.checks[0].name = "x".repeat(257);
    },
    (model) => {
      model.checks[0].app.id = 1;
    },
    (model) => {
      model.checks[0].app.slug = "other";
    },
    (model) => {
      model.checks[0].head_sha = "b".repeat(40);
    },
    (model) => {
      model.checks[0].conclusion = "failure";
    },
    (model) => {
      model.checks[0].conclusion = "cancelled";
    },
    (model) => {
      model.checks[0].status = "queued";
    },
    (model) => {
      model.checks[0].started_at = null;
    },
    (model) => {
      model.checks[0].started_at = "2026-02-30T00:00:00Z";
    },
    (model) => {
      model.checks[0].started_at = "2026-01-01T00:00:00+00:00";
    },
    (model) => {
      delete model.checks[0].app;
    },
    (model) => {
      model.jobs[0].name = "another job";
    },
    (model) => {
      model.jobs[0].check_run_url = "https://example.invalid/check";
    },
    (model) => {
      model.jobs[0].run_attempt = 2;
    },
    (model) => {
      model.jobs[0].status = "in_progress";
    },
    (model) => {
      model.runs[0].check_suite_id = 99;
    },
    (model) => {
      model.runs[0].path = ".github/workflows/other.yml";
    },
    (model) => {
      model.runs[0].event = "pull_request";
    },
    (model) => {
      model.runs[0].head_branch = "release/next";
    },
    (model) => {
      model.runs[0].run_attempt = 2;
    },
    (model) => {
      model.runs[0].status = "in_progress";
    },
    (model) => {
      model.runs[0].head_sha = "b".repeat(40);
    },
    (model) => {
      delete model.runs[0].created_at;
    },
    (model) => {
      model.suites[0].head_sha = "b".repeat(40);
    },
    (model) => {
      model.checks.push(structuredClone(model.checks[0]));
    },
    (model) => {
      model.checks.pop();
    },
  ];
  for (const mutate of mutations) {
    const model = fixture();
    mutate(model);
    assert.throws(() => verify(model), undefined, mutate.toString());
  }
});

test("old failed check is harmless but a newer failure or malformed candidate blocks", () => {
  const model = fixture();
  const oldCheck = { ...model.checks[0], id: 3 };
  oldCheck.started_at = "2025-12-31T23:00:00Z";
  oldCheck.completed_at = "2025-12-31T23:01:00Z";
  oldCheck.conclusion = "failure";
  model.checks.push(oldCheck);
  verify(model);
  oldCheck.started_at = "2026-01-01T00:02:00Z";
  oldCheck.completed_at = "2026-01-01T00:03:00Z";
  assert.throws(() => verify(model));
  oldCheck.status = "queued";
  oldCheck.started_at = null;
  assert.throws(() => verify(model));
});

test("a newer same-path run blocks before its required job exists", () => {
  for (const event of ["push", "workflow_dispatch", "pull_request"]) {
    const model = fixture();
    const newerRun = { ...model.runs[0], id: 31, event, status: "queued", conclusion: null };
    newerRun.created_at = "2026-01-01T00:02:00Z";
    newerRun.run_started_at = "2026-01-01T00:02:00Z";
    model.runs.push(newerRun);
    assert.throws(() => verify(model));
  }
});

test("later successful wrong-context check cannot be filtered away", () => {
  const model = fixture();
  const newerCheck = { ...model.checks[0], id: 3 };
  newerCheck.started_at = "2026-01-01T00:02:00Z";
  newerCheck.completed_at = "2026-01-01T00:03:00Z";
  const newerJob = { ...model.jobs[0], ...newerCheck };
  newerJob.run_id = 31;
  newerJob.check_run_url = "https://api.github.com/repos/zakideee/boundsvg/check-runs/3";
  const newerRun = { ...model.runs[0], id: 31, event: "workflow_dispatch" };
  newerRun.created_at = "2026-01-01T00:02:00Z";
  newerRun.run_started_at = "2026-01-01T00:02:00Z";
  model.checks.push(newerCheck);
  model.jobs.push(newerJob);
  model.runs.push(newerRun);
  assert.throws(() => verify(model));
});

test("commit/suite ID sets and the legacy consumer's latest selection must agree", () => {
  const model = fixture();
  const baseReader = reader(model);
  assert.throws(() =>
    verifyReleaseChecks(RELEASE_COMMIT, {
      readJson(endpoint) {
        const response = baseReader(endpoint);
        if (endpoint.includes(`/commits/${RELEASE_COMMIT}/check-runs?filter=all`)) {
          response.check_runs[0].id = 99;
        }
        return response;
      },
    }),
  );
  model.consumerChecks = model.checks.slice(1);
  assert.throws(() => verify(model));
});

test("pagination reads the short terminal page and rejects a hidden 101st record", () => {
  const model = fixture();
  const filler = Array.from({ length: 98 }, (_, index) => ({
    id: index + 100,
    name: "Unrelated",
    ...Object.fromEntries([["check_suite", { id: 11 }]]),
  }));
  model.checks.push(...filler);
  const observedPages = [];
  const completeReader = reader(model);
  verifyReleaseChecks(RELEASE_COMMIT, {
    readJson(endpoint) {
      if (endpoint.includes(`/commits/${RELEASE_COMMIT}/check-runs?filter=all`)) {
        observedPages.push(
          Number(new URL(endpoint, "https://api.github.com/").searchParams.get("page")),
        );
      }
      return completeReader(endpoint);
    },
  });
  assert.deepEqual(observedPages, [1, 2, 1, 2]);
  assert.throws(() =>
    verify(model, (endpoint) =>
      endpoint.includes("check-runs?filter=all&per_page=100&page=2")
        ? Object.fromEntries([
            ["total_count", 100],
            ["check_runs", [{ id: 777, name: "Unrelated" }]],
          ])
        : undefined,
    ),
  );
});

test("count, duplicates, cap, missing fields and observation drift fail closed", () => {
  const model = fixture();
  for (const response of [
    Object.fromEntries([
      ["total_count", 2],
      ["check_suites", []],
    ]),
    Object.fromEntries([
      ["total_count", 900],
      ["check_suites", []],
    ]),
    Object.fromEntries([
      ["total_count", 2],
      ["check_suites", [model.suites[0], model.suites[0]]],
    ]),
    {},
    null,
  ]) {
    assert.throws(() =>
      verify(model, (endpoint) => (endpoint.includes("/check-suites?") ? response : undefined)),
    );
  }
  let mainReads = 0;
  assert.throws(() =>
    verify(model, (endpoint) => {
      if (!endpoint.endsWith("/git/ref/heads/main")) {
        return undefined;
      }
      mainReads += 1;
      return {
        ref: "refs/heads/main",
        object: { type: "commit", sha: mainReads === 4 ? "b".repeat(40) : RELEASE_COMMIT },
      };
    }),
  );
  let runReads = 0;
  const baseReader = reader(model);
  assert.throws(() =>
    verifyReleaseChecks(RELEASE_COMMIT, {
      readJson(endpoint) {
        const response = baseReader(endpoint);
        if (endpoint.endsWith("/actions/runs/21") && ++runReads === 2) {
          response.run_attempt = 2;
        }
        return response;
      },
    }),
  );
});

test("GET transport fixes host, method, headers and child environment", () => {
  const inherited = Object.fromEntries([
    ["HOME", "/tmp/example-home"],
    ["PATH", "/usr/bin"],
    ["GH_TOKEN", "fixture-token"],
    ["GH_HOST", "example.invalid"],
    ["GH_REPO", "elsewhere/repo"],
    ["GH_DEBUG", "api"],
    ["NODE_OPTIONS", "--require=invalid"],
  ]);
  const readJson = createGitHubReader({
    environment: inherited,
    spawn(executable, argumentsList, options) {
      assert.equal(executable, "gh");
      assert.deepEqual(argumentsList.slice(0, 5), [
        "api",
        "--method",
        "GET",
        "--hostname",
        "github.com",
      ]);
      assert.equal(argumentsList.includes("X-GitHub-Api-Version: 2022-11-28"), true);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 10_000);
      assert.equal(options.maxBuffer, 4 * 1024 * 1024);
      assert.equal(options.env.GH_HOST, undefined);
      assert.equal(options.env.GH_DEBUG, undefined);
      assert.equal(options.env.NODE_OPTIONS, undefined);
      assert.equal(options.env.GH_TOKEN, inherited.GH_TOKEN);
      return { status: 0, signal: null, stdout: "{}" };
    },
  });
  assert.deepEqual(readJson("repos/zakideee/boundsvg/git/ref/heads/main"), {});
  assert.throws(() => readJson("https://example.invalid"));
});

test("transport refuses signals, errors, null/nonzero exit, invalid JSON and resource exhaustion", () => {
  for (const response of [
    { status: 0, stdout: "{}" },
    { status: 0, signal: null, error: false, stdout: "{}" },
    { status: null, stdout: "{}" },
    { status: 1, stdout: "{}" },
    { status: 0, signal: "SIGTERM", stdout: "{}" },
    { status: 0, error: new Error("failed"), stdout: "{}" },
    { status: 0, stdout: "{}\n{}" },
    { status: 0, stdout: "x".repeat(4 * 1024 * 1024 + 1) },
  ]) {
    assert.throws(() =>
      createGitHubReader({ spawn: () => response })("repos/zakideee/boundsvg/git/ref/heads/main"),
    );
  }
  let clockMs = 0;
  const readJson = createGitHubReader({
    now: () => clockMs,
    spawn: () => ({ status: 0, signal: null, stdout: "{}" }),
  });
  clockMs = 120_000;
  assert.throws(() => readJson("repos/zakideee/boundsvg/git/ref/heads/main"));
  const limitedReader = createGitHubReader({
    now: () => 0,
    spawn: () => ({ status: 0, signal: null, stdout: "{}" }),
  });
  for (let count = 0; count < 200; count += 1) {
    limitedReader("repos/zakideee/boundsvg/git/ref/heads/main");
  }
  assert.throws(() => limitedReader("repos/zakideee/boundsvg/git/ref/heads/main"));
});

test("workflow and both test paths call the public verifier", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  assert.equal(workflow.match(/node scripts\/verify-release-checks.mjs/g)?.length, 2);
  assert.equal(workflow.match(/actions: read/g)?.length, 2);
  assert.equal(workflow.includes("REQUIRED_CHECKS"), false);
  for (const path of ["../.github/workflows/ci.yml", "./preflight-pr.mjs"]) {
    assert.equal(
      readFileSync(new URL(path, import.meta.url), "utf8").includes(
        "verify-release-checks.test.mjs",
      ),
      true,
    );
  }
});

test("same-ID payload contradictions between suite, commit and consumer authority block", () => {
  const mutations = [
    (check) => {
      check.conclusion = "failure";
    },
    (check) => {
      check.started_at = "2026-01-01T00:00:01Z";
    },
    (check) => {
      check.check_suite.id = 99;
    },
    (check) => {
      check.app.id = 99;
    },
    (check) => {
      check.name = "CI acceptance";
    },
    (check) => {
      check.head_sha = "b".repeat(40);
    },
  ];
  for (const endpointSuffix of ["?filter=all", "?&"]) {
    for (const mutate of mutations) {
      const model = fixture();
      const baseReader = reader(model);
      assert.throws(() =>
        verifyReleaseChecks(RELEASE_COMMIT, {
          readJson(endpoint) {
            const response = baseReader(endpoint);
            if (endpoint.includes(`/commits/${RELEASE_COMMIT}/check-runs${endpointSuffix}`)) {
              mutate(response.check_runs[0]);
            }
            return response;
          },
        }),
      );
    }
  }
});

test("retained checks accept an explicit current main while publication remains strict", () => {
  const model = fixture();
  const mainCommit = "b".repeat(40);
  const baseReader = reader(model);
  const readJson = (endpoint) =>
    endpoint.endsWith("/git/ref/heads/main")
      ? { ref: "refs/heads/main", object: { type: "commit", sha: mainCommit } }
      : baseReader(endpoint);
  assert.throws(() => verifyReleaseChecks(RELEASE_COMMIT, { readJson }));
  const proof = verifyReleaseChecks(RELEASE_COMMIT, { readJson, mainCommit });
  assert.equal(proof.mainCommit, mainCommit);
  assert.equal(proof.releaseCommit, RELEASE_COMMIT);
  assert.throws(() =>
    verifyReleaseChecks(RELEASE_COMMIT, { readJson, mainCommit: "c".repeat(40) }),
  );
  let mainReads = 0;
  assert.throws(() =>
    verifyReleaseChecks(RELEASE_COMMIT, {
      mainCommit,
      readJson(endpoint) {
        if (endpoint.endsWith("/git/ref/heads/main") && ++mainReads === 4) {
          return { ref: "refs/heads/main", object: { type: "commit", sha: "c".repeat(40) } };
        }
        return readJson(endpoint);
      },
    }),
  );
});

test("publication CLI rejects any separate main override before reading GitHub", () => {
  const invocation = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./verify-release-checks.mjs", import.meta.url)),
      RELEASE_COMMIT,
      "b".repeat(40),
    ],
    { encoding: "utf8" },
  );
  assert.equal(invocation.status, 1);
  assert.equal(invocation.stdout, "");
  assert.equal(invocation.stderr, "Release check provenance verification failed.\n");
});

test("an older wrong-context run's newer queued attempt cannot hide behind a successful run", () => {
  for (const status of ["queued", "in_progress"]) {
    const model = fixture();
    const olderRun = { ...model.runs[0], id: 20, status, conclusion: null };
    olderRun.check_suite_id = 10;
    olderRun.head_branch = "release/next";
    olderRun.run_attempt = 2;
    olderRun.created_at = "2025-12-31T23:00:00Z";
    olderRun.run_started_at = "2026-01-01T00:02:00Z";
    model.runs.push(olderRun);
    assert.throws(() => verify(model));
  }
});

test("rerunning the main-push workflow recovers after a later dispatch", () => {
  const model = fixture();
  const dispatch = { ...model.runs[0], id: 31, event: "workflow_dispatch" };
  dispatch.check_suite_id = 10;
  dispatch.created_at = "2026-01-01T00:02:00Z";
  dispatch.run_started_at = "2026-01-01T00:02:00Z";
  model.runs.push(dispatch);
  assert.throws(() => verify(model));
  const newerCheck = { ...model.checks[0], id: 3 };
  newerCheck.started_at = "2026-01-01T00:03:01Z";
  newerCheck.completed_at = "2026-01-01T00:04:00Z";
  const newerJob = { ...model.jobs[0], ...newerCheck };
  newerJob.run_attempt = 2;
  newerJob.check_run_url = "https://api.github.com/repos/zakideee/boundsvg/check-runs/3";
  model.checks.push(newerCheck);
  model.jobs.push(newerJob);
  model.runs[0].run_attempt = 2;
  model.runs[0].run_started_at = "2026-01-01T00:03:00Z";
  const proof = verify(model);
  assert.equal(proof.checks[0].runAttempt, 2);
  assert.equal(proof.checks[0].checkId, 3);
});

test("attempt time must be present, valid, unchanged and match the latest endpoint", () => {
  for (const startedAt of [undefined, null, "invalid", "2025-12-31T23:00:00Z"]) {
    const model = fixture();
    model.runs[0].run_started_at = startedAt;
    assert.throws(() => verify(model));
  }
  for (const mode of ["inventory", "endpoint"]) {
    const model = fixture();
    const baseReader = reader(model);
    assert.throws(() =>
      verifyReleaseChecks(RELEASE_COMMIT, {
        readJson(endpoint) {
          const response = baseReader(endpoint);
          if (mode === "inventory" && endpoint.includes("/actions/runs?")) {
            response.workflow_runs[0].run_started_at = "2026-01-01T00:00:01Z";
          }
          if (mode === "endpoint" && endpoint.endsWith("/actions/runs/21")) {
            response.run_started_at = "2026-01-01T00:00:01Z";
          }
          return response;
        },
      }),
    );
  }
  const model = fixture();
  const baseReader = reader(model);
  let inventoryReads = 0;
  let finalObservation = false;
  assert.throws(() =>
    verifyReleaseChecks(RELEASE_COMMIT, {
      readJson(endpoint) {
        const response = baseReader(endpoint);
        if (endpoint.includes("/actions/runs?") && ++inventoryReads === 2) {
          finalObservation = true;
        }
        if (finalObservation && endpoint.includes("/actions/runs?")) {
          response.workflow_runs[0].run_started_at = "2026-01-01T00:00:01Z";
        }
        if (finalObservation && endpoint.endsWith("/actions/runs/21")) {
          response.run_started_at = "2026-01-01T00:00:01Z";
        }
        return response;
      },
    }),
  );
});

test("fractional remaining deadlines produce positive integer subprocess timeouts", () => {
  for (const [elapsedMs, timeoutMs] of [
    [115_000.5, 5_000],
    [119_999.75, 1],
  ]) {
    let clockMs = 0;
    const readJson = createGitHubReader({
      now: () => clockMs,
      spawn(_executable, _argumentsList, options) {
        assert.equal(Number.isInteger(options.timeout), true);
        assert.equal(options.timeout, timeoutMs);
        assert.equal(options.timeout > 0, true);
        return { status: 0, signal: null, stdout: "{}" };
      },
    });
    clockMs = elapsedMs;
    assert.deepEqual(readJson("repos/zakideee/boundsvg/git/ref/heads/main"), {});
  }
});

test("lower-ID wrong-context attempts with tied latest epochs cannot be hidden", () => {
  for (const status of ["queued", "in_progress", "completed"]) {
    for (const startedAt of ["2026-01-01T00:00:00Z", "2026-01-01T00:00:00.000Z"]) {
      const model = fixture();
      const olderRun = {
        ...model.runs[0],
        id: 20,
        status,
        conclusion: status === "completed" ? "failure" : null,
      };
      olderRun.head_branch = "release/next";
      olderRun.run_attempt = 2;
      olderRun.created_at = "2025-12-31T23:00:00Z";
      olderRun.run_started_at = startedAt;
      model.runs.push(olderRun);
      assert.throws(() => verify(model));
    }
  }
});

test("any incomplete required-workflow attempt blocks even with an older start time", () => {
  for (const status of ["queued", "in_progress"]) {
    const model = fixture();
    const olderRun = { ...model.runs[0], id: 20, status, conclusion: null };
    olderRun.head_branch = "release/next";
    olderRun.run_attempt = 2;
    olderRun.created_at = "2025-12-31T23:00:00Z";
    olderRun.run_started_at = "2025-12-31T23:00:00Z";
    model.runs.push(olderRun);
    assert.throws(() => verify(model));
  }
});

test("completed older failed or cancelled runs permit a uniquely later successful main attempt", () => {
  for (const conclusion of ["failure", "cancelled"]) {
    const model = fixture();
    const olderRun = { ...model.runs[0], id: 20, conclusion };
    olderRun.head_branch = "release/next";
    olderRun.run_attempt = 2;
    olderRun.created_at = "2025-12-31T23:00:00Z";
    olderRun.run_started_at = "2025-12-31T23:00:00Z";
    model.runs.push(olderRun);
    assert.equal(verify(model).checks[0].runId, 21);
  }
});

test("a complete main rerun recovers from equal-epoch ambiguity", () => {
  const model = fixture();
  const conflictingRun = { ...model.runs[0], id: 20, event: "workflow_dispatch" };
  conflictingRun.run_attempt = 2;
  conflictingRun.created_at = "2025-12-31T23:00:00Z";
  conflictingRun.run_started_at = "2026-01-01T00:00:00.000Z";
  model.runs.push(conflictingRun);
  assert.throws(() => verify(model));
  const newerCheck = { ...model.checks[0], id: 3 };
  newerCheck.started_at = "2026-01-01T00:03:01Z";
  newerCheck.completed_at = "2026-01-01T00:04:00Z";
  const newerJob = { ...model.jobs[0], ...newerCheck };
  newerJob.run_attempt = 2;
  newerJob.check_run_url = "https://api.github.com/repos/zakideee/boundsvg/check-runs/3";
  model.checks.push(newerCheck);
  model.jobs.push(newerJob);
  model.runs[0].run_attempt = 2;
  model.runs[0].run_started_at = "2026-01-01T00:03:00Z";
  assert.equal(verify(model).checks[0].runAttempt, 2);
});
