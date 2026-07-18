import fs from "node:fs";
import path from "node:path";
import { compareSnapshots } from "./bankr-diff-core.mjs";

const DEFAULT_OLD = "outputs/snapshot-old.json";
const DEFAULT_NEW = "outputs/snapshot-new.json";
const DEFAULT_OUTPUT = "outputs/bankr-leaderboard-diff-test.json";

const [oldArg = DEFAULT_OLD, newArg = DEFAULT_NEW, outputArg = DEFAULT_OUTPUT] =
  process.argv.slice(2);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const oldSnapshotPath = path.normalize(oldArg);
const newSnapshotPath = path.normalize(newArg);
const outputPath = path.normalize(outputArg);
const diff = compareSnapshots({
  oldUsers: readJson(oldSnapshotPath),
  newUsers: readJson(newSnapshotPath),
  oldSnapshot: oldSnapshotPath,
  newSnapshot: newSnapshotPath,
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(diff, null, 2)}\n`);
console.log(JSON.stringify(diff.summary, null, 2));
