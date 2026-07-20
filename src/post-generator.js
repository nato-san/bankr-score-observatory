import twitterText from "twitter-text";
import { formatUsername } from "./display-formatters.js";

const HARD_LIMIT = 280;
const LARGE_RANK_MOVE = 5;
const BROAD_OVERALL_RATIO = 0.5;
const RANK_OVERALL_GAP = 20;
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
  const researchPosts = buildResearchPosts(observation);
  const numbered = withThreadNumbers(researchPosts.map((post) => post.text));
  return {
    items: numbered.map((text, index) => ({
      index: index + 1,
      text,
      jaSummary: researchPosts[index]?.jaSummary ?? summarizeFallbackJa(text),
      length: tweetLength(text),
    })),
    omissions: researchPosts.filter((post) => post.omitted),
  };
}

function buildResearchPosts(observation) {
  const metrics = observationMetrics(observation);
  const signals = signalFlags(metrics);
  const postCount = decidePostCount(signals);

  if (postCount === 2) {
    const quietPost = quietCombinedPost(observation, metrics);
    if (tweetLength(quietPost.text) <= HARD_LIMIT) return [quietPost];
    return [headlinePost(observation, metrics, signals, true), quietNextWatchPost(metrics)];
  }

  const posts = [
    headlinePost(observation, metrics, signals, false),
    evidencePost(metrics),
  ];

  if (postCount >= 4) {
    posts.push(interpretationPost(metrics, signals));
    posts.push(limitationsNextWatchPost(metrics));
  } else {
    posts.push(questionLimitationsPost(metrics, signals));
  }

  if (postCount >= 5 && metrics.categorySignals.length) {
    posts.splice(2, 0, categorySignalPost(metrics));
  }

  return posts;
}

function observationMetrics(observation) {
  const { summary } = observation;
  const total = currentTop50Size(observation);
  const largestMove = largestRankMove(summary.rankMovers);
  const largeMovers = largeRankMovers(summary.rankMovers).slice(0, 2);
  const entered = summary.newUsers.length;
  const exited = summary.exitedUsers.length;
  const categorySignals = categoryObservationLines(summary);

  return {
    observationNumber: observation.observationNumber,
    total,
    rankMovers: summary.rankMovers.length,
    overallChanges: summary.overallChanges.length,
    entered,
    exited,
    largestMove,
    largeMovers,
    enteredUsers: summary.newUsers.slice(0, 2),
    exitedUsers: summary.exitedUsers.slice(0, 2),
    categorySignals,
    profileDetailsAvailable: observation.profileDetailsAvailable !== false,
  };
}

function signalFlags(metrics) {
  const broadOverall = metrics.overallChanges >= Math.ceil(metrics.total * BROAD_OVERALL_RATIO);
  const rankOverallGap = metrics.overallChanges - metrics.rankMovers >= RANK_OVERALL_GAP;
  const membershipChange = metrics.entered + metrics.exited > 0;
  const largeMove = metrics.largestMove >= LARGE_RANK_MOVE;
  const categoryMulti = metrics.categorySignals.some((signal) => signal.count >= 2);
  const highChurn = metrics.entered + metrics.exited >= 5;
  const activeCount = [broadOverall, rankOverallGap, membershipChange, largeMove, categoryMulti, highChurn]
    .filter(Boolean).length;

  return {
    broadOverall,
    rankOverallGap,
    membershipChange,
    largeMove,
    categoryMulti,
    highChurn,
    activeCount,
  };
}

function decidePostCount(signals) {
  if (signals.activeCount >= 5) return 5;
  if (signals.activeCount >= 4) return 4;
  if (signals.activeCount >= 1) return 3;
  return 2;
}

function headlinePost(observation, metrics, signals, quietMode) {
  const title = `📊 Bankr Score Observatory${observation.observationNumber ? ` #${observation.observationNumber}` : ""}`;
  const lines = quietMode
    ? [
        title,
        "Top 50 observation:",
        rankMoveLine(metrics.rankMovers),
        metrics.largestMove > 0 ? `• Largest move: ${metrics.largestMove} ${positionWord(metrics.largestMove)}` : null,
        membershipSummaryLine(metrics),
        overallScoreLine(metrics.overallChanges, metrics.total),
        "No strong daily signal was observed.",
      ]
    : [
        title,
        "Today's key signal:",
        keySignalSentence(metrics, signals),
        keySignalFollowup(metrics, signals),
      ];

  return {
    text: compactLines(lines).join("\n"),
    jaSummary: quietMode ? quietHeadlineJa(metrics) : headlineJa(metrics, signals),
  };
}

