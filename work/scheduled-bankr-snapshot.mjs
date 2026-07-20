import { fileURLToPath } from "node:url";
import { collectBankrTop50Details, LEADERBOARD_VERSION, TOP50_SIZE, validateTop50 } from "./bankr-live.mjs";
import { compareSnapshots } from "./bankr-diff-core.mjs";
import { createSnapshotStorage, DATA_PATHS } from "./github-storage.mjs";
import { buildCaseResearch } from "../src/case-research.js";

const TIMEZONE = "Asia/Tokyo";
const BASELINE_COLLECTION_DAYS = Number(process.env.BASELINE_COLLECTION_DAYS ?? 30);

export function jstDateKey(date = new Date()) {
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

export function top50FromSnapshot(snapshot) {
  const top50 = snapshot?.leaderboard?.top50;
  if (Array.isArray(top50)) return top50;
  if (Array.isArray(snapshot?.leaderboard)) {
    return snapshot.leaderboard.map((row) => ({
      rank: row.rank,
      username: row.username,
      overallScore: row.overallScore ?? row.totalScore ?? null,
      profileUrl: row.profileUrl,
    }));
  }
  return [];
}

export function top10ProfilesFromSnapshot(snapshot) {
  if (Array.isArray(snapshot?.profiles?.top10)) return snapshot.profiles.top10;
  if (Array.isArray(snapshot?.profiles?.top50)) return snapshot.profiles.top50.slice(0, 10);
  return Array.isArray(snapshot?.profiles) ? snapshot.profiles : [];
}

export function top50ProfilesFromSnapshot(snapshot) {
  if (Array.isArray(snapshot?.profiles?.top50)) return snapshot.profiles.top50;
  if (Array.isArray(snapshot?.profiles) && snapshot.profiles.length >= TOP50_SIZE) return snapshot.profiles;
  return [];
}

function hasCompleteTop50ProfileDetails(snapshot) {
  return top50ProfilesFromSnapshot(snapshot).length >= TOP50_SIZE;
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

function snapshotState({ dateKey, snapshot, previousPath, previous, retryCount, storageType, observationNumber, diffPathValue }) {
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
      top10ProfilesCaptured: top10ProfilesFromSnapshot(snapshot).length,
      top50ProfilesCaptured: top50ProfilesFromSnapshot(snapshot).length,
      profileCaptureStatus: snapshot.profiles?.captureStatus ?? null,
      failedProfiles: snapshot.failedProfiles ?? [],
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
          top10ProfilesCaptured: top10ProfilesFromSnapshot(previous).length,
          top50ProfilesCaptured: top50ProfilesFromSnapshot(previous).length,
          profileCaptureStatus: previous.profiles?.captureStatus ?? null,
          validation: previous.validation,
          retryCount: previous.retryCount,
        }
      : null,
    diffPath: diffPathValue,
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

  if (existing?.status === "success" && hasCompleteTop50ProfileDetails(existing)) {
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
    const captured = await collectBankrTop50Details();
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
        top50: captured.profiles.top50,
        captureStatus: captured.profiles.captureStatus,
      },
      failedProfiles: captured.failedProfiles,
      validation,
      retryCount,
    };
    const diff = previous
      ? compareSnapshots({
          oldUsers: top50FromSnapshot(previous),
          newUsers: snapshot.leaderboard.top50,
          oldSnapshot: previousPath,
          newSnapshot: currentPath,
          scope: "top50",
        })
      : null;
    const state = snapshotState({
      dateKey,
      snapshot,
      previousPath,
      previous,
      retryCount,
      storageType: storage.type,
      observationNumber,
      diffPathValue: diff ? diffPath(dateKey) : null,
    });

    await storage.commitJsonFiles(
      [
        { path: currentPath, data: snapshot },
        ...(diff ? [{ path: diffPath(dateKey), data: diff }] : []),
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
  const currentTop50 = top50FromSnapshot(currentSnapshot);
  const previousTop50 = top50FromSnapshot(previousSnapshot);
  const currentTop50Profiles = top50ProfilesFromSnapshot(currentSnapshot);
  const previousTop50Profiles = top50ProfilesFromSnapshot(previousSnapshot);
  const currentValidation = validateTop50(currentTop50);
  const previousValidation = validateTop50(previousTop50);
  const canCompare = Boolean(previousSnapshot && currentValidation.ok && previousValidation.ok);
  const diff = canCompare && state?.diffPath ? await storage.readJson(state.diffPath, null) : null;

  const caseResearch = canCompare && diff
    ? buildCaseResearch({
        oldProfiles: previousTop50Profiles,
        newProfiles: currentTop50Profiles,
        diff,
        observationFrom: previousSnapshot?.capturedAt ?? null,
        observationTo: currentSnapshot?.capturedAt ?? null,
      })
    : null;

  return {
    storage: storage.type,
    scheduledState: state,
    oldSnapshot: canCompare ? previousTop50 : [],
    newSnapshot: currentTop50,
    oldTop10Profiles: top10ProfilesFromSnapshot(previousSnapshot),
    newTop10Profiles: top10ProfilesFromSnapshot(currentSnapshot),
    oldTop50Profiles: previousTop50Profiles,
    newTop50Profiles: currentTop50Profiles,
    diff,
    caseResearch,
    canCompare,
    compareUnavailableReason: canCompare ? null : "比較対象となる前回Snapshotはありません",
  };
}

function manualTop50(manualCurrent) {
  return manualCurrent?.leaderboard?.top50 ?? [];
}

function manualTop10Profiles(manualCurrent) {
  if (Array.isArray(manualCurrent?.profiles?.top10)) return manualCurrent.profiles.top10;
  if (Array.isArray(manualCurrent?.profiles?.top50)) return manualCurrent.profiles.top50.slice(0, 10);
  return [];
}

function manualTop50Profiles(manualCurrent) {
  if (Array.isArray(manualCurrent?.profiles?.top50)) return manualCurrent.profiles.top50;
  if (Array.isArray(manualCurrent?.profiles?.top10)) return manualCurrent.profiles.top10;
  return [];
}

export function buildIntradayPreview({ researchState, manualCurrent, now = new Date() } = {}) {
  if (!manualCurrent || manualCurrent.status !== "success") {
    return {
      status: "unavailable",
      reason: "Manual Currentが取得されていません。",
    };
  }

  const formalSnapshot = researchState?.scheduledState?.currentSnapshot;
  const today = jstDateKey(now);
  if (!formalSnapshot || formalSnapshot.date !== today || formalSnapshot.status !== "success") {
    return {
      status: "unavailable",
      reason: "比較元となる本日の正式Snapshotがありません。",
      manualCapturedAt: manualCurrent.capturedAt ?? null,
    };
  }

  const oldTop50 = researchState?.newSnapshot ?? [];
  const newTop50 = manualTop50(manualCurrent);
  const oldValidation = validateTop50(oldTop50);
  const newValidation = validateTop50(newTop50);
  if (!oldValidation.ok) {
    return {
      status: "invalid",
      reason: "本日の正式Snapshotがvalidではありません。",
      validation: oldValidation,
      formalCapturedAt: formalSnapshot.capturedAt ?? null,
      manualCapturedAt: manualCurrent.capturedAt ?? null,
    };
  }
  if (!newValidation.ok) {
    return {
      status: "invalid",
      reason: "Manual CurrentのTOP50がvalidではありません。",
      validation: newValidation,
      formalCapturedAt: formalSnapshot.capturedAt ?? null,
      manualCapturedAt: manualCurrent.capturedAt ?? null,
    };
  }

  const diff = compareSnapshots({
    oldUsers: oldTop50,
    newUsers: newTop50,
    oldSnapshot: formalSnapshot.path ?? "formal-snapshot",
    newSnapshot: "manual-current",
    scope: "intraday-top50",
  });
  const oldTop10 = researchState?.newTop10Profiles ?? [];
  const newTop10 = manualTop10Profiles(manualCurrent);
  const profileDiff = oldTop10.length && newTop10.length
    ? compareSnapshots({
        oldUsers: oldTop10,
        newUsers: newTop10,
        oldSnapshot: formalSnapshot.path ?? "formal-snapshot-profiles",
        newSnapshot: "manual-current-profiles",
        scope: "intraday-top10-profiles",
      })
      : null;
  const caseResearch = buildCaseResearch({
    oldProfiles: researchState?.newTop50Profiles ?? oldTop10,
    newProfiles: manualTop50Profiles(manualCurrent),
    diff,
    observationFrom: formalSnapshot.capturedAt ?? null,
    observationTo: manualCurrent.capturedAt ?? null,
  });

  return {
    status: "success",
    title: "現在値との途中比較",
    note: "これは本日の正式Snapshotから現在時刻までの途中比較です。正式な日次Observationではありません。",
    generatedAt: new Date().toISOString(),
    formalSnapshot: {
      date: formalSnapshot.date,
      capturedAt: formalSnapshot.capturedAt,
      path: formalSnapshot.path,
    },
    manualCurrent: {
      capturedAt: manualCurrent.capturedAt,
      source: manualCurrent.source,
    },
    validation: {
      formal: oldValidation,
      manual: newValidation,
    },
    diff,
    profileDiff,
    caseResearch,
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
