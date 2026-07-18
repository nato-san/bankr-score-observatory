import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import { createServer as createViteServer } from "vite";
import {
  createScheduledSnapshot,
  hasSuccessfulResearchSnapshot,
  readResearchState,
  retryCountForFailedAttempt,
} from "./scheduled-bankr-snapshot.mjs";

const args = process.argv.slice(2);
const host = readArg("--host", "0.0.0.0");
const port = Number(readArg("--port", "5175"));
const SCHEDULE_SECRET = process.env.CRON_SECRET || process.env.BANKR_SCHEDULE_SECRET;
const TIMEZONE = "Asia/Tokyo";
const retryTimers = new Map();

function readArg(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readState() {
  const [researchState, metadata, manualCurrent] = await Promise.all([
    readResearchState(),
    readJson("outputs/observation-state.json", null),
    readJson("outputs/manual-current.json", null),
  ]);
  return {
    oldSnapshot: researchState.oldSnapshot,
    newSnapshot: researchState.newSnapshot,
    oldTop10Profiles: researchState.oldTop10Profiles,
    newTop10Profiles: researchState.newTop10Profiles,
    diff: researchState.diff,
    canCompare: researchState.canCompare,
    compareUnavailableReason: researchState.compareUnavailableReason,
    metadata,
    scheduledState: researchState.scheduledState,
    manualCurrent,
    storage: researchState.storage,
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function runObservation() {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["work/observe-bankr.mjs"], { timeout: 180000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${stderr || stdout || error.message}`.trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function requestSecret(request) {
  const auth = request.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return request.headers["x-bankr-scheduler-secret"];
}

function isAuthorized(request) {
  return Boolean(SCHEDULE_SECRET) && requestSecret(request) === SCHEDULE_SECRET;
}

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

function scheduledTargetUtc(dateKey) {
  return new Date(`${dateKey}T00:15:00.000Z`);
}

async function missedTodayNeedsRun(now = new Date()) {
  const dateKey = jstDateKey(now);
  return scheduledTargetUtc(dateKey) <= now && !(await hasSuccessfulResearchSnapshot(dateKey));
}

function nextRunDelayMs(now = new Date()) {
  const dateKey = jstDateKey(now);
  const target = scheduledTargetUtc(dateKey);
  if (target > now) return target.getTime() - now.getTime();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return scheduledTargetUtc(jstDateKey(tomorrow)).getTime() - now.getTime();
}

function scheduleRetry(dateKey, retryCount) {
  if (retryCount > 2 || retryTimers.has(`${dateKey}:${retryCount}`)) return;
  const timer = setTimeout(async () => {
    retryTimers.delete(`${dateKey}:${retryCount}`);
    await runScheduledJob({ dateKey, retryCount });
  }, 10 * 60 * 1000);
  retryTimers.set(`${dateKey}:${retryCount}`, timer);
}

async function runScheduledJob({ dateKey = jstDateKey(), retryCount = 0 } = {}) {
  try {
    return await createScheduledSnapshot({ date: dateKey, retryCount });
  } catch (error) {
    if (retryCount < 2) scheduleRetry(dateKey, retryCount + 1);
    throw error;
  }
}

function scheduleDailyRun() {
  const delay = nextRunDelayMs();
  setTimeout(async () => {
    try {
      await runScheduledJob();
    } catch (error) {
      console.error("Scheduled Bankr snapshot failed:", error instanceof Error ? error.message : String(error));
    } finally {
      scheduleDailyRun();
    }
  }, delay);
  console.log(`Next scheduled research snapshot in ${Math.round(delay / 1000)} seconds.`);
}

async function runStartupCatchUp() {
  const now = new Date();
  if (!(await missedTodayNeedsRun(now))) return;
  const dateKey = jstDateKey(now);
  const retryCount = await retryCountForFailedAttempt(dateKey);
  try {
    await runScheduledJob({ dateKey, retryCount });
    console.log(`Created missed research snapshot for ${dateKey}.`);
  } catch (error) {
    console.error("Startup catch-up Bankr snapshot failed:", error instanceof Error ? error.message : String(error));
  }
}

const vite = await createViteServer({
  server: { middlewareMode: true, hmr: false },
  appType: "spa",
});

const server = http.createServer(async (request, response) => {
  if (request.url === "/api/state" && request.method === "GET") {
    sendJson(response, 200, await readState());
    return;
  }

  if (request.url === "/api/observe" && request.method === "POST") {
    try {
      const result = await runObservation();
      sendJson(response, 200, {
        ok: true,
        logs: result.stdout,
        state: await readState(),
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: "最新Leaderboardの取得に失敗しました。前回の観測結果は更新されていません。",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (request.url?.startsWith("/api/scheduled-snapshot") && request.method === "POST") {
    if (!SCHEDULE_SECRET) {
      sendJson(response, 503, {
        ok: false,
        message: "定期実行用シークレットが設定されていません。",
      });
      return;
    }
    if (!isAuthorized(request)) {
      sendJson(response, 401, {
        ok: false,
        message: "認証が必要です。",
      });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const dateKey = url.searchParams.get("date") ?? jstDateKey();
    const retryCount = Number(url.searchParams.get("retryCount") ?? 0);

    try {
      const result = await runScheduledJob({ dateKey, retryCount });
      sendJson(response, result.skipped ? 200 : 201, {
        ok: true,
        ...result,
        state: await readState(),
      });
    } catch (error) {
      sendJson(response, 202, {
        ok: false,
        message: retryCount < 2
          ? "取得に失敗しました。10分後に再試行します。"
          : "取得に失敗しました。最大再試行回数に達しました。",
        retryScheduled: retryCount < 2,
        retryCount,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  vite.middlewares(request, response);
});

server.listen(port, host, () => {
  console.log(`Bankr Score Observatory dev server: http://${host}:${port}/`);
  void runStartupCatchUp();
  scheduleDailyRun();
});
