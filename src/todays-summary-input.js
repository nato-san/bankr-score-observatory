const DEFAULT_CATEGORY_LABELS = {
  bnkr: "$BNKR",
  deployer: "Deployer",
  developer: "Builder",
  pnl: "PNL",
  referral: "Referral",
  nft: "NFTs",
  partner: "Ecosystem",
  llmUsage: "LLM Gateway",
  social: "Social",
  og: "OG",
};

/**
 * Normalize existing observation outputs into read-only Today’s Summary inputs.
 *
 * Later phases should use top-level categoryChanges for cross-user/category
 * search and mismatch selection. users[].categoryChanges is a grouped view
 * derived from the same categoryChanges array for per-user multi-category
 * checks; it should not become a second source of truth.
 */
export function normalizeTodaysSummaryInput(source = {}) {
  const diffUsers = Array.isArray(source.diff?.users) ? source.diff.users : [];
  const caseResearch = source.caseResearch ?? null;
  const categoryLabels = categoryLabelMap(caseResearch);
  const state = normalizeState(source, caseResearch, diffUsers);
  const diffRows = diffUsers.map((user, index) => normalizeDiffUser(user, index));
  const baseline = state.baseline;
  const turnover = extractTurnoverSignals(diffRows, baseline);
  const rankMovements = extractRankSignals(diffRows, baseline);
  const overallChanges = extractOverallSignals(diffRows, baseline);
  const caseRows = Array.isArray(caseResearch?.cases) ? caseResearch.cases : [];
  const categoryChanges = extractCategorySignals(caseRows, categoryLabels, baseline);
  const users = buildUserSignals(caseRows, diffRows, categoryChanges, baseline);
  const mismatchCandidates = extractMismatchSignals(categoryChanges, baseline);

  return {
    state,
    turnover,
    rankMovements,
    overallChanges,
    categoryChanges,
    users,
    mismatchCandidates,
  };
}

function normalizeState(source, caseResearch, diffUsers) {
  const qualityStatus = source.dataQuality?.status ?? source.dataQuality?.labelEn?.toLowerCase() ?? "unavailable";
  const caseSummary = caseResearch?.summary ?? {};
  const inferredComparisonAvailable = ["complete", "limited"].includes(caseResearch?.status);
  const comparisonAvailable = Boolean(
    source.comparisonAvailable ?? source.dataQuality?.metrics?.comparisonAvailable ?? inferredComparisonAvailable,
  );
  const baselineInfo = deriveBaselineInfo({
    source,
    caseResearch,
    diffUsers,
    comparisonAvailable,
    qualityStatus,
  });
  const baseline = baselineInfo.baseline;
  const comparisonReason = source.comparisonReason
    ?? (comparisonAvailable ? null : source.dataQuality?.reasons?.[0] ?? caseResearch?.message ?? null);

  return {
    snapshotQuality: qualityStatus,
    comparisonAvailable: baseline ? false : comparisonAvailable,
    comparisonReason,
    baseline,
    baselineReason: baselineInfo.reason,
    comparableUsers: finiteNumber(caseSummary.comparableUsers) ?? 0,
    partialUsers: finiteNumber(caseSummary.partialUsers) ?? 0,
    unavailableUsers: finiteNumber(caseSummary.unavailableUsers) ?? 0,
    currentOnlyUsers: finiteNumber(caseSummary.currentOnlyUsers) ?? 0,
  };
}

function deriveBaselineInfo({ source, caseResearch, diffUsers, comparisonAvailable, qualityStatus }) {
  const explicitQuality = source.dataQuality?.status != null || source.dataQuality?.labelEn != null;
  if (explicitQuality && ["invalid", "unavailable", "partial"].includes(qualityStatus)) {
    return { baseline: false, reason: null };
  }
  if (caseResearch?.status === "baseline") {
    return { baseline: true, reason: "case-research-baseline" };
  }

  const comparisonReason = source.comparisonReason ?? source.dataQuality?.reasons?.[0] ?? caseResearch?.message ?? "";
  if (!comparisonAvailable && isKnownBaselineReason(comparisonReason)) {
    return { baseline: true, reason: "no-previous-snapshot" };
  }
  if (!comparisonAvailable && isInitialCurrentOnlySet(diffUsers, caseResearch?.summary)) {
    return { baseline: true, reason: "initial-current-only-set" };
  }
  return { baseline: false, reason: null };
}

