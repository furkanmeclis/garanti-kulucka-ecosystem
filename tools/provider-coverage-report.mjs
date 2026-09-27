import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const coveragePath = join(root, "contracts/providers/coverage.json");
const coverage = JSON.parse(readFileSync(coveragePath, "utf8"));

if (!coverage || !Array.isArray(coverage.entries)) {
  console.error("Provider coverage manifest must contain an entries array.");
  process.exit(1);
}

const covered = coverage.entries.filter((entry) => entry.status === "covered");
const pending = coverage.entries.filter((entry) => entry.status === "pending_legacy_fixture");
const unknown = coverage.entries.filter(
  (entry) => entry.status !== "covered" && entry.status !== "pending_legacy_fixture",
);

if (unknown.length > 0) {
  console.error("Provider coverage manifest contains unknown statuses:");
  for (const entry of unknown) {
    console.error(`- ${entry.provider}.${entry.operation}: ${entry.status}`);
  }
  process.exit(1);
}

const coveredPercent = coverage.entries.length === 0
  ? 0
  : Math.round((covered.length / coverage.entries.length) * 100);

console.log(
  `Provider fixture coverage: ${covered.length}/${coverage.entries.length} covered (${coveredPercent}%), ${pending.length} pending.`,
);

if (pending.length > 0) {
  console.log("Pending provider fixtures:");
  for (const entry of pending) {
    console.log(`- ${entry.provider}.${entry.operation} (${entry.direction}): ${entry.reason}`);
  }
}
