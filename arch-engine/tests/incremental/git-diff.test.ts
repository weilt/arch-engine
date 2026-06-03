import { describe, expect, it } from "vitest";
import {
  type GitRunner,
  getChangedFilesSince,
  mapFilesToModules,
  mapFilesToPackages,
} from "../../src/incremental/git-diff.js";
import type { FrontendPackage, JavaModule } from "../../src/types.js";

function mockGit(responses: Record<string, { status: number; stdout: string }>): GitRunner {
  return {
    exec(args: string[]) {
      const key = args.join(" ");
      const hit = responses[key];
      if (!hit) {
        throw new Error(`unexpected git args: ${key}`);
      }
      return { ...hit, stderr: "" };
    },
  };
}

const modules: JavaModule[] = [
  {
    slug: "base-common",
    name: "base-common",
    path: "base/base-framework/base-common",
  },
  {
    slug: "user-api",
    name: "user-api",
    path: "services/user-api",
  },
];

const packages: FrontendPackage[] = [
  { slug: "ui", name: "@app/ui", description: "", components: [], utils: [], enums: [] },
];

describe("git-diff", () => {
  it("getChangedFilesSince runs git diff and ignores .ai/ paths", () => {
    const git = mockGit({
      "rev-parse --git-dir": { status: 0, stdout: ".git\n" },
      "diff --name-only abc..HEAD": {
        status: 0,
        stdout: "base/base-framework/base-common/src/Foo.java\n.ai/arch/foo.md\n",
      },
    });

    const changed = getChangedFilesSince("/repo", "abc", git);
    expect(changed).toEqual(["base/base-framework/base-common/src/Foo.java"]);
  });

  it("mapFilesToModules returns slugs for files under module paths", () => {
    const changed = [
      "base/base-framework/base-common/src/main/java/Foo.java",
      "services/user-api/src/Bar.java",
      "README.md",
    ];
    const affected = mapFilesToModules(changed, modules);
    expect([...affected].sort()).toEqual(["base-common", "user-api"]);
  });

  it("mapFilesToPackages maps changed files under package directories", () => {
    const packageDirs = new Map<string, string>([["ui", "/repo/packages/ui"]]);
    const changed = ["packages/ui/src/Button.tsx", "packages/ui/package.json"];
    const affected = mapFilesToPackages(changed, packages, packageDirs, "/repo");
    expect([...affected]).toEqual(["ui"]);
  });
});
