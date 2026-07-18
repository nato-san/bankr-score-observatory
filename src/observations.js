const TRACKED_FIELDS = [
  "$BNKR",
  "Deployer",
  "Builder",
  "PNL",
  "Referral",
  "NFTs",
  "Ecosystem",
  "LLM Gateway",
  "Social",
  "OG",
];

function numericChanged(entry) {
  return entry && entry.change !== null && entry.change !== 0;
}

function stringChanged(entry) {
  return entry && entry.changed === true;
}

export function summarizeDiff(diff) {
  const existing = diff.users.filter((user) => user.status === "existing");
  const rankMovers = existing.filter((user) => numericChanged(user.rank));
  const overallChanges = existing.filter((user) => numericChanged(user.overallScore));
  const newUsers = diff.users.filter((user) => user.status === "new");
  const exitedUsers = diff.users.filter((user) => user.status === "exited");
  const categoryGroups = TRACKED_FIELDS.map((field) => {
    const users = existing
      .map((user) => ({ ...user, change: user.scores[field] }))
      .filter((user) => (field === "OG" ? stringChanged(user.change) : numericChanged(user.change)));
    return { field, users };
  }).filter((group) => group.users.length > 0);
  const categoryChangeUserCount = new Set(
    categoryGroups.flatMap((group) => group.users.map((user) => user.profileUrl || user.username)),
  ).size;

  return {
    rankMovers,
    overallChanges,
    newUsers,
    exitedUsers,
    categoryGroups,
    categoryChangeUserCount,
  };
}

export function buildObservation({ oldSnapshot, newSnapshot, diff, metadata }) {
  const summary = summarizeDiff(diff);
  const newCapturedAt = newestTimestamp(newSnapshot);
  const oldCapturedAt = newestTimestamp(oldSnapshot);
  const fallbackObservationNumber = metadata?.currentSnapshot ? 1 : 0;
  return {
    observationNumber: metadata?.lastObservationNumber ?? fallbackObservationNumber,
    snapshotOldId: metadata?.previousSnapshot?.id ?? oldCapturedAt ?? "snapshot-old",
    snapshotNewId: metadata?.currentSnapshot?.id ?? newCapturedAt ?? "snapshot-new",
    createdAt: diff.generatedAt || newCapturedAt || new Date().toISOString(),
    currentSnapshotAt: metadata?.currentSnapshot?.capturedAt ?? newCapturedAt,
    previousSnapshotAt: metadata?.previousSnapshot?.capturedAt ?? oldCapturedAt,
    source: metadata?.currentSnapshot?.source ?? "Local snapshot",
    status: "draft",
    profileDetailsAvailable: metadata?.currentSnapshot?.top10ProfilesCaptured == null
      ? true
      : metadata.currentSnapshot.top10ProfilesCaptured > 0,
    diff,
    summary,
  };
}

function newestTimestamp(snapshot) {
  const timestamps = snapshot
    .map((entry) => entry.collectedAt)
    .filter(Boolean)
    .sort();
  return timestamps.at(-1) || null;
}

export { TRACKED_FIELDS };
