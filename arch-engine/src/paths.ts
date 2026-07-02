import path from "node:path";

export function getArchDir(projectRoot: string): string {
  return path.join(projectRoot, ".ai", "arch");
}
export function getArchConfigPath(projectRoot: string): string {
  return path.join(getArchDir(projectRoot), "arch.config.json");
}
export function getArchSecretsPath(projectRoot: string): string {
  return path.join(getArchDir(projectRoot), "arch.secrets.json");
}
export function getArchIndexPath(projectRoot: string): string {
  return path.join(getArchDir(projectRoot), "arch-index.json");
}
export function getArchIndexMdPath(projectRoot: string): string {
  return path.join(getArchDir(projectRoot), "INDEX.md");
}
export function getVectorsDbPath(projectRoot: string): string {
  return path.join(getArchDir(projectRoot), "vectors.db");
}
export function getLastScanPath(projectRoot: string): string {
  return path.join(getArchDir(projectRoot), "last-scan.json");
}

export function getArchBackendRepoDir(projectRoot: string, repoSlug: string): string {
  return path.join(getArchDir(projectRoot), "backend", repoSlug);
}
