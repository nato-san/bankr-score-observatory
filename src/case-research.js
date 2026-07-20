export const CASE_CATEGORY_DEFINITIONS = [
  { key: "bnkr", label: "$BNKR" },
  { key: "deployer", label: "Deployer" },
  { key: "developer", label: "Builder" },
  { key: "pnl", label: "PNL" },
  { key: "referral", label: "Referral" },
  { key: "nft", label: "NFTs" },
  { key: "partner", label: "Ecosystem" },
  { key: "llmUsage", label: "LLM Gateway" },
  { key: "social", label: "Social" },
  { key: "og", label: "OG" },
];

const RANKED_CATEGORY_KEYS = CASE_CATEGORY_DEFINITIONS
  .filter((category) => category.key !== "social")
  .map((category) => category.key);

const LEGACY_CATEGORY_LABELS = Object.fromEntries(
  CASE_CATEGORY_DEFINITIONS.map((category) => [category.label, category.key]),
);

function parseNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "—") return null;
  const match = trimmed.replace(/[$,\s]/g, "").match(/^([-+]?\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return amount * multiplier;
}

function roundDiff(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(10));
}

function numericDiff(before, after) {
  const oldValue = parseNumber(before);
  const newValue = parseNumber(after);
  return {
    before: oldValue,
    after: newValue,
    diff: oldValue == null || newValue == null ? null : roundDiff(newValue - oldValue),
  };
}

function normalizeUsername(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function accountIdFromProfileUrl(profileUrl) {
  if (typeof profileUrl !== "string") return null;
  return profileUrl.split("/").filter(Boolean).at(-1) || null;
}

function userKey(user) {
  if (user?.accountId) return `account:${String(user.accountId)}`;
  if (user?.profileUrl) return `profile:${String(user.profileUrl).trim()}`;
  if (user?.username) return `username:${String(user.username).trim().toLowerCase()}`;
  return null;
}

function normalizeScorePair(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { raw: null, score: null, available: false };
  }
  return {
    raw: parseNumber(value.raw),
    score: parseNumber(value.score),
    available: value.available !== false && (value.raw != null || value.score != null),
  };
}

export function normalizeProfile(profile) {
  if (!profile) return null;
  const accountId = profile.accountId ?? accountIdFromProfileUrl(profile.profileUrl);
  const categories = {};

  if (profile.categories && typeof profile.categories === "object") {
    for (const category of CASE_CATEGORY_DEFINITIONS) {
      categories[category.key] = normalizeScorePair(profile.categories[category.key]);
    }
  } else {
    for (const category of CASE_CATEGORY_DEFINITIONS) {
      const legacyValue = profile[category.label];
      // Legacy snapshots stored one display value from raw ?? score. Treat it as raw-like
      // for continuity, but keep API score unavailable since the original response split
      // was not kept.
      categories[category.key] = {
        raw: parseNumber(legacyValue),
        score: null,
        available: legacyValue != null && legacyValue !== "",
      };
    }
  }

  const overall = normalizeScorePair(profile.overall);
  const overallScore = parseNumber(profile.overallScore);

  return {
    rank: parseNumber(profile.rank),
    accountId,
    username: normalizeUsername(profile.username),
    profileUrl: profile.profileUrl ?? (accountId ? `https://bankr.bot/terminal/leaderboard/profile/x/${accountId}` : null),
    collectedAt: profile.collectedAt ?? null,
    overall: {
      raw: overall.raw ?? overallScore,
      score: overall.score ?? overallScore,
      available: overall.available || overallScore != null,
    },
    overallScore,
    categories,
    fetchStatus: profile.fetchStatus ?? null,
  };
}

function indexProfiles(profiles) {
  const index = new Map();
  for (const profile of profiles ?? []) {
    const normalized = normalizeProfile(profile);
    const key = userKey(normalized);
    if (key) index.set(key, normalized);
  }
  return index;
}

function emptyCategoryRankings() {
  return Object.fromEntries(
    CASE_CATEGORY_DEFINITIONS.map((category) => [
      category.key,
      {
        key: category.key,
        label: category.label,
        rawIncreases: [],
        rawDecreases: [],
        scoreIncreases: [],
        scoreDecreases: [],
      },
    ]),
  );
}

function hasComparableTop50Profiles(profiles) {
  if (!Array.isArray(profiles) || profiles.length < 50) return false;
  return profiles.filter((profile) => normalizeProfile(profile)?.fetchStatus?.complete !== false).length >= 50;
}

