import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeTodaysSummaryInput } from "./todays-summary-input.js";
import { selectTodaysSummaryInsight } from "./todays-summary-selector.js";
import { buildTodaysSummaryContent } from "./todays-summary-content.js";

const PROHIBITED = [
  "原因です",
  "によって順位が上がった",
  "Bankrが評価した",
  "効果があります",
  "効きました",
  "公式ロジックでは",
  "必ず順位が上がる",
  "このカテゴリが重要です",
  "カテゴリは順位に関係しない",
  "明らかに",
];

function selection(overrides = {}) {
  return {
    status: "ready",
    insightType: "limited-movement",
    selectedSignals: { primary: null, secondary: null },
    metadata: {
      thresholdVersion: "v1",
      selectionReason: "no-higher-priority-signal",
      comparableUsers: 50,
      candidateCounts: {
        turnover: 0,
        largeRankRise: 0,
        strongMismatch: 0,
        weakMismatch: 0,
        largeOverallChange: 0,
        multiCategoryChange: 0,
      },
      ...overrides.metadata,
    },
    ...overrides,
  };
}

function turnoverSelection(primary, secondary) {
  return selection({
    insightType: "top50-turnover",
    selectedSignals: { primary, secondary },
    metadata: { selectionReason: "top50-turnover-detected", comparableUsers: 50 },
  });
}

function mismatchSelection(primary, strength = "weak") {
  return selection({
    insightType: "rank-category-mismatch",
    selectedSignals: { primary, secondary: null },
    metadata: {
      selectionReason: strength === "strong" ? "same-category-contrast" : "individual-rank-category-mismatch",
      mismatchStrength: strength,
      comparableUsers: 50,
    },
  });
}

