import fs from "node:fs";
import path from "node:path";

const GITHUB_API = "https://api.github.com";

export const DATA_PATHS = {
  snapshotsDir: "data/research-snapshots",
  diffsDir: "data/diffs",
  state: "data/state.json",
};

function hasGitHubConfig() {
  return Boolean(
    process.env.GITHUB_TOKEN &&
      process.env.GITHUB_OWNER &&
      process.env.GITHUB_REPO &&
      process.env.GITHUB_BRANCH,
  );
}

function encodeRepoPath(repoPath) {
  return repoPath.split("/").map(encodeURIComponent).join("/");
}

function jsonText(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

class LocalStorage {
  type = "local";

  mapPath(repoPath) {
    if (repoPath.startsWith(DATA_PATHS.snapshotsDir)) {
      return repoPath.replace(DATA_PATHS.snapshotsDir, "outputs/research-snapshots");
    }
    if (repoPath.startsWith(DATA_PATHS.diffsDir)) {
      return repoPath.replace(DATA_PATHS.diffsDir, "outputs/research-diffs");
    }
    if (repoPath === DATA_PATHS.state) return "outputs/research-snapshot-state.json";
    return repoPath;
  }

  async readJson(repoPath, fallback = null) {
    const filePath = this.mapPath(repoPath);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  async exists(repoPath) {
    return fs.existsSync(this.mapPath(repoPath));
  }

  async listJson(repoDir) {
    const dir = this.mapPath(repoDir);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => `${repoDir}/${file}`)
      .sort();
  }

  async commitJsonFiles(files) {
    for (const file of files) {
      const filePath = this.mapPath(file.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, jsonText(file.data));
    }
  }
}

class GitHubStorage {
  type = "github";

  constructor() {
    this.owner = process.env.GITHUB_OWNER;
    this.repo = process.env.GITHUB_REPO;
    this.branch = process.env.GITHUB_BRANCH;
    this.token = process.env.GITHUB_TOKEN;
  }

  async request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        ...options.headers,
      },
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(data?.message ?? `GitHub API failed: ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  contentsUrl(repoPath) {
    return `${GITHUB_API}/repos/${this.owner}/${this.repo}/contents/${encodeRepoPath(repoPath)}`;
  }

  async readJson(repoPath, fallback = null) {
    try {
      const data = await this.request(`${this.contentsUrl(repoPath)}?ref=${encodeURIComponent(this.branch)}`);
      if (data.type !== "file" || !data.content) return fallback;
      return JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
    } catch (error) {
      if (error.status === 404) return fallback;
      throw error;
    }
  }

  async exists(repoPath) {
    try {
      await this.request(`${this.contentsUrl(repoPath)}?ref=${encodeURIComponent(this.branch)}`);
      return true;
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  }

  async listJson(repoDir) {
    try {
      const items = await this.request(`${this.contentsUrl(repoDir)}?ref=${encodeURIComponent(this.branch)}`);
      if (!Array.isArray(items)) return [];
      return items
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .map((item) => item.path)
        .sort();
    } catch (error) {
      if (error.status === 404) return [];
      throw error;
    }
  }

  async getBranchSha() {
    try {
      const ref = await this.request(
        `${GITHUB_API}/repos/${this.owner}/${this.repo}/git/ref/heads/${encodeURIComponent(this.branch)}`,
      );
      return ref.object.sha;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async commitJsonFiles(files, message) {
    const baseSha = await this.getBranchSha();
    const baseCommit = baseSha
      ? await this.request(`${GITHUB_API}/repos/${this.owner}/${this.repo}/git/commits/${baseSha}`)
      : null;
    const treeItems = await Promise.all(
      files.map(async (file) => {
        const blob = await this.request(`${GITHUB_API}/repos/${this.owner}/${this.repo}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({
            content: jsonText(file.data),
            encoding: "utf-8",
          }),
        });
        return {
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        };
      }),
    );
    const tree = await this.request(`${GITHUB_API}/repos/${this.owner}/${this.repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        ...(baseCommit ? { base_tree: baseCommit.tree.sha } : {}),
        tree: treeItems,
      }),
    });
    const commit = await this.request(`${GITHUB_API}/repos/${this.owner}/${this.repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: baseSha ? [baseSha] : [],
      }),
    });
    if (baseSha) {
      await this.request(
        `${GITHUB_API}/repos/${this.owner}/${this.repo}/git/refs/heads/${encodeURIComponent(this.branch)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            sha: commit.sha,
            force: false,
          }),
        },
      );
    } else {
      await this.request(`${GITHUB_API}/repos/${this.owner}/${this.repo}/git/refs`, {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${this.branch}`,
          sha: commit.sha,
        }),
      });
    }
  }
}

export function createSnapshotStorage({ requireGitHub = false } = {}) {
  if (hasGitHubConfig()) return new GitHubStorage();
  if (requireGitHub) {
    throw new Error("GitHub保存用の環境変数が不足しています。");
  }
  return new LocalStorage();
}