function evidencePost(metrics) {
  const lines = [
    "Evidence:",
    metrics.overallChanges > 0 ? `• ${metrics.overallChanges}/${metrics.total} stored Overall Score values differed` : null,
    metrics.rankMovers > 0 ? `• ${metrics.rankMovers}/${metrics.total} accounts changed rank` : "• No rank changes were observed",
    metrics.largestMove > 0 ? `• Largest move: ${metrics.largestMove} ${positionWord(metrics.largestMove)}` : null,
    membershipSummaryLine(metrics),
    ...largestMoveLines(metrics),
    ...categoryEvidenceLines(metrics),
  ];

  return {
    text: compactLines(lines).join("\n"),
    jaSummary: evidenceJa(metrics),
  };
}

function interpretationPost(metrics, signals) {
  return {
    text: [
      "Interpretation:",
      interpretationLine(metrics, signals),
      possibleLine(metrics, signals),
      "Question:",
      questionLine(metrics, signals),
      "Confidence: Low",
    ].join("\n"),
    jaSummary: interpretationJa(metrics, signals),
  };
}

function questionLimitationsPost(metrics, signals) {
  return {
    text: compactLines([
      "Question:",
      questionLine(metrics, signals),
      "Confidence: Low",
      "Limitations:",
      "Category details cover only the tracked Top 10 profiles.",
      "Next watch:",
      nextWatchLine(metrics, signals),
      "Public data observation.",
    ]).join("\n"),
    jaSummary: [
      "・研究上の問いを提示",
      "・カテゴリ詳細はTOP10のみ",
      "・次回Snapshotで同じ動きが続くか確認する",
      "・公開Leaderboard観測に基づく",
    ].join("\n"),
  };
}

function limitationsNextWatchPost(metrics) {
  return {
    text: compactLines([
      ...membershipDetailLines(metrics),
      "Limitations:",
      "Category details cover only the tracked Top 10 profiles.",
      "Next watch:",
      nextWatchLine(metrics, signalFlags(metrics)),
      "Public data observation.",
    ]).join("\n"),
    jaSummary: limitationsJa(metrics),
  };
}

function quietNextWatchPost(metrics) {
  return {
    text: [
      "Limitations:",
      "Top 50 rank and Overall Score are tracked.",
      "Category details are limited to tracked Top 10 profiles.",
      "Next watch:",
      "Will a clearer pattern appear in the next scheduled snapshot?",
      "Public data observation.",
    ].join("\n"),
    jaSummary: [
      "・大きな日次シグナルはまだ確認していない",
      "・カテゴリ詳細はTOP10のみ",
      "・次回Snapshotで明確なパターンが出るか確認する",
      "・公開Leaderboard観測に基づく",
    ].join("\n"),
  };
}

function quietCombinedPost(observation, metrics) {
  const title = `📊 Bankr Score Observatory${observation.observationNumber ? ` #${observation.observationNumber}` : ""}`;
  return {
    text: compactLines([
      title,
      "Top 50 observation:",
      rankMoveLine(metrics.rankMovers),
      overallScoreLine(metrics.overallChanges, metrics.total),
      "No strong daily signal was observed.",
      "Next watch:",
      "Will a clearer pattern appear in the next scheduled snapshot?",
      "Public data observation.",
    ]).join("\n"),
    jaSummary: [
      "・大きな日次シグナルはまだ確認していない",
      `・順位変動は${metrics.rankMovers}人`,
      `・Overall Score保存値の差分は${metrics.overallChanges}/${metrics.total}`,
      "・次回Snapshotで明確なパターンが出るか確認する",
    ].join("\n"),
  };
}

function categorySignalPost(metrics) {
  return {
    text: [
      "Tracked Top 10 profiles:",
      ...metrics.categorySignals.map((signal) => `• ${signal.field} changed for ${signal.count} accounts`),
      "Observed scope is limited to tracked Top 10 profiles.",
    ].join("\n"),
    jaSummary: [
      "・取得済みTOP10詳細プロフィールでカテゴリ変動を確認",
      ...metrics.categorySignals.map((signal) => `・${signal.field}が${signal.count}人で変動`),
      "・観測範囲はTOP10詳細プロフィールのみ",
    ].join("\n"),
  };
}

