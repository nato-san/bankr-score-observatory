import twitterText from "twitter-text";
import { formatOverallDiff, formatOverallScore, formatUsername } from "./display-formatters.js";

const X_HARD_LIMIT = 280;
// Post 1 keeps roughly 50-60 weighted chars free for possible X auto-inserted CA text.
const POST_ONE_WEIGHTED_LIMIT = 220;
const OTHER_POST_WEIGHTED_LIMIT = 270;
const MAX_POSTS = 5;
const CATEGORY_LIMIT = 2;
const FOOTER_LINE = "Overall Top 50 comparison.";
const RESEARCH_NOTE_LINES = [
  "These observations are based on the public leaderboard.",
  "",
  "Raw-value changes do not necessarily explain rank movement by themselves.",
  "",
  "This observation system is still experimental and may contain errors.",
];
const CATEGORY_DEFINITIONS = [
  { key: "deployer", label: "Deployer" },
  { key: "developer", label: "Builder" },
  { key: "llmUsage", label: "LLM Gateway" },
  { key: "bnkr", label: "$BNKR" },
  { key: "referral", label: "Referral" },
  { key: "nft", label: "NFTs" },
  { key: "partner", label: "Ecosystem" },
  { key: "pnl", label: "PNL" },
  { key: "og", label: "OG" },
  { key: "social", label: "Social" },
];

export function generatePosts(observation) {
  const draftPosts = buildRankCenteredPosts(observation);
  const noted = addFinalResearchNote(draftPosts.slice(0, MAX_POSTS));
  const numbered = withThreadNumbers(noted);
  return {
    items: numbered.map((post, index) => ({
      index: index + 1,
      text: post.text,
      jaSummary: post.jaSummary,
      length: tweetLength(post.text),
      valid: twitterText.parseTweet(post.text).valid,
    })),
    omissions: numbered.flatMap((post) => post.omissions ?? []),
  };
}

function buildRankCenteredPosts(observation) {
  if (!isComparableObservation(observation)) return baselineWaitingPosts(observation);

  const posts = [];
  const categoryState = buildCategoryState(observation);
  const rankRows = rankMoverRows(observation, categoryState.categories);
  posts.push(overviewPost(observation, rankRows));
  posts.push(...rankMovementPosts(rankRows));
  posts.push(...categoryState.categories.map((category) => categoryPost(category)));

  const membership = membershipPost(observation);
  if (membership) posts.push(membership);

  return posts.filter(Boolean);
}

function overviewPost(observation, rankRows) {
  const membership = membershipCounts(observation);
  return {
    text: postLines([
      observationTitle(observation),
      "",
      "$BNKR Daily Observation",
      "",
      "🗓 Observation Period",
      intervalLine(observation),
      "",
      `Comparable users: ${comparableUsersText(observation)}`,
      "",
      `Rank movers: ${rankRows.length}`,
      "",
      `Entered Top 50: ${membership.entered}`,
      "",
      `Exited Top 50: ${membership.exited}`,
    ]),
    jaSummary: compactLines([
      `・比較可能ユーザー ${comparableUsersText(observation)}`,
      `・順位上昇 ${rankRows.length}件`,
      `・Top 50新規参加 ${membership.entered}件`,
      `・Top 50退出 ${membership.exited}件`,
    ]).join("\n"),
  };
}

function isComparableObservation(observation) {
  return ["complete", "limited"].includes(observation?.caseResearch?.status);
}

function buildCategoryState(observation) {
  const categories = CATEGORY_DEFINITIONS
    .map((category, originalOrder) => categoryPostGroup(category, originalOrder, observation?.caseResearch?.categoryRankings?.[category.key]))
    .filter((category) => category.rows.length > 0);
  return {
    categories: selectPostCategories(categories),
  };
}

function categoryPostGroup(category, originalOrder, ranking) {
  const increases = cleanRankingRows(ranking?.rawIncreases);
  const decreases = cleanRankingRows(ranking?.rawDecreases);
  const rows = uniqueRowsByUsername([...increases, ...decreases]);
  const maxAbsRawDiff = rows.reduce((max, row) => Math.max(max, Math.abs(row.rawDiff)), 0);
  return {
    ...category,
    originalOrder,
    increases,
    decreases,
    rows,
    nonZeroChangeCount: rows.length,
    maxAbsRawDiff,
  };
}

