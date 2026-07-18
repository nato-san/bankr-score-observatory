export const BANKR_SOURCE = "Live Bankr Leaderboard";
export const BANKR_TIMEFRAME = "total";
export const LEADERBOARD_VERSION = "top50-v1";
export const TOP50_SIZE = 50;

const API_BASE = "https://api.bankr.bot";
const LEADERBOARD_PAGE_SIZE = 20;
const CATEGORY_MAP = {
  "$BNKR": "bnkr",
  Deployer: "deployer",
  Builder: "developer",
  PNL: "pnl",
  Referral: "referral",
  NFTs: "nft",
  Ecosystem: "partner",
  "LLM Gateway": "llmUsage",
  Social: "social",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const bust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
  const response = await fetch(`${url}${bust}`, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "cache-control": "no-cache, no-store, max-age=0",
      pragma: "no-cache",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${url} ${text.slice(0, 180)}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(`Non-JSON response: ${url}`);
  }
  return JSON.parse(text);
}

function scoreRaw(scores, key) {
  const item = scores?.[key];
  if (!item) return null;
  return item.raw ?? item.score ?? null;
}

function scoreValue(scores, key) {
  const item = scores?.[key];
  if (!item) return null;
  return item.score ?? item.raw ?? null;
}

function normalizeUsername(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function profileUrl(accountId) {
  return `https://bankr.bot/terminal/leaderboard/profile/x/${accountId}`;
}

function leaderboardEntry(ranking) {
  return {
    rank: ranking.rank,
    username: normalizeUsername(ranking.username),
    overallScore: scoreValue(ranking.scores, "total") ?? ranking.totalScore ?? null,
    profileUrl: ranking.accountId ? profileUrl(ranking.accountId) : null,
  };
}

export function validateTop50(top50) {
  const errors = [];
  if (!Array.isArray(top50)) {
    return { ok: false, errors: ["leaderboard.top50が配列ではありません。"] };
  }
  if (top50.length !== TOP50_SIZE) {
    errors.push(`TOP50件数不足: ${top50.length}/${TOP50_SIZE}`);
  }

  const seenRanks = new Set();
  const seenUsers = new Set();
  for (const row of top50) {
    if (!row.rank) errors.push(`rank欠損: ${row.username ?? "unknown"}`);
    if (seenRanks.has(row.rank)) errors.push(`rank重複: ${row.rank}`);
    seenRanks.add(row.rank);
    if (!row.username) errors.push(`username欠損: rank ${row.rank ?? "unknown"}`);
    if (row.username && seenUsers.has(row.username.toLowerCase())) errors.push(`username重複: ${row.username}`);
    if (row.username) seenUsers.add(row.username.toLowerCase());
    if (row.overallScore == null) errors.push(`overallScore欠損: ${row.username ?? `rank ${row.rank}`}`);
    if (!row.profileUrl) errors.push(`profileUrl欠損: ${row.username ?? `rank ${row.rank}`}`);
  }

  for (let rank = 1; rank <= TOP50_SIZE; rank += 1) {
    if (!seenRanks.has(rank)) errors.push(`rank欠落: ${rank}`);
  }

  return {
    ok: errors.length === 0,
    expectedCount: TOP50_SIZE,
    actualCount: top50.length,
    errors,
  };
}

async function fetchRankingsPage({ cursor = null } = {}) {
  const params = new URLSearchParams({
    timeframe: BANKR_TIMEFRAME,
    limit: String(LEADERBOARD_PAGE_SIZE),
    type: "total",
  });
  if (cursor) params.set("cursor", cursor);
  const url = `${API_BASE}/leaderboard/rankings?${params}`;
  return fetchJson(url);
}

export async function collectBankrTop50Leaderboard({ pageDelayMs = 1000 } = {}) {
  const capturedAt = new Date().toISOString();
  const pages = [];
  let cursor = null;

  while (pages.flatMap((page) => page.data ?? []).length < TOP50_SIZE) {
    const page = await fetchRankingsPage({ cursor });
    pages.push(page);
    cursor = page.nextCursor;
    if (!cursor) break;
    if (pages.flatMap((item) => item.data ?? []).length < TOP50_SIZE) {
      await sleep(pageDelayMs);
    }
  }

  const rankings = pages.flatMap((page) => page.data ?? []);
  const top50 = rankings.slice(0, TOP50_SIZE).map(leaderboardEntry);
  const validation = validateTop50(top50);
  return {
    capturedAt,
    source: BANKR_SOURCE,
    leaderboardSource: `${API_BASE}/leaderboard/rankings?timeframe=${BANKR_TIMEFRAME}&limit=${LEADERBOARD_PAGE_SIZE}&type=total`,
    leaderboardVersion: LEADERBOARD_VERSION,
    totalUsersCaptured: top50.length,
    leaderboard: {
      top50,
    },
    rankings,
    validation,
  };
}

function validateProfiles(profiles) {
  const invalid = profiles.filter(
    (profile) =>
      !profile.rank ||
      !profile.username ||
      profile.overallScore == null ||
      !profile.profileUrl,
  );
  if (profiles.length !== 10) {
    throw new Error(`Top10取得失敗: profile count ${profiles.length}`);
  }
  if (invalid.length > 0) {
    throw new Error(`必須フィールド不足: ${invalid.map((user) => user.username ?? "unknown").join(", ")}`);
  }
}

export async function collectBankrTop10({ profileDelayMs = 1000 } = {}) {
  const top50Snapshot = await collectBankrTop50Leaderboard();
  const capturedAt = top50Snapshot.capturedAt;
  const top10 = top50Snapshot.rankings.slice(0, 10);
  if (top10.length !== 10) {
    throw new Error(`Top10取得失敗: rankings count ${top10.length}`);
  }

  const profiles = [];
  const failedProfiles = [];
  const leaderboard = top50Snapshot.leaderboard.top50.slice(0, 10);

  for (const ranking of top10) {
    if (!ranking.accountId || !ranking.rank || !ranking.username) {
      failedProfiles.push({
        rank: ranking.rank ?? null,
        username: normalizeUsername(ranking.username),
        profileUrl: ranking.accountId ? profileUrl(ranking.accountId) : null,
        reason: "必須フィールド不足",
      });
      continue;
    }

    try {
      const profile = await fetchJson(`${API_BASE}/leaderboard/users/${ranking.accountId}/profile`);
      const scoreResponse = await fetchJson(
        `${API_BASE}/leaderboard/users/${ranking.accountId}/scores?timeframe=${BANKR_TIMEFRAME}`,
      );
      const mergedScores = { ...ranking.scores, ...scoreResponse.scores };
      const row = {
        rank: ranking.rank,
        username: normalizeUsername(profile.username ?? ranking.username),
        overallScore: scoreValue(mergedScores, "total") ?? ranking.totalScore ?? profile.totalScore ?? null,
        profileUrl: profileUrl(ranking.accountId),
        collectedAt: capturedAt,
      };
      for (const [label, key] of Object.entries(CATEGORY_MAP)) {
        row[label] = scoreRaw(mergedScores, key);
      }
      row.OG = profile.ogTier ?? scoreRaw(mergedScores, "og");
      profiles.push(row);
    } catch (error) {
      failedProfiles.push({
        rank: ranking.rank,
        username: normalizeUsername(ranking.username),
        profileUrl: profileUrl(ranking.accountId),
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    await sleep(profileDelayMs);
  }

  validateProfiles(profiles);
  if (failedProfiles.length > 0) {
    throw new Error(`Profile取得失敗: ${failedProfiles.map((item) => item.username).join(", ")}`);
  }

  return {
    capturedAt,
    source: BANKR_SOURCE,
    leaderboardSource: top50Snapshot.leaderboardSource,
    leaderboardVersion: top50Snapshot.leaderboardVersion,
    totalUsersCaptured: top50Snapshot.totalUsersCaptured,
    leaderboard,
    profiles,
    failedProfiles,
    top50: top50Snapshot.leaderboard.top50,
    validation: top50Snapshot.validation,
  };
}
