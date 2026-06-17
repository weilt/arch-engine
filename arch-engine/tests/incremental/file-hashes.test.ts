import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectTrackedSourceHashes,
  hashFileContent,
} from "../../src/incremental/file-hashes.js";

describe("file-hashes", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fh-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("hashFileContent is stable for same bytes", async () => {
    const f = path.join(tmp, "a.java");
    await fs.writeFile(f, "public class A {}", "utf-8");
    const h1 = await hashFileContent(f);
    const h2 = await hashFileContent(f);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("collectTrackedSourceHashes returns relative posix paths", async () => {
    await fs.mkdir(path.join(tmp, "mod", "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "mod", "src", "FooUtils.java"),
      "class FooUtils {}",
      "utf-8"
    );
    const map = await collectTrackedSourceHashes(
      tmp,
      [{ slug: "mod", path: "mod" }],
      [],
      new Map()
    );
    expect(map.mod?.["mod/src/FooUtils.java"]).toMatch(/^[a-f0-9]{64}$/);
  });
});