function selectPostCategories(categories) {
  const ordered = rankCategoryCandidates(categories);
  const usedUsers = new Set();
  const selected = [];

  for (const category of ordered) {
    const group = removeUsedCategoryUsers(category, usedUsers);
    if (!group.increases.length && !group.decreases.length) continue;
    selected.push(group);
    for (const row of [...group.increases, ...group.decreases]) {
      usedUsers.add(row.username);
    }
    if (selected.length >= CATEGORY_LIMIT) break;
  }

  return selected;
}

function rankCategoryCandidates(categories) {
  return [...categories].sort((a, b) => (
    b.nonZeroChangeCount - a.nonZeroChangeCount
    || b.maxAbsRawDiff - a.maxAbsRawDiff
    || a.originalOrder - b.originalOrder
  ));
}

function removeUsedCategoryUsers(category, usedUsers) {
  const localUsers = new Set();
  const keep = (row) => {
    if (!row.username || usedUsers.has(row.username) || localUsers.has(row.username)) return false;
    localUsers.add(row.username);
    return true;
  };
  const increases = category.increases.filter(keep);
  const decreases = category.decreases.filter(keep);
  return {
    ...category,
    increases,
    decreases,
    rows: [...increases, ...decreases],
  };
}

function cleanRankingRows(rows = []) {
  return rows
    .filter((row) => Number.isFinite(row?.diff?.rawDiff) && row.diff.rawDiff !== 0)
    .map((row) => ({
      username: formatUsername(row.username),
      rawBefore: finiteNumber(row.diff.rawBefore),
      rawAfter: finiteNumber(row.diff.rawAfter),
      rawDiff: row.diff.rawDiff,
      rankBefore: row.rankBefore ?? row.rank?.old ?? null,
      rankAfter: row.rankAfter ?? row.rank?.new ?? null,
    }))
    .filter((row) => row.username);
}

function uniqueRowsByUsername(rows) {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    if (seen.has(row.username)) continue;
    seen.add(row.username);
    unique.push(row);
  }
  return unique;
}

function rankMovementPosts(rows) {
  if (!rows.length) {
    return [{
      text: compactLines([
        "🏆 Biggest Rank Climbs (Top 50)",
        "No Top 50 rank rises found.",
      ]).join("\n"),
      jaSummary: "・TOP50内の順位上昇はありません",
    }];
  }

  const posts = [];
  const primary = fitPrimaryRankPost(rows);
  posts.push({
    text: primary.text,
    jaSummary: rankMoverJa(primary.kept),
  });

  let remaining = primary.rest;
  let currentPrefix = ["Top 50 rank movers continued"];
  while (remaining.length && posts.length < 2) {
    const { kept, rest, detailLevel } = fitRankRows(currentPrefix, remaining);
    posts.push({
      text: compactLines([...currentPrefix, ...kept.map((row, index) => rankMoverLine(row, index, detailLevel))]).join("\n"),
      jaSummary: rankMoverJa(kept),
    });
    remaining = rest;
    currentPrefix = ["Top 50 rank movers continued"];
  }
  return posts;
}

function fitPrimaryRankPost(rows) {
  const limit = OTHER_POST_WEIGHTED_LIMIT - tweetLength("1/5\n");
  const countFloor = rows.length >= 2 ? 2 : 1;
  const noteModes = ["none"];
  const periodLabels = ["🗓 Observation Period", "🗓 Period"];
  const rowLayouts = ["block", "inline"];

  for (let count = Math.min(3, rows.length); count >= countFloor; count -= 1) {
    for (const noteMode of noteModes) {
      for (const periodLabel of periodLabels) {
        for (const rowLayout of rowLayouts) {
          const text = primaryRankPostText(rows.slice(0, count), { noteMode, periodLabel, rowLayout });
          if (tweetLength(text) <= limit) {
            return { kept: rows.slice(0, count), rest: rows.slice(count, 3), text };
          }
        }
      }
    }
  }

  const text = primaryRankPostText(rows.slice(0, 1), {
    noteMode: "none",
    periodLabel: "🗓 Period",
    rowLayout: "inline",
  });
  return { kept: rows.slice(0, 1), rest: rows.slice(1, 3), text };
}

