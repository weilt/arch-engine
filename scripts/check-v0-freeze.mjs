/**
 * Phase A hard gate: every row in designs/v0/_pages.md must be approved=yes,
 * and each page-id directory must contain page.manifest.json + page.logic.md.
 *
 * Usage: node scripts/check-v0-freeze.mjs [repoRoot]
 * Env:   V0_PAGES_MD — override path to _pages.md (default: <repoRoot>/designs/v0/_pages.md)
 *        APT_PROJECT_ROOT — repo root when CLI arg omitted
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = "page.manifest.json";
const LOGIC = "page.logic.md";

/**
 * @param {string} content
 * @returns {{ pageId: string; approved: string }[]}
 */
export function parsePagesTable(content) {
  const lines = content.split(/\r?\n/);
  /** @type {Record<string, number>} */
  let colIndex = {};
  /** @type {{ pageId: string; approved: string }[]} */
  const rows = [];
  let sawHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;

    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length === 0) continue;

    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;

    if (!sawHeader) {
      const pageIdIdx = cells.indexOf("page-id");
      const approvedIdx = cells.indexOf("approved");
      if (pageIdIdx === -1 || approvedIdx === -1) {
        throw new Error(
          "Invalid _pages.md table: missing required columns page-id and/or approved"
        );
      }
      colIndex = { pageId: pageIdIdx, approved: approvedIdx };
      sawHeader = true;
      continue;
    }

    const pageId = cells[colIndex.pageId];
    const approved = cells[colIndex.approved];
    if (!pageId) continue;

    rows.push({ pageId, approved });
  }

  if (!sawHeader) {
    throw new Error("Invalid _pages.md: no markdown table found");
  }

  return rows;
}

/**
 * @param {{ repoRoot?: string; pagesMdPath?: string }} [options]
 * @returns {{ ok: true } | { ok: false; errors: string[] }}
 */
export function checkV0Freeze(options = {}) {
  const repoRoot = path.resolve(
    options.repoRoot ??
      process.env.APT_PROJECT_ROOT ??
      process.cwd()
  );
  const pagesMdPath = path.resolve(
    options.pagesMdPath ??
      process.env.V0_PAGES_MD ??
      path.join(repoRoot, "designs", "v0", "_pages.md")
  );
  const v0Dir = path.dirname(pagesMdPath);
  /** @type {string[]} */
  const errors = [];

  if (!fs.existsSync(pagesMdPath)) {
    return { ok: false, errors: [`_pages.md not found: ${pagesMdPath}`] };
  }

  let rows;
  try {
    const content = fs.readFileSync(pagesMdPath, "utf8");
    rows = parsePagesTable(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [message] };
  }

  if (rows.length === 0) {
    return {
      ok: false,
      errors: ["_pages.md table has no data rows (nothing to freeze-check)"],
    };
  }

  for (const { pageId, approved } of rows) {
    if (approved.toLowerCase() !== "yes") {
      errors.push(
        `${pageId}: approved is "${approved}" (expected yes)`
      );
    }

    const pageDir = path.join(v0Dir, pageId);
    const manifestPath = path.join(pageDir, MANIFEST);
    const logicPath = path.join(pageDir, LOGIC);

    if (!fs.existsSync(manifestPath)) {
      errors.push(`${pageId}: missing ${MANIFEST} at ${manifestPath}`);
    }
    if (!fs.existsSync(logicPath)) {
      errors.push(`${pageId}: missing ${LOGIC} at ${logicPath}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}

function main() {
  const repoRoot = process.argv[2] ?? process.env.APT_PROJECT_ROOT ?? process.cwd();
  const result = checkV0Freeze({ repoRoot });

  if (result.ok) {
    process.exit(0);
  }

  console.error("check-v0-freeze: FAIL");
  for (const err of result.errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