function isKnownBaselineReason(reason) {
  if (typeof reason !== "string") return false;
  const knownReasons = [
    "比較対象となる前回Snapshotはありません",
    "Previous Snapshotがないため日次比較はまだ評価できません。",
    "初回Baselineのためカテゴリ比較は次回Snapshotから利用可能です。",
    "Category baseline collected. Category changes and detected cases will be available after the next scheduled snapshot.",
    "カテゴリ比較用の初回データを保存しました。次回の正式Snapshotからカテゴリ変動を比較できます。",
  ];
  return knownReasons.some((knownReason) => reason.includes(knownReason));
}

function isInitialCurrentOnlySet(diffUsers, caseSummary) {
  if (!Array.isArray(diffUsers) || diffUsers.length !== 50) return false;
  const newUsers = diffUsers.filter((user) => user?.status === "new").length;
  const existingUsers = diffUsers.filter((user) => user?.status === "existing").length;
  const exitedUsers = diffUsers.filter((user) => user?.status === "exited").length;
  const currentOnlyUsers = finiteNumber(caseSummary?.currentOnlyUsers);
  return newUsers === 50
    && existingUsers === 0
    && exitedUsers === 0
    && (currentOnlyUsers === 50 || caseSummary == null);
}

function extractTurnoverSignals(diffRows, baseline) {
  if (baseline) return { entrants: [], exits: [] };
  const entrants = diffRows
    .filter((user) => user.status === "new" && validRank(user.currentRank))
    .map((user) => ({
      username: user.username,
      currentRank: user.currentRank,
    }))
    .sort(compareByRankThenUsername("currentRank"));
  const exits = diffRows
    .filter((user) => user.status === "exited" && validRank(user.previousRank))
    .map((user) => ({
      username: user.username,
      previousRank: user.previousRank,
    }))
    .sort(compareByRankThenUsername("previousRank"));
  return { entrants, exits };
}

function extractRankSignals(diffRows, baseline) {
  if (baseline) return [];
  return diffRows
    .filter((user) => user.status === "existing")
    .filter((user) => validRank(user.previousRank) && validRank(user.currentRank))
    .filter((user) => finiteNumber(user.rankChange) !== null && user.rankChange !== 0)
    .map((user) => ({
      username: user.username,
      previousRank: user.previousRank,
      currentRank: user.currentRank,
      change: user.rankChange,
      direction: rankDirection(user.rankChange),
    }))
    .sort(compareRankMovement);
}

function extractOverallSignals(diffRows, baseline) {
  if (baseline) return [];
  return diffRows
    .filter((user) => user.status === "existing")
    .map((user) => ({
      username: user.username,
      previousValue: finiteNumber(user.overallPrevious),
      currentValue: finiteNumber(user.overallCurrent),
      change: finiteNumber(user.overallChange),
      currentRank: validRank(user.currentRank) ? user.currentRank : null,
    }))
    .filter((user) => user.previousValue !== null && user.currentValue !== null && user.change !== null && user.change !== 0)
    .sort(compareOverallChange)
    .map(({ currentRank, ...user }) => user);
}

