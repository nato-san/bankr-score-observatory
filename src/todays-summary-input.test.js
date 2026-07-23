import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeTodaysSummaryInput } from "./todays-summary-input.js";

function diffUser(username, status, oldRank, newRank, rankChange, overallChange = 0) {
  return {
    accountId: username ? `id-${username}` : null,
    username,
    status,
    rank: { old: oldRank, new: newRank, change: rankChange },
    overallScore: {
      old: Number.isFinite(overallChange) ? 1 : null,
      new: Number.isFinite(overallChange) ? 1 + overallChange : null,
      change: overallChange,
    },
  };
}

function categoryDiff({ rawDiff = 0, scoreDiff = 0, status = "complete" } = {}) {
  return {
    rawBefore: 0,
    rawAfter: rawDiff,
    rawDiff,
    scoreBefore: 0,
    scoreAfter: scoreDiff,
    scoreDiff,
    comparisonStatus: status,
  };
}

function caseItem(username, rankDiff, categoryDiffs) {
  return {
    accountId: username ? `id-${username}` : null,
    username,
    rankBefore: rankDiff == null ? null : 10,
    rankAfter: rankDiff == null ? null : 10 - rankDiff,
    rankDiff,
    overallDiff: 0,
    categoryDiffs,
    dataCompleteness: "complete",
    detectionReasons: [],
    notableVisibleChanges: [],
  };
}

function syntheticSource() {
  return {
    comparisonAvailable: true,
    dataQuality: { status: "complete", metrics: { comparisonAvailable: true } },
    diff: {
      users: [
        diffUser("@Rise", "existing", 10, 4, 6, 0.2),
        diffUser("@SmallRise", "existing", 8, 7, 1, 0.5),
        diffUser("@Drop", "existing", 4, 6, -2, -0.1),
        diffUser("@Same", "existing", 3, 3, 0, 0),
        diffUser("@Newbie", "new", null, 50, null, null),
        diffUser("@Exited", "exited", 49, null, null, null),
        diffUser("@BadOverall", "existing", 12, 12, 0, Infinity),
      ],
    },
    caseResearch: {
      status: "complete",
      summary: {
        comparableUsers: 4,
        partialUsers: 0,
        unavailableUsers: 0,
        currentOnlyUsers: 0,
      },
      categoryDefinitions: [
        { key: "deployer", label: "Deployer" },
        { key: "developer", label: "Builder" },
        { key: "llmUsage", label: "LLM Gateway" },
        { key: "pnl", label: "PNL" },
      ],
      cases: [
        caseItem("@Rise", 6, {
          deployer: categoryDiff({ rawDiff: 50, scoreDiff: 0.5 }),
          developer: categoryDiff({ rawDiff: 3, scoreDiff: null }),
        }),
        caseItem("@Drop", -2, {
          deployer: categoryDiff({ rawDiff: 10, scoreDiff: 0.1 }),
          llmUsage: categoryDiff({ rawDiff: -8, scoreDiff: -0.2 }),
        }),
        caseItem("@Same", 0, {
          deployer: categoryDiff({ rawDiff: 4, scoreDiff: 0.05 }),
          pnl: categoryDiff({ rawDiff: -10, scoreDiff: 0.1 }),
        }),
        caseItem(null, 0, {
          developer: categoryDiff({ rawDiff: 7, scoreDiff: null }),
        }),
      ],
    },
  };
}

test("baseline does not turn current-only users into entrants", () => {
  const source = {
    comparisonAvailable: false,
    diff: { users: Array.from({ length: 50 }, (_, index) => diffUser(`@User${index}`, "new", null, index + 1, null)) },
    caseResearch: {
      status: "baseline",
      summary: { comparableUsers: 0, partialUsers: 0, unavailableUsers: 0, currentOnlyUsers: 50 },
    },
  };
  const result = normalizeTodaysSummaryInput(source);
  assert.equal(result.state.baseline, true);
  assert.equal(result.state.baselineReason, "case-research-baseline");
  assert.equal(result.turnover.entrants.length, 0);
  assert.equal(result.turnover.exits.length, 0);
  assert.equal(result.rankMovements.length, 0);
});

