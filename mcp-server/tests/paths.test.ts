import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { getAiDir, getDbPath, getProjectRoot, resolveTsPath } from "../src/paths.js";

describe("paths", () => {
  const root = "/project";

  afterEach(() => {
    delete process.env.APT_PROJECT_ROOT;
  });

  it("getProjectRoot prefers APT_PROJECT_ROOT over cwd", () => {
    process.env.APT_PROJECT_ROOT = "/business/project";
    expect(getProjectRoot("/tool/repo")).toBe(path.resolve("/business/project"));
  });

  it("getProjectRoot falls back to cwd when env unset", () => {
    expect(getProjectRoot("/tool/repo")).toBe("/tool/repo");
  });

  it("getAiDir returns .ai under cwd", () => {
    expect(getAiDir(root)).toBe(path.join(root, ".ai"));
  });

  it("getDbPath returns db.json path", () => {
    expect(getDbPath(root)).toBe(path.join(root, ".ai", "db.json"));
  });

  it("resolveTsPath handles relative path", () => {
    expect(resolveTsPath(root, "src/contracts/foo.ts")).toBe(
      path.resolve(root, "src/contracts/foo.ts")
    );
  });

  it("resolveTsPath handles absolute path within project", () => {
    const abs = path.join(root, "abs.ts");
    expect(resolveTsPath(root, abs)).toBe(path.resolve(abs));
  });

  it("resolveTsPath rejects path traversal", () => {
    expect(() => resolveTsPath(root, "../../../etc/passwd")).toThrow(
      /within the project directory/
    );
  });
});
