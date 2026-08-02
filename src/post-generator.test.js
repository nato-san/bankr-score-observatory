import assert from "node:assert/strict";
import test from "node:test";
import twitterText from "twitter-text";
import { generatePosts } from "./post-generator.js";

const X_SAFE_LIMIT = 270;
const POST_ONE_WEIGHTED_LIMIT = 220;

function rankMover(username, change, rankBefore = 30, rankAfter = rankBefore - change, overallBefore = 0.1, overallAfter = 0.11) {
  return {
    username,
    rank: { old: rankBefore, new: rankAfter, change },
    overallScore: {
      old: overallBefore,
      new: overallAfter,
      change: overallAfter - overallBefore,
    },
  };
}

function rankDrop(username, change = -2, rankBefore = 10, rankAfter = rankBefore - change) {
  return rankMover(username, change, rankBefore, rankAfter);
}

function categoryRow(username, rawDiff, rankBefore = 10, rankAfter = 9, rawBefore = 0, rawAfter = rawBefore + rawDiff) {
  return {
    username,
    rankBefore,
    rankAfter,
    diff: {
      rawBefore,
      rawAfter,
      rawDiff,
      scoreBefore: rawBefore,
      scoreAfter: rawAfter,
    },
  };
}

function rows(prefix, count, rawDiff = 1) {
  return Array.from({ length: count }, (_, index) => categoryRow(`@${prefix}${index + 1}`, rawDiff + index / 100));
}

function categoryRanking(increases = [], decreases = []) {
  return {
    rawIncreases: increases,
    rawDecreases: decreases,
    scoreIncreases: [],
    scoreDecreases: [],
  };
}

function observation({
  rankMovers = [],
  categoryRankings = {},
  newUsers = [],
  exitedUsers = [],
  caseResearchStatus = "limited",
  currentTop50 = [],
  observationNumber = 9,
} = {}) {
  return {
    observationNumber,
    previousSnapshotAt: "2026-07-27T00:51:00.000Z",
    currentSnapshotAt: "2026-07-28T00:51:00.000Z",
    currentTop50,
    summary: {
      rankMovers,
      overallChanges: [],
      newUsers,
      exitedUsers,
    },
    caseResearch: {
      status: caseResearchStatus,
      categoryRankings,
    },
  };
}

function postsFor(input) {
  return generatePosts(observation(input)).items;
}

function textFor(input) {
  return postsFor(input).map((post) => post.text).join("\n---\n");
}

function categoryHeaders(text) {
  return [...text.matchAll(/^Category Highlights\n(.+?)$/gm)]
    .map((match) => match[1].replace(/^[^\p{L}$]+ /u, ""));
}

function mentionCount(text) {
  return (text.match(/(^|\s)@[A-Za-z0-9_]/g) ?? []).length;
}

function weightedLength(text) {
  return twitterText.parseTweet(text).weightedLength;
}

