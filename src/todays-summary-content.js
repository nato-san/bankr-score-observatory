import { formatOverallScore } from "./display-formatters.js";

const TEMPLATE_VERSION = "v1";

export function buildTodaysSummaryContent(selection) {
  if (!isObject(selection)) return buildUnavailableContent(selection, "invalid-normalized-input");

  const status = safeStatus(selection.status);
  const insightType = safeInsightType(selection.insightType, status);
  const metadataBase = {
    templateVersion: TEMPLATE_VERSION,
    sourceSelectionReason: stringOrFallback(selection.metadata?.selectionReason, "unknown"),
    selectedUsernames: [],
    selectedCategoryKeys: [],
  };

  const content = buildContentByType(selection, status, insightType);
  const metadata = {
    ...metadataBase,
    selectedUsernames: collectSelectedUsernames(selection),
    selectedCategoryKeys: collectSelectedCategoryKeys(selection),
    ...content.metadata,
  };

  return {
    status,
    insightType,
    conclusion: content.conclusion,
    evidencePrimary: content.evidencePrimary,
    evidenceSecondary: content.evidenceSecondary,
    disclaimer: withPartialDisclaimer(content.disclaimer, selection),
    metadata,
  };
}

function buildContentByType(selection, status, insightType) {
  if (status === "baseline" || insightType === "baseline") return buildBaselineContent();
  if (status === "unavailable" || insightType === "unavailable") return buildUnavailableContent(selection);
  if (insightType === "top50-turnover") return buildTurnoverContent(selection);
  if (insightType === "large-rank-rise") return buildLargeRankRiseContent(selection);
  if (insightType === "rank-category-mismatch") return buildMismatchContent(selection);
  if (insightType === "large-overall-change") return buildOverallContent(selection);
  if (insightType === "multi-category-change") return buildMultiCategoryContent(selection);
  if (insightType === "limited-movement") return buildLimitedMovementContent(selection);
  return buildUnavailableContent(selection, "invalid-normalized-input");
}

function buildTurnoverContent(selection) {
  const primary = selection.selectedSignals?.primary ?? {};
  const secondary = selection.selectedSignals?.secondary ?? null;
  const entrantCount = nonNegativeInteger(primary.entrantCount) ?? asArray(primary.entrants).length;
  const exitCount = nonNegativeInteger(primary.exitCount) ?? asArray(primary.exits).length;

  let evidencePrimary = "Top 50の構成変化が確認されました。";
  if (entrantCount > 0 && exitCount > 0) {
    evidencePrimary = `新たに${entrantCount}アカウントがTop 50へ入り、${exitCount}アカウントが圏外となりました。`;
  } else if (entrantCount > 0) {
    evidencePrimary = `新たに${entrantCount}アカウントがTop 50へ入りました。`;
  } else if (exitCount > 0) {
    evidencePrimary = `${exitCount}アカウントがTop 50圏外となりました。`;
  }

  let evidenceSecondary = "今回の入替件数は公開Leaderboardの比較から確認しています。";
  if (validRank(secondary?.currentRank)) {
    evidenceSecondary = `新規参加のうち最上位は${username(secondary?.username)}の${secondary.currentRank}位でした。`;
  } else if (validRank(secondary?.previousRank)) {
    evidenceSecondary = `退出したアカウントのうち、前回最上位は${username(secondary?.username)}の${secondary.previousRank}位でした。`;
  }

  return {
    conclusion: "Top 50の構成に変化がありました。",
    evidencePrimary,
    evidenceSecondary,
    disclaimer: "Top 50への新規参加・退出は観測事実であり、その理由を示すものではありません。",
    metadata: {},
  };
}

function buildLargeRankRiseContent(selection) {
  const primary = selection.selectedSignals?.primary ?? {};
  return {
    conclusion: "本日は大きな順位上昇が確認されました。",
    evidencePrimary: rankRiseSentence(primary),
    evidenceSecondary: selection.selectedSignals?.secondary
      ? "次に大きい上昇も確認されましたが、主な動きは上記のケースです。"
      : "今回のTop 50比較では、この上昇幅が最大でした。",
    disclaimer: "公開Leaderboardの観測であり、順位上昇の理由を断定するものではありません。",
    metadata: {},
  };
}

function buildMismatchContent(selection) {
  if (selection.metadata?.mismatchStrength === "strong") return buildStrongMismatchContent(selection);
  return buildWeakMismatchContent(selection);
}

