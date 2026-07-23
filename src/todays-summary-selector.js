const THRESHOLD_VERSION = "v1";
const LARGE_RANK_RISE_THRESHOLD = 5;
const LARGE_OVERALL_INCREASE_THRESHOLD = 0.0010;
const MULTI_CATEGORY_THRESHOLD = 2;
const MIN_COMPARABLE_USERS = 40;

/**
 * Select the single highest-priority Today’s Summary insight from normalized signals.
 *
 * candidateCounts.turnover counts individual entrant/exit rows rather than a
 * binary turnover event, so later phases can describe volume without rereading
 * the source diff.
 */
export function selectTodaysSummaryInsight(normalizedInput) {
  if (!isObject(normalizedInput) || !isObject(normalizedInput.state)) {
    return unavailableResult("invalid-normalized-input", zeroCandidateCounts(), 0);
  }

  const state = normalizedInput.state;
  const candidateCounts = buildCandidateCounts(normalizedInput);
  const comparableUsers = finiteNumber(state.comparableUsers) ?? 0;

  if (state.baseline === true) {
    return {
      status: "baseline",
      insightType: "baseline",
      selectedSignals: { primary: null, secondary: null },
      metadata: {
        thresholdVersion: THRESHOLD_VERSION,
        selectionReason: state.baselineReason ?? "baseline",
        comparableUsers,
        candidateCounts,
      },
    };
  }

  const unavailableReason = unavailableReasonForState(state, comparableUsers);
  if (unavailableReason) {
    return unavailableResult(unavailableReason, candidateCounts, comparableUsers);
  }

  const turnover = selectTurnover(normalizedInput);
  if (turnover) {
    return readyResult("top50-turnover", turnover.primary, turnover.secondary, "top50-turnover-detected", candidateCounts, comparableUsers);
  }

  const largeRankRise = selectLargeRankRise(normalizedInput);
  if (largeRankRise) {
    return readyResult("large-rank-rise", largeRankRise.primary, largeRankRise.secondary, "rank-rise-gte-5", candidateCounts, comparableUsers);
  }

  const strongMismatch = selectStrongMismatch(normalizedInput);
  if (strongMismatch) {
    return readyResult(
      "rank-category-mismatch",
      strongMismatch.primary,
      strongMismatch.secondary,
      "same-category-contrast",
      candidateCounts,
      comparableUsers,
      { mismatchStrength: "strong" },
    );
  }

  const weakMismatch = selectWeakMismatch(normalizedInput);
  if (weakMismatch) {
    return readyResult(
      "rank-category-mismatch",
      weakMismatch.primary,
      weakMismatch.secondary,
      "individual-rank-category-mismatch",
      candidateCounts,
      comparableUsers,
      { mismatchStrength: "weak" },
    );
  }

  const largeOverallChange = selectLargeOverallChange(normalizedInput);
  if (largeOverallChange) {
    return readyResult("large-overall-change", largeOverallChange.primary, largeOverallChange.secondary, "overall-increase-gte-0.001", candidateCounts, comparableUsers);
  }

  const multiCategoryChange = selectMultiCategoryChange(normalizedInput);
  if (multiCategoryChange) {
    return readyResult("multi-category-change", multiCategoryChange.primary, multiCategoryChange.secondary, "multiple-category-changes", candidateCounts, comparableUsers);
  }

  return readyResult(
    "limited-movement",
    {
      entrantCount: asArray(normalizedInput.turnover?.entrants).length,
      exitCount: asArray(normalizedInput.turnover?.exits).length,
      largeRankRiseCount: candidateCounts.largeRankRise,
      largeOverallChangeCount: candidateCounts.largeOverallChange,
      multiCategoryChangeCount: candidateCounts.multiCategoryChange,
    },
    null,
    "no-higher-priority-signal",
    candidateCounts,
    comparableUsers,
  );
}

function unavailableReasonForState(state, comparableUsers) {
  if (state.snapshotQuality === "invalid") return "invalid-snapshot";
  if (state.snapshotQuality === "unavailable") return "unavailable-snapshot";
  if (state.comparisonAvailable !== true) return "comparison-unavailable";
  if (comparableUsers < MIN_COMPARABLE_USERS) return "insufficient-comparable-users";
  return null;
}

function buildCandidateCounts(input) {
  return {
    turnover: asArray(input.turnover?.entrants).length + asArray(input.turnover?.exits).length,
    largeRankRise: largeRankRiseCandidates(input).length,
    strongMismatch: strongMismatchCandidates(input).length,
    weakMismatch: weakMismatchCandidates(input).length,
    largeOverallChange: largeOverallChangeCandidates(input).length,
    multiCategoryChange: multiCategoryCandidates(input).length,
  };
}

function zeroCandidateCounts() {
  return {
    turnover: 0,
    largeRankRise: 0,
    strongMismatch: 0,
    weakMismatch: 0,
    largeOverallChange: 0,
    multiCategoryChange: 0,
  };
}

