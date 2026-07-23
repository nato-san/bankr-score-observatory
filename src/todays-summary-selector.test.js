import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeTodaysSummaryInput } from "./todays-summary-input.js";
import { selectTodaysSummaryInsight } from "./todays-summary-selector.js";

function readyInput(overrides = {}) {
  return {
    state: {
      snapshotQuality: "complete",
      comparisonAvailable: true,
      comparisonReason: null,
      baseline: false,
      baselineReason: null,
      comparableUsers: 40,
      partialUsers: 0,
      unavailableUsers: 0,
      currentOnlyUsers: 0,
      ...overrides.state,
    },
    turnover: {
      entrants: [],
      exits: [],
      ...overrides.turnover,
    },
    rankMovements: overrides.rankMovements ?? [],
    overallChanges: overrides.overallChanges ?? [],
    categoryChanges: overrides.categoryChanges ?? [],
    users: overrides.users ?? [],
    mismatchCandidates: {
      sameCategoryContrasts: [],
      individualMismatches: [],
      ...overrides.mismatchCandidates,
    },
  };
}

function rankMove(username, change, currentRank = 10) {
  return {
    username,
    previousRank: currentRank + change,
    currentRank,
    change,
    direction: change > 0 ? "up" : change < 0 ? "down" : "same",
  };
}

function overall(username, change, currentRank = 10) {
  return { username, previousValue: 1, currentValue: 1 + change, change, currentRank };
}

function weakMismatch(username, categoryDirection, rankDirection, extras = {}) {
  return {
    username,
    categoryKey: extras.categoryKey ?? "deployer",
    categoryLabel: extras.categoryLabel ?? "Deployer",
    categoryDirection,
    rankDirection,
    rankChange: extras.rankChange ?? (rankDirection === "up" ? 2 : rankDirection === "down" ? -2 : 0),
    changeBasis: extras.changeBasis ?? "score",
    scoreDiff: extras.scoreDiff ?? (categoryDirection === "increase" ? 0.5 : -0.5),
    rawDiff: extras.rawDiff ?? null,
    currentRank: extras.currentRank,
  };
}

function contrast(categoryKey, contrastTypes, groups = {}) {
  return {
    categoryKey,
    categoryLabel: groups.categoryLabel ?? categoryKey,
    contrastTypes,
    rankUp: groups.rankUp ?? [],
    rankDown: groups.rankDown ?? [],
    rankSame: groups.rankSame ?? [],
  };
}

function contrastUser(username, extras = {}) {
  return {
    username,
    rankChange: extras.rankChange ?? 1,
    changeBasis: extras.changeBasis ?? "score",
    scoreDiff: extras.scoreDiff ?? 0.2,
    rawDiff: extras.rawDiff ?? null,
  };
}