function buildStrongMismatchContent(selection) {
  const primary = selection.selectedSignals?.primary ?? {};
  const category = categoryLabel(primary);
  const contrastType = preferredContrastType(primary);
  let evidencePrimary = `${category}が変化したユーザーの中で、順位方向の違いが確認されました。`;
  if (contrastType === "rankUp+rankDown") {
    evidencePrimary = `${category}が増加したユーザーの中で、順位が上がった例と下がった例の両方が確認されました。`;
  }
  if (contrastType === "rankUp+rankSame") {
    evidencePrimary = `${category}が増加したユーザーの中で、順位が上がった例と変わらなかった例が確認されました。`;
  }
  if (contrastType === "rankDown+rankSame") {
    evidencePrimary = `${category}が増加したユーザーの中で、順位が下がった例と変わらなかった例が確認されました。`;
  }
  return {
    conclusion: "カテゴリ成長と順位上昇は必ずしも一致しませんでした。",
    evidencePrimary,
    evidenceSecondary: "公開データ上、単一カテゴリの増加だけでは順位変動との一貫した関係を確認できませんでした。",
    disclaimer: "公開データ上の比較であり、カテゴリ変化と順位変動の因果関係を示すものではありません。",
    metadata: {},
  };
}

function buildWeakMismatchContent(selection) {
  const primary = selection.selectedSignals?.primary ?? {};
  return {
    conclusion: "カテゴリ変化と順位変動の方向が一致しないケースが確認されました。",
    evidencePrimary: weakMismatchSentence(primary),
    evidenceSecondary: "この1例だけで、カテゴリと順位の一般的な関係を判断することはできません。",
    disclaimer: "公開データ上の比較であり、カテゴリ変化と順位変動の因果関係を示すものではありません。",
    metadata: {},
  };
}

function buildOverallContent(selection) {
  const primary = selection.selectedSignals?.primary ?? {};
  const hasValues = finiteNumber(primary.previousValue) !== null && finiteNumber(primary.currentValue) !== null;
  return {
    conclusion: "本日はOverall Scoreに目立つ増加が確認されました。",
    evidencePrimary: hasValues
      ? `${username(primary.username)}のOverall Scoreが${formatOverallScore(primary.previousValue)}から${formatOverallScore(primary.currentValue)}へ増加しました。`
      : "Overall Score増加の詳細データが一部不足しています。",
    evidenceSecondary: "今回の比較対象内では、最大の増加でした。",
    disclaimer: "公開Leaderboardの観測であり、Overall Score増加の理由を示すものではありません。",
    metadata: {},
  };
}

function buildMultiCategoryContent(selection) {
  const primary = selection.selectedSignals?.primary ?? {};
  const count = nonNegativeInteger(primary.changedCategoryCount) ?? asArray(primary.categoryChanges).length;
  return {
    conclusion: "複数カテゴリが同時に変化したケースが確認されました。",
    evidencePrimary: multiCategorySentence(primary, count),
    evidenceSecondary: "各カテゴリの変化と順位変動の関係は、公開データだけでは断定できません。",
    disclaimer: "複数カテゴリの同時変化は観測事実であり、順位変動の理由を示すものではありません。",
    metadata: {},
  };
}

function buildLimitedMovementContent(selection) {
  const comparableUsers = nonNegativeInteger(selection.metadata?.comparableUsers) ?? 50;
  return {
    conclusion: "本日のTop 50では、大きな変動は限定的でした。",
    evidencePrimary: "Top 50の新規参加・退出はありませんでした。",
    evidenceSecondary: `比較可能な${comparableUsers}件の中で、5ランク以上の順位上昇は確認されませんでした。`,
    disclaimer: "小さな変化まで否定するものではなく、今回の基準で大きな動きが確認されなかったことを示しています。",
    metadata: {},
  };
}

function buildBaselineContent() {
  return {
    conclusion: "初回Baselineを記録しました。",
    evidencePrimary: "比較元となる前回Snapshotがないため、日次変化の要約はまだ生成できません。",
    evidenceSecondary: "次回以降の観測から、順位・Overall Score・カテゴリ変化の比較が可能になります。",
    disclaimer: "現在のSnapshot自体が無効という意味ではありません。",
    metadata: {},
  };
}

function buildUnavailableContent(selection, forcedReason = null) {
  const reason = forcedReason ?? selection?.metadata?.selectionReason;
  return {
    status: "unavailable",
    insightType: "unavailable",
    conclusion: "今日の要約は利用できません。",
    evidencePrimary: unavailablePrimary(reason),
    evidenceSecondary: "データ不足を変化なしとして扱っていません。",
    disclaimer: "Snapshotの取得状態と日次比較の可否は別々に確認してください。",
    metadata: {},
  };
}

function unavailablePrimary(reason) {
  if (reason === "invalid-snapshot") return "現在の観測データが有効な比較条件を満たしていません。";
  if (reason === "unavailable-snapshot") return "必要なSnapshotデータが利用できません。";
  if (reason === "comparison-unavailable") return "比較可能な前回Snapshotがないため、日次変化を判定できません。";
  if (reason === "insufficient-comparable-users") return "比較可能なユーザー数が不足しているため、安全な要約を生成できません。";
  if (reason === "invalid-normalized-input") return "要約に必要な入力データが不足しています。";
  return "日次変化を安全に判定するための条件が不足しています。";
}

