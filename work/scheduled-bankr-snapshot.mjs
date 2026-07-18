import { fileURLToPath } from "node:url";
import { collectBankrTop10 } from "./bankr-live.mjs";
import { compareSnapshots } from "./bankr-diff-core.mjs";
import { createSnapshotStorage, DATA_PATHS } from "./github-storage.mjs";

const TIMEZONE = "Asia/Tokyo";

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
    if (snapshot?.status === "success") successful.push(file);
  }
  return successful.sort().at(-1) ?? null;
}

function snapshotState({ dateKey, snapshot, previousPath, previous, retryCount, storageType }) {
  return {
    storage: storageType,
    currentSnapshot: {
      date: dateKey,
      path: snapshotPath(dateKey),
      scheduledFor: snapshot.scheduledFor,
      capturedAt: snapshot.capturedAt,
      timezone: snapshot.timezone,
      source: snapshot.source,
      status: snapshot.status,
      retryCount,
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
    const captured = await collectBankrTop10();
    const snapshot = {
      scheduledFor,
      capturedAt: captured.capturedAt,
      timezone: TIMEZONE,
      source: captured.source,
      status: "success",
      leaderboard: captured.leaderboard,
      profiles: captured.profiles,
      failedProfiles: captured.failedProfiles,
      retryCount,
    };
    const diff = compareSnapshots({
      oldUsers: previous?.profiles ?? [],
      newUsers: snapshot.profiles,
      oldSnapshot: previousPath ?? "none",
      newSnapshot: currentPath,
    });
    const state = snapshotState({
      dateKey,
      snapshot,
      previousPath,
      previous,
      retryCount,
      storageType: storage.type,
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
    oldSnapshot: previousSnapshot?.profiles ?? [],
    newSnapshot: currentSnapshot?.profiles ?? [],
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