function diffCategory(oldProfile, newProfile, categoryKey) {
  const oldPair = oldProfile?.categories?.[categoryKey];
  const newPair = newProfile?.categories?.[categoryKey];
  const raw = numericDiff(oldPair?.raw, newPair?.raw);
  const score = numericDiff(oldPair?.score, newPair?.score);
  const hasOld = oldPair?.available && oldPair.raw != null;
  const hasNew = newPair?.available && newPair.raw != null;

  if (!oldProfile || !newProfile || !hasOld || !hasNew) {
    return {
      rawBefore: hasOld ? oldPair.raw : null,
      rawAfter: hasNew ? newPair.raw : null,
      rawDiff: null,
      scoreBefore: oldPair?.score ?? null,
      scoreAfter: newPair?.score ?? null,
      scoreDiff: score.diff,
      comparisonStatus: "unavailable",
    };
  }

  return {
    rawBefore: raw.before,
    rawAfter: raw.after,
    rawDiff: raw.diff,
    scoreBefore: score.before,
    scoreAfter: score.after,
    scoreDiff: score.diff,
    comparisonStatus: "complete",
  };
}

function rankDiff(oldRank, newRank) {
  const oldParsed = parseNumber(oldRank);
  const newParsed = parseNumber(newRank);
  return oldParsed == null || newParsed == null ? null : oldParsed - newParsed;
}

function overallDiff(oldProfile, newProfile) {
  const oldValue = oldProfile?.overallScore ?? oldProfile?.overall?.score ?? oldProfile?.overall?.raw;
  const newValue = newProfile?.overallScore ?? newProfile?.overall?.score ?? newProfile?.overall?.raw;
  return numericDiff(oldValue, newValue).diff;
}

function dataCompleteness(oldProfile, newProfile, categoryDiffs) {
  if (!newProfile) return "unavailable";
  if (!oldProfile) return "current-only";
  const oldComplete = oldProfile.fetchStatus ? oldProfile.fetchStatus.complete === true : true;
  const newComplete = newProfile.fetchStatus ? newProfile.fetchStatus.complete === true : true;
  const hasUnavailable = Object.values(categoryDiffs).some((diff) => diff.comparisonStatus !== "complete");
  if (oldComplete && newComplete && !hasUnavailable) return "complete";
  return "partial";
}

function sortByAbsDiff(items, accessor, limit) {
  return [...items]
    .filter((item) => {
      const value = accessor(item);
      return value != null && value !== 0;
    })
    .sort((a, b) => Math.abs(accessor(b)) - Math.abs(accessor(a)))
    .slice(0, limit);
}

function addReason(caseMap, base, reason, notableChange = null) {
  const key = base.key;
  if (!caseMap.has(key)) {
    caseMap.set(key, {
      caseId: `case-${String(base.accountId ?? base.username ?? key).replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`,
      accountId: base.accountId ?? null,
      username: base.username ?? null,
      observationFrom: base.observationFrom ?? null,
      observationTo: base.observationTo ?? null,
      rankBefore: base.rankBefore ?? null,
      rankAfter: base.rankAfter ?? null,
      rankDiff: base.rankDiff ?? null,
      overallBefore: base.overallBefore ?? null,
      overallAfter: base.overallAfter ?? null,
      overallDiff: base.overallDiff ?? null,
      categoryDiffs: base.categoryDiffs ?? {},
      detectionReasons: [],
      notableVisibleChanges: [],
      dataCompleteness: base.dataCompleteness ?? "unavailable",
      status: "unreviewed",
    });
  }

  const item = caseMap.get(key);
  if (!item.detectionReasons.includes(reason)) item.detectionReasons.push(reason);
  if (notableChange) {
    const notableKey = `${notableChange.category}:${notableChange.direction}:${notableChange.categoryRank}`;
    if (!item.notableVisibleChanges.some((change) => `${change.category}:${change.direction}:${change.categoryRank}` === notableKey)) {
      item.notableVisibleChanges.push(notableChange);
    }
  }
}

function caseBase({ key, oldProfile, newProfile, userDiff, categoryDiffs, observationFrom, observationTo }) {
  return {
    key,
    accountId: newProfile?.accountId ?? oldProfile?.accountId ?? null,
    username: newProfile?.username ?? oldProfile?.username ?? userDiff?.username ?? null,
    observationFrom,
    observationTo,
    rankBefore: oldProfile?.rank ?? userDiff?.rank?.old ?? null,
    rankAfter: newProfile?.rank ?? userDiff?.rank?.new ?? null,
    rankDiff: userDiff?.rank?.change ?? rankDiff(oldProfile?.rank, newProfile?.rank),
    overallBefore: oldProfile?.overallScore ?? oldProfile?.overall?.score ?? userDiff?.overallScore?.old ?? null,
    overallAfter: newProfile?.overallScore ?? newProfile?.overall?.score ?? userDiff?.overallScore?.new ?? null,
    overallDiff: userDiff?.overallScore?.change ?? overallDiff(oldProfile, newProfile),
    categoryDiffs,
    dataCompleteness: dataCompleteness(oldProfile, newProfile, categoryDiffs),
  };
}

