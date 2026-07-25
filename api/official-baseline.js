import { createOfficialBaseline, jstDateKey } from "../work/scheduled-bankr-snapshot.mjs";

export const config = {
  maxDuration: 60,
};

function configuredSecret() {
  return process.env.BANKR_ADMIN_SECRET || process.env.ADMIN_SECRET || process.env.CRON_SECRET || process.env.BANKR_SCHEDULE_SECRET;
}

function requestSecret(request) {
  const auth = request.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return request.headers["x-bankr-admin-secret"];
}

function isAuthorized(request) {
  return Boolean(configuredSecret()) && requestSecret(request) === configuredSecret();
}

function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string" && request.body.trim()) {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(request, response) {
  response.setHeader("cache-control", "no-store");
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!configuredSecret()) {
    response.status(503).json({ ok: false, message: "管理者用シークレットが設定されていません。" });
    return;
  }
  if (!isAuthorized(request)) {
    response.status(401).json({ ok: false, message: "管理者認証が必要です。" });
    return;
  }

  const body = readBody(request);
  const reason = String(body.reason ?? "").trim();
  const actor = String(body.actor ?? "").trim();
  if (!reason || !actor) {
    response.status(400).json({ ok: false, message: "実行理由と実行者を入力してください。" });
    return;
  }

  try {
    const result = await createOfficialBaseline({
      date: body.date ?? jstDateKey(),
      reason,
      actor,
      requireGitHub: true,
    });
    response.status(201).json({
      ok: true,
      baselinePath: result.baselinePath,
      state: result.state,
      snapshot: {
        capturedAt: result.snapshot.capturedAt,
        leaderboardSource: result.snapshot.leaderboardSource,
        validation: result.snapshot.validation,
        profileCaptureStatus: result.snapshot.profiles?.captureStatus ?? null,
        officialBaseline: result.snapshot.officialBaseline,
      },
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: "Official Baselineの作成に失敗しました。",
      detail: error instanceof Error ? error.message : String(error),
      validation: error?.validation ?? null,
    });
  }
}
