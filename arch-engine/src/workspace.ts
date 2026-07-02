import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceConfig, WorkspaceRepo } from "./types.js";

const MANIFEST_FILE = "apt-workspace.json";

const VALID_LANGS: readonly string[] = ["java", "go", "python", "ts"];

/**
 * Marker files that reveal a subdirectory's primary language. The order is the
 * detection priority when a directory happens to match more than one rule.
 */
const MARKER_RULES: { lang: WorkspaceRepo["lang"]; markers: string[] }[] = [
  { lang: "java", markers: ["pom.xml", "build.gradle"] },
  { lang: "go", markers: ["go.mod"] },
  { lang: "python", markers: ["pyproject.toml", "setup.py"] },
  { lang: "ts", markers: ["package.json"] },
];

/**
 * Last path segment of a repo path (e.g. "services/payment" -> "payment").
 * Repo paths in the manifest use POSIX separators.
 */
function baseName(repoPath: string): string {
  const segments = repoPath.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : repoPath;
}

/**
 * Turn a repo path into a file-safe slug. Takes the basename, lowercases it,
 * collapses any run of non-alphanumeric characters into a single "-", and trims
 * leading/trailing dashes.
 *
 * Example: "services/Payment Go!" -> "payment-go".
 */
export function slugFromRepoPath(repoPath: string): string {
  return baseName(repoPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Read `apt-workspace.json` from `projectRoot`. Returns `null` when the manifest
 * is absent (single-repo mode, backward compatible). When present, each repo is
 * validated and auto-filled with a slug/name derived from its path.
 */
export async function loadWorkspace(
  projectRoot: string
): Promise<WorkspaceConfig | null> {
  const manifestPath = path.join(projectRoot, MANIFEST_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf-8");
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }

  const data = JSON.parse(raw) as Record<string, unknown>;
  if (!Array.isArray(data.repos)) {
    throw new Error(`Invalid ${MANIFEST_FILE}: "repos" must be an array`);
  }

  const repos: WorkspaceRepo[] = (data.repos as unknown[]).map((entry, i) => {
    const repo = entry as Record<string, unknown>;
    if (typeof repo.path !== "string" || repo.path.length === 0) {
      throw new Error(
        `Invalid ${MANIFEST_FILE}: repos[${i}].path must be a non-empty string`
      );
    }
    if (typeof repo.lang !== "string") {
      throw new Error(
        `Invalid ${MANIFEST_FILE}: repos[${i}].lang must be a string`
      );
    }
    if (!VALID_LANGS.includes(repo.lang)) {
      throw new Error(
        `Invalid ${MANIFEST_FILE}: repos[${i}].lang "${repo.lang}" is not one of ${VALID_LANGS.join(", ")}`
      );
    }

    const slug =
      typeof repo.slug === "string" && repo.slug.length > 0
        ? repo.slug
        : slugFromRepoPath(repo.path);
    const name =
      typeof repo.name === "string" && repo.name.length > 0
        ? repo.name
        : baseName(repo.path);

    const result: WorkspaceRepo = {
      path: repo.path,
      lang: repo.lang as WorkspaceRepo["lang"],
      slug,
      name,
    };
    if (typeof repo.stack === "string") result.stack = repo.stack;
    return result;
  });

  return { repos };
}

async function hasAnyMarker(
  dirAbs: string,
  markers: string[]
): Promise<boolean> {
  for (const marker of markers) {
    try {
      await fs.access(path.join(dirAbs, marker));
      return true;
    } catch {
      // marker absent — try the next one
    }
  }
  return false;
}

/**
 * Scan immediate subdirectories of `projectRoot`, detect each project's
 * language from well-known marker files, and write the resulting
 * `apt-workspace.json` manifest. Directories without a recognized marker are
 * skipped.
 */
export async function initWorkspace(
  projectRoot: string
): Promise<WorkspaceConfig> {
  const entries = await fs.readdir(projectRoot, { withFileTypes: true });
  const repos: WorkspaceRepo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip VCS / tooling noise that could otherwise be mistaken for a project.
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    const dirAbs = path.join(projectRoot, entry.name);
    let lang: WorkspaceRepo["lang"] | null = null;
    for (const rule of MARKER_RULES) {
      if (await hasAnyMarker(dirAbs, rule.markers)) {
        lang = rule.lang;
        break;
      }
    }
    if (!lang) continue;

    repos.push({
      path: entry.name,
      lang,
      slug: slugFromRepoPath(entry.name),
      name: entry.name,
    });
  }

  const config: WorkspaceConfig = { repos };
  const manifestPath = path.join(projectRoot, MANIFEST_FILE);
  await fs.writeFile(manifestPath, JSON.stringify(config, null, 2), "utf-8");
  return config;
}

/**
 * Join `projectRoot` and a repo-relative `repoPath` into an absolute path.
 */
export function resolveRepoRoot(projectRoot: string, repoPath: string): string {
  return path.join(projectRoot, repoPath);
}
