import twitterText from "twitter-text";
import { formatOverallScore, formatUsername } from "./display-formatters.js";

const HARD_LIMIT = 280;
const PRIORITY_CATEGORIES = [
  { key: "deployer", label: "Deployer" },
  { key: "developer", label: "Builder" },
  { key: "llmUsage", label: "LLM Gateway" },
  { key: "bnkr", label: "$BNKR" },
];
const SECONDARY_CATEGORIES = [
  { key: "referral", label: "Referral" },
  { key: "nft", label: "NFTs" },
  { key: "partner", label: "Ecosystem" },
  { key: "pnl", label: "PNL" },
  { key: "og", label: "OG" },
];

export function generatePosts(observation) {
  const draftPosts = buildCategoryResearchPosts(observation);
  const numbered = withThreadNumbers(draftPosts);
  return {
    items: numbered.map((post, index) => ({
      index: index + 1,
      text: post.text,
      jaSummary: post.jaSummary,
      length: tweetLength(post.text),
    })),
    omissions: numbered.flatMap((post) => post.omissions ?? []),
  };
}

function buildCategoryResearchPosts(observation) {
  const categoryState = categoryPostState(observation);
  if (categoryState.status === "not-comparable") return baselineWaitingPosts(observation);
  if (categoryState.status === "no-category-change") return noCategoryChangePosts(observation);
  return categoryMoverPosts(observation, categoryState);
}

function categoryPostState(observation) {
  const caseResearch = observation?.caseResearch;
  if (!caseResearch || !["complete", "limited"].includes(caseResearch.status)) {
    return { status: "not-comparable" };
  }

  const categories = [...PRIORITY_CATEGORIES, ...SECONDARY_CATEGORIES]
    .map((category) => categoryPostGroup(category, caseResearch.categoryRankings?.[category.key]))
    .filter((category) => category.increases.length || category.decreases.length);
  const priorityChanges = categories.filter((category) => PRIORITY_CATEGORIES.some((item) => item.key === category.key));
  if (!priorityChanges.length && !categories.length) return { status: "no-category-change" };

  return {
    status: "comparable",
    categories,
    priorityChanges,
    crossCategoryLeads: crossCategoryLeads(categories),
    rankMovers: rankMoverRows(observation, categories),
  };
}

function categoryPostGroup(category, ranking) {
  const increases = cleanRankingRows(ranking?.rawIncreases).slice(0, 3);
  const decreases = notableDecreaseRows(cleanRankingRows(ranking?.rawDecreases));
  return {
    ...category,
    increases,
    decreases,
  };
}

function cleanRankingRows(rows = []) {
  return rows
    .filter((row) => {
      const rawDiff = row?.diff?.rawDiff;
      return typeof rawDiff === "number" && Number.isFinite(rawDiff) && rawDiff !== 0 && formattedDiff(rawDiff) !== "+0";
    })
    .map((row) => ({
      username: formatUsername(row.username),
      rawDiff: row.diff.rawDiff,
      rankBefore: row.rankBefore ?? row.rank?.old ?? null,
      rankAfter: row.rankAfter ?? row.rank?.new ?? null,
    }));
}

function notableDecreaseRows(rows) {
  if (!rows.length) return [];
  const absoluteValues = rows.map((row) => Math.abs(row.rawDiff)).sort((a, b) => a - b);
  const median = absoluteValues[Math.floor(absoluteValues.length / 2)] ?? 0;
  return rows
    .filter((row, index) => {
      const rankChanged = row.rankBefore != null && row.rankAfter != null && row.rankBefore !== row.rankAfter;
      const clearlyLarge = median > 0 && Math.abs(row.rawDiff) >= median * 2;
      return index === 0 && (rankChanged || clearlyLarge);
    })
    .slice(0, 3);
}

