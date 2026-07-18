import { createSnapshotStorage } from "./github-storage.mjs";

const storage = createSnapshotStorage({ requireGitHub: true });
const data = {
  checkedAt: new Date().toISOString(),
  ok: true,
  purpose: "Bankr Score Observatory GitHub storage connectivity check",
};

await storage.commitJsonFiles(
  [{ path: "data/healthcheck.json", data }],
  "Check Bankr GitHub storage access",
);

const saved = await storage.readJson("data/healthcheck.json", null);
if (!saved?.ok) {
  throw new Error("GitHubへの書き込み確認に失敗しました。");
}

console.log("GitHub storage check passed.");
console.log(JSON.stringify(saved, null, 2));