function buildCategoryRankings(comparableCases) {
  const rankings = {};

  for (const category of CASE_CATEGORY_DEFINITIONS) {
    const rawItems = comparableCases
      .map((item) => ({
        ...item,
        category: category.key,
        categoryLabel: category.label,
        diff: item.categoryDiffs[category.key],
      }))
      .filter((item) => item.diff?.comparisonStatus === "complete" && item.diff.rawDiff != null && item.diff.rawDiff !== 0);

    const scoreItems = comparableCases
      .map((item) => ({
        ...item,
        category: category.key,
        categoryLabel: category.label,
        diff: item.categoryDiffs[category.key],
      }))
      .filter((item) => item.diff?.comparisonStatus === "complete" && item.diff.scoreDiff != null && item.diff.scoreDiff !== 0);

    rankings[category.key] = {
      key: category.key,
      label: category.label,
      rawIncreases: rawItems.filter((item) => item.diff.rawDiff > 0).sort((a, b) => b.diff.rawDiff - a.diff.rawDiff).slice(0, 5),
      rawDecreases: rawItems.filter((item) => item.diff.rawDiff < 0).sort((a, b) => a.diff.rawDiff - b.diff.rawDiff).slice(0, 5),
      scoreIncreases: scoreItems.filter((item) => item.diff.scoreDiff > 0).sort((a, b) => b.diff.scoreDiff - a.diff.scoreDiff).slice(0, 5),
      scoreDecreases: scoreItems.filter((item) => item.diff.scoreDiff < 0).sort((a, b) => a.diff.scoreDiff - b.diff.scoreDiff).slice(0, 5),
    };
  }

  return rankings;
}

function keyFromDiffUser(user) {
  if (user.accountId) return `account:${user.accountId}`;
  if (user.profileUrl) return `profile:${user.profileUrl}`;
  if (user.username) return `username:${String(user.username).toLowerCase()}`;
  return null;
}

