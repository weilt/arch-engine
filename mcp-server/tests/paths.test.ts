import { describe, it, expect } from "vitest";
import path from "node:path";
import { getAiDir, getDbPath, resolveTsPath } from "../src/paths.js";

describe("paths", () => {
  const root = "/project";

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
