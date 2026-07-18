import { fileURLToPath } from "node:url";
import { collectBankrTop10, LEADERBOARD_VERSION, TOP50_SIZE, validateTop50 } from "./bankr-live.mjs";
import { compareSnapshots } from "./bankr-diff-core.mjs";
import { createSnapshotStorage, DATA_PATHS } from "./github-storage.mjs";

const TIMEZONE = "Asia/Tokyo";
const BASELINE_COLLECTION_DAYS = Number(process.env.BASELINE_COLLECTION_DAYS ?? 30);

function jstDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function scheduledForFromDateKey(dateKey) {
  return `${dateKey}T09:15:00+09:00`;
}

function snapshotPath(dateKey) {
  return `${DATA_PATHS.snapshotsDir}/${dateKey}.json`;
}

function diffPath(dateKey) {
  return `${DATA_PATHS.diffsDir}/${dateKey}.json`;
}

function pathDateKey(repoPath) {
  return repoPath.split("/").at(-1)?.replace(/\.json$/, "") ?? "";
}

async function latestPreviousSnapshotPath(storage, dateKey) {
  const files = await storage.listJson(DATA_PATHS.snapshotsDir);
  const successful = [];
  for (const file of files) {
    if (pathDateKey(file) >= dateKey) continue;
    const snapshot = await storage.readJson(file, null);
    if (isSuccessTop50Snapshot(snapshot)) successful.push(file);
  }
  return successful.sort().at(-1) ?? null;
}

function top50FromSnapshot(snapshot) {
  return snapshot?.leaderboard?.top50 ?? snapshot?.leaderboard ?? snapshot?.profiles ?? [];
}

function top10ProfilesFromSnapshot(snapshot) {
  return snapshot?.profiles?.top10 ?? snapshot?.profiles ?? [];
}

function isSuccessSnapshot(snapshot) {
  return isSuccessTop50Snapshot(snapshot) || (snapshot?.status === "success" && Array.isArray(snapshot?.profiles) && snapshot.profiles.length === 10);
}

function isSuccessTop50Snapshot(snapshot) {
  if (snapshot?.status !== "success") return false;
  return Boolean(snapshot?.leaderboard?.top50 && validateTop50(snapshot.leaderboard.top50).ok);
}

async function countSuccessfulSnapshotsBefore(storage, dateKey) {
  const files = await storage.listJson(DATA_PATHS.snapshotsDir);
  let count = 0;
  for (const file of files) {
    if (pathDateKey(file) >= dateKey) continue;
    const snapshot = await storage.readJson(file, null);
    if (isSuccessSnapshot(snapshot)) count += 1;
  }
  return count;
}

function snapshotState({ dateKey, snapshot, previousPath, previous, retryCount, storageType, observationNumber }) {
  return {
    storage: storageType,
    baselineCollectionDays: BASELINE_COLLECTION_DAYS,
    lastObservationNumber: observationNumber,
    currentSnapshot: {
      date: dateKey,
      path: snapshotPath(dateKey),
      scheduledFor: snapshot.scheduledFor,
      capturedAt: snapshot.capturedAt,
      timezone: snapshot.timezone,
      source: snapshot.source,
      status: snapshot.status,
      baselineCollectionDays: snapshot.baselineCollectionDays,
      leaderboardVersion: snapshot.leaderboardVersion,
      totalUsersCaptured: snapshot.totalUsersCaptured,
      validation: snapshot.validation,
      retryCount,
      observationNumber,
    },
    previousSnapshot: previous
      ? {
          date: pathDateKey(previousPath),
          path: previousPath,
          scheduledFor: previous.scheduledFor,
          capturedAt: previous.capturedAt,
          timezone: previous.timezone,
          source: previous.source,
          status: previous.status,
          baselineCollectionDays: previous.baselineCollectionDays,
          leaderboardVersion: previous.leaderboardVersion,
          totalUsersCaptured: previous.totalUsersCaptured,
          validation: previous.validation,
          retryCount: previous.retryCount,
        }
      : null,
    diffPath: diffPath(dateKey),
    updatedAt: new Date().toISOString(),
  };
}

async function recordFailedAttempt({ storage, dateKey, scheduledFor, retryCount, error }) {
  const state = await storage.readJson(DATA_PATHS.state, {});
  state.storage = storage.type;
  state.lastFailedAttempt = {
    date: dateKey,
    scheduledFor,
    capturedAt: new Date().toISOString(),
    timezone: TIMEZONE,
    status: "failed",
    retryCount,
    validation: error?.validation ?? null,
    error: error instanceof Error ? error.message : String(error),
  };
  await storage.commitJsonFiles(
    [{ path: DATA_PATHS.state, data: state }],
    `Record failed Bankr snapshot attempt for ${dateKey}`,
  );
}

