export const BANKR_SOURCE = "Live Bankr Leaderboard";
export const BANKR_TIMEFRAME = "total";
export const LEADERBOARD_VERSION = "top50-v1";
export const TOP50_SIZE = 50;

const API_BASE = "https://api.bankr.bot";
const LEADERBOARD_PAGE_SIZE = 20;
const RATE_LIMIT_REMAINING_FLOOR = 6;
export const BANKR_CATEGORY_DEFINITIONS = [
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

const CATEGORY_MAP = Object.fromEntries(BANKR_CATEGORY_DEFINITIONS.map(({ label, key }) => [label, key]));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rateLimitFromHeaders(headers) {
  return {
    limit: numberHeader(headers.get("ratelimit-limit")),
    remaining: numberHeader(headers.get("ratelimit-remaining")),
    reset: numberHeader(headers.get("ratelimit-reset")),
    retryAfter: numberHeader(headers.get("retry-after")),
    cacheControl: headers.get("cache-control"),
    etag: headers.get("etag"),
    date: headers.get("date"),
  };
}

function numberHeader(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function createRateLimitTracker() {
  const samples = [];
  return {
    samples,
    latest: null,
    record(stage, rateLimit, status = 200) {
      if (!rateLimit) return;
      const sample = {
        stage,
        status,
        at: new Date().toISOString(),
        limit: rateLimit.limit,
        remaining: rateLimit.remaining,
        reset: rateLimit.reset,
        retryAfter: rateLimit.retryAfter,
        cacheControl: rateLimit.cacheControl,
        hasEtag: Boolean(rateLimit.etag),
      };
      samples.push(sample);
      this.latest = sample;
    },
    shouldStop() {
      return this.latest?.remaining != null && this.latest.remaining <= RATE_LIMIT_REMAINING_FLOOR;
    },
    summary() {
      const withRemaining = samples.filter((sample) => sample.remaining != null);
      return {
        limit: samples.find((sample) => sample.limit != null)?.limit ?? null,
        remainingFloor: RATE_LIMIT_REMAINING_FLOOR,
        startRemaining: withRemaining.at(0)?.remaining ?? null,
        minRemaining: withRemaining.length ? Math.min(...withRemaining.map((sample) => sample.remaining)) : null,
        endRemaining: withRemaining.at(-1)?.remaining ?? null,
        resetValues: [...new Set(samples.map((sample) => sample.reset).filter((value) => value != null))],
        samples,
      };
    },
  };
}

function retryDelayFromRateLimit(rateLimit, fallbackMs) {
  if (rateLimit?.retryAfter != null) return Math.max(0, rateLimit.retryAfter * 1000);
  if (rateLimit?.reset != null) {
    if (rateLimit.reset > 0 && rateLimit.reset <= 3600) return Math.min(rateLimit.reset * 1000, 30_000);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (rateLimit.reset > nowSeconds) return Math.min((rateLimit.reset - nowSeconds) * 1000, 30_000);
  }
  return fallbackMs;
}

class JsonFetchError extends Error {
  constructor(message, { status = null, rateLimit = null } = {}) {
    super(message);
    this.status = status;
    this.rateLimit = rateLimit;
  }
}

async function requestJson(url) {
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
  const rateLimit = rateLimitFromHeaders(response.headers);
  if (!response.ok) {
    throw new JsonFetchError(`Fetch failed ${response.status}: ${url} ${text.slice(0, 180)}`, {
      status: response.status,
      rateLimit,
    });
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new JsonFetchError(`Non-JSON response: ${url}`, { status: response.status, rateLimit });
  }
  return {
    data: JSON.parse(text),
    status: response.status,
    rateLimit,
  };
}

async function fetchJson(url, { rateLimitTracker = null, stage = "request" } = {}) {
  const result = await requestJson(url);
  rateLimitTracker?.record(stage, result.rateLimit, result.status);
  return result.data;
}

async function fetchJsonWithRetry(
  url,
  { maxRetries = 2, retryDelaysMs = [500, 1500], rateLimitTracker = null, stage = "request" } = {},
) {
  let attempt = 0;
  while (true) {
    try {
      if (rateLimitTracker?.shouldStop()) {
        throw new JsonFetchError(`Rate limit guard stopped new request: ${url}`, {
          status: "rate-limit-guard",
          rateLimit: rateLimitTracker.latest,
        });
      }
      return await fetchJson(url, { rateLimitTracker, stage });
    } catch (error) {
      if (error instanceof JsonFetchError) rateLimitTracker?.record(`${stage}:error`, error.rateLimit, error.status);
      const status = error instanceof JsonFetchError ? error.status : null;
      const shouldRetry = status === 429 || status >= 500;
      if (!shouldRetry || attempt >= maxRetries) throw error;
      const fallbackDelay = retryDelaysMs[attempt] ?? retryDelaysMs.at(-1) ?? 1000;
      const delay = retryDelayFromRateLimit(error.rateLimit, fallbackDelay);
      attempt += 1;
      await sleep(delay);
    }
  }
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
    accountId: ranking.accountId ? String(ranking.accountId) : null,
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

async function fetchRankingsPage({ cursor = null, rateLimitTracker = null } = {}) {
  const params = new URLSearchParams({
    timeframe: BANKR_TIMEFRAME,
    limit: String(LEADERBOARD_PAGE_SIZE),
    type: "total",
  });
  if (cursor) params.set("cursor", cursor);
  const url = `${API_BASE}/leaderboard/rankings?${params}`;
  return fetchJson(url, { rateLimitTracker, stage: "leaderboard" });
}

export async function collectBankrTop50Leaderboard({ pageDelayMs = 1000, rateLimitTracker = createRateLimitTracker() } = {}) {
  const capturedAt = new Date().toISOString();
  const pages = [];
  let cursor = null;

  while (pages.flatMap((page) => page.data ?? []).length < TOP50_SIZE) {
    const page = await fetchRankingsPage({ cursor, rateLimitTracker });
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
    rateLimit: rateLimitTracker.summary(),
  };
}

function scorePair(scores, key, { fallbackRaw = null, fallbackScore = null, availableFallback = false } = {}) {
  const item = scores?.[key];
  const raw = item?.raw ?? fallbackRaw ?? null;
  const score = item?.score ?? fallbackScore ?? null;
  return {
    raw,
    score,
    available: Boolean(item) || availableFallback || raw != null || score != null,
  };
}

function legacyFlatProfile(row) {
  const flat = {
    rank: row.rank,
    accountId: row.accountId,
    username: row.username,
    overallScore: row.overallScore,
    profileUrl: row.profileUrl,
    collectedAt: row.collectedAt,
  };
  for (const [label, key] of Object.entries(CATEGORY_MAP)) {
    flat[label] = row.categories?.[key]?.raw ?? row.categories?.[key]?.score ?? null;
  }
  flat.OG = row.categories?.og?.raw ?? row.categories?.og?.score ?? null;
  return flat;
}

function profileRowFromResponses({ ranking, profile, scoreResponse, capturedAt }) {
  const mergedScores = { ...ranking.scores, ...scoreResponse.scores };
  const overall = scorePair(mergedScores, "total", {
    fallbackRaw: ranking.totalScore ?? profile.totalScore ?? null,
    fallbackScore: ranking.totalScore ?? profile.totalScore ?? null,
  });
  const categories = Object.fromEntries(
    BANKR_CATEGORY_DEFINITIONS.map(({ key }) => {
      if (key === "social") return [key, scorePair(mergedScores, key)];
      if (key === "og") {
        return [
          key,
          scorePair(mergedScores, key, {
            fallbackRaw: profile.ogTier ?? null,
            availableFallback: profile.ogTier != null,
          }),
        ];
      }
      return [key, scorePair(mergedScores, key)];
    }),
  );

  return {
    rank: ranking.rank,
    accountId: String(ranking.accountId),
    username: normalizeUsername(profile.username ?? ranking.username),
    profileUrl: profileUrl(ranking.accountId),
    collectedAt: capturedAt,
    overall,
    overallScore: overall.score ?? overall.raw ?? null,
    categories,
    fetchStatus: {
      profile: "success",
      scores: "success",
      complete: true,
      errors: [],
    },
  };
}

function failedProfileRow({ ranking, capturedAt, profileStatus = "failed", scoresStatus = "failed", errors }) {
  return {
    rank: ranking.rank ?? null,
    accountId: ranking.accountId ? String(ranking.accountId) : null,
    username: normalizeUsername(ranking.username),
    profileUrl: ranking.accountId ? profileUrl(ranking.accountId) : null,
    collectedAt: capturedAt,
    overall: { raw: null, score: null, available: false },
    overallScore: null,
    categories: Object.fromEntries(
      BANKR_CATEGORY_DEFINITIONS.map(({ key }) => [key, { raw: null, score: null, available: false }]),
    ),
    fetchStatus: {
      profile: profileStatus,
      scores: scoresStatus,
      complete: false,
      errors,
    },
  };
}

async function collectOneDetailedProfile(ranking, capturedAt, rateLimitTracker) {
  if (!ranking.accountId || !ranking.rank || !ranking.username) {
    return {
      row: failedProfileRow({
        ranking,
        capturedAt,
        profileStatus: ranking.accountId ? "skipped" : "missing-account-id",
        scoresStatus: "skipped",
        errors: ["必須フィールド不足"],
      }),
      failed: {
        rank: ranking.rank ?? null,
        accountId: ranking.accountId ? String(ranking.accountId) : null,
        username: normalizeUsername(ranking.username),
        profileUrl: ranking.accountId ? profileUrl(ranking.accountId) : null,
        reason: "必須フィールド不足",
      },
    };
  }

  const accountId = String(ranking.accountId);
  const errors = [];
  let profile = null;
  let scoreResponse = null;

  try {
    profile = await fetchJsonWithRetry(`${API_BASE}/leaderboard/users/${accountId}/profile`, {
      rateLimitTracker,
      stage: "profile",
    });
  } catch (error) {
    errors.push(`profile: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    scoreResponse = await fetchJsonWithRetry(`${API_BASE}/leaderboard/users/${accountId}/scores?timeframe=${BANKR_TIMEFRAME}`, {
      rateLimitTracker,
      stage: "scores",
    });
  } catch (error) {
    errors.push(`scores: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (profile && scoreResponse) {
    return { row: profileRowFromResponses({ ranking, profile, scoreResponse, capturedAt }), failed: null };
  }

  return {
    row: failedProfileRow({
      ranking,
      capturedAt,
      profileStatus: profile ? "success" : "failed",
      scoresStatus: scoreResponse ? "success" : "failed",
      errors,
    }),
    failed: {
      rank: ranking.rank,
      accountId,
      username: normalizeUsername(ranking.username),
      profileUrl: profileUrl(accountId),
      reason: errors.join("; "),
    },
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function profileCaptureStatus({ requested, rows, startedAt, completedAt, rateLimit }) {
  const profileSuccess = rows.filter((row) => row.fetchStatus?.profile === "success").length;
  const scoresSuccess = rows.filter((row) => row.fetchStatus?.scores === "success").length;
  const completeUsers = rows.filter((row) => row.fetchStatus?.complete === true).length;
  const failedUsers = rows.filter((row) => row.fetchStatus?.profile !== "success" && row.fetchStatus?.scores !== "success").length;
  const partialUsers = rows.length - completeUsers - failedUsers;
  const status = completeUsers === requested
    ? "success"
    : completeUsers > 0 || partialUsers > 0
      ? "partial"
      : "failed";
  return {
    status,
    requested,
    completeUsers,
    partialUsers,
    failedUsers,
    profileSuccess,
    scoresSuccess,
    startedAt,
    completedAt,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    rateLimit,
  };
}

function validateProfiles(profiles, expectedCount = 10) {
  const invalid = profiles.filter(
    (profile) =>
      !profile.rank ||
      !profile.username ||
      profile.overallScore == null ||
      !profile.profileUrl,
  );
  if (profiles.length !== expectedCount) {
    throw new Error(`Profile取得失敗: profile count ${profiles.length}/${expectedCount}`);
  }
  if (invalid.length > 0) {
    throw new Error(`必須フィールド不足: ${invalid.map((user) => user.username ?? "unknown").join(", ")}`);
  }
}

export async function collectBankrTop50Details({ concurrency = 3 } = {}) {
  const rateLimitTracker = createRateLimitTracker();
  const top50Snapshot = await collectBankrTop50Leaderboard({ rateLimitTracker });
  const capturedAt = top50Snapshot.capturedAt;
  const top50Rankings = top50Snapshot.rankings.slice(0, TOP50_SIZE);
  const startedAt = new Date().toISOString();
  const results = await mapWithConcurrency(
    top50Rankings,
    concurrency,
    (ranking) => collectOneDetailedProfile(ranking, capturedAt, rateLimitTracker),
  );
  const completedAt = new Date().toISOString();
  const profilesTop50 = results.map((result) => result.row);
  const failedProfiles = results.map((result) => result.failed).filter(Boolean);
  const captureStatus = profileCaptureStatus({
    requested: TOP50_SIZE,
    rows: profilesTop50,
    startedAt,
    completedAt,
    rateLimit: rateLimitTracker.summary(),
  });

  return {
    capturedAt,
    source: BANKR_SOURCE,
    leaderboardSource: top50Snapshot.leaderboardSource,
    leaderboardVersion: top50Snapshot.leaderboardVersion,
    totalUsersCaptured: top50Snapshot.totalUsersCaptured,
    leaderboard: top50Snapshot.leaderboard,
    top50: top50Snapshot.leaderboard.top50,
    profiles: {
      top50: profilesTop50,
      captureStatus,
    },
    failedProfiles,
    validation: top50Snapshot.validation,
  };
}

export async function collectBankrTop10({ profileDelayMs = 1000 } = {}) {
  const detailed = await collectBankrTop50Details({ concurrency: 1 });
  if (profileDelayMs > 0) await sleep(0);
  const profiles = detailed.profiles.top50.slice(0, 10);
  const failedProfiles = detailed.failedProfiles.filter((item) => item.rank <= 10);
  validateProfiles(profiles, 10);
  if (failedProfiles.length > 0) throw new Error(`Profile取得失敗: ${failedProfiles.map((item) => item.username).join(", ")}`);

  return {
    capturedAt: detailed.capturedAt,
    source: detailed.source,
    leaderboardSource: detailed.leaderboardSource,
    leaderboardVersion: detailed.leaderboardVersion,
    totalUsersCaptured: detailed.totalUsersCaptured,
    leaderboard: detailed.top50.slice(0, 10),
    profiles,
    profilesTop50: detailed.profiles.top50,
    profileCaptureStatus: detailed.profiles.captureStatus,
    failedProfiles: detailed.failedProfiles,
    top50: detailed.top50,
    validation: detailed.validation,
    legacyProfiles: profiles.map(legacyFlatProfile),
  };
}