function categoryMoverPosts(observation, state) {
  const interval = intervalLine(observation);
  const title = titleLine(observation);
  const posts = [];
  const rankPosts = rankMovementPosts(observation, state.rankMovers);
  posts.push(...rankPosts);
  const secondaryChanges = state.categories
    .filter((category) => SECONDARY_CATEGORIES.some((item) => item.key === category.key))
    .slice(0, 2);
  const queue = [
    ...PRIORITY_CATEGORIES.map((category) => state.categories.find((item) => item.key === category.key)).filter(Boolean),
    ...(secondaryChanges.length >= 2 ? secondaryChanges : []),
  ];

  let firstCategory = queue.shift();
  if (firstCategory && posts.length < 4) {
    posts.push(packPost({
      prefix: compactLines([
        posts.length ? null : title,
        posts.length ? null : interval,
        "Category raw increase Top3",
      ]),
      groups: [firstCategory],
      jaSummary: categoryJa([firstCategory], "最重要カテゴリのraw増加Top3と順位変動"),
    }));
  }

  while (queue.length && posts.length < 4) {
    const groupBatch = queue.splice(0, 2);
    posts.push(packPost({
      prefix: [],
      groups: groupBatch,
      jaSummary: categoryJa(groupBatch, `${groupBatch.map((group) => group.label).join("と")}のraw増加Top3`),
    }));
  }

  posts.push(researchLeadPost(observation, state));
  return posts.filter(Boolean).slice(0, 5);
}

function rankMovementPosts(observation, rows) {
  const title = titleLine(observation);
  const interval = intervalLine(observation);
  const prefix = compactLines([title, interval, "Top 50 rank movement Top3"]);
  if (!rows.length) {
    return [{
      text: compactLines([...prefix, "No Top 50 rank changes found."]).join("\n"),
      jaSummary: [
        "・TOP50内の順位変動はありません",
        "・Entered / Exited Top50は別枠で扱う",
      ].join("\n"),
    }];
  }

  const posts = [];
  let remaining = rows.slice(0, 3);
  let currentPrefix = prefix;
  while (remaining.length) {
    const { kept, rest } = fitRankRows(currentPrefix, remaining);
    posts.push({
      text: compactLines([...currentPrefix, ...kept.map(rankMoverLine)]).join("\n"),
      jaSummary: rankMoverJa(kept),
    });
    remaining = rest;
    currentPrefix = ["Rank movement Top3 continued"];
  }
  return posts;
}

function fitRankRows(prefix, rows) {
  for (let count = Math.min(3, rows.length); count >= 1; count -= 1) {
    const text = compactLines([...prefix, ...rows.slice(0, count).map(rankMoverLine)]).join("\n");
    if (tweetLengthPlaceholder(text) <= HARD_LIMIT) {
      return { kept: rows.slice(0, count), rest: rows.slice(count) };
    }
  }
  return { kept: rows.slice(0, 1), rest: rows.slice(1) };
}

