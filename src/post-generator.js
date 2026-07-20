import twitterText from "twitter-text";
import { formatUsername } from "./display-formatters.js";

const SAFE_LIMIT = 270;
const HARD_LIMIT = 280;
const LARGE_RANK_MOVE = 5;
const DETAIL_CATEGORY_FIELDS = [
  "Builder",
  "LLM Gateway",
  "Ecosystem",
  "Social",
  "$BNKR",
  "Deployer",
  "PNL",
  "Referral",
  "NFTs",
  "OG",
];

export function generatePosts(observation) {
  const chunks = buildChunks(observation);
  const packed = packChunks(chunks);
  const numbered = withThreadNumbers(packed);
  return {
    items: numbered.map((text, index) => ({
      index: index + 1,
      text,
      jaSummary: summarizePostJa(text, observation),
      length: twitterText.parseTweet(text).weightedLength,
    })),
    omissions: chunks.filter((chunk) => chunk.omitted),
  };
}

function buildChunks(observation) {
  const { summary } = observation;
  const currentTop50Count = currentTop50Size(observation);
  const largestMove = largestRankMove(summary.rankMovers);
  const largeMovers = largeRankMovers(summary.rankMovers).slice(0, 2);
  const chunks = [
    {
      priority: 1,
      text: compactLines([
        `📊 Bankr Score Observatory${observation.observationNumber ? ` #${observation.observationNumber}` : ""}`,
        "Validated Top 50 comparison:",
        rankMoveLine(summary.rankMovers.length),
        largestMove > 0 ? `• Largest move: ${largestMove} ${positionWord(largestMove)}` : null,
        membershipSummaryLine(summary),
        overallScoreLine(summary.overallChanges.length, currentTop50Count),
      ]).join("\n"),
    },
  ];

  if (largeMovers.length) {
    chunks.push({
      priority: 2,
      text: [
        "Largest move:",
        ...largeMovers.map((user) => `${formatUsername(user.username)} ${user.rank.old}→${user.rank.new}`),
      ].join("\n"),
    });
  }

  const membershipLines = membershipDetailLines(summary);
  if (membershipLines.length) {
    chunks.push({
      priority: 3,
      text: membershipLines.join("\n"),
    });
  }

  const categoryLines = categoryObservationLines(summary);
  if (categoryLines.length) {
    chunks.push({
      priority: 4,
      text: ["Tracked Top 10 profiles:", ...categoryLines].join("\n"),
    });
  }

  chunks.push({
    priority: 99,
    text: "Too early for causal conclusions.\nPublic data observation.",
  });
  return chunks;
}

function currentTop50Size(observation) {
  const currentUsers = observation.diff?.users?.filter((user) => user.status !== "exited") ?? [];
  return currentUsers.length || 50;
}

function largestRankMove(rankMovers) {
  return rankMovers.reduce((max, user) => Math.max(max, Math.abs(user.rank.change ?? 0)), 0);
}

function largeRankMovers(rankMovers) {
  return [...rankMovers]
    .filter((user) => Math.abs(user.rank.change ?? 0) >= LARGE_RANK_MOVE)
    .sort((a, b) => Math.abs(b.rank.change ?? 0) - Math.abs(a.rank.change ?? 0));
}

function membershipDetailLines(summary) {
  const lines = [];
  if (summary.newUsers.length > 0 && summary.newUsers.length <= 2) {
    lines.push("Entered Top 50:", ...summary.newUsers.map((user) => formatUsername(user.username)));
  }
  if (summary.exitedUsers.length > 0 && summary.exitedUsers.length <= 2) {
    lines.push("Exited Top 50:", ...summary.exitedUsers.map((user) => formatUsername(user.username)));
  }
  return lines;
}

function categoryObservationLines(summary) {
  return DETAIL_CATEGORY_FIELDS.flatMap((field) => {
    const group = summary.categoryGroups.find((item) => item.field === field);
    if (!group) return [];
    const largest = largestCategoryChange(group);
    if (group.users.length < 2 && largest < LARGE_RANK_MOVE && field !== "Builder") return [];
    return [`${field} changed for ${group.users.length} tracked Top 10 ${accountWord(group.users.length)}.`];
  }).slice(0, 3);
}

