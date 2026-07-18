import { collectBankrTop10 } from "../work/bankr-live.mjs";
import { readResearchState } from "../work/scheduled-bankr-snapshot.mjs";

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
    const researchState = await readResearchState({ requireGitHub: true });
    response.status(200).json({
      ok: true,
      state: {
        oldSnapshot: researchState.oldSnapshot,
        newSnapshot: researchState.newSnapshot,
        oldTop10Profiles: researchState.oldTop10Profiles,
        newTop10Profiles: researchState.newTop10Profiles,
        diff: researchState.diff,
        canCompare: researchState.canCompare,
        compareUnavailableReason: researchState.compareUnavailableReason,
        metadata: null,
        scheduledState: researchState.scheduledState,
        manualCurrent: {
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
        },
        storage: researchState.storage,
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
