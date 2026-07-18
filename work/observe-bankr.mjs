import fs from "node:fs";
import path from "node:path";
import { collectBankrTop10 } from "./bankr-live.mjs";

const manualPath = "outputs/manual-current.json";
const summaryPath = "work/snapshot-live-collection-summary.json";

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

try {
  const snapshot = await collectBankrTop10();
  ensureDir(manualPath);
  const manual = {
    capturedAt: snapshot.capturedAt,
    source: snapshot.source,
    leaderboardSource: snapshot.leaderboardSource,
    leaderboardVersion: snapshot.leaderboardVersion,
    totalUsersCaptured: snapshot.totalUsersCaptured,
    leaderboard: {
      top50: snapshot.top50,
    },
    profiles: {
      top10: snapshot.profiles,
    },
    failedProfiles: snapshot.failedProfiles,
    validation: snapshot.validation,
    status: "success",
  };
  fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);
  fs.writeFileSync(summaryPath, `${JSON.stringify({
    fetchedAt: snapshot.capturedAt,
    leaderboardSource: snapshot.leaderboardSource,
    source: snapshot.source,
    mode: "manual-current",
    fetchedUsers: snapshot.profiles.length,
    totalUsersCaptured: snapshot.totalUsersCaptured,
    top10: snapshot.profiles.map(({ rank, username }) => ({ rank, username })),
    top50Preview: snapshot.top50.slice(0, 5).map(({ rank, username }) => ({ rank, username })),
  }, null, 2)}\n`);

  console.log("Fetched at:", snapshot.capturedAt);
  console.log("Leaderboard source:", snapshot.leaderboardSource);
  console.log("Fetched users:", snapshot.profiles.length);
  console.log("Top 50 lightweight users:", snapshot.totalUsersCaptured);
  console.log("Top 10 usernames:");
  for (const user of snapshot.profiles) console.log(`${user.rank}. ${user.username}`);
  console.log("Saved as manual current value. Formal research snapshot was not created.");
} catch (error) {
  console.error("最新Leaderboardの取得に失敗しました。");
  console.error("前回の観測結果は更新されていません。");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