export function buildCaseResearch({
  oldProfiles = [],
  newProfiles = [],
  diff = null,
  observationFrom = null,
  observationTo = null,
} = {}) {
  if (newProfiles.length >= 50 && !hasComparableTop50Profiles(oldProfiles)) {
    return {
      status: "baseline",
      generatedAt: new Date().toISOString(),
      observationFrom,
      observationTo,
      categoryDefinitions: CASE_CATEGORY_DEFINITIONS,
      message: "Category baseline collected. Category changes and detected cases will be available after the next scheduled snapshot.",
      jaMessage: "カテゴリ比較用の初回データを保存しました。次回の正式Snapshotからカテゴリ変動を比較できます。",
      summary: {
        capturedUsers: newProfiles.length,
        comparableUsers: 0,
        completeUsers: 0,
        partialUsers: 0,
        currentOnlyUsers: newProfiles.length,
        unavailableUsers: 0,
        detectedCases: 0,
      },
      categoryRankings: emptyCategoryRankings(),
      cases: [],
    };
  }

  const oldIndex = indexProfiles(oldProfiles);
  const newIndex = indexProfiles(newProfiles);
  const diffIndex = new Map((diff?.users ?? []).map((user) => [keyFromDiffUser(user), user]).filter(([key]) => key));
  const keys = [...new Set([...oldIndex.keys(), ...newIndex.keys(), ...diffIndex.keys()])];
  const comparableCases = keys.map((key) => {
    const oldProfile = oldIndex.get(key);
    const newProfile = newIndex.get(key);
    const userDiff = diffIndex.get(key);
    const categoryDiffs = Object.fromEntries(
      CASE_CATEGORY_DEFINITIONS.map((category) => [category.key, diffCategory(oldProfile, newProfile, category.key)]),
    );
    return caseBase({ key, oldProfile, newProfile, userDiff, categoryDiffs, observationFrom, observationTo });
  });

  const categoryRankings = buildCategoryRankings(comparableCases);
  const caseMap = new Map();

  for (const item of sortByAbsDiff(comparableCases, (candidate) => candidate.overallDiff, 5)) {
    addReason(caseMap, item, "top-overall-change");
  }
  for (const item of sortByAbsDiff(comparableCases, (candidate) => candidate.rankDiff, 5)) {
    addReason(caseMap, item, "top-rank-change");
  }

  for (const categoryKey of RANKED_CATEGORY_KEYS) {
    for (const [direction, rows] of [
      ["increase", categoryRankings[categoryKey].rawIncreases.slice(0, 3)],
      ["decrease", categoryRankings[categoryKey].rawDecreases.slice(0, 3)],
    ]) {
      rows.forEach((item, index) => {
        addReason(caseMap, item, `top-${categoryKey}-raw-${direction}`, {
          category: categoryKey,
          categoryLabel: categoryRankings[categoryKey].label,
          direction,
          rawDiff: item.diff.rawDiff,
          categoryRank: index + 1,
        });
      });
    }
  }

  for (const user of diff?.users ?? []) {
    if (user.status !== "new") continue;
    const key = keyFromDiffUser(user);
    const item = comparableCases.find((candidate) => candidate.key === key) ?? {
      key,
      username: user.username,
      rankAfter: user.rank?.new ?? null,
      overallAfter: user.overallScore?.new ?? null,
      dataCompleteness: "current-only",
      categoryDiffs: {},
    };
    addReason(caseMap, item, "entered-top50");
  }

  for (const item of comparableCases) {
    const existing = caseMap.get(item.key);
    if (!existing) continue;
    const changedCategories = Object.entries(item.categoryDiffs)
      .filter(([, value]) => value.comparisonStatus === "complete" && value.rawDiff != null && value.rawDiff !== 0)
      .map(([key]) => key);
    const scoreChanged = Object.values(item.categoryDiffs).some((value) => value.comparisonStatus === "complete" && value.scoreDiff != null && value.scoreDiff !== 0);
    if (changedCategories.length > 1) addReason(caseMap, item, "multiple-category-raw-changes");
    if (scoreChanged) addReason(caseMap, item, "api-score-change");
    if (item.rankDiff) addReason(caseMap, item, "rank-change");
  }

  const completeUsers = comparableCases.filter((item) => item.dataCompleteness === "complete").length;
  const currentOnlyUsers = comparableCases.filter((item) => item.dataCompleteness === "current-only").length;
  const partialUsers = comparableCases.filter((item) => item.dataCompleteness === "partial").length;
  const unavailableUsers = comparableCases.filter((item) => item.dataCompleteness === "unavailable").length;
  const status =
    oldProfiles.length && newProfiles.length
      ? partialUsers || currentOnlyUsers
        ? "limited"
        : "complete"
      : newProfiles.length
        ? "unavailable"
        : "unavailable";

  return {
    status,
    generatedAt: new Date().toISOString(),
    observationFrom,
    observationTo,
    categoryDefinitions: CASE_CATEGORY_DEFINITIONS,
    summary: {
      comparableUsers: comparableCases.filter((item) => item.dataCompleteness === "complete" || item.dataCompleteness === "partial").length,
      completeUsers,
      partialUsers,
      currentOnlyUsers,
      unavailableUsers,
      detectedCases: caseMap.size,
    },
    categoryRankings,
    cases: [...caseMap.values()].sort((a, b) => {
      const completenessOrder = { complete: 0, partial: 1, "current-only": 2, unavailable: 3 };
      const aMulti = a.detectionReasons.length > 1 ? 1 : 0;
      const bMulti = b.detectionReasons.length > 1 ? 1 : 0;
      const aCategoryFirst = a.notableVisibleChanges.some((change) => change.categoryRank === 1) ? 1 : 0;
      const bCategoryFirst = b.notableVisibleChanges.some((change) => change.categoryRank === 1) ? 1 : 0;
      const aRankOnly = a.detectionReasons.every((reason) => reason === "top-rank-change" || reason === "rank-change") ? 1 : 0;
      const bRankOnly = b.detectionReasons.every((reason) => reason === "top-rank-change" || reason === "rank-change") ? 1 : 0;
      return bMulti - aMulti
        || bCategoryFirst - aCategoryFirst
        || Math.abs(b.overallDiff ?? 0) - Math.abs(a.overallDiff ?? 0)
        || aRankOnly - bRankOnly
        || (completenessOrder[a.dataCompleteness] ?? 9) - (completenessOrder[b.dataCompleteness] ?? 9)
        || Math.abs(b.overallDiff ?? 0) - Math.abs(a.overallDiff ?? 0)
        || Math.abs(b.rankDiff ?? 0) - Math.abs(a.rankDiff ?? 0);
    }),
  };
}

export function categoryKeyFromLabel(label) {
  return LEGACY_CATEGORY_LABELS[label] ?? null;
}
