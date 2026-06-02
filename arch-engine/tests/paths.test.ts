import { describe, it, expect } from "vitest";
import { getArchDir, getVectorsDbPath } from "../src/paths.js";

describe("arch paths", () => {
  const root = "/project";
  it("getArchDir", () => {
    expect(getArchDir(root)).toMatch(/\.ai[\\/]arch$/);
  });
  it("getVectorsDbPath", () => {
    expect(getVectorsDbPath(root)).toContain("vectors.db");
  });
});
