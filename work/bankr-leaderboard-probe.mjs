import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(
  "/Users/nato-san/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/",
);
const { chromium } = require("playwright");

const targetUrl = "https://bankr.bot/leaderboard";
const outputPath = path.resolve("outputs/bankr-leaderboard-test.json");
const summaryPath = path.resolve("work/bankr-leaderboard-probe-summary.json");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1200 },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
});

const responses = [];
page.on("response", async (response) => {
  const url = response.url();
  if (url.includes("leaderboard") || url.includes("api") || url.includes("rank")) {
    responses.push({
      url,
      status: response.status(),
      contentType: response.headers()["content-type"] || "",
    });
  }
});

const result = {
  targetUrl,
  loaded: false,
  finalUrl: "",
  title: "",
  loginNeeded: false,
  extractionSucceeded: false,
  entries: [],
  missingFields: [],
  diagnostics: {},
  responses,
};

try {
  const response = await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  result.loaded = Boolean(response && response.ok());
  result.diagnostics.initialStatus = response?.status() ?? null;

  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const root = document.querySelector("#root");
        return root && root.innerText && root.innerText.trim().length > 80;
      },
      { timeout: 30000 },
    )
    .catch(() => {});

  result.finalUrl = page.url();
  result.title = await page.title();

  const extracted = await page.evaluate(() => {
    const absUrl = (href) => {
      try {
        return href ? new URL(href, location.href).href : "";
      } catch {
        return "";
      }
    };

    const isVisible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const textOf = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    const pageText = document.body.innerText.replace(/\s+/g, " ").trim();

    const parseRank = (text) => {
      const match = text.match(/(?:^|\s|#)([1-9]|10)(?:\s|$|[.)])/);
      return match ? Number(match[1]) : null;
    };

    const parseScore = (text) => {
      const scoreLabel = text.match(/score\s*[:#]?\s*([0-9][0-9,]*(?:\.[0-9]+)?[kKmMbB]?)/i);
      if (scoreLabel) return scoreLabel[1];
      const nums = [...text.matchAll(/(?:^|\s)([0-9][0-9,]*(?:\.[0-9]+)?[kKmMbB]?)(?:\s|$)/g)]
        .map((m) => m[1])
        .filter((value) => !/^(?:[1-9]|10)$/.test(value.replace(/,/g, "")));
      return nums.at(-1) || "";
    };

    const parseUsername = (text, linkText) => {
      const atName = text.match(/@[\w.-]{2,}/);
      if (atName) return atName[0];
      if (linkText && !/^(?:view|profile|details|#?\d+)$/i.test(linkText)) return linkText;

      const cleaned = text
        .replace(/(?:^|\s)#?(?:[1-9]|10)(?:\s|$|[.)])/g, " ")
        .replace(/score\s*[:#]?\s*[0-9][0-9,]*(?:\.[0-9]+)?[kKmMbB]?/gi, " ")
        .replace(/\b[0-9][0-9,]*(?:\.[0-9]+)?[kKmMbB]?\b/g, " ")
        .replace(/\b(rank|score|profile|points|pts|leaderboard)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      return cleaned.split(" ").find((part) => /[A-Za-z0-9_@.-]{2,}/.test(part)) || "";
    };

    const makeEntry = (el) => {
      const text = textOf(el);
      const link = el.matches("a") ? el : el.querySelector("a[href]");
      const linkText = link ? textOf(link) : "";
      const rank = parseRank(text);
      const username = parseUsername(text, linkText);
      const score = parseScore(text);
      const profileUrl = absUrl(link?.getAttribute("href") || "");
      return { rank, username, score, profileUrl, sourceText: text };
    };

    const selectors = [
      "table tbody tr",
      "[role='row']",
      "li",
      "article",
      "a[href]",
      "main div",
    ];
    const candidates = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!isVisible(el)) continue;
        const text = textOf(el);
        if (!text || text.length < 3 || text.length > 500) continue;
        const rank = parseRank(text);
        const hasProfileLink = Boolean(el.matches("a[href]") || el.querySelector("a[href]"));
        if (rank || hasProfileLink || /score|leaderboard|rank/i.test(text)) {
          candidates.push({ selector, ...makeEntry(el) });
        }
      }
    }

    const byRank = new Map();
    for (const candidate of candidates) {
      if (!candidate.rank || candidate.rank < 1 || candidate.rank > 10) continue;
      if (!candidate.username && !candidate.score && !candidate.profileUrl) continue;
      const existing = byRank.get(candidate.rank);
      const candidateQuality =
        Number(Boolean(candidate.username)) +
        Number(Boolean(candidate.score)) +
        Number(Boolean(candidate.profileUrl)) +
        Math.max(0, 400 - candidate.sourceText.length) / 400;
      const existingQuality = existing
        ? Number(Boolean(existing.username)) +
          Number(Boolean(existing.score)) +
          Number(Boolean(existing.profileUrl)) +
          Math.max(0, 400 - existing.sourceText.length) / 400
        : -1;
      if (!existing || candidateQuality > existingQuality) byRank.set(candidate.rank, candidate);
    }

    const entries = [...byRank.values()]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 10)
      .map(({ rank, username, score, profileUrl }) => ({
        rank,
        username,
        score,
        profileUrl,
      }));

    return {
      pageText,
      entries,
      candidates: candidates.slice(0, 80),
      linkSamples: [...document.querySelectorAll("a[href]")]
        .filter(isVisible)
        .slice(0, 50)
        .map((a) => ({ text: textOf(a), href: absUrl(a.getAttribute("href")) })),
    };
  });

  result.loginNeeded = /\b(log in|login|sign in|connect wallet|wallet)\b/i.test(extracted.pageText);
  result.entries = extracted.entries;
  result.extractionSucceeded =
    result.entries.length >= 10 &&
    result.entries.every((entry, index) => entry.rank === index + 1 && entry.username && entry.score);
  result.missingFields = [
    result.entries.some((entry) => !entry.rank) ? "rank" : "",
    result.entries.some((entry) => !entry.username) ? "username" : "",
    result.entries.some((entry) => !entry.score) ? "score" : "",
    result.entries.some((entry) => !entry.profileUrl) ? "profileUrl" : "",
  ].filter(Boolean);
  result.diagnostics.visibleTextStart = extracted.pageText.slice(0, 1200);
  result.diagnostics.candidates = extracted.candidates;
  result.diagnostics.linkSamples = extracted.linkSamples;

  if (result.extractionSucceeded) {
    fs.writeFileSync(outputPath, `${JSON.stringify(result.entries, null, 2)}\n`);
  }
} catch (error) {
  result.error = {
    name: error.name,
    message: error.message,
  };
} finally {
  fs.writeFileSync(summaryPath, `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));
