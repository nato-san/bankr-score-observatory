import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  FileText,
  Play,
  RefreshCw,
} from "lucide-react";
import twitterText from "twitter-text";
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
  const observation = useMemo(() => {
    if (!dataState?.diff) return null;
    return buildObservation({
      oldSnapshot: dataState.oldSnapshot ?? [],
      newSnapshot: dataState.newSnapshot ?? [],
      diff: dataState.diff,
      metadata: observationMetadata,
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
      const response = await fetch("/api/state", { cache: "no-store" });
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
      setProgress((current) => [...current, "Top10 Profileを取得完了"]);
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
          <OfficialSnapshotCard snapshot={formalSnapshot} />
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
          <button className="ghost-button" onClick={() => setView("changes")}>
            変動を見る
          </button>
        </section>
      )}

      {view === "changes" && (
        observation && summary ? (
          <ChangesScreen
            observation={observation}
            summary={summary}
            diff={dataState.diff}
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
    </main>
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

function OfficialSnapshotCard({ snapshot }) {
  return (
    <section className="snapshot-meta">
      <h3>正式Snapshot</h3>
      <p><span>予定時刻</span>{formatJst(snapshot?.scheduledFor)}</p>
      <p><span>取得時刻</span>{formatJst(snapshot?.capturedAt)}</p>
      <p><span>状態</span>{snapshot?.status === "success" ? "成功" : "未取得"}</p>
    </section>
  );
}

function ChangesScreen({ observation, summary, diff, onCreatePosts }) {
  return (
    <section className="screen">
      <div className="section-head">
        <p className="eyebrow">Today's Changes</p>
        <h2>変動サマリー</h2>
      </div>
      <div className="snapshot-meta">
        <p><span>Current snapshot</span>{formatUtc(observation.currentSnapshotAt)}</p>
        <p><span>Previous snapshot</span>{formatUtc(observation.previousSnapshotAt)}</p>
        <p><span>Source</span>{observation.source}</p>
      </div>
      <div className="metric-grid">
        <Metric label="Rank Movers" value={summary.rankMovers.length} />
        <Metric label="New Top 10" value={summary.newUsers.length} />
        <Metric label="Exited Top 10" value={summary.exitedUsers.length} />
        <Metric label="Overall Score" value={summary.overallChanges.length} />
        <Metric label="Category Changes" value={summary.categoryChangeUserCount} />
      </div>

      <Card title="順位変動">
        {summary.rankMovers.length ? (
          summary.rankMovers.map((user) => <RankMover key={user.profileUrl} user={user} />)
        ) : (
          <EmptyLine text="順位変動はありません" />
        )}
      </Card>

      <div className="two-stack">
        <Card title="New Top 10">
          {summary.newUsers.length ? (
            summary.newUsers.map((user) => <UserLine key={user.profileUrl} user={user} />)
          ) : (
            <EmptyLine text="新規ランクインなし" />
          )}
        </Card>
        <Card title="Exited Top 10">
          {summary.exitedUsers.length ? (
            summary.exitedUsers.map((user) => <UserLine key={user.profileUrl} user={user} />)
          ) : (
            <EmptyLine text="退出なし" />
          )}
        </Card>
      </div>

      <Card title="カテゴリ変動">
        {summary.categoryGroups.map((group) => (
          <details key={group.field} className="category-detail" open={group.field === "LLM Gateway"}>
            <summary>
              <span>{group.field}</span>
              <span>{group.users.length}</span>
              <ChevronDown size={18} />
            </summary>
            {group.users.map((item) => (
              <div className="change-line" key={`${group.field}-${item.profileUrl}`}>
                <strong>{item.username}</strong>
                <span>
                  {formatValue(item.change.old)} → {formatValue(item.change.new)}
                </span>
              </div>
            ))}
          </details>
        ))}
      </Card>

      <button className="primary-button sticky-action" onClick={onCreatePosts}>
        <FileText size={20} />
        X投稿文を作成
      </button>
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
      <strong>{user.username}</strong>
      <span>
        {user.rank.old} → {user.rank.new}
      </span>
    </div>
  );
}

function UserLine({ user }) {
  return (
    <div className="user-line">
      <strong>{user.username}</strong>
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