function extractCategorySignals(caseRows, categoryLabels, baseline) {
  if (baseline) return [];
  const rows = [];
  for (const item of caseRows) {
    const user = normalizeCaseUser(item);
    const rankChange = finiteNumber(item.rankDiff);
    const categoryEntries = Object.entries(item.categoryDiffs ?? {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [categoryKey, diff] of categoryEntries) {
      const scoreDiff = finiteNumber(diff?.scoreDiff);
      const rawDiff = finiteNumber(diff?.rawDiff);
      const hasScoreChange = scoreDiff !== null && scoreDiff !== 0;
      const hasRawChange = rawDiff !== null && rawDiff !== 0;
      if (!hasScoreChange && !hasRawChange) continue;

      const changeBasis = scoreDiff !== null ? "score" : rawDiff !== null ? "raw-fallback" : null;
      rows.push({
        username: user.username,
        userKey: user.key,
        categoryKey,
        categoryLabel: categoryLabels[categoryKey] ?? categoryKey,
        scoreDiff,
        rawDiff,
        comparisonStatus: diff?.comparisonStatus ?? "unavailable",
        rankChange,
        changeBasis,
        directionConflict: hasDirectionConflict(scoreDiff, rawDiff),
      });
    }
  }
  return rows.sort(compareCategoryChange);
}

function buildUserSignals(caseRows, diffRows, categoryChanges, baseline) {
  if (baseline) return [];
  const usersByKey = new Map();
  for (const item of caseRows) {
    const user = normalizeCaseUser(item);
    usersByKey.set(user.key, {
      username: user.username,
      userKey: user.key,
      rankChange: finiteNumber(item.rankDiff),
      changedCategoryCount: 0,
      changedCategoryKeys: [],
      categoryChanges: [],
    });
  }
  for (const user of diffRows) {
    const key = user.key;
    if (!usersByKey.has(key)) {
      usersByKey.set(key, {
        username: user.username,
        userKey: key,
        rankChange: finiteNumber(user.rankChange),
        changedCategoryCount: 0,
        changedCategoryKeys: [],
        categoryChanges: [],
      });
    }
  }
  for (const change of categoryChanges) {
    const user = usersByKey.get(change.userKey) ?? {
      username: change.username,
      userKey: change.userKey,
      rankChange: change.rankChange,
      changedCategoryCount: 0,
      changedCategoryKeys: [],
      categoryChanges: [],
    };
    user.categoryChanges.push(stripUserKey(change));
    usersByKey.set(change.userKey, user);
  }

  return [...usersByKey.values()]
    .map((user) => {
      const changedCategoryKeys = [...new Set(user.categoryChanges.map((change) => change.categoryKey))].sort();
      return {
        username: user.username,
        rankChange: user.rankChange,
        changedCategoryCount: changedCategoryKeys.length,
        changedCategoryKeys,
        categoryChanges: user.categoryChanges.sort(compareCategoryChangeForUser),
      };
    })
    .sort(compareUserSignal);
}

function extractMismatchSignals(categoryChanges, baseline) {
  if (baseline) return { sameCategoryContrasts: [], individualMismatches: [] };
  const eligible = categoryChanges
    .filter((change) => !change.directionConflict)
    .map((change) => ({
      ...change,
      primaryDiff: primaryCategoryDiff(change),
    }))
    .filter((change) => change.primaryDiff !== null && change.primaryDiff !== 0 && finiteNumber(change.rankChange) !== null);

  const individualMismatches = eligible
    .filter((change) => {
      const categoryDirection = change.primaryDiff > 0 ? "increase" : "decrease";
      const rank = rankDirection(change.rankChange);
      return (categoryDirection === "increase" && (rank === "down" || rank === "same"))
        || (categoryDirection === "decrease" && rank === "up");
    })
    .map((change) => ({
      username: change.username,
      categoryKey: change.categoryKey,
      categoryLabel: change.categoryLabel,
      categoryDirection: change.primaryDiff > 0 ? "increase" : "decrease",
      rankDirection: rankDirection(change.rankChange),
      rankChange: change.rankChange,
      changeBasis: change.changeBasis,
      scoreDiff: change.scoreDiff,
      rawDiff: change.rawDiff,
    }))
    .sort(compareMismatch);

  const grouped = new Map();
  for (const change of eligible) {
    const group = grouped.get(change.categoryKey) ?? {
      categoryKey: change.categoryKey,
      categoryLabel: change.categoryLabel,
      rankUp: [],
      rankDown: [],
      rankSame: [],
    };
    const direction = rankDirection(change.rankChange);
    if (direction === "up") group.rankUp.push(mismatchUser(change));
    if (direction === "down") group.rankDown.push(mismatchUser(change));
    if (direction === "same") group.rankSame.push(mismatchUser(change));
    grouped.set(change.categoryKey, group);
  }

  const sameCategoryContrasts = [...grouped.values()]
    .map((group) => ({
      ...group,
      rankUp: group.rankUp.sort(compareMismatchUser),
      rankDown: group.rankDown.sort(compareMismatchUser),
      rankSame: group.rankSame.sort(compareMismatchUser),
      contrastTypes: contrastTypes(group),
    }))
    .filter((group) => group.contrastTypes.length > 0)
    .sort((a, b) => a.categoryLabel.localeCompare(b.categoryLabel) || a.categoryKey.localeCompare(b.categoryKey));

  return { sameCategoryContrasts, individualMismatches };
}

function normalizeDiffUser(user, index) {
  const previousRank = finiteIntegerRank(user?.rank?.old);
  const currentRank = finiteIntegerRank(user?.rank?.new);
  const key = stableUserKey(user, index);
  return {
    key,
    username: normalizeUsername(user?.username, key),
    status: user?.status ?? "unknown",
    previousRank,
    currentRank,
    rankChange: finiteNumber(user?.rank?.change),
    overallPrevious: finiteNumber(user?.overallScore?.old),
    overallCurrent: finiteNumber(user?.overallScore?.new),
    overallChange: finiteNumber(user?.overallScore?.change),
  };
}

function normalizeCaseUser(item) {
  const key = stableUserKey(item, 0);
  return {
    key,
    username: normalizeUsername(item?.username, key),
  };
}

function stableUserKey(user, index) {
  if (user?.accountId) return `account:${String(user.accountId)}`;
  if (user?.profileUrl) return `profile:${String(user.profileUrl)}`;
  if (user?.caseId) return `case:${String(user.caseId)}`;
  if (user?.username) return `username:${String(user.username).toLowerCase()}`;
  const rankOld = user?.rank?.old ?? user?.rankBefore ?? "";
  const rankNew = user?.rank?.new ?? user?.rankAfter ?? "";
  return `unknown:${rankOld}:${rankNew}:${index}`;
}

function normalizeUsername(value, key) {
  if (typeof value === "string" && value.trim()) return value.trim().replace(/^@+/, "");
  const suffix = key?.startsWith("unknown:") ? ` ${key.split(":").slice(1).filter(Boolean).join("-")}` : "";
  return `Unknown account${suffix}`;
}

function categoryLabelMap(caseResearch) {
  const labels = { ...DEFAULT_CATEGORY_LABELS };
  for (const category of caseResearch?.categoryDefinitions ?? []) {
    if (category?.key && category?.label) labels[category.key] = category.label;
  }
  for (const ranking of Object.values(caseResearch?.categoryRankings ?? {})) {
    if (ranking?.key && ranking?.label) labels[ranking.key] = ranking.label;
  }
  return labels;
}

function finiteNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Object.is(number, -0) ? 0 : number;
}