function keySignalSentence(metrics, signals) {
  if (signals.broadOverall && signals.rankOverallGap) {
    return `${metrics.overallChanges} of ${metrics.total} stored Overall Score values differed from the previous snapshot.`;
  }
  if (signals.categoryMulti) {
    return "Category movement appeared among the tracked Top 10 profiles while Top 50 rank movement was limited.";
  }
  if (signals.membershipChange && signals.largeMove) {
    return `Top 50 membership changed, and the largest rank move was ${metrics.largestMove} positions.`;
  }
  if (signals.broadOverall) return `${metrics.overallChanges} of ${metrics.total} stored Overall Score values differed from the previous snapshot.`;
  if (signals.largeMove) return `The largest Top 50 rank move was ${metrics.largestMove} positions.`;
  if (signals.membershipChange) return `${metrics.entered} entered and ${metrics.exited} exited the Top 50.`;
  return "No strong Top 50 signal was observed in this comparison.";
}

function keySignalFollowup(metrics, signals) {
  if (signals.broadOverall && signals.rankOverallGap) {
    return `Only ${metrics.rankMovers} accounts changed rank, so the score/rank relationship needs another snapshot.`;
  }
  if (signals.membershipChange || signals.largeMove) {
    return "Movement was concentrated in a small part of the Top 50.";
  }
  if (signals.categoryMulti) {
    return "This is a limited-scope signal, not a Top 50-wide category observation.";
  }
  return "The next scheduled snapshot will show whether this pattern changes.";
}

function interpretationLine(metrics, signals) {
  if (signals.broadOverall && signals.rankOverallGap) {
    return "Stored Overall Score values differed much more often than ranks changed.";
  }
  if (signals.membershipChange && signals.largeMove) {
    return "Membership changed while most Top 50 positions stayed close to their prior ranks.";
  }
  if (signals.categoryMulti) {
    return "Tracked Top 10 category movement appeared without broad Top 50 rank movement.";
  }
  return "The observed movement is limited, so interpretation should remain cautious.";
}

function possibleLine(metrics, signals) {
  if (signals.broadOverall && signals.rankOverallGap) {
    return "One comparison cannot identify whether this reflects recalculation or activity.";
  }
  if (signals.categoryMulti) {
    return "Tracked Top 10 category changes may be related, but the scope is limited.";
  }
  return "Multiple explanations remain possible from public data alone.";
}

function questionLine(metrics, signals) {
  if (signals.broadOverall && signals.rankOverallGap) {
    return "Will the next scheduled snapshot show the same score/rank split?";
  }
  if (signals.membershipChange) {
    return "Will Top 50 membership continue to rotate in the next snapshot?";
  }
  if (signals.categoryMulti) {
    return "Will the same tracked Top 10 category movement repeat?";
  }
  if (signals.largeMove) {
    return "Will rank volatility stay concentrated or broaden tomorrow?";
  }
  return "Will a clearer pattern appear in the next scheduled snapshot?";
}