function primaryRankPostText(rows, { noteMode, periodLabel, rowLayout }) {
  const notes = noteMode === "full"
    ? ["Overall Top 50 comparison.", "", "Public leaderboard observation.", "Daily research thread."]
    : [];
  return postLines([
    "🏆 Biggest Rank Climbs (Top 50)",
    "",
    ...rows.flatMap((row, index) => primaryRankRowLines(row, index, rowLayout)),
    ...notes.length ? ["", ...notes] : [],
  ]);
}

function observationTitle(observation) {
  const number = Number(observation?.observationNumber);
  return Number.isInteger(number) && number > 0
    ? `📊 Bankr Score Observatory #${number}`
    : "📊 Bankr Score Observatory";
}

function primaryRankRowLines(row, index, rowLayout) {
  const medal = ["🥇", "🥈", "🥉"][index] ?? `${index + 1}.`;
  const title = `${medal} #${index + 1} ${row.username}`;
  const movement = `${row.rankBefore} → ${row.rankAfter} (+${row.rankDiff})`;
  return rowLayout === "inline" ? [`${title} ${movement}`, ""] : [title, movement, ""];
}

function fitRankRows(prefix, rows) {
  const detailLevels = ["full", "no-cats", "rank-only"];
  for (const detailLevel of detailLevels) {
    for (let count = Math.min(3, rows.length); count >= 1; count -= 1) {
      const text = compactLines([...prefix, ...rows.slice(0, count).map((row, index) => rankMoverLine(row, index, detailLevel))]).join("\n");
      if (tweetLength(text) <= OTHER_POST_WEIGHTED_LIMIT) {
        return { kept: rows.slice(0, count), rest: rows.slice(count, 3), detailLevel };
      }
    }
  }
  return { kept: rows.slice(0, 1), rest: rows.slice(1, 3), detailLevel: "rank-only" };
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
        rankDiff: finiteNumber(user.rank?.change),
        overallBefore: user.overallScore?.old ?? null,
        overallAfter: user.overallScore?.new ?? null,
        overallDiff: user.overallScore?.change ?? null,
        categoryChanges: categoryByUser.get(username) ?? [],
      };
    })
    .filter((row) => row.username && Number.isFinite(row.rankDiff) && row.rankDiff > 0)
    .sort((a, b) => (
      b.rankDiff - a.rankDiff
      || Math.abs(finiteNumber(b.overallDiff) ?? 0) - Math.abs(finiteNumber(a.overallDiff) ?? 0)
      || rankSortValue(a.rankAfter) - rankSortValue(b.rankAfter)
      || a.username.localeCompare(b.username)
    ))
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

function rankMoverLine(row, index, detailLevel = "full") {
  const categoryText = row.categoryChanges.length
    ? ` | cats: ${row.categoryChanges.map((item) => `${item.label} ${formattedRawDiff(item.rawDiff)}`).join(", ")}`
    : "";
  const rankLine = `${index + 1}. ${row.username} ${rankTransition(row)} ▲${row.rankDiff}`;
  if (detailLevel === "rank-only") return rankLine;
  const overallLine = `Overall ${formatOverallScore(row.overallBefore)}→${formatOverallScore(row.overallAfter)} (${formatOverallDiff(row.overallDiff)})`;
  return detailLevel === "no-cats" ? `${rankLine}\n${overallLine}` : `${rankLine}\n${overallLine}${categoryText}`;
}

function rankMoverJa(rows) {
  return compactLines([
    `・TOP50順位上昇Top${rows.length}`,
    ...rows.map((row, index) => `・${index + 1}位 ${row.username}: rank ${rankTransition(row)} / Overall ${formatOverallScore(row.overallBefore)}→${formatOverallScore(row.overallAfter)}`),
  ]).join("\n");
}