test("missing caseResearch can still classify known no-previous initial snapshot as baseline", () => {
  const source = {
    comparisonAvailable: false,
    comparisonReason: "比較対象となる前回Snapshotはありません",
    diff: { users: Array.from({ length: 50 }, (_, index) => diffUser(`@Initial${index}`, "new", null, index + 1, null)) },
  };
  const result = normalizeTodaysSummaryInput(source);
  assert.equal(result.state.baseline, true);
  assert.equal(result.state.baselineReason, "no-previous-snapshot");
  assert.equal(result.turnover.entrants.length, 0);
});

test("normal Top 50 turnover remains available when comparison exists", () => {
  const result = normalizeTodaysSummaryInput(syntheticSource());
  assert.equal(result.state.baseline, false);
  assert.equal(result.turnover.entrants.length, 1);
  assert.equal(result.turnover.exits.length, 1);
});

test("invalid or unavailable quality is not classified as baseline", () => {
  for (const status of ["invalid", "unavailable"]) {
    const result = normalizeTodaysSummaryInput({
      comparisonAvailable: false,
      dataQuality: { status },
      diff: { users: Array.from({ length: 50 }, (_, index) => diffUser(`@Invalid${index}`, "new", null, index + 1, null)) },
      caseResearch: {
        status: "baseline",
        summary: { currentOnlyUsers: 50 },
      },
    });
    assert.equal(result.state.baseline, false);
    assert.equal(result.state.baselineReason, null);
  }
});

test("ambiguous comparison unavailable is not classified as baseline", () => {
  const result = normalizeTodaysSummaryInput({
    comparisonAvailable: false,
    comparisonReason: "比較できません。",
    diff: {
      users: [
        diffUser("@CurrentOnly", "new", null, 50, null),
        diffUser("@Existing", "existing", 1, 1, 0),
      ],
    },
    caseResearch: {
      status: "unavailable",
      summary: { currentOnlyUsers: 1, comparableUsers: 1 },
    },
  });
  assert.equal(result.state.baseline, false);
  assert.equal(result.turnover.entrants.length, 1);
});

test("new and exited users are separated from rank movements", () => {
  const result = normalizeTodaysSummaryInput(syntheticSource());
  assert.deepEqual(result.turnover.entrants, [{ username: "Newbie", currentRank: 50 }]);
  assert.deepEqual(result.turnover.exits, [{ username: "Exited", previousRank: 49 }]);
  assert.equal(result.rankMovements.some((user) => user.username === "Newbie"), false);
});

test("rank change sign and stable rank sorting are preserved", () => {
  const result = normalizeTodaysSummaryInput(syntheticSource());
  assert.deepEqual(
    result.rankMovements.map((user) => [user.username, user.change, user.direction]),
    [
      ["Rise", 6, "up"],
      ["Drop", -2, "down"],
      ["SmallRise", 1, "up"],
    ],
  );
});

test("overall changes exclude non-finite values and sort deterministically", () => {
  const result = normalizeTodaysSummaryInput(syntheticSource());
  assert.deepEqual(
    result.overallChanges.map((user) => [user.username, user.change]),
    [
      ["SmallRise", 0.5],
      ["Rise", 0.2],
      ["Drop", -0.1],
    ],
  );
  assert.equal(result.overallChanges.some((user) => user.username === "BadOverall"), false);
});

test("category extraction uses score first and raw fallback only when score is unavailable", () => {
  const result = normalizeTodaysSummaryInput(syntheticSource());
  const scoreBased = result.categoryChanges.find((item) => item.username === "Rise" && item.categoryKey === "deployer");
  const rawFallback = result.categoryChanges.find((item) => item.username === "Rise" && item.categoryKey === "developer");
  assert.equal(scoreBased.changeBasis, "score");
  assert.equal(rawFallback.changeBasis, "raw-fallback");
});

test("score/raw direction conflicts are flagged and excluded from mismatch candidates", () => {
  const result = normalizeTodaysSummaryInput(syntheticSource());
  const conflict = result.categoryChanges.find((item) => item.username === "Same" && item.categoryKey === "pnl");
  assert.equal(conflict.directionConflict, true);
  assert.equal(
    result.mismatchCandidates.individualMismatches.some((item) => item.username === "Same" && item.categoryKey === "pnl"),
    false,
  );
});