function rankMoverRows(observation, categories) {
  const categoryByUser = categoryChangesByUser(categories);
  return (observation?.summary?.rankMovers ?? [])
    .map((user) => {
      const username = formatUsername(user.username);
      return {
        username,
        rankBefore: user.rank?.old ?? null,
        rankAfter: user.rank?.new ?? null,
        rankDiff: user.rank?.change ?? null,
        overallBefore: user.overallScore?.old ?? null,
        overallAfter: user.overallScore?.new ?? null,
        overallDiff: user.overallScore?.change ?? null,
        categoryChanges: categoryByUser.get(username) ?? [],
      };
    })
    .sort((a, b) => {
      const rankSort = Math.abs(b.rankDiff ?? 0) - Math.abs(a.rankDiff ?? 0);
      if (rankSort) return rankSort;
      const overallSort = Math.abs(b.overallDiff ?? 0) - Math.abs(a.overallDiff ?? 0);
      if (overallSort) return overallSort;
      return (a.rankAfter ?? Number.MAX_SAFE_INTEGER) - (b.rankAfter ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, 3);
}

function categoryChangesByUser(categories) {
  const byUser = new Map();
  for (const category of categories) {
    for (const row of [...category.increases, ...category.decreases]) {
      const changes = byUser.get(row.username) ?? [];
      changes.push({ label: category.label, rawDiff: row.rawDiff });
      byUser.set(row.username, changes);
    }
  }
  for (const [username, changes] of byUser.entries()) {
    byUser.set(username, changes.sort((a, b) => Math.abs(b.rawDiff) - Math.abs(a.rawDiff)).slice(0, 2));
  }
  return byUser;
}

function rankMoverLine(row, index) {
  const categoryText = row.categoryChanges.length
    ? row.categoryChanges.map((item) => `${item.label} ${formattedDiff(item.rawDiff)}`).join(", ")
    : "No comparable non-zero category change found.";
  return `${index + 1}. ${row.username} rank ${rankTransition(row)} Δ${formattedSigned(row.rankDiff)} | overall ${formatOverallScore(row.overallBefore)}→${formatOverallScore(row.overallAfter)} | cats: ${categoryText}`;
}

function rankMoverJa(rows) {
  return compactLines([
    "・TOP50全体の順位変動Top3",
    ...rows.map((row) => `・${row.username}: rank ${rankTransition(row)} / Overall ${formatOverallScore(row.overallBefore)}→${formatOverallScore(row.overallAfter)}`),
    "・同期間のカテゴリ変化は最大2件まで表示",
  ]).join("\n");
}

function packPost({ prefix, groups, jaSummary }) {
  const preferred = postFromGroups(prefix, groups, 3);
  if (tweetLengthPlaceholder(preferred) <= HARD_LIMIT) {
    return { text: preferred, jaSummary };
  }
  const top2 = postFromGroups(prefix, groups, 2);
  if (tweetLengthPlaceholder(top2) <= HARD_LIMIT) {
    return { text: top2, jaSummary: `${jaSummary}\n・文字数調整のためTop2まで表示` };
  }
  const firstOnly = postFromGroups(prefix, groups.slice(0, 1), 2);
  return {
    text: firstOnly,
    jaSummary: `${groups[0].label}のraw増加上位を表示\n・文字数調整のため他カテゴリは別投稿から省略`,
    omissions: groups.slice(1).map((group) => `${group.label} omitted for length`),
  };
}

function postFromGroups(prefix, groups, limit) {
  return compactLines([
    ...prefix,
    ...groups.flatMap((group) => categoryLines(group, limit)),
  ]).join("\n");
}

function categoryLines(group, limit = 3) {
  const lines = [];
  if (group.increases.length) {
    lines.push(`${group.label} raw increases:`);
    lines.push(...group.increases.slice(0, limit).map((row, index) => moverLine(row, index)));
  }
  if (group.decreases.length) {
    lines.push(`${group.label} notable decreases:`);
    lines.push(...group.decreases.slice(0, limit).map((row, index) => moverLine(row, index)));
  }
  return lines;
}

function moverLine(row, index) {
  return `${index + 1}. ${row.username} ${formattedDiff(row.rawDiff)} | rank ${rankTransition(row)}`;
}

function researchLeadPost(observation, state) {
  const context = contextLines(observation);
  const membership = membershipLines(observation);
  const crossCategory = state.crossCategoryLeads.length
    ? ["Cross-category leads:", ...state.crossCategoryLeads.map((lead) => lead)]
    : [];
  const preferredLines = compactLines([
    ...crossCategory,
    ...membership,
    "These are stored raw-value changes.",
    "They do not explain rank movement by themselves.",
    "Research leads:",
    "• Check largest category movers",
    "• Compare repeated Builder/LLM patterns",
    ...context,
    "Public leaderboard observation.",
    "Not an official explanation.",
  ]);
  const fallbackLines = compactLines([
    ...crossCategory,
    ...membership,
    "These are stored raw-value changes.",
    "They do not explain rank movement by themselves.",
    "Public leaderboard observation.",
    "Not an official explanation.",
  ]);
  const preferredText = preferredLines.join("\n");
  const text = tweetLengthPlaceholder(preferredText) <= HARD_LIMIT ? preferredText : fallbackLines.join("\n");
  return {
    text,
    jaSummary: compactLines([
      state.crossCategoryLeads.length ? "・複数カテゴリで上位に入ったユーザーを確認" : null,
      membership.length ? "・TOP50新規入り/退出は順位変動とは別枠で表示" : null,
      "・raw変動は原因を証明しない",
      "・次に公開活動を確認する対象を示す",
      "・公開Leaderboard観測に基づく",
    ]).join("\n"),
  };
}

function baselineWaitingPosts(observation) {
  const title = titleLine(observation);
  const topRows = currentTopRows(observation).map(
    (row) => `${row.rank}. ${formatUsername(row.username)} | overall ${formatOverallScore(row.overallScore)}`,
  );
  return [
    {
      text: compactLines([
        title,
        "Current Top 50 preview:",
        ...topRows,
        "Top 50 category comparison is waiting for two comparable detailed snapshots.",
      ]).join("\n"),
      jaSummary: [
        "・現在の順位とOverall Scoreを暫定表示",
        "・カテゴリ別Top3は生成しない",
        "・旧TOP10をTOP50カテゴリ比較に使わない",
      ].join("\n"),
    },
    {
      text: [
        "Current status:",
        "• Top 50 leaderboard data available",
        "• Category comparison waiting for two comparable detailed snapshots",
        "Category mover posts will begin after the next valid comparison.",
        "Public data observation.",
      ].join("\n"),
      jaSummary: [
        "・TOP50軽量データは利用可能",
        "・カテゴリ比較は2件の詳細Snapshot待ち",
        "・次回の有効比較からカテゴリ投稿を開始",
      ].join("\n"),
    },
  ];
}

function noCategoryChangePosts(observation) {
  const title = titleLine(observation);
  const rankRows = rankMoverRows(observation, []);
  return [
    {
      text: compactLines([
        title,
        rankRows.length ? "Top 50 rank movement Top3:" : "No Top 50 rank changes found.",
        ...rankRows.slice(0, 2).map(rankMoverLine),
        "No non-zero stored raw-value changes were detected in the priority categories.",
      ]).join("\n"),
      jaSummary: [
        rankRows.length ? "・順位変動Top3を表示" : "・TOP50内の順位変動なし",
        "・優先カテゴリで非ゼロraw差分なし",
        "・0差分からTop3を作らない",
      ].join("\n"),
    },
    {
      text: [
        "The snapshot was recorded successfully.",
        "Next watch:",
        "Will category changes appear in the next scheduled comparison?",
        "Public data observation.",
      ].join("\n"),
      jaSummary: [
        "・Snapshotは正常記録",
        "・次回比較でカテゴリ変動が出るか確認",
        "・公開Leaderboard観測に基づく",
      ].join("\n"),
    },
  ];
}

function contextLines(observation) {
  const summary = observation?.summary;
  if (!summary) return [];
  const lines = [];
  if (summary.rankMovers.length) lines.push(`Context: ${summary.rankMovers.length} accounts changed rank.`);
  if (summary.newUsers.length || summary.exitedUsers.length) {
    lines.push(`${summary.newUsers.length} entered and ${summary.exitedUsers.length} exited the Top 50.`);
  }
  return lines;
}

function membershipLines(observation) {
  const summary = observation?.summary;
  if (!summary) return [];
  const lines = [];
  if (summary.newUsers.length) {
    lines.push("Entered Top50:");
    lines.push(...summary.newUsers.slice(0, 2).map((user) => formatUsername(user.username)).filter(Boolean));
    if (summary.newUsers.length > 2) lines.push(`+${summary.newUsers.length - 2} more`);
  }
  if (summary.exitedUsers.length) {
    lines.push("Exited Top50:");
    lines.push(...summary.exitedUsers.slice(0, 2).map((user) => formatUsername(user.username)).filter(Boolean));
    if (summary.exitedUsers.length > 2) lines.push(`+${summary.exitedUsers.length - 2} more`);
  }
  return lines;
}

function crossCategoryLeads(categories) {
  const byUser = new Map();
  for (const category of categories) {
    for (const row of category.increases.slice(0, 3)) {
      if (!row.username) continue;
      const item = byUser.get(row.username) ?? [];
      item.push(category.label);
      byUser.set(row.username, item);
    }
  }
  return [...byUser.entries()]
    .filter(([, labels]) => labels.length >= 2)
    .slice(0, 2)
    .map(([username, labels]) => `${username}: Top3 in ${labels.slice(0, 3).join(" and ")} raw increases.`);
}

function categoryJa(groups, lead) {
  return compactLines([
    `・${lead}`,
    ...groups.map((group) => `・${group.label}: ${group.increases.length}件表示`),
    "・各ユーザーのrawDiffと同期間の順位変動を表示",
  ]).join("\n");
}

function titleLine(observation) {
  return `📊 Bankr Score Observatory${observation?.observationNumber ? ` #${observation.observationNumber}` : ""}`;
}

function intervalLine(observation) {
  const from = formatMonthDayTime(observation?.previousSnapshotAt);
  const to = formatMonthDayTime(observation?.currentSnapshotAt);
  return from && to ? `${from} → ${to} JST` : null;
}

function formatMonthDayTime(value) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const data = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${data.month}/${data.day} ${data.hour}:${data.minute}`;
}

function rankTransition(row) {
  const before = row.rankBefore ?? "?";
  const after = row.rankAfter ?? "?";
  return `${before}→${after}`;
}

function currentTopRows(observation) {
  return (observation?.currentTop50 ?? [])
    .filter((row) => row?.rank != null && row?.username)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3);
}

function limitThreadPosts(posts, maxPosts) {
  if (posts.length <= maxPosts) return posts;
  const kept = posts.slice(0, maxPosts - 1);
  const finalPost = posts.at(-1);
  return [...kept, finalPost];
}

function formattedDiff(value) {
  if (value == null || !Number.isFinite(value)) return "+0";
  const sign = value > 0 ? "+" : "";
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 100 ? 2 : abs >= 1 ? 4 : 7;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
  if (formatted === "0" || formatted === "-0") {
    return `${sign}${value.toPrecision(3)}`;
  }
  return `${sign}${formatted}`;
}

function formattedSigned(value) {
  if (value == null || !Number.isFinite(value)) return "?";
  return value > 0 ? `+${value}` : String(value);
}

function withThreadNumbers(posts) {
  const compacted = posts.map((post) => ({ ...post, text: post.text.trim() })).filter((post) => post.text);
  if (compacted.length <= 1) return compacted;
  return compacted.map((post, index) => {
    const prefix = `${index + 1}/${compacted.length}\n`;
    let text = `${prefix}${post.text}`;
    if (tweetLength(text) > HARD_LIMIT) {
      text = `${prefix}${fitLines(post.text.split("\n"), HARD_LIMIT - prefix.length)}`;
    }
    return { ...post, text };
  });
}

function fitLines(lines, limit = HARD_LIMIT) {
  const kept = [];
  for (const line of lines) {
    const next = [...kept, line].join("\n");
    if (tweetLength(next) > limit) break;
    kept.push(line);
  }
  return kept.join("\n");
}

function compactLines(lines) {
  return lines.filter(Boolean);
}

function tweetLengthPlaceholder(text) {
  return tweetLength(`1/5\n${text}`);
}

function tweetLength(text) {
  return twitterText.parseTweet(text).weightedLength;
}
