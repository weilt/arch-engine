import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidDesignIdError } from "../../src/design/errors.js";
import {
  getUiPatternFilePath,
  listUiPatterns,
  readUiPattern,
  registerUiPattern,
} from "../../src/design/implementations.js";

describe("ui pattern implementations", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "design-impl-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("writes and reads implementation json", async () => {
    const result = await registerUiPattern(tmpRoot, {
      page: "user-settings",
      sourcePath: "src/pages/UserSettings.vue",
      componentsUsed: ["PrimaryButton", "Card"],
      notes: "settings form page",
    });

    expect(result.ok).toBe(true);
    expect(result.path).toBe(".ai/design/implementations/user-settings.json");
    expect(result.record.page).toBe("user-settings");
    expect(result.record.componentsUsed).toEqual(["PrimaryButton", "Card"]);
    expect(result.record.notes).toBe("settings form page");
    expect(result.record.registeredAt).toBeTruthy();

    const onDisk = JSON.parse(
      await fs.readFile(getUiPatternFilePath(tmpRoot, "user-settings"), "utf-8")
    );
    expect(onDisk.sourcePath).toBe("src/pages/UserSettings.vue");

    const readBack = await readUiPattern(tmpRoot, "user-settings");
    expect(readBack?.page).toBe("user-settings");
    expect(readBack?.componentsUsed).toEqual(["PrimaryButton", "Card"]);
  });

  it("omits notes when not provided", async () => {
    await registerUiPattern(tmpRoot, {
      page: "list-page",
      sourcePath: "src/pages/ListPage.tsx",
      componentsUsed: ["PageHeader"],
    });

    const readBack = await readUiPattern(tmpRoot, "list-page");
    expect(readBack?.notes).toBeUndefined();
  });

  it("overwrites existing registration for the same page", async () => {
    await registerUiPattern(tmpRoot, {
      page: "form-page",
      sourcePath: "src/pages/FormPage.vue",
      componentsUsed: ["Input"],
    });
    await registerUiPattern(tmpRoot, {
      page: "form-page",
      sourcePath: "src/views/FormPage.vue",
      componentsUsed: ["Input", "PrimaryButton"],
    });

    const readBack = await readUiPattern(tmpRoot, "form-page");
    expect(readBack?.sourcePath).toBe("src/views/FormPage.vue");
    expect(readBack?.componentsUsed).toEqual(["Input", "PrimaryButton"]);
    expect((await listUiPatterns(tmpRoot)).length).toBe(1);
  });

  it("lists implementations sorted by page slug", async () => {
    await registerUiPattern(tmpRoot, {
      page: "z-page",
      sourcePath: "src/z.tsx",
      componentsUsed: ["Card"],
    });
    await registerUiPattern(tmpRoot, {
      page: "a-page",
      sourcePath: "src/a.tsx",
      componentsUsed: ["Card"],
    });

    const listed = await listUiPatterns(tmpRoot);
    expect(listed.map((r) => r.page)).toEqual(["a-page", "z-page"]);
  });

  it("returns null for missing implementation", async () => {
    expect(await readUiPattern(tmpRoot, "missing-page")).toBeNull();
    expect(await listUiPatterns(tmpRoot)).toEqual([]);
  });

  it("rejects invalid page slug", async () => {
    await expect(
      registerUiPattern(tmpRoot, {
        page: "bad slug",
        sourcePath: "src/pages/Bad.vue",
        componentsUsed: ["Card"],
      })
    ).rejects.toThrow(InvalidDesignIdError);
  });

  it("rejects empty sourcePath", async () => {
    await expect(
      registerUiPattern(tmpRoot, {
        page: "user-settings",
        sourcePath: "   ",
        componentsUsed: ["Card"],
      })
    ).rejects.toThrow(/sourcePath is required/);
  });

  it("rejects empty componentsUsed", async () => {
    await expect(
      registerUiPattern(tmpRoot, {
        page: "user-settings",
        sourcePath: "src/pages/UserSettings.vue",
        componentsUsed: [],
      })
    ).rejects.toThrow(/componentsUsed/);
  });
});