function multiUser(username, changedCategoryCount, categoryChanges = []) {
  return { username, changedCategoryCount, categoryChanges };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("baseline returns baseline insight before unavailable checks", () => {
  const result = selectTodaysSummaryInsight(readyInput({
    state: {
      baseline: true,
      baselineReason: "case-research-baseline",
      comparisonAvailable: false,
      comparableUsers: 0,
    },
    turnover: { entrants: [{ username: "ShouldNotAppear", currentRank: 1 }] },
  }));
  assert.equal(result.status, "baseline");
  assert.equal(result.insightType, "baseline");
  assert.equal(result.metadata.selectionReason, "case-research-baseline");
  assert.equal(result.selectedSignals.primary, null);
});

test("invalid snapshot is unavailable", () => {
  const result = selectTodaysSummaryInsight(readyInput({ state: { snapshotQuality: "invalid" } }));
  assert.equal(result.status, "unavailable");
  assert.equal(result.metadata.selectionReason, "invalid-snapshot");
});

test("comparison unavailable is unavailable", () => {
  const result = selectTodaysSummaryInsight(readyInput({ state: { comparisonAvailable: false } }));
  assert.equal(result.status, "unavailable");
  assert.equal(result.metadata.selectionReason, "comparison-unavailable");
});

test("comparableUsers 39 is unavailable", () => {
  const result = selectTodaysSummaryInsight(readyInput({ state: { comparableUsers: 39 } }));
  assert.equal(result.status, "unavailable");
  assert.equal(result.metadata.selectionReason, "insufficient-comparable-users");
});

test("comparableUsers 40 can select limited movement", () => {
  const result = selectTodaysSummaryInsight(readyInput({ state: { comparableUsers: 40 } }));
  assert.equal(result.status, "ready");
  assert.equal(result.insightType, "limited-movement");
});

test("turnover is selected when entrants or exits exist", () => {
  const result = selectTodaysSummaryInsight(readyInput({
    turnover: {
      entrants: [{ username: "Beta", currentRank: 7 }, { username: "Alpha", currentRank: 7 }],
      exits: [{ username: "Exit", previousRank: 4 }],
    },
  }));
  assert.equal(result.insightType, "top50-turnover");
  assert.equal(result.metadata.candidateCounts.turnover, 3);
  assert.deepEqual(result.selectedSignals.secondary, { username: "Alpha", currentRank: 7 });
});

test("rank rise 4 is below threshold", () => {
  const result = selectTodaysSummaryInsight(readyInput({ rankMovements: [rankMove("Rise4", 4, 8)] }));
  assert.equal(result.insightType, "limited-movement");
  assert.equal(result.metadata.candidateCounts.largeRankRise, 0);
});

test("rank rise 5 is selected", () => {
  const result = selectTodaysSummaryInsight(readyInput({ rankMovements: [rankMove("Rise5", 5, 8)] }));
  assert.equal(result.insightType, "large-rank-rise");
  assert.equal(result.selectedSignals.primary.username, "Rise5");
});

test("turnover outranks rank rise", () => {
  const result = selectTodaysSummaryInsight(readyInput({
    turnover: { entrants: [{ username: "New", currentRank: 50 }] },
    rankMovements: [rankMove("Rise10", 10, 3)],
  }));
  assert.equal(result.insightType, "top50-turnover");
});

test("strong mismatch outranks weak mismatch", () => {
  const result = selectTodaysSummaryInsight(readyInput({
    mismatchCandidates: {
      sameCategoryContrasts: [
        contrast("deployer", ["rankUp+rankDown"], {
          rankUp: [contrastUser("Up")],
          rankDown: [contrastUser("Down", { rankChange: -1 })],
        }),
      ],
      individualMismatches: [weakMismatch("Weak", "increase", "down")],
    },
  }));
  assert.equal(result.insightType, "rank-category-mismatch");
  assert.equal(result.metadata.mismatchStrength, "strong");
});

test("rankUp + rankDown contrast outranks rankUp + rankSame", () => {
  const result = selectTodaysSummaryInsight(readyInput({
    mismatchCandidates: {
      sameCategoryContrasts: [
        contrast("builder", ["rankUp+rankSame"], {
          rankUp: [contrastUser("UpLarge", { scoreDiff: 9 })],
          rankSame: [contrastUser("SameLarge", { scoreDiff: 8, rankChange: 0 })],
        }),
        contrast("deployer", ["rankUp+rankDown"], {
          rankUp: [contrastUser("UpSmall", { scoreDiff: 1 })],
          rankDown: [contrastUser("DownSmall", { scoreDiff: 1, rankChange: -1 })],
        }),
      ],
    },
  }));
  assert.equal(result.selectedSignals.primary.categoryKey, "deployer");
});

test("strong mismatch outranks overall increase", () => {
  const result = selectTodaysSummaryInsight(readyInput({
    overallChanges: [overall("Overall", 0.5, 1)],
    mismatchCandidates: {
      sameCategoryContrasts: [
        contrast("deployer", ["rankDown+rankSame"], {
          rankDown: [contrastUser("Down", { rankChange: -1 })],
          rankSame: [contrastUser("Same", { rankChange: 0 })],
        }),
      ],
    },
  }));
  assert.equal(result.insightType, "rank-category-mismatch");
  assert.equal(result.metadata.mismatchStrength, "strong");
});

test("weak mismatch is selected when no higher signal exists", () => {
  const result = selectTodaysSummaryInsight(readyInput({
    mismatchCandidates: {
      individualMismatches: [
        weakMismatch("Same", "increase", "same"),
        weakMismatch("Down", "increase", "down"),
      ],
    },
  }));
  assert.equal(result.insightType, "rank-category-mismatch");
  assert.equal(result.metadata.mismatchStrength, "weak");
  assert.equal(result.selectedSignals.primary.username, "Down");
});

test("overall 0.0009 is below threshold", () => {
  const result = selectTodaysSummaryInsight(readyInput({ overallChanges: [overall("Small", 0.0009)] }));
  assert.equal(result.insightType, "limited-movement");
  assert.equal(result.metadata.candidateCounts.largeOverallChange, 0);
});

test("overall 0.0010 is selected", () => {
  const result = selectTodaysSummaryInsight(readyInput({ overallChanges: [overall("Enough", 0.0010)] }));
  assert.equal(result.insightType, "large-overall-change");
  assert.equal(result.selectedSignals.primary.username, "Enough");
});

test("multi-category count 1 is below threshold", () => {
  const result = selectTodaysSummaryInsight(readyInput({ users: [multiUser("One", 1)] }));
  assert.equal(result.insightType, "limited-movement");
});

test("multi-category count 2 is selected", () => {
  const result = selectTodaysSummaryInsight(readyInput({
    users: [
      multiUser("Two", 2, [{ changeBasis: "score", scoreDiff: 1 }, { changeBasis: "raw-fallback", rawDiff: 1 }]),
    ],
  }));
  assert.equal(result.insightType, "multi-category-change");
  assert.equal(result.selectedSignals.primary.username, "Two");
});

test("limited movement is selected when no candidates match", () => {
  const result = selectTodaysSummaryInsight(readyInput());
  assert.equal(result.status, "ready");
  assert.equal(result.insightType, "limited-movement");
  assert.equal(result.metadata.selectionReason, "no-higher-priority-signal");
});

test("tie-breaks are deterministic", () => {
  const result = selectTodaysSummaryInsight(readyInput({
    rankMovements: [
      rankMove("Zulu", 5, 9),
      rankMove("Alpha", 5, 9),
      rankMove("Top", 5, 3),
    ],
  }));
  assert.equal(result.selectedSignals.primary.username, "Top");
  assert.equal(result.selectedSignals.secondary.username, "Alpha");
});

test("input array order changes do not affect selection", () => {
  const first = readyInput({
    rankMovements: [
      rankMove("Beta", 5, 8),
      rankMove("Alpha", 5, 8),
    ],
  });
  const second = readyInput({
    rankMovements: [
      rankMove("Alpha", 5, 8),
      rankMove("Beta", 5, 8),
    ],
  });
  assert.deepEqual(selectTodaysSummaryInsight(first), selectTodaysSummaryInsight(second));
});

test("the same input produces the same selection", () => {
  const input = readyInput({ overallChanges: [overall("Enough", 0.0010)] });
  assert.deepEqual(selectTodaysSummaryInsight(input), selectTodaysSummaryInsight(input));
});

test("broken input is unavailable", () => {
  const result = selectTodaysSummaryInsight(null);
  assert.equal(result.status, "unavailable");
  assert.equal(result.metadata.selectionReason, "invalid-normalized-input");
});

test("selector does not mutate input", () => {
  const input = readyInput({
    turnover: { entrants: [{ username: "B", currentRank: 2 }, { username: "A", currentRank: 1 }] },
    rankMovements: [rankMove("Rise", 5, 4)],
  });
  const before = clone(input);
  selectTodaysSummaryInsight(input);
  assert.deepEqual(input, before);
});

test("selector does not return prose fields", () => {
  const result = selectTodaysSummaryInsight(readyInput({ overallChanges: [overall("Enough", 0.0010)] }));
  const disallowed = ["text", "title", "body", "headline", "evidence", "disclaimer", "content", "jaSummary"];
  for (const key of disallowed) {
    assert.equal(Object.hasOwn(result, key), false);
  }
});

test("fixture selections use normalized input only", () => {
  assertFixtureSelection("outputs/case-research-fixture.json", {
    status: "ready",
    insightType: "top50-turnover",
    selectionReason: "top50-turnover-detected",
    candidateCounts: {
      turnover: 2,
      largeRankRise: 1,
      strongMismatch: 0,
      weakMismatch: 2,
      largeOverallChange: 1,
      multiCategoryChange: 1,
    },
  });
  assertFixtureSelection("outputs/case-research-baseline-fixture.json", {
    status: "baseline",
    insightType: "baseline",
    selectionReason: "case-research-baseline",
    candidateCounts: {
      turnover: 0,
      largeRankRise: 0,
      strongMismatch: 0,
      weakMismatch: 0,
      largeOverallChange: 0,
      multiCategoryChange: 0,
    },
  });
  assertFixtureSelection("outputs/case-research-real-ab.json", {
    status: "ready",
    insightType: "limited-movement",
    selectionReason: "no-higher-priority-signal",
    candidateCounts: {
      turnover: 0,
      largeRankRise: 0,
      strongMismatch: 0,
      weakMismatch: 0,
      largeOverallChange: 0,
      multiCategoryChange: 0,
    },
  });
});

function assertFixtureSelection(filePath, expected) {
  const fixture = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const normalized = normalizeTodaysSummaryInput({
    diff: fixture.diff,
    caseResearch: fixture.caseResearch,
    comparisonAvailable: fixture.caseResearch?.status !== "baseline" && fixture.caseResearch?.status !== "unavailable",
    comparisonReason: fixture.caseResearch?.message ?? null,
    dataQuality: { status: "complete" },
  });
  const result = selectTodaysSummaryInsight(normalized);
  assert.equal(result.status, expected.status);
  assert.equal(result.insightType, expected.insightType);
  assert.equal(result.metadata.selectionReason, expected.selectionReason);
  assert.deepEqual(result.metadata.candidateCounts, expected.candidateCounts);
}
