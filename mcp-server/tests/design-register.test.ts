import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRegisterUiPattern } from "../src/design-register.js";

describe("register_ui_pattern MCP handler", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-design-register-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("registers implementation and writes json under .ai/design/implementations", async () => {
    const result = await handleRegisterUiPattern(tmpRoot, {
      page: "user-settings",
      sourcePath: "src/pages/UserSettings.vue",
      componentsUsed: ["PrimaryButton", "Card"],
      notes: "vue settings page",
    });

    expect(result.ok).toBe(true);
    expect(result.path).toBe(".ai/design/implementations/user-settings.json");

    const raw = await fs.readFile(
      path.join(tmpRoot, ".ai", "design", "implementations", "user-settings.json"),
      "utf-8"
    );
    const record = JSON.parse(raw);
    expect(record.page).toBe("user-settings");
    expect(record.sourcePath).toBe("src/pages/UserSettings.vue");
    expect(record.componentsUsed).toEqual(["PrimaryButton", "Card"]);
    expect(record.notes).toBe("vue settings page");
    expect(record.registeredAt).toBeTruthy();
  });

  it("propagates validation errors for invalid page slug", async () => {
    await expect(
      handleRegisterUiPattern(tmpRoot, {
        page: "1bad",
        sourcePath: "src/pages/Bad.vue",
        componentsUsed: ["Card"],
      })
    ).rejects.toThrow(/Invalid design page id/);
  });

  it("propagates validation errors for empty componentsUsed", async () => {
    await expect(
      handleRegisterUiPattern(tmpRoot, {
        page: "user-settings",
        sourcePath: "src/pages/UserSettings.vue",
        componentsUsed: [],
      })
    ).rejects.toThrow(/componentsUsed/);
  });
});
