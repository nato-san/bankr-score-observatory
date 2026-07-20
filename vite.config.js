import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function gitCommitShort() {
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercelSha) return vercelSha.slice(0, 7);

  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD_INFO__: JSON.stringify({
      version: process.env.VITE_APP_VERSION ?? "v0.3.1",
      commit: process.env.VITE_GIT_COMMIT_SHA?.slice(0, 7) ?? gitCommitShort(),
      buildTime: new Date().toISOString(),
    }),
  },
});