function rankRiseSentence(signal) {
  const previousRank = positiveInteger(signal.previousRank);
  const currentRank = positiveInteger(signal.currentRank);
  const change = positiveInteger(signal.change);
  if (previousRank === null || currentRank === null || change === null) {
    return "順位上昇の詳細データが一部不足しています。";
  }
  return `${username(signal.username)}が${previousRank}位から${currentRank}位へ、${change}ランク上昇しました。`;
}

function weakMismatchSentence(signal) {
  const name = username(signal.username);
  const category = categoryLabel(signal);
  const rankChange = finiteNumber(signal.rankChange);
  const movement = rankMovementText(rankChange);
  if (signal.categoryDirection === "increase" && signal.rankDirection === "down") {
    return `${name}では${category}の値が増加した一方、順位は${movement}。`;
  }
  if (signal.categoryDirection === "decrease" && signal.rankDirection === "up") {
    return `${name}では${category}の値が減少した一方、順位は${movement}。`;
  }
  if (signal.categoryDirection === "increase" && signal.rankDirection === "same") {
    return `${name}では${category}の値が増加しましたが、順位は変わりませんでした。`;
  }
  return `${name}では${category}の変化と順位変動の方向が一致しませんでした。`;
}

function rankMovementText(rankChange) {
  if (rankChange === null) return "詳細データが一部不足しています";
  if (rankChange > 0) return `${Math.abs(rankChange)}ランク上昇しました`;
  if (rankChange < 0) return `${Math.abs(rankChange)}ランク下落しました`;
  return "変わりませんでした";
}

function multiCategorySentence(signal, count) {
  const name = username(signal.username);
  const labels = uniqueLabels(asArray(signal.categoryChanges).map(categoryLabel).filter(Boolean));
  if (count >= 4) return `${name}では${count}カテゴリが変化しました。`;
  if (labels.length >= 2) return `${name}では${joinJapaneseList(labels.slice(0, 3))}の${count}カテゴリが変化しました。`;
  if (count > 0) return `${name}では${count}カテゴリが変化しました。`;
  return "複数カテゴリ変化の詳細データが一部不足しています。";
}

function withPartialDisclaimer(disclaimer, selection) {
  if (selection?.status !== "ready") return disclaimer;
  const comparableUsers = nonNegativeInteger(selection.metadata?.comparableUsers);
  if (comparableUsers === null || comparableUsers >= 50 || comparableUsers < 40) return disclaimer;
  return `比較可能な${comparableUsers}件を対象とした要約です。一部データは比較対象外です。${disclaimer}`;
}

function collectSelectedUsernames(selection) {
  const values = [];
  collectFromValue(selection?.selectedSignals?.primary, "username", values);
  collectFromValue(selection?.selectedSignals?.secondary, "username", values);
  return [...new Set(values.map(username).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function collectSelectedCategoryKeys(selection) {
  const values = [];
  collectFromValue(selection?.selectedSignals?.primary, "categoryKey", values);
  collectFromValue(selection?.selectedSignals?.secondary, "categoryKey", values);
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))]
    .sort((a, b) => a.localeCompare(b));
}

function collectFromValue(value, key, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectFromValue(item, key, output);
    return;
  }
  if (!isObject(value)) return;
  if (value[key] != null) output.push(value[key]);
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) collectFromValue(nested, key, output);
  }
}

function safeStatus(value) {
  if (value === "ready" || value === "baseline" || value === "unavailable") return value;
  return "unavailable";
}

function safeInsightType(value, status) {
  if (status === "baseline") return "baseline";
  if (status === "unavailable") return "unavailable";
  return typeof value === "string" && value.trim() ? value : "unavailable";
}

function stringOrFallback(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function username(value) {
  if (typeof value === "string" && value.trim()) return value.trim().replace(/^@+/, "");
  return "Unknown account";
}

function categoryLabel(value) {
  if (typeof value?.categoryLabel === "string" && value.categoryLabel.trim()) return value.categoryLabel.trim();
  return "対象カテゴリ";
}

function preferredContrastType(signal) {
  const types = new Set(asArray(signal.contrastTypes).map(String));
  for (const type of ["rankUp+rankDown", "rankUp+rankSame", "rankDown+rankSame"]) {
    if (types.has(type)) return type;
  }
  return null;
}

function joinJapaneseList(values) {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]}と${values[1]}`;
  return `${values.slice(0, -1).join("、")}と${values.at(-1)}`;
}

function uniqueLabels(values) {
  return [...new Set(values)];
}

function positiveInteger(value) {
  const number = finiteNumber(value);
  if (number === null || !Number.isInteger(number) || number <= 0) return null;
  return number;
}

function validRank(value) {
  return positiveInteger(value) !== null;
}

function nonNegativeInteger(value) {
  const number = finiteNumber(value);
  if (number === null || !Number.isInteger(number) || number < 0) return null;
  return number;
}

function finiteNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Object.is(number, -0) ? 0 : number;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
