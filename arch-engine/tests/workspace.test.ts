import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initWorkspace,
  loadWorkspace,
  resolveRepoRoot,
  slugFromRepoPath,
} from "../src/workspace.js";

describe("workspace", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe("slugFromRepoPath", () => {
    it("slugifies a nested path with spaces and special chars", () => {
      expect(slugFromRepoPath("services/Payment Go!")).toBe("payment-go");
    });

    it("lowercases the basename only", () => {
      expect(slugFromRepoPath("web/AdminUI")).toBe("adminui");
    });

    it("collapses runs of non-alphanumeric chars into single dashes", () => {
      expect(slugFromRepoPath("a/b/c--d e")).toBe("c-d-e");
    });

    it("keeps an existing dash intact", () => {
      expect(slugFromRepoPath("services/payment-go")).toBe("payment-go");
    });

    it("replaces dots with dashes", () => {
      expect(slugFromRepoPath("svc/my.project")).toBe("my-project");
    });
  });

  describe("loadWorkspace", () => {
    it("returns null when no manifest exists", async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-load-"));
      await expect(loadWorkspace(tmpDir)).resolves.toBeNull();
    });

    it("loads a valid manifest and auto-fills slug + name", async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-load-"));
      await fs.writeFile(
        path.join(tmpDir, "apt-workspace.json"),
        JSON.stringify({
          repos: [
            { path: "services/Payment Go", lang: "go" },
            { path: "web/admin-ui", lang: "ts", slug: "custom", name: "Custom" },
          ],
        }),
        "utf-8"
      );

      const cfg = await loadWorkspace(tmpDir);
      expect(cfg).not.toBeNull();
      expect(cfg!.repos).toHaveLength(2);
      expect(cfg!.repos[0]).toEqual({
        path: "services/Payment Go",
        lang: "go",
        slug: "payment-go",
        name: "Payment Go",
      });
      expect(cfg!.repos[1]).toEqual({
        path: "web/admin-ui",
        lang: "ts",
        slug: "custom",
        name: "Custom",
      });
    });

    it("preserves an explicit stack field", async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-load-"));
      await fs.writeFile(
        path.join(tmpDir, "apt-workspace.json"),
        JSON.stringify({
          repos: [{ path: "svc/billing", lang: "java", stack: "spring-boot" }],
        }),
        "utf-8"
      );

      const cfg = await loadWorkspace(tmpDir);
      expect(cfg!.repos[0].stack).toBe("spring-boot");
    });

    it("throws on invalid lang value", async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-load-"));
      await fs.writeFile(
        path.join(tmpDir, "apt-workspace.json"),
        JSON.stringify({ repos: [{ path: "svc/x", lang: "rust" }] }),
        "utf-8"
      );

      await expect(loadWorkspace(tmpDir)).rejects.toThrow(/not one of/);
    });

    it("throws when repos is not an array", async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-load-"));
      await fs.writeFile(
        path.join(tmpDir, "apt-workspace.json"),
        JSON.stringify({ repos: "nope" }),
        "utf-8"
      );

      await expect(loadWorkspace(tmpDir)).rejects.toThrow(/must be an array/);
    });
  });

  describe("initWorkspace", () => {
    it("detects java/go/ts subdirectories by marker files", async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-init-"));
      await fs.mkdir(path.join(tmpDir, "payment-svc"));
      await fs.writeFile(
        path.join(tmpDir, "payment-svc", "pom.xml"),
        "<p/>",
        "utf-8"
      );
      await fs.mkdir(path.join(tmpDir, "order-go"));
      await fs.writeFile(
        path.join(tmpDir, "order-go", "go.mod"),
        "module o",
        "utf-8"
      );
      await fs.mkdir(path.join(tmpDir, "frontend"));
      await fs.writeFile(
        path.join(tmpDir, "frontend", "package.json"),
        "{}",
        "utf-8"
      );
      // directory with no recognized marker — must be skipped
      await fs.mkdir(path.join(tmpDir, "notes"));
      await fs.writeFile(path.join(tmpDir, "notes", "readme.txt"), "hi", "utf-8");

      const cfg = await initWorkspace(tmpDir);
      const byPath = Object.fromEntries(cfg.repos.map((r) => [r.path, r]));
      expect(Object.keys(byPath).sort()).toEqual([
        "frontend",
        "order-go",
        "payment-svc",
      ]);
      expect(byPath["payment-svc"].lang).toBe("java");
      expect(byPath["order-go"].lang).toBe("go");
      expect(byPath["frontend"].lang).toBe("ts");
      expect(byPath["payment-svc"].slug).toBe("payment-svc");
    });

    it("writes apt-workspace.json to disk", async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-init-"));
      await fs.mkdir(path.join(tmpDir, "py-api"));
      await fs.writeFile(
        path.join(tmpDir, "py-api", "pyproject.toml"),
        "[tool]",
        "utf-8"
      );

      const cfg = await initWorkspace(tmpDir);
      expect(cfg.repos).toHaveLength(1);
      expect(cfg.repos[0].lang).toBe("python");

      const written = JSON.parse(
        await fs.readFile(path.join(tmpDir, "apt-workspace.json"), "utf-8")
      ) as { repos: { path: string; lang: string }[] };
      expect(written.repos[0].path).toBe("py-api");
      expect(written.repos[0].lang).toBe("python");
    });

    it("detects python via setup.py as well", async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-init-"));
      await fs.mkdir(path.join(tmpDir, "legacy-py"));
      await fs.writeFile(
        path.join(tmpDir, "legacy-py", "setup.py"),
        "x=1",
        "utf-8"
      );

      const cfg = await initWorkspace(tmpDir);
      expect(cfg.repos[0].lang).toBe("python");
    });

    it("detects gradle-based java projects", async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-init-"));
      await fs.mkdir(path.join(tmpDir, "gradle-app"));
      await fs.writeFile(
        path.join(tmpDir, "gradle-app", "build.gradle"),
        "plugins {}",
        "utf-8"
      );

      const cfg = await initWorkspace(tmpDir);
      expect(cfg.repos[0].lang).toBe("java");
    });
  });

  describe("resolveRepoRoot", () => {
    it("joins projectRoot and repoPath into an absolute path", () => {
      const abs = resolveRepoRoot("/projects/workspace", "services/payment");
      expect(abs).toBe(path.join("/projects/workspace", "services/payment"));
    });
  });
});
