import path from "node:path";

export function getProjectRoot(cwd: string = process.cwd()): string {
  return cwd;
}

export function getAiDir(projectRoot: string): string {
  return path.join(projectRoot, ".ai");
}

export function getDbPath(projectRoot: string): string {
  return path.join(getAiDir(projectRoot), "db.json");
}

export function getIndexMdPath(projectRoot: string): string {
  return path.join(getAiDir(projectRoot), "INDEX.md");
}

export function resolveTsPath(projectRoot: string, tsFilePath: string): string {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(
    path.isAbsolute(tsFilePath) ? tsFilePath : path.join(root, tsFilePath)
  );
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("❌ TS file path must stay within the project directory.");
  }
  return resolved;
}
