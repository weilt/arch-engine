import path from "node:path";

export function getDesignDir(projectRoot: string): string {
  return path.join(projectRoot, ".ai", "design");
}

export function getDesignProfilePath(projectRoot: string): string {
  return path.join(getDesignDir(projectRoot), "profile.json");
}

export function getDesignStylePath(projectRoot: string): string {
  return path.join(getDesignDir(projectRoot), "style.md");
}

export function getDesignTokensDir(projectRoot: string): string {
  return path.join(getDesignDir(projectRoot), "tokens");
}

export function getDesignComponentsDir(projectRoot: string): string {
  return path.join(getDesignDir(projectRoot), "components");
}

export function getDesignPagesDir(projectRoot: string): string {
  return path.join(getDesignDir(projectRoot), "pages");
}

export function getDesignRefsDir(projectRoot: string): string {
  return path.join(getDesignDir(projectRoot), "refs");
}

export function getDesignGapsPath(projectRoot: string): string {
  return path.join(getDesignDir(projectRoot), "gaps.json");
}

export function getDesignVectorsDbPath(projectRoot: string): string {
  return path.join(getDesignDir(projectRoot), "design-vectors.db");
}