function selectTurnover(input) {
  const entrants = asArray(input.turnover?.entrants).map(copyPlain).sort(compareEntrant);
  const exits = asArray(input.turnover?.exits).map(copyPlain).sort(compareExit);
  if (!entrants.length && !exits.length) return null;
  return {
    primary: {
      entrants,
      exits,
      entrantCount: entrants.length,
      exitCount: exits.length,
    },
    secondary: entrants[0] ?? exits[0] ?? null,
  };
}

function selectLargeRankRise(input) {
  const candidates = largeRankRiseCandidates(input).map(copyPlain).sort(compareLargeRankRise);
  if (!candidates.length) return null;
  return { primary: candidates[0], secondary: candidates[1] ?? null };
}

function selectStrongMismatch(input) {
  const candidates = strongMismatchCandidates(input).map(normalizeContrast).sort(compareStrongMismatch);
  if (!candidates.length) return null;
  return {
    primary: candidates[0],
    secondary: representativeContrastUsers(candidates[0]),
  };
}

function selectWeakMismatch(input) {
  const candidates = weakMismatchCandidates(input).map(copyPlain).sort(compareWeakMismatch);
  if (!candidates.length) return null;
  return { primary: candidates[0], secondary: candidates[1] ?? null };
}

function selectLargeOverallChange(input) {
  const candidates = largeOverallChangeCandidates(input).map(copyPlain).sort(compareOverallIncrease);
  if (!candidates.length) return null;
  return { primary: candidates[0], secondary: candidates[1] ?? null };
}

function selectMultiCategoryChange(input) {
  const candidates = multiCategoryCandidates(input).map(copyPlain).sort(compareMultiCategory);
  if (!candidates.length) return null;
  return { primary: candidates[0], secondary: candidates[1] ?? null };
}

function largeRankRiseCandidates(input) {
  return asArray(input.rankMovements)
    .filter((item) => item?.direction === "up")
    .filter((item) => (finiteNumber(item.change) ?? 0) >= LARGE_RANK_RISE_THRESHOLD);
}

function strongMismatchCandidates(input) {
  return asArray(input.mismatchCandidates?.sameCategoryContrasts)
    .filter((item) => preferredContrastType(item) !== null);
}

function weakMismatchCandidates(input) {
  return asArray(input.mismatchCandidates?.individualMismatches)
    .filter((item) => weakMismatchPriority(item) !== Number.MAX_SAFE_INTEGER);
}

function largeOverallChangeCandidates(input) {
  return asArray(input.overallChanges)
    .filter((item) => (finiteNumber(item.change) ?? 0) >= LARGE_OVERALL_INCREASE_THRESHOLD);
}

function multiCategoryCandidates(input) {
  return asArray(input.users)
    .filter((item) => (finiteNumber(item.changedCategoryCount) ?? 0) >= MULTI_CATEGORY_THRESHOLD);
}

function readyResult(insightType, primary, secondary, selectionReason, candidateCounts, comparableUsers, extraMetadata = {}) {
  return {
    status: "ready",
    insightType,
    selectedSignals: {
      primary: primary ?? null,
      secondary: secondary ?? null,
    },
    metadata: {
      thresholdVersion: THRESHOLD_VERSION,
      selectionReason,
      comparableUsers,
      candidateCounts,
      ...extraMetadata,
    },
  };
}

function unavailableResult(selectionReason, candidateCounts, comparableUsers) {
  return {
    status: "unavailable",
    insightType: "unavailable",
    selectedSignals: { primary: null, secondary: null },
    metadata: {
      thresholdVersion: THRESHOLD_VERSION,
      selectionReason,
      comparableUsers,
      candidateCounts,
    },
  };
}

function normalizeContrast(contrast) {
  const normalized = {
    ...copyPlain(contrast),
    rankUp: asArray(contrast.rankUp).map(copyPlain).sort(compareMismatchUser),
    rankDown: asArray(contrast.rankDown).map(copyPlain).sort(compareMismatchUser),
    rankSame: asArray(contrast.rankSame).map(copyPlain).sort(compareMismatchUser),
    contrastTypes: asArray(contrast.contrastTypes).map(String).sort(compareContrastType),
  };
  return normalized;
}

function representativeContrastUsers(contrast) {
  const type = preferredContrastType(contrast);
  if (type === "rankUp+rankDown") return [contrast.rankUp[0], contrast.rankDown[0]].filter(Boolean);
  if (type === "rankUp+rankSame") return [contrast.rankUp[0], contrast.rankSame[0]].filter(Boolean);
  if (type === "rankDown+rankSame") return [contrast.rankDown[0], contrast.rankSame[0]].filter(Boolean);
  return [];
}

function compareEntrant(a, b) {
  return compareRankValue(a.currentRank, b.currentRank) || compareUsername(a, b);
}

function compareExit(a, b) {
  return compareRankValue(a.previousRank, b.previousRank) || compareUsername(a, b);
}

function compareLargeRankRise(a, b) {
  return compareNumberDesc(a.change, b.change)
    || compareRankValue(a.currentRank, b.currentRank)
    || compareUsername(a, b);
}

