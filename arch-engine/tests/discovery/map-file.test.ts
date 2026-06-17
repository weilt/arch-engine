import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mapFileToCandidate } from "../../src/discovery/map-file.js";

describe("mapFileToCandidate", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "map-file-"));
    await fs.mkdir(path.join(tmp, "demo", "src"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("maps Java util file", async () => {
    await fs.writeFile(
      path.join(tmp, "demo", "src", "JsonUtils.java"),
      "public class JsonUtils {}",
      "utf-8"
    );
    const c = await mapFileToCandidate(tmp, "demo/src/JsonUtils.java", "demo");
    expect(c).toMatchObject({
      kind: "util",
      name: "JsonUtils",
      moduleSlug: "demo",
      filePath: "demo/src/JsonUtils.java",
    });
  });

  it("returns null for non-asset Java", async () => {
    await fs.writeFile(
      path.join(tmp, "demo", "src", "Plain.java"),
      "interface Plain {}",
      "utf-8"
    );
    const c = await mapFileToCandidate(tmp, "demo/src/Plain.java", "demo");
    expect(c).toBeNull();
  });
});
