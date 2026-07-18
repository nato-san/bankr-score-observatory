import twitterText from "twitter-text";

const SAFE_LIMIT = 270;
const HARD_LIMIT = 280;
const PRIORITY_FIELDS = [
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
      jaSummary: summarizePostJa(text),
      length: twitterText.parseTweet(text).weightedLength,
    })),
    omissions: chunks.filter((chunk) => chunk.omitted),
  };
}

function buildChunks(observation) {
  const { summary } = observation;
  const chunks = [];
  chunks.push({
    priority: 1,
    text: `📊 Bankr Score Observatory #${observation.observationNumber}\n\nTop 10 changes`,
  });

  if (summary.rankMovers.length) {
    chunks.push({
      priority: 1,
      text: summary.rankMovers
        .slice(0, 5)
        .map((user) => `${user.rank.direction === "up" ? "↑" : "↓"} ${user.username} ${user.rank.old}→${user.rank.new}`)
        .join("\n"),
    });
  } else {
    chunks.push({ priority: 1, text: "No Top 10 rank changes were observed." });
  }

  if (summary.newUsers.length) {
    chunks.push({
      priority: 2,
      text: `New:\n${summary.newUsers.map((user) => user.username).join("\n")}`,
    });
  }
  if (summary.exitedUsers.length) {
    chunks.push({
      priority: 3,
      text: `Exited:\n${summary.exitedUsers.map((user) => user.username).join("\n")}`,
    });
  }

  if (summary.overallChanges.length) {
    chunks.push({
      priority: 4,
      text: `Overall Score:\n${summary.overallChanges
        .slice(0, 5)
        .map((user) => `${user.username} ${fmt(user.overallScore.old)}→${fmt(user.overallScore.new)}`)
        .join("\n")}`,
    });
  }

  for (const field of PRIORITY_FIELDS) {
    const group = summary.categoryGroups.find((item) => item.field === field);
    if (!group) {
      if (field === "Builder") chunks.push({ priority: 5, text: "Builder: no changes" });
      continue;
    }
    const lines = group.users
      .slice(0, field === "LLM Gateway" ? 5 : 4)
      .map((user) => {
        const change = user.change;
        const oldValue = "changed" in change ? change.old : fmt(change.old);
        const newValue = "changed" in change ? change.new : fmt(change.new);
        return `${user.username} ${oldValue}→${newValue}`;
      });
    chunks.push({
      priority: PRIORITY_FIELDS.indexOf(field) + 5,
      text: `${field}:\n${lines.join("\n")}`,
      omitted: group.users.length > lines.length,
    });
  }

  chunks.push({
    priority: 99,
    text: "Based on public leaderboard data.\nNot an official explanation.",
  });
  return chunks;
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
    let numbered = `${index + 1}/${posts.length}\n\n${post}`;
    if (tweetLength(numbered) <= HARD_LIMIT) return numbered;
    numbered = `${index + 1}/${posts.length}\n${post}`;
    return tweetLength(numbered) <= HARD_LIMIT ? numbered : post;
  });
}

function tweetLength(text) {
  return twitterText.parseTweet(text).weightedLength;
}

function fmt(value) {
  if (value == null) return "null";
  if (typeof value !== "number") return String(value);
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function summarizePostJa(text) {
  const lines = text
    .split("\n")
    .filter((line) => line.includes("@") || line.startsWith("New") || line.startsWith("Exited") || line.includes("no changes"))
    .slice(0, 5);
  if (!lines.length) return "公開Leaderboard観測に基づく注意書きです。";
  return lines.map((line) => `・${line}`).join("\n");
}