function largestCategoryChange(group) {
  return group.users.reduce((max, user) => {
    const change = user.change;
    if (!change || typeof change.change !== "number") return max;
    return Math.max(max, Math.abs(change.change));
  }, 0);
}

function overallScoreLine(changes, total) {
  if (changes === 0) return "• No Overall Score changes were observed";
  return `• ${changes} of ${total} ${accountWord(total)} showed Overall Score updates`;
}

function rankMoveLine(count) {
  if (count === 0) return "• No rank changes were observed";
  return `• ${count} ${accountWord(count)} changed rank`;
}

function membershipSummaryLine(summary) {
  if (summary.newUsers.length === 0 && summary.exitedUsers.length === 0) return null;
  if (summary.newUsers.length > 0 && summary.exitedUsers.length > 0) {
    return `• ${summary.newUsers.length} entered and ${summary.exitedUsers.length} exited the Top 50`;
  }
  if (summary.newUsers.length > 0) return `• ${summary.newUsers.length} entered the Top 50`;
  return `• ${summary.exitedUsers.length} exited the Top 50`;
}

function compactLines(lines) {
  return lines.filter(Boolean);
}

function accountWord(count) {
  return count === 1 ? "account" : "accounts";
}

function positionWord(count) {
  return count === 1 ? "position" : "positions";
}

function packChunks(chunks) {
  const posts = [];
  let current = "";
  const ordered = [...chunks].sort((a, b) => a.priority - b.priority);

  for (const chunk of ordered) {
    const candidate = current ? `${current}\n\n${chunk.text}` : chunk.text;
    if (tweetLength(candidate) <= SAFE_LIMIT) {
      current = candidate;
      continue;
    }
    if (current) posts.push(current);
    current = chunk.text;
  }
  if (current) posts.push(current);
  return posts.flatMap((post) => splitOversizedPost(post));
}

function splitOversizedPost(post) {
  if (tweetLength(post) <= SAFE_LIMIT) return [post];
  const lines = post.split("\n");
  const parts = [];
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (tweetLength(candidate) <= SAFE_LIMIT) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = line;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function withThreadNumbers(posts) {
  if (posts.length <= 1) return posts;
  return posts.map((post, index) => {
    const numbered = `${index + 1}/${posts.length}\n\n${post}`;
    if (tweetLength(numbered) <= HARD_LIMIT) return numbered;
    return `${index + 1}/${posts.length}\n${post}`;
  });
}

function tweetLength(text) {
  return twitterText.parseTweet(text).weightedLength;
}

function summarizePostJa(text, observation) {
  const { summary } = observation;
  const total = currentTop50Size(observation);
  const largestMove = largestRankMove(summary.rankMovers);
  const lines = [];

  if (text.includes("Validated Top 50 comparison")) {
    lines.push(`・TOP50内で${summary.rankMovers.length}人が順位変動`);
    if (largestMove > 0) lines.push(`・最大変動は${largestMove}位`);
    if (summary.newUsers.length || summary.exitedUsers.length) {
      lines.push(`・TOP50新規入り${summary.newUsers.length}人、退出${summary.exitedUsers.length}人`);
    }
    lines.push(
      summary.overallChanges.length
        ? `・${total}人中${summary.overallChanges.length}人でOverall Score変動`
        : "・Overall Score変動は観測されていません",
    );
  }

  if (text.includes("Entered Top 50:")) {
    lines.push(`・TOP50新規入り：${summary.newUsers.map((user) => formatUsername(user.username)).join("、")}`);
  }
  if (text.includes("Exited Top 50:")) {
    lines.push(`・TOP50退出：${summary.exitedUsers.map((user) => formatUsername(user.username)).join("、")}`);
  }
  if (text.includes("Tracked Top 10 profiles:")) {
    lines.push("・取得済みTOP10詳細プロフィールでカテゴリ変動を確認");
  }
  if (text.includes("Too early for causal conclusions.")) {
    lines.push("・因果関係はまだ判断しない");
  }
  if (text.includes("Public data observation.")) {
    lines.push("・公開Leaderboard観測に基づく");
  }

  return lines.join("\n") || "公開Leaderboard観測に基づく注意書きです。";
}