function allText(content) {
  return [content.conclusion, content.evidencePrimary, content.evidenceSecondary, content.disclaimer].join("\n");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("top50-turnover handles entrants and exits", () => {
  const content = buildTodaysSummaryContent(turnoverSelection(
    { entrants: [{ username: "@New", currentRank: 43 }], exits: [{ username: "@Old", previousRank: 41 }], entrantCount: 1, exitCount: 1 },
    { username: "@New", currentRank: 43 },
  ));
  assert.equal(content.conclusion, "Top 50の構成に変化がありました。");
  assert.match(content.evidencePrimary, /新たに1アカウント/);
  assert.match(content.evidenceSecondary, /Newの43位/);
});

test("top50-turnover handles entrants only", () => {
  const content = buildTodaysSummaryContent(turnoverSelection(
    { entrants: [{ username: "OnlyNew", currentRank: 49 }], exits: [], entrantCount: 1, exitCount: 0 },
    { username: "OnlyNew", currentRank: 49 },
  ));
  assert.equal(content.evidencePrimary, "新たに1アカウントがTop 50へ入りました。");
});

test("top50-turnover handles exits only", () => {
  const content = buildTodaysSummaryContent(turnoverSelection(
    { entrants: [], exits: [{ username: "OnlyExit", previousRank: 40 }], entrantCount: 0, exitCount: 1 },
    { username: "OnlyExit", previousRank: 40 },
  ));
  assert.equal(content.evidencePrimary, "1アカウントがTop 50圏外となりました。");
  assert.match(content.evidenceSecondary, /OnlyExitの40位/);
});

test("large-rank-rise uses rank details", () => {
  const content = buildTodaysSummaryContent(selection({
    insightType: "large-rank-rise",
    selectedSignals: { primary: { username: "Mover", previousRank: 50, currentRank: 43, change: 7 }, secondary: null },
    metadata: { selectionReason: "rank-rise-gte-5" },
  }));
  assert.equal(content.evidencePrimary, "Moverが50位から43位へ、7ランク上昇しました。");
});

test("strong mismatch rankUp + rankDown", () => {
  const content = buildTodaysSummaryContent(mismatchSelection({
    categoryKey: "llmUsage",
    categoryLabel: "LLM Gateway",
    contrastTypes: ["rankUp+rankDown"],
  }, "strong"));
  assert.match(content.evidencePrimary, /LLM Gatewayが増加したユーザー/);
  assert.match(content.evidencePrimary, /上がった例と下がった例/);
});

test("strong mismatch rankUp + rankSame", () => {
  const content = buildTodaysSummaryContent(mismatchSelection({
    categoryKey: "developer",
    categoryLabel: "Builder",
    contrastTypes: ["rankUp+rankSame"],
  }, "strong"));
  assert.match(content.evidencePrimary, /Builderが増加したユーザー/);
  assert.match(content.evidencePrimary, /上がった例と変わらなかった例/);
});

test("weak mismatch increase + down", () => {
  const content = buildTodaysSummaryContent(mismatchSelection({
    username: "CaseA",
    categoryLabel: "Builder",
    categoryDirection: "increase",
    rankDirection: "down",
    rankChange: -1,
  }));
  assert.equal(content.evidencePrimary, "CaseAではBuilderの値が増加した一方、順位は1ランク下落しました。");
});

test("weak mismatch decrease + up", () => {
  const content = buildTodaysSummaryContent(mismatchSelection({
    username: "CaseB",
    categoryLabel: "LLM Gateway",
    categoryDirection: "decrease",
    rankDirection: "up",
    rankChange: 2,
  }));
  assert.equal(content.evidencePrimary, "CaseBではLLM Gatewayの値が減少した一方、順位は2ランク上昇しました。");
});

test("weak mismatch increase + same", () => {
  const content = buildTodaysSummaryContent(mismatchSelection({
    username: "CaseC",
    categoryLabel: "Builder",
    categoryDirection: "increase",
    rankDirection: "same",
    rankChange: 0,
  }));
  assert.equal(content.evidencePrimary, "CaseCではBuilderの値が増加しましたが、順位は変わりませんでした。");
});

test("large-overall-change uses shared overall formatter", () => {
  const content = buildTodaysSummaryContent(selection({
    insightType: "large-overall-change",
    selectedSignals: {
      primary: { username: "ScoreUser", previousValue: 0.1074585097, currentValue: 0.1107441824, change: 0.003285672 },
      secondary: null,
    },
    metadata: { selectionReason: "overall-increase-gte-0.001" },
  }));
  assert.equal(content.evidencePrimary, "ScoreUserのOverall Scoreが0.1075から0.1107へ増加しました。");
});

test("multi-category lists two categories", () => {
  const content = buildTodaysSummaryContent(selection({
    insightType: "multi-category-change",
    selectedSignals: {
      primary: {
        username: "Multi",
        changedCategoryCount: 2,
        categoryChanges: [{ categoryLabel: "Builder" }, { categoryLabel: "LLM Gateway" }],
      },
      secondary: null,
    },
    metadata: { selectionReason: "multiple-category-changes" },
  }));
  assert.equal(content.evidencePrimary, "MultiではBuilderとLLM Gatewayの2カテゴリが変化しました。");
});

test("multi-category uses count for four or more categories", () => {
  const content = buildTodaysSummaryContent(selection({
    insightType: "multi-category-change",
    selectedSignals: {
      primary: {
        username: "Many",
        changedCategoryCount: 4,
        categoryChanges: [
          { categoryLabel: "Builder" },
          { categoryLabel: "LLM Gateway" },
          { categoryLabel: "Deployer" },
          { categoryLabel: "$BNKR" },
        ],
      },
      secondary: null,
    },
  }));
  assert.equal(content.evidencePrimary, "Manyでは4カテゴリが変化しました。");
});

test("limited-movement uses comparableUsers 50", () => {
  const content = buildTodaysSummaryContent(selection());
  assert.match(content.evidenceSecondary, /比較可能な50件/);
});

test("limited-movement uses comparableUsers 49", () => {
  const content = buildTodaysSummaryContent(selection({ metadata: { comparableUsers: 49 } }));
  assert.match(content.evidenceSecondary, /比較可能な49件/);
});

test("baseline content is not normal change content", () => {
  const content = buildTodaysSummaryContent(selection({
    status: "baseline",
    insightType: "baseline",
    metadata: { selectionReason: "case-research-baseline", comparableUsers: 0 },
  }));
  assert.equal(content.conclusion, "初回Baselineを記録しました。");
  assert.match(content.disclaimer, /無効という意味ではありません/);
});

test("unavailable invalid", () => {
  const content = buildTodaysSummaryContent(selection({
    status: "unavailable",
    insightType: "unavailable",
    metadata: { selectionReason: "invalid-snapshot" },
  }));
  assert.match(content.evidencePrimary, /有効な比較条件/);
});

test("unavailable comparison", () => {
  const content = buildTodaysSummaryContent(selection({
    status: "unavailable",
    insightType: "unavailable",
    metadata: { selectionReason: "comparison-unavailable" },
  }));
  assert.match(content.evidencePrimary, /比較可能な前回Snapshot/);
});

test("unavailable insufficient users", () => {
  const content = buildTodaysSummaryContent(selection({
    status: "unavailable",
    insightType: "unavailable",
    metadata: { selectionReason: "insufficient-comparable-users" },
  }));
  assert.match(content.evidencePrimary, /ユーザー数が不足/);
});

test("username fallback", () => {
  const content = buildTodaysSummaryContent(selection({
    insightType: "large-rank-rise",
    selectedSignals: { primary: { previousRank: 10, currentRank: 5, change: 5 }, secondary: null },
  }));
  assert.match(content.evidencePrimary, /Unknown account/);
});

test("category fallback", () => {
  const content = buildTodaysSummaryContent(mismatchSelection({
    username: "CaseD",
    categoryDirection: "increase",
    rankDirection: "same",
    rankChange: 0,
  }));
  assert.match(content.evidencePrimary, /対象カテゴリ/);
});

test("rank fallback", () => {
  const content = buildTodaysSummaryContent(selection({
    insightType: "large-rank-rise",
    selectedSignals: { primary: { username: "Broken", currentRank: 5, change: 5 }, secondary: null },
  }));
  assert.equal(content.evidencePrimary, "順位上昇の詳細データが一部不足しています。");
});

test("invalid selector output falls back to unavailable", () => {
  const content = buildTodaysSummaryContent(null);
  assert.equal(content.status, "unavailable");
  assert.equal(content.insightType, "unavailable");
});

test("partial disclaimer is added for ready 40 to 49 users", () => {
  const content = buildTodaysSummaryContent(selection({ metadata: { comparableUsers: 49 } }));
  assert.match(content.disclaimer, /^比較可能な49件を対象とした要約です。/);
});

test("content does not include prohibited wording", () => {
  const samples = [
    buildTodaysSummaryContent(turnoverSelection({ entrants: [{ username: "New", currentRank: 50 }], exits: [], entrantCount: 1, exitCount: 0 }, { username: "New", currentRank: 50 })),
    buildTodaysSummaryContent(selection({ insightType: "large-rank-rise", selectedSignals: { primary: { username: "Mover", previousRank: 50, currentRank: 43, change: 7 }, secondary: null } })),
    buildTodaysSummaryContent(mismatchSelection({ username: "Case", categoryLabel: "Builder", categoryDirection: "increase", rankDirection: "down", rankChange: -1 })),
    buildTodaysSummaryContent(selection({ insightType: "limited-movement" })),
  ];
  for (const content of samples) {
    for (const phrase of PROHIBITED) assert.equal(allText(content).includes(phrase), false, phrase);
  }
});

test("same input produces identical output", () => {
  const input = selection({ insightType: "large-overall-change", selectedSignals: { primary: { username: "A", previousValue: 0.1, currentValue: 0.2 }, secondary: null } });
  assert.deepEqual(buildTodaysSummaryContent(input), buildTodaysSummaryContent(input));
});

test("all text fields are strings", () => {
  const content = buildTodaysSummaryContent(selection());
  for (const key of ["conclusion", "evidencePrimary", "evidenceSecondary", "disclaimer"]) {
    assert.equal(typeof content[key], "string");
  }
});

test("content generator does not mutate selector result", () => {
  const input = turnoverSelection(
    { entrants: [{ username: "B", currentRank: 2 }, { username: "A", currentRank: 1 }], exits: [], entrantCount: 2, exitCount: 0 },
    { username: "A", currentRank: 1 },
  );
  const before = clone(input);
  buildTodaysSummaryContent(input);
  assert.deepEqual(input, before);
});

test("overall formatter handles tiny values consistently", () => {
  const content = buildTodaysSummaryContent(selection({
    insightType: "large-overall-change",
    selectedSignals: {
      primary: { username: "Tiny", previousValue: 0.00003248, currentValue: 0.123456 },
      secondary: null,
    },
  }));
  assert.match(content.evidencePrimary, /0\.0000から0\.1235/);
});

test("fixture content can be generated without UI", () => {
  const research = fixtureContent("outputs/case-research-fixture.json");
  assert.equal(research.status, "ready");
  assert.equal(research.insightType, "top50-turnover");
  assert.match(research.conclusion, /Top 50/);

  const baseline = fixtureContent("outputs/case-research-baseline-fixture.json");
  assert.equal(baseline.status, "baseline");
  assert.equal(baseline.insightType, "baseline");
  assert.match(baseline.conclusion, /初回Baseline/);

  const realAb = fixtureContent("outputs/case-research-real-ab.json");
  assert.equal(realAb.status, "ready");
  assert.equal(realAb.insightType, "limited-movement");
  assert.match(realAb.conclusion, /限定的/);
});

function fixtureContent(filePath) {
  const fixture = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const normalized = normalizeTodaysSummaryInput({
    diff: fixture.diff,
    caseResearch: fixture.caseResearch,
    comparisonAvailable: fixture.caseResearch?.status !== "baseline" && fixture.caseResearch?.status !== "unavailable",
    comparisonReason: fixture.caseResearch?.message ?? null,
    dataQuality: { status: "complete" },
  });
  return buildTodaysSummaryContent(selectTodaysSummaryInsight(normalized));
}