test("Post 1 is an overview and Post 2 uses the rank movers report", () => {
  const posts = postsFor({
    rankMovers: [
      rankMover("@leader", 22, 32, 10, 0.1835, 0.112),
      rankMover("@second", 8, 20, 12, 0.2, 0.21),
    ],
  });

  assert.match(posts[0].text, /📊 Bankr Score Observatory #9/);
  assert.match(posts[0].text, /\$BNKR Daily Observation/);
  assert.match(posts[0].text, /🗓 Observation Period/);
  assert.match(posts[0].text, /Comparable users: \?\/\?/);
  assert.match(posts[0].text, /Rank movers: 2/);
  assert.match(posts[0].text, /Entered Top 50: 0/);
  assert.match(posts[0].text, /Exited Top 50: 0/);
  assert.doesNotMatch(posts[0].text, /🥇|Biggest Rank Climbs/);
  assert.match(posts[1].text, /🏆 Biggest Rank Climbs \(Top 50\)/);
  assert.match(posts[1].text, /🥇 #1 leader\n32 → 10 \(\+22\)/);
  assert.match(posts[1].text, /🥈 #2 second\n20 → 12 \(\+8\)/);
  assert.doesNotMatch(posts[1].text, /Overall Growth Top 3|\+.*%/);
});

test("Post 1 counts all rank movers while Post 2 still uses rank climb rows", () => {
  const posts = postsFor({
    rankMovers: [
      rankMover("@riseOne", 8, 20, 12),
      rankMover("@riseTwo", 4, 16, 12),
      rankDrop("@dropOne", -3, 10, 13),
      rankDrop("@dropTwo", -1, 30, 31),
    ],
  });

  assert.match(posts[0].text, /Rank movers: 4/);
  assert.match(posts[1].text, /🥇 #1 riseOne\n20 → 12 \(\+8\)/);
  assert.match(posts[1].text, /🥈 #2 riseTwo\n16 → 12 \(\+4\)/);
  assert.doesNotMatch(posts[1].text, /dropOne|dropTwo/);
});

test("twitter-text weighted length handles ASCII, Japanese, emoji, URL, and newlines", () => {
  assert.equal(weightedLength("a".repeat(280)), 280);
  assert.ok(weightedLength("日本語".repeat(70)) > "日本語".repeat(70).length);
  assert.equal(weightedLength("😀".repeat(140)), 280);
  assert.equal(weightedLength(`https://example.com/${"a".repeat(80)}`), 23);
  assert.equal(weightedLength("line1\nline2"), 11);
});

test("plain length can fit 280 while X weighted length exceeds the safe limit", () => {
  const text = "日本語".repeat(46);

  assert.ok(text.length <= 280);
  assert.ok(Array.from(text).length <= 280);
  assert.ok(weightedLength(text) > X_SAFE_LIMIT);
});

test("all generated posts remove automatic @ mentions", () => {
  const text = textFor({
    rankMovers: [rankMover("@leader", 5)],
    categoryRankings: {
      social: categoryRanking([categoryRow("@socialLead", 1.23456)]),
    },
    newUsers: [{ username: "@newUser" }],
    exitedUsers: [{ username: "@oldUser" }],
  });

  assert.equal(mentionCount(text), 0);
  assert.match(text, /leader/);
  assert.match(text, /socialLead/);
  assert.match(text, /newUser/);
});

test("Social is a normal category candidate and observed volume selects categories", () => {
  const text = textFor({
    categoryRankings: {
      social: categoryRanking(rows("social", 19, 0.2)),
      llmUsage: categoryRanking(rows("llm", 15, 0.3)),
      bnkr: categoryRanking(rows("bnkr", 2, 5)),
    },
  });

  assert.deepEqual(categoryHeaders(text), ["Social", "LLM Gateway"]);
});

test("category ties use max abs raw diff, then category definition order", () => {
  const maxText = textFor({
    categoryRankings: {
      social: categoryRanking([categoryRow("@socialLead", 1)]),
      llmUsage: categoryRanking([categoryRow("@llmLead", 3)]),
    },
  });
  assert.deepEqual(categoryHeaders(maxText), ["LLM Gateway", "Social"]);

  const orderText = textFor({
    categoryRankings: {
      developer: categoryRanking([categoryRow("@builderLead", 1)]),
      llmUsage: categoryRanking([categoryRow("@llmLead", 1)]),
      social: categoryRanking([categoryRow("@socialLead", 1)]),
    },
  });
  assert.deepEqual(categoryHeaders(orderText), ["Builder", "LLM Gateway"]);
});

test("category posting uses at most two categories and keeps the final note separate", () => {
  const posts = postsFor({
    rankMovers: [
      rankMover("@one", 10),
      rankMover("@two", 9),
      rankMover("@three", 8),
    ],
    categoryRankings: {
      social: categoryRanking(rows("social", 5, 1)),
      llmUsage: categoryRanking(rows("llm", 4, 1)),
      bnkr: categoryRanking(rows("bnkr", 3, 1)),
    },
    newUsers: [{ username: "@newUser" }],
  });
  const text = posts.map((post) => post.text).join("\n");

  assert.equal(categoryHeaders(text).length, 2);
  assert.match(posts.at(-1).text, /This observation system is still experimental/);
});

test("thread numbering is included before final safe-length validation", () => {
  const posts = postsFor({
    rankMovers: [
      rankMover("@one", 10),
      rankMover("@two", 9),
      rankMover("@three", 8),
    ],
    categoryRankings: {
      social: categoryRanking(rows("social", 3, 1)),
      llmUsage: categoryRanking(rows("llm", 3, 0.8)),
    },
    newUsers: [{ username: "@newUser" }],
  });

  assert.ok(posts.length > 1);
  assert.match(posts[0].text, new RegExp(`^1/${posts.length}\\n`));
  assert.match(posts.at(-1).text, new RegExp(`^${posts.length}/${posts.length}\\n`));
  assert.ok(posts[0].length <= POST_ONE_WEIGHTED_LIMIT);
  assert.ok(posts.slice(1).every((post) => post.length <= X_SAFE_LIMIT));
  assert.ok(posts.every((post) => twitterText.parseTweet(post.text).valid));
});

test("rank movers fit Top 3 into Post 1 when possible", () => {
  const posts = postsFor({
    rankMovers: [
      rankMover("@one", 10),
      rankMover("@two", 9),
      rankMover("@three", 8),
    ],
  });

  assert.match(posts[1].text, /🏆 Biggest Rank Climbs \(Top 50\)/);
  assert.match(posts[1].text, /🥇 #1 one\n30 → 20 \(\+10\)/);
  assert.match(posts[1].text, /🥈 #2 two\n30 → 21 \(\+9\)/);
  assert.match(posts[1].text, /🥉 #3 three\n30 → 22 \(\+8\)/);
  assert.doesNotMatch(posts[1].text, /continued/);
  assert.ok(posts[0].length <= POST_ONE_WEIGHTED_LIMIT);
});

test("rank mover Top N label matches two and one available movers", () => {
  const topTwo = postsFor({
    rankMovers: [rankMover("@one", 10), rankMover("@two", 9)],
  });
  assert.match(topTwo[1].text, /Biggest Rank Climbs \(Top 50\)/);
  assert.match(topTwo[1].text, /#1 one/);
  assert.match(topTwo[1].text, /#2 two/);
  assert.doesNotMatch(topTwo[1].text, /#3/);

  const topOne = postsFor({
    rankMovers: [rankMover("@one", 10)],
  });
  assert.match(topOne[1].text, /Biggest Rank Climbs \(Top 50\)/);
  assert.match(topOne[1].text, /#1 one/);
  assert.doesNotMatch(topOne[1].text, /#2/);
});

test("Post 1 keeps overview blank-line structure for scanability", () => {
  const [post] = postsFor({
    rankMovers: [rankMover("@one", 10), rankMover("@two", 9), rankMover("@three", 8)],
  });

  assert.match(post.text, /Bankr Score Observatory #9\n\n\$BNKR Daily Observation/);
  assert.match(post.text, /Daily Observation\n\n🗓/);
  assert.match(post.text, /JST\n\nComparable users:/);
  assert.match(post.text, /Rank movers: 3/);
});

test("final post uses only the specified caution wording", () => {
  const posts = postsFor({
    rankMovers: [rankMover("@one", 10)],
  });

  assert.doesNotMatch(posts.map((post) => post.text).join("\n"), /Public leaderboard data\./);
  assert.match(posts.at(-1).text, /These observations are based on the public leaderboard\./);
  assert.match(posts.at(-1).text, /Raw-value changes do not necessarily explain rank movement by themselves\./);
  assert.match(posts.at(-1).text, /This observation system is still experimental and may contain errors\./);
});

test("long usernames can reduce Post 1 to Top 2 and send third mover to the continuation post", () => {
  const long = "XXXXXXXXXXXX";
  const posts = postsFor({
    rankMovers: [
      rankMover(`@${long}A`, 10),
      rankMover(`@${long}B`, 9),
      rankMover(`@${long}C`, 8),
    ],
  });

  assert.match(posts[1].text, /Biggest Rank Climbs \(Top 50\)/);
  assert.match(posts[1].text, new RegExp(`#1 ${long}A`));
  assert.match(posts[1].text, new RegExp(`#2 ${long}B`));
  assert.match(posts[1].text, new RegExp(`#3 ${long}C`));
  assert.match(posts[1].jaSummary, /TOP50順位上昇Top3/);
});

test("Observation number is omitted when it is not safely available", () => {
  const posts = postsFor({
    observationNumber: null,
    rankMovers: [rankMover("@one", 10)],
  });

  assert.match(posts[0].text, /📊 Bankr Score Observatory\n/);
  assert.doesNotMatch(posts[0].text, /Observatory #/);
});

test("generated thread is variable length rather than fixed at five posts", () => {
  const posts = postsFor({
    rankMovers: [rankMover("@leader", 5)],
  });

  assert.ok(posts.length < 5);
  assert.ok(posts.every((post) => post.text.split("\n").filter(Boolean).length > 1));
});

test("duplicate users are removed between category posts and later categories are promoted", () => {
  const text = textFor({
    categoryRankings: {
      social: categoryRanking([categoryRow("@same1", 1.2), categoryRow("@same2", 1.1)]),
      llmUsage: categoryRanking([categoryRow("@same1", 0.9), categoryRow("@same2", 0.8)]),
      bnkr: categoryRanking([categoryRow("@bnkrNext", 0.7)]),
    },
  });

  assert.deepEqual(categoryHeaders(text), ["Social", "$BNKR"]);
  assert.doesNotMatch(text, /LLM Gateway raw change watch/);
});

test("0 to positive raw values are retained as rawDiff increases", () => {
  const text = textFor({
    categoryRankings: {
      social: categoryRanking([categoryRow("@activated", 5, 12, 11, 0, 5)]),
    },
  });

  assert.match(text, /activated\n\+5\.0000/);
});

test("rawDiff 0, NaN, and Infinity are excluded", () => {
  const text = textFor({
    categoryRankings: {
      social: categoryRanking([
        categoryRow("@zero", 0),
        categoryRow("@nan", Number.NaN),
        categoryRow("@infinity", Number.POSITIVE_INFINITY),
      ]),
      llmUsage: categoryRanking([categoryRow("@llmLead", 0.5)]),
    },
  });

  assert.deepEqual(categoryHeaders(text), ["LLM Gateway"]);
  assert.doesNotMatch(text, /zero|nan|infinity/);
});

test("category posts show positive highlights and omit notable decreases", () => {
  const text = textFor({
    categoryRankings: {
      social: categoryRanking(
        [categoryRow("@up", 1)],
        [categoryRow("@down", -3, 8, 10)],
      ),
    },
  });

  assert.match(text, /Category Highlights/);
  assert.match(text, /up\n\+1\.0000/);
  assert.doesNotMatch(text, /Notable decrease/);
  assert.doesNotMatch(text, /down\n-3\.0000/);
});

test("Top 50 entries and exits are retained as a separate post", () => {
  const text = textFor({
    rankMovers: [rankMover("@leader", 5)],
    newUsers: [{ username: "@newUser" }],
    exitedUsers: [{ username: "@oldUser" }],
  });

  assert.match(text, /Top 50 update/);
  assert.match(text, /Entered: 1/);
  assert.match(text, /Exited: 1/);
});

test("Baseline or comparison unavailable produces one compact post", () => {
  const posts = postsFor({
    caseResearchStatus: "baseline",
    currentTop50: [
      { rank: 1, username: "@topUser", overallScore: 0.123456 },
      { rank: 2, username: "@nextUser", overallScore: 0.1 },
    ],
  });

  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /Official comparison is waiting/);
  assert.match(posts[0].text, /not treated as failed/);
  assert.match(posts[0].text, /next valid Snapshot/);
});

test("English posts and Japanese summaries use matching candidates", () => {
  const posts = postsFor({
    rankMovers: [rankMover("@leader", 5, 10, 5)],
    categoryRankings: {
      social: categoryRanking([categoryRow("@socialLead", 1.23456)]),
    },
  });

  assert.match(posts[1].text, /#1 leader\n10 → 5 \(\+5\)/);
  assert.match(posts[1].jaSummary, /TOP50順位上昇Top1/);
  assert.match(posts[1].jaSummary, /leader: rank 10→5/);
  assert.match(posts[2].text, /socialLead\n\+1\.2346/);
  assert.match(posts[2].jaSummary, /socialLead: \+1\.2346/);
});

test("Social with no changes is not posted", () => {
  const text = textFor({
    categoryRankings: {
      social: categoryRanking([]),
    },
  });

  assert.doesNotMatch(text, /Social raw change watch/);
});

test("research caution is kept only on the final post and every post fits the X safe limit", () => {
  const posts = postsFor({
    rankMovers: [rankMover("@leader", 5)],
    categoryRankings: {
      social: categoryRanking([categoryRow("@socialLead", 1)]),
    },
  });
  const text = posts.map((post) => post.text).join("\n");

  assert.match(text, /Raw-value changes do not necessarily explain rank movement by themselves/);
  assert.doesNotMatch(posts[0].text, /Overall Top 50 comparison/);
  assert.match(posts.at(-1).text, /These observations are based on the public leaderboard/);
  assert.match(posts.at(-1).text, /Raw-value changes do not necessarily explain rank movement by themselves/);
  assert.match(posts.at(-1).text, /This observation system is still experimental and may contain errors\./);
  for (const post of posts) {
    const limit = post.index === 1 ? POST_ONE_WEIGHTED_LIMIT : X_SAFE_LIMIT;
    assert.ok(post.length <= limit);
    assert.ok(twitterText.parseTweet(post.text).valid);
  }
});

test("category compression keeps raw increases and omits decreases", () => {
  const longName = "veryLongCategoryIncreaseUserNameThatMakesThePostNeedCompression";
  const posts = postsFor({
    categoryRankings: {
      social: categoryRanking(
        [categoryRow(`@${longName}One`, 1), categoryRow(`@${longName}Two`, 0.9), categoryRow(`@${longName}Three`, 0.8)],
        [categoryRow(`@${longName}Decrease`, -4, 7, 12)],
      ),
    },
  });
  const categoryPost = posts.find((post) => post.text.includes("👥 Social"));

  assert.ok(categoryPost);
  assert.match(categoryPost.text, /Category Highlights/);
  assert.doesNotMatch(categoryPost.text, /Notable decrease/);
  assert.ok(categoryPost.length <= X_SAFE_LIMIT);
});

test("all generated posts are valid under X weighted length and stay under the safe limit", () => {
  const posts = postsFor({
    rankMovers: [
      rankMover("@one", 10),
      rankMover("@two", 9),
      rankMover("@three", 8),
    ],
    categoryRankings: {
      social: categoryRanking(rows("social", 4, 1)),
      llmUsage: categoryRanking(rows("llm", 4, 0.8)),
    },
    newUsers: [{ username: "@newUser" }],
    exitedUsers: [{ username: "@oldUser" }],
  });

  for (const post of posts) {
    const limit = post.index === 1 ? POST_ONE_WEIGHTED_LIMIT : X_SAFE_LIMIT;
    assert.ok(post.length <= limit);
    assert.equal(post.length, weightedLength(post.text));
    assert.equal(twitterText.parseTweet(post.text).valid, true);
  }
});

test("input objects are not mutated", () => {
  const input = {
    rankMovers: [rankMover("@leader", 5)],
    categoryRankings: {
      social: categoryRanking([categoryRow("@socialLead", 1)]),
    },
  };
  const before = structuredClone(input);

  generatePosts(observation(input));

  assert.deepEqual(input, before);
});
