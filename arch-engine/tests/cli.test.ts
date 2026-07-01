import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliArgs, runCli } from "../src/cli.js";
import { getArchIndexPath } from "../src/paths.js";

const { runReindexApisMock, runStartInitMock } = vi.hoisted(() => ({
  runReindexApisMock: vi.fn(),
  runStartInitMock: vi.fn(),
}));

vi.mock("../src/reindex/apis.js", () => ({
  runReindexApis: (...args: unknown[]) => runReindexApisMock(...args),
}));

vi.mock("../src/pipeline.js", () => ({
  runStartInit: (...args: unknown[]) => runStartInitMock(...args),
}));

describe("parseCliArgs", () => {
  it("defaults to cwd with no flags", () => {
    const opts = parseCliArgs([]);
    expect(opts.projectRoot).toBe(process.cwd());
    expect(opts.full).toBe(false);
    expect(opts.reindexApis).toBe(false);
    expect(opts.verbose).toBe(false);
  });

  it("parses --full and project root", () => {
    const opts = parseCliArgs(["--full", "/tmp/proj"]);
    expect(opts.projectRoot).toBe(path.resolve("/tmp/proj"));
    expect(opts.full).toBe(true);
    expect(opts.reindexApis).toBe(false);
  });

  it("parses --reindex-apis and disables --full", () => {
    const opts = parseCliArgs(["--full", "--reindex-apis", "/tmp/proj"]);
    expect(opts.projectRoot).toBe(path.resolve("/tmp/proj"));
    expect(opts.reindexApis).toBe(true);
    expect(opts.full).toBe(false);
  });

  it("parses --verbose", () => {
    const opts = parseCliArgs(["-v"]);
    expect(opts.verbose).toBe(true);
  });
});

describe("runCli --reindex-apis", () => {
  let tmpRoot: string;

  afterEach(async () => {
    runReindexApisMock.mockReset();
    runStartInitMock.mockReset();
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("exits 2 when arch-index.json is missing", async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cli-reindex-"));
    const code = await runCli({
      projectRoot: tmpRoot,
      full: false,
      reindexApis: true,
      verbose: false,
    });
    expect(code).toBe(2);
    expect(runReindexApisMock).not.toHaveBeenCalled();
  });

  it("calls runReindexApis when arch-index exists", async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cli-reindex-"));
    await fs.mkdir(path.dirname(getArchIndexPath(tmpRoot)), { recursive: true });
    await fs.writeFile(getArchIndexPath(tmpRoot), "{}", "utf-8");
    runReindexApisMock.mockResolvedValue({ apiCount: 3, modulesUpdated: 2 });

    const code = await runCli({
      projectRoot: tmpRoot,
      full: false,
      reindexApis: true,
      verbose: false,
    });

    expect(code).toBe(0);
    expect(runReindexApisMock).toHaveBeenCalledWith(tmpRoot);
  });

  it("uses runStartInit for default path", async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cli-start-"));
    runStartInitMock.mockResolvedValue({
      status: "ok",
      apiCount: 1,
      moduleCount: 1,
      chunkCount: 2,
    });

    const code = await runCli({
      projectRoot: tmpRoot,
      full: false,
      reindexApis: false,
      verbose: false,
    });

    expect(code).toBe(0);
    expect(runStartInitMock).toHaveBeenCalledWith(tmpRoot, {}, { full: false });
    expect(runReindexApisMock).not.toHaveBeenCalled();
  });
});
