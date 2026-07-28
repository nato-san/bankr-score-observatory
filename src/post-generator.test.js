import assert from "node:assert/strict";
import test from "node:test";
import { generatePosts } from "./post-generator.js";

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
} = {}) {
  return {
    observationNumber: 9,
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
  return [...text.matchAll(/^(.+?) raw change watch$/gm)].map((match) => match[1]);
}

function mentionCount(text) {
  return (text.match(/(^|\s)@[A-Za-z0-9_]/g) ?? []).length;
}

test("Post 1 is centered on Top 50 rank movers, not growth rate", () => {
  const posts = postsFor({
    rankMovers: [
      rankMover("@leader", 22, 32, 10, 0.1835, 0.112),
      rankMover("@second", 8, 20, 12, 0.2, 0.21),
    ],
  });

  assert.match(posts[0].text, /\$BNKR Daily Observatory/);
  assert.match(posts[0].text, /Top 50 rank movers/);
  assert.match(posts[0].text, /leader 32→10 ▲22/);
  assert.match(posts[0].text, /Overall 0\.1835→0\.1120/);
  assert.doesNotMatch(posts[0].text, /Overall Growth Top 3|\+.*%/);
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

test("category posting uses at most two categories and total posts stay within five", () => {
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
  assert.ok(posts.length <= 5);
});

test("rank movers fit Top 3 into the first post when possible", () => {
  const posts = postsFor({
    rankMovers: [
      rankMover("@one", 10),
      rankMover("@two", 9),
      rankMover("@three", 8),
    ],
  });

  assert.match(posts[0].text, /1\. one 30→20 ▲10/);
  assert.match(posts[0].text, /2\. two 30→21 ▲9/);
  assert.match(posts[0].text, /3\. three 30→22 ▲8/);
  assert.doesNotMatch(posts[0].text, /continued/);
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

  assert.match(text, /activated \+5\.0000/);
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

test("category posts can include notable decreases without creating a decrease ranking post", () => {
  const text = textFor({
    categoryRankings: {
      social: categoryRanking(
        [categoryRow("@up", 1)],
        [categoryRow("@down", -3, 8, 10)],
      ),
    },
  });

  assert.match(text, /Raw increase Top3/);
  assert.match(text, /Notable decrease/);
  assert.match(text, /down -3\.0000/);
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

  assert.match(posts[0].text, /leader 10→5/);
  assert.match(posts[0].jaSummary, /leader: rank 10→5/);
  assert.match(posts[1].text, /socialLead \+1\.2346/);
  assert.match(posts[1].jaSummary, /socialLead: \+1\.2346/);
});

test("Social with no changes is not posted", () => {
  const text = textFor({
    categoryRankings: {
      social: categoryRanking([]),
    },
  });

  assert.doesNotMatch(text, /Social raw change watch/);
});

test("research caution is kept only on the final post and every post fits 280 characters", () => {
  const posts = postsFor({
    rankMovers: [rankMover("@leader", 5)],
    categoryRankings: {
      social: categoryRanking([categoryRow("@socialLead", 1)]),
    },
  });
  const text = posts.map((post) => post.text).join("\n");

  assert.match(text, /They do not explain rank movement by themselves/);
  assert.doesNotMatch(posts[0].text, /Overall Top 50 comparison/);
  assert.match(posts.at(-1).text, /Overall Top 50 comparison/);
  assert.match(posts.at(-1).text, /These are observed raw-value changes/);
  assert.match(posts.at(-1).text, /They do not explain rank movement by themselves/);
  assert.match(posts.at(-1).text, /Public leaderboard observation\. Not an official explanation\./);
  for (const post of posts) {
    assert.ok(post.length <= 280);
  }
});

test("category compression drops notable decreases before raw increases", () => {
  const longName = "veryLongCategoryIncreaseUserNameThatMakesThePostNeedCompression";
  const posts = postsFor({
    categoryRankings: {
      social: categoryRanking(
        [categoryRow(`@${longName}One`, 1), categoryRow(`@${longName}Two`, 0.9), categoryRow(`@${longName}Three`, 0.8)],
        [categoryRow(`@${longName}Decrease`, -4, 7, 12)],
      ),
    },
  });
  const categoryPost = posts.find((post) => post.text.includes("Social raw change watch"));

  assert.ok(categoryPost);
  assert.match(categoryPost.text, /Raw increase Top3/);
  assert.doesNotMatch(categoryPost.text, /Notable decrease/);
  assert.ok(categoryPost.length <= 280);
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
