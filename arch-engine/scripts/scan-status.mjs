/**
 * Summarize scan-run.log into scan-status.json (key lines only).
 * Usage: node scripts/scan-status.mjs <logPath> <outPath>
 */
import fs from "node:fs/promises";

const logPath = process.argv[2];
const outPath = process.argv[3];
if (!logPath || !outPath) {
  console.error("Usage: node scripts/scan-status.mjs <logPath> <outPath>");
  process.exit(1);
}

let text = "";
try {
  text = await fs.readFile(logPath, "utf-8");
} catch {
  text = "";
}

const lines = text.split(/\r?\n/).filter(Boolean);
const summarizeCount = (text.match(/summarize request/g) ?? []).length;
const warnCount = (text.match(/\[arch-engine\]\[WARN\]/g) ?? []).length;
const fallbackCount = (text.match(/fallback cards/g) ?? []).length;
const splitCount = (text.match(/summarize batch split/g) ?? []).length;
const complete = text.includes("start-init complete");

const moduleMatch = text.match(/moduleSlug: '([^']+)'/g);
const lastModule = moduleMatch?.at(-1)?.replace(/moduleSlug: '|'/g, "") ?? null;

const candidateMatch = text.match(
  /module-batch: summarize \{[^}]*moduleSlug: '([^']+)'[^}]*candidateCount: (\d+)/
);
const currentModule = candidateMatch?.[1] ?? lastModule;
const candidateCount = candidateMatch ? Number(candidateMatch[2]) : null;
const expectedBatches =
  candidateCount && candidateCount > 0
    ? Math.ceil(candidateCount / 4)
    : null;

const lastSummarize = [...lines]
  .reverse()
  .find((l) => l.includes("summarize request"))
  ?.slice(0, 200);

const recentWarnings = lines
  .filter((l) => l.includes("[WARN]"))
  .slice(-5)
  .map((l) => l.replace(/^node :\s*/, "").slice(0, 300));

const status = {
  time: new Date().toISOString(),
  logPath,
  running: !complete && summarizeCount > 0,
  complete,
  progress: {
    summarizeRequestsDone: summarizeCount,
    expectedBatchesForCurrentModule: expectedBatches,
    currentModule,
    candidateCount,
  },
  health: {
    jsonModeFalse: !text.includes("jsonMode: true"),
    warnLines: warnCount,
    fallbackBatches: fallbackCount,
    splitBatches: splitCount,
  },
  recentWarnings,
  lastSummarizeLine: lastSummarize ?? null,
};

await fs.writeFile(outPath, JSON.stringify(status, null, 2), "utf-8");
console.log(JSON.stringify(status, null, 2));
