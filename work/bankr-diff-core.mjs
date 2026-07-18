import path from "node:path";

const NUMERIC_FIELDS = [
  "overallScore",
  "$BNKR",
  "Deployer",
  "Builder",
  "PNL",
  "Referral",
  "NFTs",
  "Ecosystem",
  "LLM Gateway",
  "Social",
];
const SCORE_FIELDS = NUMERIC_FIELDS.filter((field) => field !== "overallScore");
const STRING_FIELDS = ["OG"];

function normalizeKey(user) {
  if (typeof user.profileUrl === "string" && user.profileUrl.trim()) {
    return `profileUrl:${user.profileUrl.trim()}`;
  }
  if (typeof user.username === "string" && user.username.trim()) {
    return `username:${user.username.trim().toLowerCase()}`;
  }
  return null;
}

export function parseNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return null;

  const match = trimmed
    .replace(/[$,\s]/g, "")
    .match(/^([-+]?\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) return null;

  const multipliers = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const suffix = match[2]?.toUpperCase();
  return amount * (suffix ? multipliers[suffix] : 1);
}

function roundChange(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(10));
}

function numericDiff(oldValue, newValue) {
  const oldParsed = parseNumber(oldValue);
  const newParsed = parseNumber(newValue);
  return {
    old: oldParsed,
    new: newParsed,
    change: oldParsed == null || newParsed == null ? null : roundChange(newParsed - oldParsed),
  };
}

function rankDiff(oldRank, newRank) {
  const oldParsed = parseNumber(oldRank);
  const newParsed = parseNumber(newRank);
  let change = null;
  let direction = "unchanged";

  if (oldParsed != null && newParsed != null) {
    change = oldParsed - newParsed;
    if (change > 0) direction = "up";
    if (change < 0) direction = "down";
  } else if (oldParsed == null && newParsed != null) {
    direction = "new";
  } else if (oldParsed != null && newParsed == null) {
    direction = "out";
  }

  return {
    old: oldParsed,
    new: newParsed,
    change,
    direction,
  };
}

function stringDiff(oldValue, newValue) {
  const oldNormalized = oldValue == null ? null : String(oldValue);
  const newNormalized = newValue == null ? null : String(newValue);
  return {
    old: oldNormalized,
    new: newNormalized,
    changed: oldNormalized !== newNormalized,
  };
}

function indexUsers(users, snapshotName) {
  const indexed = new Map();
  const skipped = [];
  const duplicates = [];

  for (const user of users) {
    const key = normalizeKey(user);
    if (!key) {
      skipped.push(user);
      continue;
    }
    if (indexed.has(key)) duplicates.push({ key, snapshot: snapshotName });
    indexed.set(key, user);
  }

  return { indexed, skipped, duplicates };
}

function userLabel(oldUser, newUser) {
  return {
    username: newUser?.username ?? oldUser?.username ?? null,
    profileUrl: newUser?.profileUrl ?? oldUser?.profileUrl ?? null,
  };
}

function compareUsers(oldUser, newUser) {
  const status =
    oldUser && newUser ? "existing" : oldUser && !newUser ? "exited" : "new";
  const user = {
    ...userLabel(oldUser, newUser),
    status,
    rank: rankDiff(oldUser?.rank, newUser?.rank),
    overallScore: numericDiff(oldUser?.overallScore, newUser?.overallScore),
    scores: {},
  };

  for (const field of SCORE_FIELDS) {
    user.scores[field] = numericDiff(oldUser?.[field], newUser?.[field]);
  }
  for (const field of STRING_FIELDS) {
    user.scores[field] = stringDiff(oldUser?.[field], newUser?.[field]);
  }

  return user;
}

function allNumericDiffsAreZero(diff) {
  if (diff.rank.change !== 0 || diff.rank.direction !== "unchanged") return false;
  if (diff.overallScore.change !== 0) return false;
  return SCORE_FIELDS.every((field) => diff.scores[field].change === 0);
}

export function compareSnapshots({
  oldUsers,
  newUsers,
  oldSnapshot = "old",
  newSnapshot = "new",
} = {}) {
  const oldIndex = indexUsers(oldUsers ?? [], "old");
  const newIndex = indexUsers(newUsers ?? [], "new");
  const keys = [...new Set([...oldIndex.indexed.keys(), ...newIndex.indexed.keys()])].sort();
  const users = keys.map((key) => compareUsers(oldIndex.indexed.get(key), newIndex.indexed.get(key)));
  const identicalInputPaths = path.resolve(oldSnapshot) === path.resolve(newSnapshot);
  const summary = {
    totalUsers: users.length,
    existingUsers: users.filter((user) => user.status === "existing").length,
    newUsers: users.filter((user) => user.status === "new").length,
    exitedUsers: users.filter((user) => user.status === "exited").length,
    allNumericDiffsZero: users.every(allNumericDiffsAreZero),
    identicalInputPaths,
    skippedOldUsers: oldIndex.skipped.length,
    skippedNewUsers: newIndex.skipped.length,
    duplicateKeys: [...oldIndex.duplicates, ...newIndex.duplicates],
  };

  return {
    generatedAt: new Date().toISOString(),
    oldSnapshot,
    newSnapshot,
    summary,
    users,
  };
}