function compareStrongMismatch(a, b) {
  return contrastTypePriority(preferredContrastType(a)) - contrastTypePriority(preferredContrastType(b))
    || compareBooleanDesc(hasScoreBasis(a), hasScoreBasis(b))
    || compareNumberDesc(maxContrastCategoryChange(a), maxContrastCategoryChange(b))
    || compareNumberDesc(maxContrastRankChange(a), maxContrastRankChange(b))
    || String(a.categoryKey ?? "").localeCompare(String(b.categoryKey ?? ""))
    || firstContrastUsername(a).localeCompare(firstContrastUsername(b));
}

function compareWeakMismatch(a, b) {
  return weakMismatchPriority(a) - weakMismatchPriority(b)
    || compareBooleanDesc(a.changeBasis === "score", b.changeBasis === "score")
    || compareNumberDesc(absCategoryChange(a), absCategoryChange(b))
    || compareNumberDesc(absFinite(a.rankChange), absFinite(b.rankChange))
    || compareRankValue(a.currentRank, b.currentRank)
    || String(a.categoryKey ?? "").localeCompare(String(b.categoryKey ?? ""))
    || compareUsername(a, b);
}

function compareOverallIncrease(a, b) {
  return compareNumberDesc(a.change, b.change)
    || compareRankValue(a.currentRank, b.currentRank)
    || compareUsername(a, b);
}

function compareMultiCategory(a, b) {
  return compareNumberDesc(a.changedCategoryCount, b.changedCategoryCount)
    || compareNumberDesc(scoreBasedCategoryCount(a), scoreBasedCategoryCount(b))
    || compareRankValue(a.currentRank, b.currentRank)
    || compareUsername(a, b);
}

function compareMismatchUser(a, b) {
  return compareNumberDesc(absCategoryChange(a), absCategoryChange(b))
    || compareNumberDesc(absFinite(a.rankChange), absFinite(b.rankChange))
    || compareUsername(a, b);
}

function compareContrastType(a, b) {
  return contrastTypePriority(a) - contrastTypePriority(b) || String(a).localeCompare(String(b));
}

function preferredContrastType(contrast) {
  const types = new Set(asArray(contrast?.contrastTypes).map(String));
  for (const type of ["rankUp+rankDown", "rankUp+rankSame", "rankDown+rankSame"]) {
    if (types.has(type)) return type;
  }
  return null;
}

function contrastTypePriority(type) {
  if (type === "rankUp+rankDown") return 0;
  if (type === "rankUp+rankSame") return 1;
  if (type === "rankDown+rankSame") return 2;
  return Number.MAX_SAFE_INTEGER;
}

function weakMismatchPriority(item) {
  if (item?.categoryDirection === "increase" && item?.rankDirection === "down") return 0;
  if (item?.categoryDirection === "decrease" && item?.rankDirection === "up") return 1;
  if (item?.categoryDirection === "increase" && item?.rankDirection === "same") return 2;
  return Number.MAX_SAFE_INTEGER;
}

function hasScoreBasis(contrast) {
  return [...asArray(contrast.rankUp), ...asArray(contrast.rankDown), ...asArray(contrast.rankSame)]
    .some((item) => item?.changeBasis === "score");
}

function maxContrastCategoryChange(contrast) {
  return Math.max(0, ...[...asArray(contrast.rankUp), ...asArray(contrast.rankDown), ...asArray(contrast.rankSame)].map(absCategoryChange));
}

function maxContrastRankChange(contrast) {
  return Math.max(0, ...[...asArray(contrast.rankUp), ...asArray(contrast.rankDown), ...asArray(contrast.rankSame)].map((item) => absFinite(item.rankChange)));
}

function firstContrastUsername(contrast) {
  const users = [...asArray(contrast.rankUp), ...asArray(contrast.rankDown), ...asArray(contrast.rankSame)]
    .map((item) => String(item?.username ?? ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return users[0] ?? "";
}

function scoreBasedCategoryCount(user) {
  return asArray(user.categoryChanges)
    .filter((change) => change?.changeBasis === "score")
    .filter((change) => (finiteNumber(change.scoreDiff) ?? 0) !== 0)
    .length;
}

function absCategoryChange(item) {
  if (item?.changeBasis === "score") return absFinite(item.scoreDiff);
  if (item?.changeBasis === "raw-fallback") return absFinite(item.rawDiff);
  return Math.max(absFinite(item?.scoreDiff), absFinite(item?.rawDiff));
}

function compareNumberDesc(a, b) {
  return (finiteNumber(b) ?? 0) - (finiteNumber(a) ?? 0);
}

function compareBooleanDesc(a, b) {
  return Number(Boolean(b)) - Number(Boolean(a));
}

function compareRankValue(a, b) {
  return (validRank(a) ? a : Number.MAX_SAFE_INTEGER) - (validRank(b) ? b : Number.MAX_SAFE_INTEGER);
}

function compareUsername(a, b) {
  return String(a?.username ?? "").localeCompare(String(b?.username ?? ""));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Object.is(number, -0) ? 0 : number;
}

function validRank(value) {
  return Number.isInteger(value) && value > 0;
}

function absFinite(value) {
  return Math.abs(finiteNumber(value) ?? 0);
}

function copyPlain(value) {
  if (!isObject(value)) return value;
  return structuredClone(value);
}
