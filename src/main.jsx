import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Copy,
  FileText,
  Play,
  RefreshCw,
} from "lucide-react";
import twitterText from "twitter-text";
import { CASE_CATEGORY_DEFINITIONS } from "./case-research.js";
import { formatUsername } from "./display-formatters.js";
import { buildObservation, summarizeDiff } from "./observations.js";
import { generatePosts } from "./post-generator.js";
import "./styles.css";

const OBSERVATION_ERROR =
  "最新Leaderboardの取得に失敗しました。前回の観測結果は更新されていません。";

function App() {
  const [view, setView] = useState("home");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState([]);
  const [postsReady, setPostsReady] = useState(false);
  const [copied, setCopied] = useState({});
  const [dataState, setDataState] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [manualMessage, setManualMessage] = useState("");
  const formalSnapshot = dataState?.scheduledState?.currentSnapshot ?? null;
  const observationMetadata = dataState?.scheduledState ?? dataState?.metadata;
  const currentTop50 = dataState?.newSnapshot ?? [];
  const currentTop50Profiles = dataState?.newTop50Profiles ?? [];
  const intradayPreview = dataState?.intradayPreview ?? null;
  const intradaySummary = useMemo(
    () => (intradayPreview?.status === "success" ? summarizeDiff(intradayPreview.diff) : null),
    [intradayPreview],
  );
  const intradayProfileSummary = useMemo(
    () => (intradayPreview?.profileDiff ? summarizeDiff(intradayPreview.profileDiff) : null),
    [intradayPreview],
  );
  const currentSnapshotInvalid = formalSnapshot?.validation?.ok === false;
  const hasPreviousSnapshot = Boolean(dataState?.scheduledState?.previousSnapshot);
  const canCompare = Boolean(dataState?.canCompare && dataState?.diff);
  const homeDataQuality = useMemo(
    () => deriveDataQuality({
      currentSnapshot: formalSnapshot,
      top50: currentTop50,
      top50Profiles: currentTop50Profiles,
      caseResearch: dataState?.caseResearch,
      requireComparison: false,
    }),
    [formalSnapshot, currentTop50, currentTop50Profiles, dataState?.caseResearch],
  );
  const postUnavailableReason = postBlockReason({
    currentSnapshotInvalid,
    hasPreviousSnapshot,
    diff: dataState?.diff,
    oldSnapshot: dataState?.oldSnapshot,
    newSnapshot: dataState?.newSnapshot,
    previousSnapshot: dataState?.scheduledState?.previousSnapshot,
  });
  const observation = useMemo(() => {
    if (!dataState?.diff) return null;
    return buildObservation({
      oldSnapshot: dataState.oldSnapshot ?? [],
      newSnapshot: dataState.newSnapshot ?? [],
      diff: dataState.diff,
      metadata: observationMetadata,
      caseResearch: dataState.caseResearch,
    });
  }, [dataState, observationMetadata]);
  const summary = useMemo(
    () => (dataState?.diff ? summarizeDiff(dataState.diff) : null),
    [dataState],
  );
  const posts = useMemo(
    () => (observation ? generatePosts(observation) : { items: [], omissions: [] }),
    [observation],
  );
  const lastObservation = observation?.createdAt
    ? new Date(observation.createdAt).toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "未取得";

  useEffect(() => {
    refreshState();
  }, []);

  async function refreshState() {
    try {
      const fixtureMode = new URLSearchParams(window.location.search).get("fixture");
      const localFixtures = new Set(["case-research", "case-baseline", "case-real-ab"]);
      const stateUrl = localFixtures.has(fixtureMode) ? `/api/state?fixture=${fixtureMode}` : "/api/state";
      const response = await fetch(stateUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("state api failed");
      setDataState(await response.json());
      setLoadError("");
    } catch {
      setLoadError("ローカル観測APIに接続できません。");
    }
  }

  async function startObservation() {
    setRunning(true);
    setProgress([]);
    setLoadError("");
    setManualMessage("");
    setProgress((current) => [...current, "現在値を確認中..."]);
    try {
      const response = await fetch("/api/observe", {
        method: "POST",
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || OBSERVATION_ERROR);
      }
      const profileCount = payload.state?.scheduledState?.currentSnapshot?.profileCaptureStatus?.completeUsers
        ?? payload.state?.scheduledState?.currentSnapshot?.top50ProfilesCaptured
        ?? payload.state?.newTop50Profiles?.length;
      setProgress((current) => [
        ...current,
        profileCount ? `詳細プロフィール ${profileCount}件を取得完了` : "詳細プロフィールを取得完了",
      ]);
      setProgress((current) => [...current, "手動の現在値として保存"]);
      setProgress((current) => [...current, "正式Snapshotは作成していません"]);
      setDataState(payload.state);
      setManualMessage("現在値を確認しました。正式Snapshotは作成していません。");
      setRunning(false);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : OBSERVATION_ERROR);
      setProgress((current) => [...current, OBSERVATION_ERROR]);
      setRunning(false);
    }
  }

  function openPosts() {
    if (postUnavailableReason) return;
    setPostsReady(true);
    setView("posts");
  }

  async function copyText(text, key) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied((current) => ({ ...current, [key]: true }));
    } catch {
      setCopied((current) => ({ ...current, [`${key}-failed`]: true }));
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Public leaderboard observation</p>
          <h1>Bankr Score Observatory</h1>
        </div>
        <button className="icon-button" onClick={() => setView("home")} aria-label="Home">
          <RefreshCw size={20} />
        </button>
      </header>

      {view === "home" && (
        <section className="screen">
          <div className="status-grid">
            <StatusCard label="Last Observation" value={lastObservation} />
            <StatusCard label="正式Snapshot" value={formalSnapshot?.status === "success" ? "成功" : "未取得"} />
            <StatusCard label="Latest Post" value={postsReady ? "作成済み" : "未作成"} />
            <StatusCard label="Manual Current" value={dataState?.manualCurrent?.capturedAt ? "確認済み" : "未確認"} />
          </div>
          <OfficialSnapshotCard
            snapshot={formalSnapshot}
            dataQuality={homeDataQuality}
            comparisonAvailable={canCompare}
            comparisonReason={!hasPreviousSnapshot ? "初回Baselineのため日次比較不可" : null}
          />
          <InvalidSnapshotCard failedAttempt={dataState?.scheduledState?.lastFailedAttempt} />
          {manualMessage && <div className="success-card">{manualMessage}</div>}
          {loadError && <div className="error-card">{loadError}</div>}
          <button className="primary-button" onClick={startObservation} disabled={running}>
            <Play size={20} />
            現在値を確認
          </button>
          {running && (
            <div className="progress-card">
              {progress.map((step) => (
                <p key={step}>
                  <Check size={16} /> {step}
                </p>
              ))}
            </div>
          )}
          {dataState?.manualCurrent?.capturedAt && (
            <button className="ghost-button" onClick={() => setView("intraday")}>
              現在値との差を見る
            </button>
          )}
          <button className="ghost-button" onClick={() => setView("changes")} disabled={!canCompare}>
            変動を見る
          </button>
          {!canCompare && (
            <div className="warning-card">
              2件の正式Snapshotがそろうまで、正式な日次変動は表示できません。
            </div>
          )}
        </section>
      )}

      {view === "changes" && (
        dataState?.scheduledState?.currentSnapshot ? (
          <ChangesScreen
            observation={observation}
            summary={summary}
            diff={dataState.diff}
            top50={currentTop50}
            top50Profiles={currentTop50Profiles}
            currentSnapshot={formalSnapshot}
            previousSnapshot={dataState.scheduledState?.previousSnapshot}
            caseResearch={dataState.caseResearch}
            isFixture={String(dataState.storage ?? "").includes("fixture")}
            canCompare={canCompare}
            compareUnavailableReason={dataState.compareUnavailableReason}
            postUnavailableReason={postUnavailableReason}
            onCreatePosts={openPosts}
          />
        ) : (
          <section className="screen">
            <div className="error-card">{loadError || "観測データを読み込めません。"}</div>
            <button className="ghost-button" onClick={() => setView("home")}>戻る</button>
          </section>
        )
      )}

      {view === "posts" && (
        <PostsScreen
          posts={posts}
          copied={copied}
          onCopy={copyText}
          onBack={() => setView("changes")}
        />
      )}

      {view === "intraday" && (
        <IntradayScreen
          preview={intradayPreview}
          summary={intradaySummary}
          profileSummary={intradayProfileSummary}
          onBack={() => setView("home")}
        />
      )}

      <AppVersionFooter />
    </main>
  );
}