function nextWatchLine(metrics, signals) {
  if (signals.broadOverall) return "Will broad stored score differences repeat tomorrow?";
  if (signals.membershipChange) return "Will the same accounts stay inside the Top 50 tomorrow?";
  return "Will the next scheduled snapshot show stronger movement?";
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

function largestMoveLines(metrics) {
  if (!metrics.largeMovers.length) return [];
  return [
    "Largest move:",
    ...metrics.largeMovers.map((user) => `${formatUsername(user.username)} ${user.rank.old}→${user.rank.new}`),
  ];
}

function categoryEvidenceLines(metrics) {
  return metrics.categorySignals.map(
    (signal) => `Among tracked Top 10 profiles, ${signal.field} changed for ${signal.count} ${accountWord(signal.count)}.`,
  );
}

function membershipDetailLines(metrics) {
  const lines = [];
  if (metrics.entered > 0 && metrics.entered <= 2) {
    lines.push("Entered Top 50:", ...metrics.enteredUsers.map((user) => formatUsername(user.username)));
  } else if (metrics.entered > 0) {
    lines.push(`Entered Top 50: ${metrics.entered} accounts`);
  }
  if (metrics.exited > 0 && metrics.exited <= 2) {
    lines.push("Exited Top 50:", ...metrics.exitedUsers.map((user) => formatUsername(user.username)));
  } else if (metrics.exited > 0) {
    lines.push(`Exited Top 50: ${metrics.exited} accounts`);
  }
  return lines;
}

function categoryObservationLines(summary) {
  return DETAIL_CATEGORY_FIELDS.flatMap((field) => {
    const group = summary.categoryGroups.find((item) => item.field === field);
    if (!group) return [];
    const largest = largestCategoryChange(group);
    if (group.users.length < 2 && largest < LARGE_RANK_MOVE && field !== "Builder") return [];
    return [{ field, count: group.users.length }];
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
  if (changes === 0) return "• No stored Overall Score differences were observed";
  return `• ${changes} of ${total} stored Overall Score values differed`;
}

function rankMoveLine(count) {
  if (count === 0) return "• No rank changes were observed";
  return `• ${count} ${accountWord(count)} changed rank`;
}

function membershipSummaryLine(metrics) {
  if (metrics.entered === 0 && metrics.exited === 0) return null;
  if (metrics.entered > 0 && metrics.exited > 0) {
    return `• ${metrics.entered} entered and ${metrics.exited} exited the Top 50`;
  }
  if (metrics.entered > 0) return `• ${metrics.entered} entered the Top 50`;
  return `• ${metrics.exited} exited the Top 50`;
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

function withThreadNumbers(posts) {
  if (posts.length <= 1) return posts;
  return posts.map((post, index) => {
    const numbered = `${index + 1}/${posts.length}\n${post}`;
    return tweetLength(numbered) <= HARD_LIMIT ? numbered : `${index + 1}/${posts.length}\n${shortenPost(post)}`;
  });
}

function shortenPost(post) {
  return post
    .split("\n")
    .filter((line) => !line.startsWith("Public data observation.") && !line.startsWith("Observed scope is limited"))
    .join("\n");
}

function tweetLength(text) {
  return twitterText.parseTweet(text).weightedLength;
}

function headlineJa(metrics, signals) {
  if (signals.broadOverall && signals.rankOverallGap) {
    return [
      `・${metrics.total}人中${metrics.overallChanges}人のOverall Score保存値が前回と異なる`,
      `・順位変動は${metrics.rankMovers}人`,
      "・原因や安定性は次回Snapshotで検証",
    ].join("\n");
  }
  return quietHeadlineJa(metrics);
}

function quietHeadlineJa(metrics) {
  const lines = [
    `・TOP50内で${metrics.rankMovers}人が順位変動`,
    metrics.largestMove > 0 ? `・最大変動は${metrics.largestMove}位` : null,
    metrics.entered + metrics.exited > 0 ? `・TOP50新規入り${metrics.entered}人、退出${metrics.exited}人` : null,
    metrics.overallChanges > 0
      ? `・${metrics.total}人中${metrics.overallChanges}人でOverall Score保存値差分`
      : "・Overall Score保存値差分は観測されていません",
  ];
  return compactLines(lines).join("\n");
}

function evidenceJa(metrics) {
  const lines = [
    metrics.largestMove > 0 ? `・最大順位変動は${metrics.largestMove}位` : null,
    metrics.entered + metrics.exited > 0 ? `・TOP50新規入り${metrics.entered}人、退出${metrics.exited}人` : null,
    metrics.largeMovers.length ? `・最大変動者は${metrics.largeMovers.map((user) => formatUsername(user.username)).join("、")}` : null,
    `・Overall Score保存値差分は${metrics.overallChanges}/${metrics.total}`,
    ...metrics.categorySignals.map((signal) => `・tracked Top 10 profilesで${signal.field}が${signal.count}人変動`),
  ];
  return compactLines(lines).join("\n");
}

function interpretationJa(metrics, signals) {
  if (signals.broadOverall && signals.rankOverallGap) {
    return [
      "・保存値差分の多さと順位変動人数に差がある",
      "・1回の比較では原因を識別できない",
      "・まだ確度は低い",
    ].join("\n");
  }
  if (signals.categoryMulti) {
    return [
      "・TOP10詳細カテゴリで限定的な変動を確認",
      "・TOP50全体のカテゴリ変動とは言えない",
      "・まだ確度は低い",
    ].join("\n");
  }
  return [
    "・観測事実と解釈を分けて確認",
    "・公開データだけでは複数の説明が可能",
    "・まだ確度は低い",
  ].join("\n");
}

function limitationsJa(metrics) {
  const lines = [
    metrics.entered > 0
      ? `・TOP50新規入り：${metrics.entered <= 2 ? metrics.enteredUsers.map((user) => formatUsername(user.username)).join("、") : `${metrics.entered}人`}`
      : null,
    metrics.exited > 0
      ? `・TOP50退出：${metrics.exited <= 2 ? metrics.exitedUsers.map((user) => formatUsername(user.username)).join("、") : `${metrics.exited}人`}`
      : null,
    "・カテゴリ詳細はTOP10のみ",
    "・翌日も同じ保存値差分が続くか確認する",
    "・公開Leaderboard観測に基づく",
  ];
  return compactLines(lines).join("\n");
}

function summarizeFallbackJa(text) {
  if (text.includes("Public data observation.")) return "・公開Leaderboard観測に基づく";
  return "公開Leaderboard観測に基づく注意書きです。";
}
