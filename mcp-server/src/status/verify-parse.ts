import fs from "node:fs/promises";
import path from "node:path";
import type { VerifyResult } from "./types.js";

// Extract "Overall: <result>" from a verify report. Tolerant of optional
// markdown bold asterisks around the keyword and case-insensitive on it.
// The "\b" after the keyword prevents matching a longer word like "PASSED".
const OVERALL_RE = /Overall:\s*\**\s*(pass|fail|blocked)\b/i;

export function parseVerifyReport(text: string): { result: VerifyResult } {
  const match = text.match(OVERALL_RE);
  if (!match) {
    return { result: "none" };
  }
  return { result: match[1].toUpperCase() as VerifyResult };
}

// Absolute path to the latest verify report for a project. Exported so the
// status aggregate module can reuse it without depending on shared paths.ts.
export function latestVerifyPath(projectRoot: string): string {
  return path.join(projectRoot, ".apt", "verify", "latest.md");
}

// Reads the latest verify report and parses its Overall verdict. A missing or
// unreadable file resolves to result "none" with the expected absolute path.
export async function readLatestVerify(
  projectRoot: string
): Promise<{ path: string; result: VerifyResult }> {
  const filePath = latestVerifyPath(projectRoot);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return { path: filePath, result: parseVerifyReport(raw).result };
  } catch {
    return { path: filePath, result: "none" };
  }
}