export async function createScheduledSnapshot({
  date = new Date(),
  retryCount = 0,
  requireGitHub = false,
} = {}) {
  const storage = createSnapshotStorage({ requireGitHub });
  const dateKey = typeof date === "string" ? date : jstDateKey(date);
  const scheduledFor = scheduledForFromDateKey(dateKey);
  const currentPath = snapshotPath(dateKey);
  const existing = await storage.readJson(currentPath, null);

  if (existing?.status === "success") {
    return {
      ok: true,
      skipped: true,
      reason: "同日の正式Snapshotは作成済みです。",
      snapshot: existing,
      state: await storage.readJson(DATA_PATHS.state, null),
      storage: storage.type,
    };
  }

  try {
    const previousPath = await latestPreviousSnapshotPath(storage, dateKey);
    const previous = previousPath ? await storage.readJson(previousPath, null) : null;
    const observationNumber = (await countSuccessfulSnapshotsBefore(storage, dateKey)) + 1;
    const captured = await collectBankrTop10();
    const validation = captured.validation ?? validateTop50(captured.top50 ?? []);
    if (!validation.ok) {
      const error = new Error(`Snapshot Invalid: ${validation.errors.join(", ")}`);
      error.validation = validation;
      throw error;
    }
    const snapshot = {
      scheduledFor,
      capturedAt: captured.capturedAt,
      timezone: TIMEZONE,
      source: captured.source,
      status: "success",
      baselineCollectionDays: BASELINE_COLLECTION_DAYS,
      leaderboardVersion: LEADERBOARD_VERSION,
      totalUsersCaptured: TOP50_SIZE,
      leaderboard: {
        top50: captured.top50,
      },
      profiles: {
        top10: captured.profiles,
      },
      failedProfiles: captured.failedProfiles,
      validation,
      retryCount,
    };
    const diff = compareSnapshots({
      oldUsers: top50FromSnapshot(previous),
      newUsers: snapshot.leaderboard.top50,
      oldSnapshot: previousPath ?? "none",
      newSnapshot: currentPath,
      scope: "top50",
    });
    const state = snapshotState({
      dateKey,
      snapshot,
      previousPath,
      previous,
      retryCount,
      storageType: storage.type,
      observationNumber,
    });

    await storage.commitJsonFiles(
      [
        { path: currentPath, data: snapshot },
        { path: diffPath(dateKey), data: diff },
        { path: DATA_PATHS.state, data: state },
      ],
      `Add Bankr research snapshot for ${dateKey}`,
    );

    return {
      ok: true,
      skipped: false,
      snapshot,
      diff,
      state,
      storage: storage.type,
    };
  } catch (error) {
    await recordFailedAttempt({ storage, dateKey, scheduledFor, retryCount, error });
    throw error;
  }
}

export async function readResearchState({ requireGitHub = false } = {}) {
  const storage = createSnapshotStorage({ requireGitHub });
  const state = await storage.readJson(DATA_PATHS.state, null);
  const currentSnapshot = state?.currentSnapshot?.path
    ? await storage.readJson(state.currentSnapshot.path, null)
    : null;
  const previousSnapshot = state?.previousSnapshot?.path
    ? await storage.readJson(state.previousSnapshot.path, null)
    : null;
  const diff = state?.diffPath ? await storage.readJson(state.diffPath, null) : null;

  return {
    storage: storage.type,
    scheduledState: state,
    oldSnapshot: top50FromSnapshot(previousSnapshot),
    newSnapshot: top50FromSnapshot(currentSnapshot),
    oldTop10Profiles: top10ProfilesFromSnapshot(previousSnapshot),
    newTop10Profiles: top10ProfilesFromSnapshot(currentSnapshot),
    diff,
  };
}

export async function hasSuccessfulResearchSnapshot(dateKey, { requireGitHub = false } = {}) {
  const storage = createSnapshotStorage({ requireGitHub });
  const snapshot = await storage.readJson(snapshotPath(dateKey), null);
  return snapshot?.status === "success";
}

export async function retryCountForFailedAttempt(dateKey, { requireGitHub = false } = {}) {
  const storage = createSnapshotStorage({ requireGitHub });
  const state = await storage.readJson(DATA_PATHS.state, null);
  const failed = state?.lastFailedAttempt;
  if (failed?.date === dateKey && Number(failed.retryCount) < 2) {
    return Number(failed.retryCount) + 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const retryArg = process.argv.find((arg) => arg.startsWith("--retry-count="));
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
  const githubArg = process.argv.includes("--require-github");
  const retryCount = retryArg ? Number(retryArg.split("=")[1]) : 0;
  const date = dateArg ? dateArg.split("=")[1] : new Date();
  try {
    const result = await createScheduledSnapshot({ date, retryCount, requireGitHub: githubArg });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
