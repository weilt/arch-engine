import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getArchDir } from "../../src/paths.js";
import type { DocumentModel } from "../../src/types.js";
import { writeMarkdownTree } from "../../src/writer/markdown.js";

const fixtureModel: DocumentModel = {
  modules: [{ slug: "auth", name: "auth", path: "services/auth" }],
  apis: [
    {
      id: "POST-/auth/login",
      method: "POST",
      path: "/auth/login",
      summary: "User login",
      tags: ["auth"],
      audience: "frontend-facing",
      source: "openapi",
      moduleSlug: "auth",
    },
    {
      id: "GET-/auth/me",
      method: "GET",
      path: "/auth/me",
      summary: "Current user profile",
      tags: [],
      audience: "frontend-facing",
      source: "java",
      moduleSlug: "auth",
    },
  ],
  rpcs: [
    {
      id: "feign-UserClient",
      name: "UserClient",
      summary: "Feign client UserClient",
      moduleSlug: "auth",
      source: "java",
    },
  ],
  packages: [
    {
      slug: "ui",
      name: "@app/ui",
      description: "Shared UI components",
      framework: "react",
      components: [
        {
          name: "Button",
          file: "src/components/Button.tsx",
          description: "Primary button",
          exports: ["export function Button()"],
        },
      ],
      utils: [
        {
          name: "formatDate",
          file: "src/utils/format.ts",
          description: "Format dates",
          exports: ["export function formatDate(d: Date): string"],
        },
      ],
      enums: [
        {
          name: "UserRole",
          file: "src/enums/UserRole.ts",
          description: "User roles",
          members: ["Admin", "User"],
        },
      ],
    },
  ],
};

describe("writeMarkdownTree", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-writer-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("writes backend and frontend markdown under .ai/arch", async () => {
    await writeMarkdownTree(tmpRoot, fixtureModel);

    const archDir = getArchDir(tmpRoot);
    const apiMd = await fs.readFile(path.join(archDir, "backend", "auth", "api.md"), "utf-8");
    const rpcMd = await fs.readFile(path.join(archDir, "backend", "auth", "rpc.md"), "utf-8");
    const overviewMd = await fs.readFile(
      path.join(archDir, "backend", "auth", "overview.md"),
      "utf-8"
    );
    const componentsMd = await fs.readFile(
      path.join(archDir, "frontend", "ui", "components.md"),
      "utf-8"
    );
    const utilsMd = await fs.readFile(path.join(archDir, "frontend", "ui", "utils.md"), "utf-8");
    const enumsMd = await fs.readFile(path.join(archDir, "frontend", "ui", "enums.md"), "utf-8");

    expect(apiMd).toContain("## POST /auth/login");
    expect(apiMd).toContain("## GET /auth/me");
    expect(apiMd).toContain("User login");
    expect(rpcMd).toContain("## UserClient");
    expect(overviewMd).toContain("# auth");
    expect(componentsMd).toContain("## Button");
    expect(componentsMd).toContain("Primary button");
    expect(componentsMd).toContain("export function Button()");
    expect(utilsMd).toContain("## formatDate");
    expect(utilsMd).toContain("Format dates");
    expect(enumsMd).toContain("## UserRole");
    expect(enumsMd).toContain("Members: Admin, User");
  });
});