function AppVersionFooter() {
  const buildInfo = typeof __APP_BUILD_INFO__ === "object" ? __APP_BUILD_INFO__ : {};
  const parts = [
    buildInfo.version,
    buildInfo.commit,
    buildInfo.buildTime ? `build ${formatJst(buildInfo.buildTime)}` : null,
  ].filter(Boolean);

  if (!parts.length) return null;

  return (
    <footer className="app-version">
      <span>Bankr Score Observatory</span>
      <span>{parts.join(" · ")}</span>
    </footer>
  );
}

function StatusCard({ label, value }) {
  return (
    <article className="status-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function OfficialSnapshotCard({ snapshot, dataQuality, comparisonAvailable, comparisonReason }) {
  return (
    <section className="snapshot-meta">
      <h3>正式Snapshot</h3>
      <p><span>予定時刻</span>{formatJst(snapshot?.scheduledFor)}</p>
      <p><span>取得時刻</span>{formatJst(snapshot?.capturedAt)}</p>
      <p><span>状態</span>{snapshot?.status === "success" ? "成功" : "未取得"}</p>
      {snapshot?.leaderboardVersion && <p><span>Leaderboard</span>{snapshot.leaderboardVersion}</p>}
      {snapshot?.totalUsersCaptured != null && <p><span>取得件数</span>{snapshot.totalUsersCaptured}</p>}
      <p><span>Snapshot Quality</span>{formatQualityStatus(dataQuality)}</p>
      <p>
        <span>Comparison</span>
        {comparisonAvailable ? "Available（比較可能）" : `Unavailable（比較不可）${comparisonReason ? ` - ${comparisonReason}` : ""}`}
      </p>
    </section>
  );
}

function InvalidSnapshotCard({ failedAttempt }) {
  if (!failedAttempt) return null;
  return (
    <section className="error-card">
      <strong>直近の取得失敗</strong>
      <p>{formatJst(failedAttempt.capturedAt)}</p>
      <p>{failedAttempt.error}</p>
      {failedAttempt.validation?.errors?.length > 0 && (
        <ul className="compact-list">
          {failedAttempt.validation.errors.slice(0, 5).map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function postBlockReason({ currentSnapshotInvalid, hasPreviousSnapshot, diff, oldSnapshot, newSnapshot, previousSnapshot }) {
  if (currentSnapshotInvalid) return "TOP50 Snapshotがvalidではないため投稿文は作成できません。";
  if (previousSnapshot?.validation?.ok === false) return "Previous Snapshotがvalidではないため投稿文は作成できません。";
  if (!hasPreviousSnapshot) {
    return "初回Baseline Snapshotのため、まだ投稿文は作成できません。次回の正式Snapshot取得後から変動を比較できます。";
  }
  if (!diff) return "Diffがまだ生成されていないため投稿文は作成できません。";
  if (diff.scope?.startsWith("intraday")) return "Intraday PreviewはDaily Research投稿に使用できません。";
  if (!isCompleteTop50(oldSnapshot) || !isCompleteTop50(newSnapshot)) {
    return "TOP50が50件そろっていないため投稿文は作成できません。";
  }
  if (hasMissingOverallScore(oldSnapshot) || hasMissingOverallScore(newSnapshot)) {
    return "Overall Score欠損があるため投稿文は作成できません。";
  }
  return "";
}

function isCompleteTop50(snapshot) {
  return Array.isArray(snapshot) && snapshot.length === 50;
}

function hasMissingOverallScore(snapshot) {
  return !Array.isArray(snapshot) || snapshot.some((user) => user.overallScore == null || user.overallScore === "");
}

const QUALITY_LABELS = {
  complete: { en: "Complete", ja: "完全" },
  partial: { en: "Partial", ja: "一部欠損" },
  invalid: { en: "Invalid", ja: "無効" },
  unavailable: { en: "Unavailable", ja: "利用不可" },
};

function formatQualityStatus(quality) {
  const label = QUALITY_LABELS[quality?.status] ?? QUALITY_LABELS.unavailable;
  return `${label.en}（${label.ja}）`;
}

function deriveDataQuality({
  currentSnapshot,
  previousSnapshot = null,
  top50 = [],
  top50Profiles = [],
  caseResearch = null,
  requireComparison = false,
} = {}) {
  const validation = currentSnapshot?.validation ?? null;
  const previousValidation = previousSnapshot?.validation ?? null;
  const top50Captured = currentSnapshot?.totalUsersCaptured ?? (Array.isArray(top50) ? top50.length : 0);
  const captureStatus = currentSnapshot?.profileCaptureStatus ?? null;
  const detailedRequested = captureStatus?.requested
    ?? (currentSnapshot?.top50ProfilesCaptured != null ? 50 : top50Profiles.length ? top50Profiles.length : 0);
  const detailedCaptured = captureStatus?.completeUsers
    ?? currentSnapshot?.top50ProfilesCaptured
    ?? (Array.isArray(top50Profiles) ? top50Profiles.length : 0);
  const failedProfiles = currentSnapshot?.failedProfiles ?? [];
  const caseSummary = caseResearch?.summary ?? null;
  const comparableUsers = caseSummary?.comparableUsers ?? null;
  const currentOnlyUsers = caseSummary?.currentOnlyUsers ?? 0;
  const partialUsers = caseSummary?.partialUsers ?? 0;
  const unavailableUsers = caseSummary?.unavailableUsers ?? 0;
  const partialUnavailable = partialUsers + unavailableUsers;
  const delayMinutes = scheduleDelayMinutes(currentSnapshot?.scheduledFor, currentSnapshot?.capturedAt);
  const reasons = [];

  let status = "complete";

  if (!currentSnapshot) {
    status = "unavailable";
    reasons.push("正式Snapshotがまだ取得されていません。");
  } else if (validation?.ok === false) {
    status = "invalid";
    reasons.push("Current Snapshot validationが失敗しています。");
  } else if (top50Captured !== 50) {
    status = "invalid";
    reasons.push("Top 50取得件数が50件ではありません。");
  } else if (detailedRequested === 0) {
    status = "partial";
    reasons.push("詳細プロフィール取得件数を確認できません。");
  } else if (requireComparison && !previousSnapshot) {
    status = "unavailable";
    reasons.push("Previous Snapshotがないため日次比較はまだ評価できません。");
  } else if (requireComparison && previousValidation?.ok === false) {
    status = "invalid";
    reasons.push("Previous Snapshot validationが失敗しています。");
  } else if (detailedRequested > 0 && detailedCaptured < detailedRequested) {
    status = "partial";
    reasons.push("詳細プロフィールに一部欠損があります。");
  } else if (failedProfiles.length > 0) {
    status = "partial";
    reasons.push("取得失敗プロフィールがあります。");
  } else if (requireComparison && caseResearch?.status === "baseline") {
    status = "unavailable";
    reasons.push("初回Baselineのためカテゴリ比較は次回Snapshotから利用可能です。");
  } else if (requireComparison && !caseSummary) {
    status = "unavailable";
    reasons.push("Case Research比較情報がまだありません。");
  } else if (requireComparison && caseSummary && comparableUsers !== null && comparableUsers < 50) {
    status = "partial";
    reasons.push("比較可能な詳細プロフィールが50件未満です。");
  } else if (requireComparison && partialUnavailable > 0) {
    status = "partial";
    reasons.push("Partial / Unavailableが存在します。");
  }

  if (!reasons.length) {
    reasons.push(status === "complete"
      ? "設定した取得・検証条件を満たしています。"
      : "利用可能な品質情報が不足しています。");
  }

  return {
    status,
    labelEn: QUALITY_LABELS[status].en,
    labelJa: QUALITY_LABELS[status].ja,
    reasons,
    metrics: {
      top50Captured,
      top50Expected: 50,
      detailedCaptured,
      detailedRequested,
      comparableUsers,
      currentOnlyUsers,
      partialUsers,
      unavailableUsers,
      partialUnavailable,
      failedProfiles,
      validation,
      previousValidation,
      leaderboardVersion: currentSnapshot?.leaderboardVersion ?? null,
      scheduledFor: currentSnapshot?.scheduledFor ?? null,
      capturedAt: currentSnapshot?.capturedAt ?? null,
      delayMinutes,
      snapshotStatus: currentSnapshot?.status ?? null,
      comparisonAvailable: Boolean(requireComparison ? previousSnapshot && caseResearch?.status !== "baseline" : currentSnapshot),
    },
  };
}

function scheduleDelayMinutes(scheduledFor, capturedAt) {
  if (!scheduledFor || !capturedAt) return null;
  const scheduled = new Date(scheduledFor);
  const captured = new Date(capturedAt);
  if (Number.isNaN(scheduled.getTime()) || Number.isNaN(captured.getTime())) return null;
  const diff = captured.getTime() - scheduled.getTime();
  if (diff < 0) return null;
  return Math.round(diff / 60000);
}

function ChangesScreen({
  observation,
  summary,
  top50,
  top50Profiles,
  currentSnapshot,
  previousSnapshot,
  caseResearch,
  isFixture,
  canCompare,
  compareUnavailableReason,
  postUnavailableReason,
  onCreatePosts,
}) {
  const [selectedCategory, setSelectedCategory] = useState("deployer");
  const [top50Expanded, setTop50Expanded] = useState(false);
  const [qualityExpanded, setQualityExpanded] = useState(false);
  const selectedRanking = caseResearch?.categoryRankings?.[selectedCategory];
  const captureStatus = currentSnapshot?.profileCaptureStatus;
  const detailedCaptured = captureStatus?.completeUsers
    ?? currentSnapshot?.top50ProfilesCaptured
    ?? top50Profiles.length;
  const detailedRequested = captureStatus?.requested
    ?? (currentSnapshot?.top50ProfilesCaptured != null ? 50 : top50Profiles.length ? top50Profiles.length : 0);
  const comparableUsers = caseResearch?.summary?.comparableUsers ?? 0;
  const currentOnlyUsers = caseResearch?.summary?.currentOnlyUsers ?? 0;
  const partialUnavailableUsers = (caseResearch?.summary?.partialUsers ?? 0) + (caseResearch?.summary?.unavailableUsers ?? 0);
  const categoryBaseline = caseResearch?.status === "baseline";
  const hasCaseSummary = Boolean(caseResearch?.summary);
  const dataQuality = deriveDataQuality({
    currentSnapshot,
    previousSnapshot,
    top50,
    top50Profiles,
    caseResearch,
    requireComparison: true,
  });
  return (
    <section className="screen changes-screen">
      <div className="section-head">
        <p className="eyebrow">Today's Changes</p>
        <h2>変動サマリー</h2>
      </div>
      {isFixture && (
        <div className="fixture-warning">
          <strong>TEST FIXTURE / SYNTHETIC DATA</strong>
          <p>この画面はローカル確認用です。合成された前回値を含み、本番データではありません。</p>
        </div>
      )}
      <div className="snapshot-meta">
        <p><span>Current snapshot</span>{formatUtc(observation?.currentSnapshotAt ?? currentSnapshot?.capturedAt)}</p>
        <p><span>Previous snapshot</span>{formatUtc(observation?.previousSnapshotAt)}</p>
        <p><span>Source</span>{observation?.source ?? "Live Bankr Leaderboard"}</p>
      </div>
      <DataQualityPanel
        quality={dataQuality}
        expanded={qualityExpanded}
        onToggle={() => setQualityExpanded((expanded) => !expanded)}
      />
      {!canCompare && (
        <div className="warning-card">
          <strong>初回Baseline Snapshotです。</strong>
          <p>{compareUnavailableReason || "次回の正式Snapshot取得後から変動を比較できます。"}</p>
          <p>次回の正式Snapshot取得後から変動を比較できます。</p>
        </div>
      )}
      <div className="metric-grid">
        <Metric label="Top 50 Rank Movers" value={canCompare ? summary.rankMovers.length : "比較不可"} />
        <Metric label="Entered Top 50" value={canCompare ? summary.newUsers.length : "比較不可"} />
        <Metric label="Exited Top 50" value={canCompare ? summary.exitedUsers.length : "比較不可"} />
        <Metric label="Overall Score" value={canCompare ? summary.overallChanges.length : "比較不可"} />
        <Metric label="Detailed Profiles" value={detailedRequested ? `${detailedCaptured}/${detailedRequested}` : "未取得"} />
      </div>
      <div className="snapshot-meta">
        <p><span>Detailed profiles</span>{detailedRequested ? `${detailedCaptured} / ${detailedRequested} captured` : "未取得"}</p>
        <p><span>Comparable with previous snapshot</span>{hasCaseSummary ? `${comparableUsers} / 50` : "比較不可"}</p>
        <p><span>Current only</span>{hasCaseSummary ? currentOnlyUsers : "比較不可"}</p>
        <p><span>Partial / unavailable</span>{hasCaseSummary ? partialUnavailableUsers : "比較不可"}</p>
      </div>
      {categoryBaseline && (
        <div className="success-card">
          <strong>Category baseline collected.</strong>
          <p>Category changes and detected cases will be available after the next scheduled snapshot.</p>
          <p>カテゴリ比較用の初回データを保存しました。次回の正式Snapshotからカテゴリ変動を比較できます。</p>
        </div>
      )}

      <Card title="TOP50内順位変動">
        {!canCompare ? (
          <EmptyLine text="比較対象となる前回Snapshotがないため、順位変動は表示しません" />
        ) : summary.rankMovers.length ? (
          summary.rankMovers.map((user) => <RankMover key={user.profileUrl} user={user} />)
        ) : (
          <EmptyLine text="順位変動はありません" />
        )}
      </Card>

      <div className="two-stack">
        <Card title="Entered Top 50">
          {!canCompare ? (
            <EmptyLine text="初回Snapshotでは新規参入判定を行いません" />
          ) : summary.newUsers.length ? (
            summary.newUsers.map((user) => <UserLine key={user.profileUrl} user={user} />)
          ) : (
            <EmptyLine text="新規ランクインなし" />
          )}
        </Card>
        <Card title="Exited Top 50">
          {!canCompare ? (
            <EmptyLine text="初回Snapshotでは退出判定を行いません" />
          ) : summary.exitedUsers.length ? (
            summary.exitedUsers.map((user) => <UserLine key={user.profileUrl} user={user} />)
          ) : (
            <EmptyLine text="退出なし" />
          )}
        </Card>
      </div>

      <Card title={`TOP50一覧（${top50.length}）`}>
        <button
          type="button"
          className="collapse-button"
          aria-expanded={top50Expanded}
          aria-controls="top50-leaderboard-list"
          onClick={() => setTop50Expanded((expanded) => !expanded)}
        >
          {top50Expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          {top50Expanded ? "TOP50一覧を閉じる" : "TOP50一覧を表示"}
        </button>
        {top50.length ? (
          <div id="top50-leaderboard-list" className="leaderboard-list" hidden={!top50Expanded}>
            {top50.map((user) => (
              <div className="leaderboard-row" key={user.profileUrl || user.username}>
                <span>{user.rank}</span>
                <strong>{formatUsername(user.username)}</strong>
                <span>{formatValue(user.overallScore)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine text="TOP50を確認できません" />
        )}
      </Card>

      <Card title="カテゴリ変動">
        {!canCompare ? (
          <EmptyLine text="比較対象となる前回Snapshotがないため、カテゴリ変動は表示しません" />
        ) : summary.categoryGroups.length ? (
          summary.categoryGroups.map((group) => (
            <details key={group.field} className="category-detail" open={group.field === "LLM Gateway"}>
              <summary>
                <span>{group.field}</span>
                <span>{group.users.length}</span>
                <ChevronDown size={18} />
              </summary>
              {group.users.map((item) => (
                <div className="change-line" key={`${group.field}-${item.profileUrl}`}>
                  <strong>{formatUsername(item.username)}</strong>
                  <span>
                    {formatValue(item.change.old)} → {formatValue(item.change.new)}
                  </span>
                </div>
              ))}
            </details>
          ))
        ) : (
          <EmptyLine text="Top 50順位一覧のデータとは別に取得した詳細プロフィールを使用して、カテゴリ変動を比較しています。" />
        )}
      </Card>

      <Card title="Category Changes">
        {categoryBaseline ? (
          <EmptyLine text="Category baseline collected. 次回の正式Snapshotからカテゴリ変動を比較できます" />
        ) : !canCompare ? (
          <EmptyLine text="比較対象となる前回Snapshotがないため、カテゴリ変動ランキングは表示しません" />
        ) : caseResearch?.status === "unavailable" ? (
          <EmptyLine text="TOP50詳細データがそろっていないため、カテゴリ変動ランキングは表示できません" />
        ) : (
          <>
            <div className="case-meta-row">
              <span>Case Detection</span>
              <strong>{caseResearch?.status === "complete" ? "Complete" : "Limited"}</strong>
              <span>{comparableUsers} comparable users</span>
            </div>
            <div className="category-tabs" role="tablist" aria-label="Category selector">
              {CASE_CATEGORY_DEFINITIONS.filter((category) => category.key !== "social").map((category) => (
                <button
                  type="button"
                  key={category.key}
                  className={selectedCategory === category.key ? "category-tab active" : "category-tab"}
                  onClick={() => setSelectedCategory(category.key)}
                >
                  {category.label}
                </button>
              ))}
            </div>
            <CategoryRanking title="Largest raw increases" rows={selectedRanking?.rawIncreases?.slice(0, 3) ?? []} />
            <CategoryRanking title="Largest raw decreases" rows={selectedRanking?.rawDecreases?.slice(0, 3) ?? []} />
          </>
        )}
      </Card>

      <Card title="Detected Cases">
        {categoryBaseline ? (
          <EmptyLine text="Case Detection: Waiting for next comparable snapshot" />
        ) : !canCompare ? (
          <EmptyLine text="比較対象となる前回Snapshotがないため、Case Detectionは行いません" />
        ) : caseResearch?.cases?.length ? (
          <div className="case-list">
            {caseResearch.cases.slice(0, 12).map((item) => (
              <CaseCard key={item.caseId} item={item} />
            ))}
          </div>
        ) : (
          <EmptyLine text="検出されたCaseはありません" />
        )}
      </Card>

      <button className="primary-button sticky-action" onClick={onCreatePosts} disabled={Boolean(postUnavailableReason)}>
        <FileText size={20} />
        X投稿文を作成
      </button>
      {postUnavailableReason && <div className="warning-card">{postUnavailableReason}</div>}
    </section>
  );
}

function CategoryRanking({ title, rows }) {
  return (
    <div className="ranking-block">
      <h4>{title}</h4>
      {rows.length ? (
        rows.map((item) => (
          <div className="category-row" key={`${item.accountId || item.username}-${item.category}-${title}`}>
            <div>
              <strong>{formatUsername(item.username)}</strong>
              <span>rank {formatRankTransition(item.rankBefore, item.rankAfter)}</span>
            </div>
            <div>
              <span>stored raw value</span>
              <strong>{formatValue(item.diff.rawBefore)} → {formatValue(item.diff.rawAfter)}</strong>
              <small>{formatSigned(item.diff.rawDiff)}</small>
            </div>
            <div>
              <span>API score</span>
              <strong>{formatValue(item.diff.scoreBefore)} → {formatValue(item.diff.scoreAfter)}</strong>
            </div>
          </div>
        ))
      ) : (
        <EmptyLine text="該当するraw value changeはありません" />
      )}
    </div>
  );
}

function DataQualityPanel({ quality, expanded, onToggle }) {
  const detailsId = "data-quality-details";
  const metrics = quality.metrics ?? {};
  const failedProfiles = metrics.failedProfiles ?? [];
  const failedPreview = failedProfiles.slice(0, 4).map((item) => formatUsername(item.username)).filter(Boolean);
  const failedMore = Math.max(0, failedProfiles.length - failedPreview.length);

  return (
    <section className={`data-quality-panel ${quality.status}`}>
      <div className="data-quality-head">
        <div>
          <span>DATA QUALITY</span>
          <strong>{formatQualityStatus(quality)}</strong>
        </div>
        <span className={`quality-pill ${quality.status}`}>{quality.labelJa}</span>
      </div>
      <div className="quality-metrics">
        <QualityMetric label="Top 50" value={`${metrics.top50Captured ?? 0} / ${metrics.top50Expected ?? 50}`} />
        <QualityMetric
          label="Detailed Profiles"
          subLabel="詳細プロフィール"
          value={metrics.detailedRequested ? `${metrics.detailedCaptured} / ${metrics.detailedRequested}` : "未取得"}
        />
        <QualityMetric
          label="Comparable"
          subLabel="比較可能"
          value={metrics.comparableUsers == null ? "比較不可" : `${metrics.comparableUsers} / 50`}
        />
        <QualityMetric label="Partial / Unavailable" value={metrics.partialUnavailable ?? 0} />
      </div>
      <button
        type="button"
        className="quality-toggle"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        {expanded ? "品質詳細を閉じる" : "品質詳細を表示"}
      </button>
      <div id={detailsId} className="quality-details" hidden={!expanded}>
        <QualityDetail label="Current Snapshot validation" value={formatValidation(metrics.validation)} />
        <QualityDetail label="Previous Snapshot validation" value={formatValidation(metrics.previousValidation)} />
        <QualityDetail label="Current Only" value={metrics.currentOnlyUsers ?? 0} />
        <QualityDetail label="Failed Profiles（取得失敗）" value={failedProfiles.length} />
        {failedPreview.length > 0 && (
          <p className="quality-list">{failedPreview.join(", ")}{failedMore ? ` +${failedMore}` : ""}</p>
        )}
        <QualityDetail label="Leaderboard Version" value={metrics.leaderboardVersion ?? "未取得"} />
        <QualityDetail label="Scheduled At" value={formatJst(metrics.scheduledFor)} />
        <QualityDetail label="Captured At" value={formatJst(metrics.capturedAt)} />
        {metrics.delayMinutes != null && (
          <QualityDetail label="Schedule Delay（取得遅延）" value={`${metrics.delayMinutes}分`} />
        )}
        <QualityDetail label="Compare Availability" value={metrics.comparisonAvailable ? "Available（比較可能）" : "Unavailable（比較不可）"} />
        <QualityDetail label="Snapshot status" value={metrics.snapshotStatus ?? "未取得"} />
        <div className="quality-reasons">
          {quality.reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
          <p>Data Qualityは取得completenessと比較可能性を示すものであり、Bankr公式スコア計算の正しさを保証するものではありません。</p>
        </div>
      </div>
    </section>
  );
}

function QualityMetric({ label, subLabel, value }) {
  return (
    <div className="quality-metric">
      <span>{label}</span>
      {subLabel && <small>{subLabel}</small>}
      <strong>{value}</strong>
    </div>
  );
}

function QualityDetail({ label, value }) {
  return (
    <p>
      <span>{label}</span>
      <strong>{value}</strong>
    </p>
  );
}

function formatValidation(validation) {
  if (!validation) return "未取得";
  return validation.ok === false ? "Invalid（無効）" : "Valid（有効）";
}

function CaseCard({ item }) {
  return (
    <article className="case-card">
      <div className="case-card-head">
        <strong>{formatUsername(item.username)}</strong>
        <span className={`completeness ${item.dataCompleteness}`}>{formatCompleteness(item.dataCompleteness)}</span>
      </div>
      <div className="case-facts">
        <span>Observation</span>
        <strong>{formatJst(item.observationFrom)} → {formatJst(item.observationTo)}</strong>
        <span>Rank</span>
        <strong>{formatRankTransition(item.rankBefore, item.rankAfter)}</strong>
        <span>Overall Score</span>
        <strong>{formatValue(item.overallBefore)} → {formatValue(item.overallAfter)} ({formatSigned(item.overallDiff)})</strong>
      </div>
      <div className="reason-tags">
        {item.detectionReasons.map((reason) => (
          <span key={reason}>{reason}</span>
        ))}
      </div>
      {item.notableVisibleChanges.length > 0 && (
        <div className="notable-list">
          {item.notableVisibleChanges.slice(0, 4).map((change) => (
            <p key={`${change.category}-${change.direction}-${change.categoryRank}`}>
              {change.categoryLabel}: {change.direction} rank #{change.categoryRank} in category, raw diff {formatSigned(change.rawDiff)}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}

function IntradayScreen({ preview, summary, profileSummary, onBack }) {
  if (!preview || preview.status !== "success" || !summary) {
    return (
      <section className="screen">
        <div className="section-head">
          <p className="eyebrow">Intraday Preview</p>
          <h2>現在値との途中比較</h2>
        </div>
        <div className="warning-card">{preview?.reason || "途中比較を生成できません。"}</div>
        <button className="ghost-button" onClick={onBack}>ホームへ戻る</button>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="section-head">
        <p className="eyebrow">Intraday Preview</p>
        <h2>現在値との途中比較</h2>
      </div>
      <div className="warning-card">{preview.note}</div>
      <div className="snapshot-meta">
        <p><span>Formal snapshot</span>{formatJst(preview.formalSnapshot?.capturedAt)}</p>
        <p><span>Manual current</span>{formatJst(preview.manualCurrent?.capturedAt)}</p>
        <p><span>Source</span>{preview.manualCurrent?.source ?? "Live Bankr Leaderboard"}</p>
      </div>
      <div className="metric-grid">
        <Metric label="Top 50 Rank Movers" value={summary.rankMovers.length} />
        <Metric label="Entered Top 50" value={summary.newUsers.length} />
        <Metric label="Exited Top 50" value={summary.exitedUsers.length} />
        <Metric label="Overall Score" value={summary.overallChanges.length} />
        <Metric label="Detailed Category Users" value={profileSummary?.categoryChangeUserCount ?? "未取得"} />
      </div>

      <Card title="TOP50内順位変動">
        {summary.rankMovers.length ? (
          summary.rankMovers.map((user) => <RankMover key={user.profileUrl} user={user} />)
        ) : (
          <EmptyLine text="順位変動はありません" />
        )}
      </Card>

      <div className="two-stack">
        <Card title="Entered Top 50">
          {summary.newUsers.length ? (
            summary.newUsers.map((user) => <UserLine key={user.profileUrl} user={user} />)
          ) : (
            <EmptyLine text="新規ランクインなし" />
          )}
        </Card>
        <Card title="Exited Top 50">
          {summary.exitedUsers.length ? (
            summary.exitedUsers.map((user) => <UserLine key={user.profileUrl} user={user} />)
          ) : (
            <EmptyLine text="退出なし" />
          )}
        </Card>
      </div>

      <Card title="Overall Score変動">
        {summary.overallChanges.length ? (
          summary.overallChanges.map((user) => (
            <div className="change-line" key={user.profileUrl || user.username}>
              <strong>{formatUsername(user.username)}</strong>
              <span>{formatValue(user.overallScore.old)} → {formatValue(user.overallScore.new)}</span>
            </div>
          ))
        ) : (
          <EmptyLine text="Overall Score変動はありません" />
        )}
      </Card>

      <Card title="詳細プロフィールカテゴリ変動">
        {profileSummary?.categoryGroups.length ? (
          profileSummary.categoryGroups.map((group) => (
            <details key={group.field} className="category-detail" open={group.field === "Builder"}>
              <summary>
                <span>{group.field}</span>
                <span>{group.users.length}</span>
                <ChevronDown size={18} />
              </summary>
              {group.users.map((item) => (
                <div className="change-line" key={`${group.field}-${item.profileUrl}`}>
                  <strong>{formatUsername(item.username)}</strong>
                  <span>
                    {formatValue(item.change.old)} → {formatValue(item.change.new)}
                  </span>
                </div>
              ))}
            </details>
          ))
        ) : preview.profileDiff ? (
          <EmptyLine text="詳細プロフィールカテゴリ変動はありません" />
        ) : (
          <EmptyLine text="詳細プロフィールがそろっていないため、カテゴリ差分は表示しません" />
        )}
      </Card>

      <button className="ghost-button" onClick={onBack}>ホームへ戻る</button>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <article className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function Card({ title, children }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function RankMover({ user }) {
  const isUp = user.rank.direction === "up";
  return (
    <div className={`rank-line ${isUp ? "up" : "down"}`}>
      {isUp ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
      <strong>{formatUsername(user.username)}</strong>
      <span>
        {user.rank.old} → {user.rank.new}
      </span>
    </div>
  );
}

function UserLine({ user }) {
  return (
    <div className="user-line">
      <strong>{formatUsername(user.username)}</strong>
      {user.rank?.new && <span>rank {user.rank.new}</span>}
      {user.rank?.old && !user.rank?.new && <span>old rank {user.rank.old}</span>}
    </div>
  );
}

function EmptyLine({ text }) {
  return <p className="empty-line">{text}</p>;
}

function PostsScreen({ posts, copied, onCopy, onBack }) {
  const allText = posts.items.map((post) => post.text).join("\n\n---\n\n");
  const nextIndex = posts.items.findIndex((post) => !copied[`post-${post.index}`]);

  return (
    <section className="screen">
      <div className="section-head">
        <p className="eyebrow">Thread: {posts.items.length} posts</p>
        <h2>X投稿文確認</h2>
      </div>
      <div className="next-card">
        <span>Next</span>
        <strong>{nextIndex >= 0 ? `Post ${nextIndex + 1}` : "すべてコピー済み"}</strong>
      </div>
      {posts.omissions.length > 0 && (
        <div className="warning-card">{posts.omissions.length} low-priority changes were omitted from the X post.</div>
      )}
      {posts.items.map((post) => (
        <PostCard
          key={post.index}
          post={post}
          copied={copied[`post-${post.index}`]}
          failed={copied[`post-${post.index}-failed`]}
          onCopy={() => onCopy(post.text, `post-${post.index}`)}
        />
      ))}
      <button className="secondary-button" onClick={() => onCopy(allText, "all-posts")}>
        <Copy size={18} />
        全投稿をまとめてコピー
      </button>
      {copied["all-posts"] && <p className="copy-ok">✓ 全投稿をコピーしました</p>}
      <button className="ghost-button" onClick={onBack}>変動画面へ戻る</button>
    </section>
  );
}

function PostCard({ post, copied, failed, onCopy }) {
  const count = twitterText.parseTweet(post.text).weightedLength;
  const warn = count > 270 && count <= 280;
  const error = count > 280;
  return (
    <article className="post-card">
      <div className="post-meta">
        <strong>Post {post.index}</strong>
        <span className={error ? "count error" : warn ? "count warn" : "count"}>{count} / 280</span>
      </div>
      <pre>{post.text}</pre>
      {warn && <p className="warning-text">文字数に余裕がありません</p>}
      {error && <p className="error-text">280文字を超えています</p>}
      <button className="copy-button" disabled={error} onClick={onCopy}>
        <Clipboard size={18} />
        {copied ? "✓ Copied" : "コピー"}
      </button>
      {failed && <p className="error-text">コピーできませんでした。文章を長押ししてコピーしてください。</p>}
      <div className="ja-summary">
        <strong>日本語確認</strong>
        <p>{post.jaSummary}</p>
      </div>
    </article>
  );
}

function formatValue(value) {
  if (value == null) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\\.00$/, "");
  return value;
}

function formatSigned(value) {
  if (value == null) return "unavailable";
  const formatted = formatValue(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return "0";
}

function formatRankTransition(before, after) {
  const oldRank = before == null ? "TOP50圏外" : before;
  const newRank = after == null ? "TOP50圏外" : after;
  return `${oldRank} → ${newRank}`;
}

function formatCompleteness(value) {
  if (value === "complete") return "Complete";
  if (value === "partial") return "Partial";
  if (value === "current-only") return "Current only";
  return "Unavailable";
}

function formatUtc(value) {
  if (!value) return "未取得";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function formatJst(value) {
  if (!value) return "未取得";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute} JST`;
}

createRoot(document.getElementById("root")).render(<App />);
