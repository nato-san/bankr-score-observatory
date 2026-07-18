import { runScheduledSnapshot } from "../work/vercel-scheduled-runner.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(request, response) {
  await runScheduledSnapshot(request, response, { retryCount: 1 });
}
