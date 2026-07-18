import { collectBankrTop10 } from "../work/bankr-live.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(request, response) {
  response.setHeader("cache-control", "no-store");
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }

  try {
    const snapshot = await collectBankrTop10();
    response.status(200).json({
      ok: true,
      state: {
        oldSnapshot: [],
        newSnapshot: [],
        diff: null,
        metadata: null,
        scheduledState: null,
        manualCurrent: {
          capturedAt: snapshot.capturedAt,
          source: snapshot.source,
          leaderboardSource: snapshot.leaderboardSource,
          leaderboard: snapshot.leaderboard,
          profiles: snapshot.profiles,
          failedProfiles: snapshot.failedProfiles,
          status: "success",
        },
        storage: "transient",
      },
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "最新Leaderboardの取得に失敗しました。前回の観測結果は更新されていません。",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