test("changed category counts and usernames are normalized safely", () => {
  const result = normalizeTodaysSummaryInput(syntheticSource());
  const rise = result.users.find((user) => user.username === "Rise");
  const unknown = result.users.find((user) => user.username.startsWith("Unknown account"));
  assert.equal(rise.changedCategoryCount, 2);
  assert.deepEqual(rise.changedCategoryKeys, ["deployer", "developer"]);
  assert.ok(unknown);
});

test("individual mismatch candidates are extracted without selecting insights", () => {
  const result = normalizeTodaysSummaryInput(syntheticSource());
  assert.deepEqual(
    result.mismatchCandidates.individualMismatches.map((item) => [item.username, item.categoryKey, item.categoryDirection, item.rankDirection]),
    [
      ["Unknown account 10-10-0", "developer", "increase", "same"],
      ["Drop", "deployer", "increase", "down"],
      ["Same", "deployer", "increase", "same"],
      ["Rise", "developer", "increase", "up"],
    ].filter(([, , categoryDirection, rankDirection]) => !(categoryDirection === "increase" && rankDirection === "up")),
  );
});

test("same-category contrast candidates are extracted", () => {
  const result = normalizeTodaysSummaryInput(syntheticSource());
  const deployer = result.mismatchCandidates.sameCategoryContrasts.find((item) => item.categoryKey === "deployer");
  assert.ok(deployer);
  assert.deepEqual(deployer.contrastTypes, ["rankUp+rankDown", "rankUp+rankSame", "rankDown+rankSame"]);
});

test("input order does not affect normalized output", () => {
  const source = syntheticSource();
  const reversed = {
    ...source,
    diff: { users: [...source.diff.users].reverse() },
    caseResearch: { ...source.caseResearch, cases: [...source.caseResearch.cases].reverse() },
  };
  assert.deepEqual(normalizeTodaysSummaryInput(source), normalizeTodaysSummaryInput(reversed));
});

test("the same input produces the same output", () => {
  const source = syntheticSource();
  assert.deepEqual(normalizeTodaysSummaryInput(source), normalizeTodaysSummaryInput(source));
});

test("case-research fixture normalizes to concrete signal counts", () => {
  const result = normalizeFixture("outputs/case-research-fixture.json");
  assert.equal(result.turnover.entrants.length, 1);
  assert.equal(result.turnover.exits.length, 1);
  assert.equal(result.rankMovements.length, 2);
  assert.equal(result.overallChanges.length, 2);
  assert.equal(result.categoryChanges.length, 7);
  assert.equal(result.mismatchCandidates.individualMismatches.length, 2);
  assert.equal(result.mismatchCandidates.sameCategoryContrasts.length, 0);
});

test("case-baseline fixture does not produce comparison signals", () => {
  const result = normalizeFixture("outputs/case-research-baseline-fixture.json");
  assert.equal(result.state.baseline, true);
  assert.equal(result.turnover.entrants.length, 0);
  assert.equal(result.turnover.exits.length, 0);
  assert.equal(result.rankMovements.length, 0);
  assert.equal(result.overallChanges.length, 0);
  assert.equal(result.categoryChanges.length, 0);
});

test("case-real-ab fixture normalizes to quiet comparable state", () => {
  const result = normalizeFixture("outputs/case-research-real-ab.json");
  assert.equal(result.turnover.entrants.length, 0);
  assert.equal(result.turnover.exits.length, 0);
  assert.equal(result.rankMovements.length, 0);
  assert.equal(result.overallChanges.length, 0);
  assert.equal(result.categoryChanges.length, 0);
});

function normalizeFixture(filePath) {
  const fixture = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return normalizeTodaysSummaryInput({
    diff: fixture.diff,
    caseResearch: fixture.caseResearch,
    comparisonAvailable: fixture.caseResearch?.status !== "baseline" && fixture.caseResearch?.status !== "unavailable",
    comparisonReason: fixture.caseResearch?.message ?? null,
    dataQuality: { status: "complete" },
  });
}