function categoryPost(category) {
  if (!category.increases.length) return null;
  const prefix = ["Category Highlights", "", categoryTitle(category)];
  const { keptIncreases, keptDecreases } = fitCategoryRows(prefix, category);
  const lines = compactLines([
    ...prefix,
    ...keptIncreases.map((row, index) => categoryRowLine(row, index)),
  ]);
  return {
    text: lines.join("\n"),
    jaSummary: categoryJa(category, keptIncreases, keptDecreases),
  };
}

function fitCategoryRows(prefix, category) {
  const increases = category.increases.slice(0, 3);
  const decreases = notableDecreaseRows(category.decreases).slice(0, 1);

  for (let increaseCount = increases.length; increaseCount >= Math.min(1, increases.length); increaseCount -= 1) {
    for (let decreaseCount = decreases.length; decreaseCount >= 0; decreaseCount -= 1) {
      const keptIncreases = increases.slice(0, increaseCount);
      const keptDecreases = decreases.slice(0, decreaseCount);
      const lines = compactLines([
        ...prefix,
        ...keptIncreases.map((row, index) => categoryRowLine(row, index)),
      ]);
      if (tweetLength(lines.join("\n")) <= OTHER_POST_WEIGHTED_LIMIT) return { keptIncreases, keptDecreases };
    }
  }

  return {
    keptIncreases: increases.slice(0, 1),
    keptDecreases: [],
  };
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

function categoryRowLine(row, index) {
  return index === 0
    ? `${row.username}\n${formattedRawDiff(row.rawDiff)} | rank ${rankTransition(row)}`
    : `\n${row.username}\n${formattedRawDiff(row.rawDiff)} | rank ${rankTransition(row)}`;
}

function categoryJa(category, increases, decreases) {
  return compactLines([
    `・${category.label} raw変化`,
    ...increases.map((row, index) => `・増加${index + 1}位 ${row.username}: ${formattedRawDiff(row.rawDiff)} / rank ${rankTransition(row)}`),
  ]).join("\n");
}

function membershipPost(observation) {
  const entered = observation?.summary?.newUsers ?? [];
  const exited = observation?.summary?.exitedUsers ?? [];
  if (!entered.length && !exited.length) return null;

  const baseLines = compactLines([
    "Top 50 update",
    entered.length ? `Entered: ${entered.length}` : null,
    ...entered.slice(0, 3).map((user) => formatUsername(user.username)).filter(Boolean),
    exited.length ? `Exited: ${exited.length}` : null,
    ...exited.slice(0, 3).map((user) => formatUsername(user.username)).filter(Boolean),
  ]);

  return {
    text: fitLines(baseLines, OTHER_POST_WEIGHTED_LIMIT),
    jaSummary: compactLines([
      entered.length ? `・Top 50新規参加 ${entered.length}件: ${entered.slice(0, 3).map((user) => formatUsername(user.username)).filter(Boolean).join(", ")}` : null,
      exited.length ? `・Top 50退出 ${exited.length}件: ${exited.slice(0, 3).map((user) => formatUsername(user.username)).filter(Boolean).join(", ")}` : null,
    ]).join("\n"),
  };
}

function addFinalResearchNote(posts) {
  if (!posts.length) return posts;
  const result = posts.map((post) => ({ ...post }));
  const lastIndex = result.length - 1;
  if (result[lastIndex].suppressResearchNote) return result;
  result.push({
    text: RESEARCH_NOTE_LINES.join("\n"),
    jaSummary: "・公開Leaderboard観測に基づく\n・raw値変化は順位変動の原因を断定しない\n・実験的な観測システムのため誤差の可能性あり",
  });
  return result;
}

function addNoteToPost(post, limit) {
  const notes = RESEARCH_NOTE_LINES;
  const text = compactLines([post.text, ...notes]).join("\n");
  if (tweetLength(text) > limit) return null;
  return {
    ...post,
    text,
    jaSummary: compactLines([post.jaSummary, "・raw値変化は順位変動の原因を断定しない", "・公開Leaderboard観測に基づく"]).join("\n"),
  };
}

function addCompressedNoteToPost(post) {
  const notes = RESEARCH_NOTE_LINES;
  return {
    ...post,
    text: fitLines([...post.text.split("\n"), ...notes], OTHER_POST_WEIGHTED_LIMIT, notes),
    jaSummary: compactLines([post.jaSummary, "・raw値変化は順位変動の原因を断定しない", "・公開Leaderboard観測に基づく"]).join("\n"),
  };
}

function baselineWaitingPosts(observation) {
  return [
    {
      text: compactLines([
        "📊 $BNKR Daily Observatory",
        "Official comparison is waiting for a previous detailed Snapshot.",
        "Current Snapshot is not treated as failed.",
        "Daily comparison can begin from the next valid Snapshot.",
      ]).join("\n"),
      jaSummary: compactLines([
        "・正式な比較元Snapshot待ち",
        "・現在Snapshot自体の失敗ではない",
        "・次回以降に日次比較可能",
      ]).join("\n"),
      suppressResearchNote: true,
    },
  ];
}

function membershipCounts(observation) {
  return {
    entered: observation?.summary?.newUsers?.length ?? 0,
    exited: observation?.summary?.exitedUsers?.length ?? 0,
  };
}

function comparableUsersText(observation) {
  const summary = observation?.caseResearch?.summary ?? {};
  const comparable = finiteNumber(summary.comparableUsers);
  if (comparable == null) return "?/?";
  const currentTop50Count = Array.isArray(observation?.currentTop50) ? observation.currentTop50.length : null;
  const inferredTotal = comparable
    + (finiteNumber(summary.currentOnlyUsers) ?? 0)
    + (finiteNumber(summary.unavailableUsers) ?? 0);
  const total = currentTop50Count && currentTop50Count > 0 ? currentTop50Count : inferredTotal;
  return `${comparable}/${total || "?"}`;
}

function categoryTitle(category) {
  const icon = {
    llmUsage: "🤖",
    bnkr: "💰",
    social: "👥",
    developer: "🏗",
    deployer: "🛠",
    partner: "🌱",
    nft: "🖼",
    referral: "🔗",
    pnl: "📈",
    og: "⭐",
  }[category.key];
  return icon ? `${icon} ${category.label}` : category.label;
}

function withThreadNumbers(posts) {
  const compacted = posts.map((post) => ({ ...post, text: post.text.trim() })).filter((post) => post.text);
  if (compacted.length <= 1) return compacted.map((post, index) => ensureSafeLimit(post, index));
  return compacted.map((post, index) => {
    const numberedPost = {
      ...post,
      text: `${index + 1}/${compacted.length}\n${post.text}`,
    };
    return ensureSafeLimit(numberedPost, index);
  });
}

function ensureSafeLimit(post, index = 0) {
  const parsed = twitterText.parseTweet(post.text);
  const limit = index === 0 ? POST_ONE_WEIGHTED_LIMIT : OTHER_POST_WEIGHTED_LIMIT;
  if (parsed.weightedLength <= limit && parsed.valid && parsed.weightedLength <= X_HARD_LIMIT) return post;
  return {
    ...post,
    text: fitLines(post.text.split("\n"), limit),
  };
}

function fitLines(lines, limit, requiredLines = null) {
  const fullNote = [FOOTER_LINE, ...RESEARCH_NOTE_LINES];
  const required = requiredLines ?? (fullNote.every((line) => lines.includes(line)) ? fullNote : (lines.includes(FOOTER_LINE) ? [FOOTER_LINE] : []));
  const kept = [];
  for (const line of lines) {
    if (required.includes(line)) continue;
    const next = [...kept, line, ...required].join("\n");
    if (tweetLength(next) > limit) break;
    kept.push(line);
  }
  return [...kept, ...required].join("\n");
}

function intervalLine(observation) {
  const from = formatMonthDayTime(observation?.previousSnapshotAt ?? observation?.caseResearch?.observationFrom);
  const to = formatMonthDayTime(observation?.currentSnapshotAt ?? observation?.caseResearch?.observationTo);
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

function formattedRawDiff(value) {
  if (!Number.isFinite(value)) return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(4)}`;
}

function finiteNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rankSortValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER;
}

function compactLines(lines) {
  return lines.filter(Boolean);
}

function postLines(lines) {
  return lines.filter((line) => line != null).join("\n").trim();
}

function tweetLength(text) {
  return twitterText.parseTweet(text).weightedLength;
}
