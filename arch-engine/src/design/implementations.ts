import fs from "node:fs/promises";
import path from "node:path";
import { assertDesignId } from "./ids.js";
import { getDesignImplementationsDir } from "./paths.js";
import type {
  RegisterUiPatternInput,
  RegisterUiPatternResult,
  UiPatternImplementation,
} from "./types.js";

export function getUiPatternFilePath(projectRoot: string, page: string): string {
  assertDesignId(page, "page");
  return path.join(getDesignImplementationsDir(projectRoot), `${page}.json`);
}

export async function registerUiPattern(
  projectRoot: string,
  input: RegisterUiPatternInput
): Promise<RegisterUiPatternResult> {
  assertDesignId(input.page, "page");
  if (!input.sourcePath.trim()) {
    throw new Error("sourcePath is required");
  }
  if (!input.componentsUsed.length) {
    throw new Error("componentsUsed must contain at least one semantic component id");
  }

  const record: UiPatternImplementation = {
    page: input.page,
    sourcePath: input.sourcePath,
    componentsUsed: [...input.componentsUsed],
    registeredAt: new Date().toISOString(),
  };
  if (input.notes) record.notes = input.notes;

  const filePath = getUiPatternFilePath(projectRoot, input.page);
  await fs.mkdir(getDesignImplementationsDir(projectRoot), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");

  return {
    ok: true,
    page: input.page,
    path: path.relative(projectRoot, filePath).replace(/\\/g, "/"),
    record,
  };
}

export async function readUiPattern(
  projectRoot: string,
  page: string
): Promise<UiPatternImplementation | null> {
  assertDesignId(page, "page");
  const filePath = getUiPatternFilePath(projectRoot, page);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as UiPatternImplementation;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function listUiPatterns(projectRoot: string): Promise<UiPatternImplementation[]> {
  const dir = getDesignImplementationsDir(projectRoot);
  try {
    const entries = await fs.readdir(dir);
    const results: UiPatternImplementation[] = [];
    for (const file of entries.filter((f) => f.endsWith(".json"))) {
      const raw = await fs.readFile(path.join(dir, file), "utf-8");
      results.push(JSON.parse(raw) as UiPatternImplementation);
    }
    return results.sort((a, b) => a.page.localeCompare(b.page));
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
