import { createScheduledSnapshot } from "./scheduled-bankr-snapshot.mjs";

const TIMEZONE = "Asia/Tokyo";

function configuredSecret() {
  return process.env.CRON_SECRET || process.env.BANKR_SCHEDULE_SECRET;
}

function requestSecret(request) {
  const auth = request.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return request.headers["x-bankr-scheduler-secret"];
}

function isAuthorized(request) {
  return Boolean(configuredSecret()) && requestSecret(request) === configuredSecret();
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

export async function runScheduledSnapshot(request, response, { retryCount = 0 } = {}) {
  response.setHeader("cache-control", "no-store");
  if (request.method !== "POST" && request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!configuredSecret()) {
    response.status(503).json({ ok: false, message: "定期実行用シークレットが設定されていません。" });
    return;
  }
  if (!isAuthorized(request)) {
    response.status(401).json({ ok: false, message: "認証が必要です。" });
    return;
  }

  const dateKey = request.query?.date ?? jstDateKey();
  try {
    const result = await createScheduledSnapshot({
      date: dateKey,
      retryCount,
      requireGitHub: true,
    });
    response.status(result.skipped ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "正式Snapshotの取得またはGitHub保存に失敗しました。",
      retryCount,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