function finiteIntegerRank(value) {
  const number = finiteNumber(value);
  if (number === null || !Number.isInteger(number) || number <= 0) return null;
  return number;
}

function validRank(value) {
  return Number.isInteger(value) && value > 0;
}

function rankDirection(change) {
  const value = finiteNumber(change);
  if (value === null || value === 0) return "same";
  return value > 0 ? "up" : "down";
}

function hasDirectionConflict(scoreDiff, rawDiff) {
  if (scoreDiff === null || rawDiff === null || scoreDiff === 0 || rawDiff === 0) return false;
  return Math.sign(scoreDiff) !== Math.sign(rawDiff);
}

function primaryCategoryDiff(change) {
  if (change.changeBasis === "score") return finiteNumber(change.scoreDiff);
  if (change.changeBasis === "raw-fallback") return finiteNumber(change.rawDiff);
  return null;
}

function stripUserKey(change) {
  const { userKey, ...rest } = change;
  return rest;
}

function mismatchUser(change) {
  return {
    username: change.username,
    rankChange: change.rankChange,
    changeBasis: change.changeBasis,
    scoreDiff: change.scoreDiff,
    rawDiff: change.rawDiff,
  };
}

function contrastTypes(group) {
  const types = [];
  if (group.rankUp.length && group.rankDown.length) types.push("rankUp+rankDown");
  if (group.rankUp.length && group.rankSame.length) types.push("rankUp+rankSame");
  if (group.rankDown.length && group.rankSame.length) types.push("rankDown+rankSame");
  return types;
}

function compareByRankThenUsername(rankKey) {
  return (a, b) => a[rankKey] - b[rankKey] || a.username.localeCompare(b.username);
}

function compareRankMovement(a, b) {
  return Math.abs(b.change) - Math.abs(a.change)
    || a.currentRank - b.currentRank
    || a.username.localeCompare(b.username);
}

function compareOverallChange(a, b) {
  return b.change - a.change
    || (a.currentRank ?? Number.MAX_SAFE_INTEGER) - (b.currentRank ?? Number.MAX_SAFE_INTEGER)
    || a.username.localeCompare(b.username);
}

function compareCategoryChange(a, b) {
  return a.categoryLabel.localeCompare(b.categoryLabel)
    || a.categoryKey.localeCompare(b.categoryKey)
    || a.username.localeCompare(b.username)
    || Math.abs(b.scoreDiff ?? b.rawDiff ?? 0) - Math.abs(a.scoreDiff ?? a.rawDiff ?? 0);
}

function compareCategoryChangeForUser(a, b) {
  return a.categoryLabel.localeCompare(b.categoryLabel)
    || a.categoryKey.localeCompare(b.categoryKey);
}

function compareUserSignal(a, b) {
  return b.changedCategoryCount - a.changedCategoryCount
    || Math.abs(b.rankChange ?? 0) - Math.abs(a.rankChange ?? 0)
    || a.username.localeCompare(b.username);
}

function compareMismatch(a, b) {
  return a.categoryLabel.localeCompare(b.categoryLabel)
    || a.username.localeCompare(b.username)
    || a.rankDirection.localeCompare(b.rankDirection);
}

function compareMismatchUser(a, b) {
  return a.username.localeCompare(b.username)
    || Math.abs(b.rankChange ?? 0) - Math.abs(a.rankChange ?? 0);
}
