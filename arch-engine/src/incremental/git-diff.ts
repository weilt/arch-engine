import { spawnSync } from "node:child_process";
import path from "node:path";
import type { FrontendPackage, JavaModule } from "../types.js";

export interface GitExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

export interface GitRunner {
  exec(args: string[], cwd: string): GitExecResult;
}

export class GitDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitDiffError";
  }
}

export function defaultGitRunner(): GitRunner {
  return {
    exec(args, cwd) {
      const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        status: result.status ?? 1,
      };
    },
  };
}

function normalizeRel(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isGitRepo(projectRoot: string, git: GitRunner = defaultGitRunner()): boolean {
  const result = git.exec(["rev-parse", "--git-dir"], projectRoot);
  return result.status === 0;
}

export function getCurrentCommit(
  projectRoot: string,
  git: GitRunner = defaultGitRunner()
): string {
  if (!isGitRepo(projectRoot, git)) {
    return "nogit";
  }
  const result = git.exec(["rev-parse", "HEAD"], projectRoot);
  if (result.status !== 0) {
    return "nogit";
  }
  return result.stdout.trim();
}

export function getCurrentBranch(
  projectRoot: string,
  git: GitRunner = defaultGitRunner()
): string {
  if (!isGitRepo(projectRoot, git)) {
    return "nogit";
  }
  const result = git.exec(["rev-parse", "--abbrev-ref", "HEAD"], projectRoot);
  if (result.status !== 0) {
    return "nogit";
  }
  return result.stdout.trim();
}

export function getChangedFilesSince(
  projectRoot: string,
  commit: string,
  git: GitRunner = defaultGitRunner()
): string[] {
  if (commit === "nogit" || !isGitRepo(projectRoot, git)) {
    return [];
  }

  const result = git.exec(["diff", "--name-only", `${commit}..HEAD`], projectRoot);
  if (result.status !== 0) {
    throw new GitDiffError(
      `git diff failed for ${commit}..HEAD: ${result.stderr.trim() || "unknown error"}`
    );
  }

  return result.stdout
    .split("\n")
    .map((line) => normalizeRel(line.trim()))
    .filter((line) => line.length > 0 && !line.startsWith(".ai/"));
}

export function mapFilesToModules(
  changed: string[],
  modules: JavaModule[]
): Set<string> {
  const affected = new Set<string>();
  const normalizedChanged = changed.map(normalizeRel);

  for (const file of normalizedChanged) {
    for (const mod of modules) {
      const modPath = normalizeRel(mod.path);
      if (file === modPath || file.startsWith(`${modPath}/`)) {
        affected.add(mod.slug);
      }
    }
  }

  return affected;
}

export function mapFilesToPackages(
  changed: string[],
  packages: FrontendPackage[],
  packageDirs: Map<string, string>,
  projectRoot: string
): Set<string> {
  const affected = new Set<string>();
  const root = path.resolve(projectRoot);

  for (const file of changed) {
    const absFile = path.resolve(root, file);
    for (const pkg of packages) {
      const dir = packageDirs.get(pkg.slug);
      if (!dir) continue;
      const absDir = path.resolve(dir);
      if (absFile === absDir || absFile.startsWith(`${absDir}${path.sep}`)) {
        affected.add(pkg.slug);
      }
    }
  }

  return affected;
}
