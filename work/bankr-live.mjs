export const BANKR_SOURCE = "Live Bankr Leaderboard";
export const BANKR_TIMEFRAME = "total";

const API_BASE = "https://api.bankr.bot";
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
  const capturedAt = new Date().toISOString();
  const leaderboardSource = `${API_BASE}/leaderboard/rankings?timeframe=${BANKR_TIMEFRAME}&limit=20&type=total`;
  const rankings = await fetchJson(leaderboardSource);
  const top10 = rankings.data?.slice(0, 10) ?? [];
  if (top10.length !== 10) {
    throw new Error(`Top10取得失敗: rankings count ${top10.length}`);
  }

  const profiles = [];
  const failedProfiles = [];
  const leaderboard = top10.map((ranking) => ({
    accountId: ranking.accountId,
    rank: ranking.rank,
    username: normalizeUsername(ranking.username),
    totalScore: ranking.totalScore ?? ranking.scores?.total?.score ?? null,
    profileUrl: ranking.accountId ? profileUrl(ranking.accountId) : null,
  }));

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
    leaderboardSource,
    leaderboard,
    profiles,
    failedProfiles,
  };
}
