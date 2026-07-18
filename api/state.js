import { readResearchState } from "../work/scheduled-bankr-snapshot.mjs";

export default async function handler(_request, response) {
  response.setHeader("cache-control", "no-store");
  try {
    const researchState = await readResearchState({ requireGitHub: true });
    response.status(200).json({
      oldSnapshot: researchState.oldSnapshot,
      newSnapshot: researchState.newSnapshot,
      diff: researchState.diff,
      metadata: null,
      scheduledState: researchState.scheduledState,
      manualCurrent: null,
      storage: researchState.storage,
    });
  } catch (error) {
    response.status(500).json({
      oldSnapshot: [],
      newSnapshot: [],
      diff: null,
      metadata: null,
      scheduledState: null,
      manualCurrent: null,
      storage: "github",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
