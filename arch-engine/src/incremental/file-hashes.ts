import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { FrontendPackage, JavaModule } from "../types.js";

export async function hashFileContent(absPath: string): Promise<string> {
  const buf = await fs.readFile(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const JAVA_GLOB = "**/*.java";
const TS_GLOBS = ["**/*.{ts,tsx}", "**/*.{js,jsx}"];

const TRACKED_IGNORE = [
  "**/node_modules/**",
  "**/target/**",
  "**/dist/**",
  "**/.ai/**",
];

async function hashesUnder(
  projectRoot: string,
  relDir: string,
  globs: string[]
): Promise<Record<string, string>> {
  const cwd = path.join(projectRoot, relDir);
  let files: string[];
  try {
    files = await fg.glob(globs, { cwd, absolute: true, ignore: TRACKED_IGNORE });
  } catch {
    return {};
  }

  const out: Record<string, string> = {};
  for (const abs of files) {
    const rel = path.relative(projectRoot, abs).replace(/\\/g, "/");
    out[rel] = await hashFileContent(abs);
  }
  return out;
}

export async function collectTrackedSourceHashes(
  projectRoot: string,
  modules: Pick<JavaModule, "slug" | "path">[],
  packages: Pick<FrontendPackage, "slug">[],
  packageDirs: Map<string, string>
): Promise<Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, string>> = {};

  for (const mod of modules) {
    result[mod.slug] = await hashesUnder(projectRoot, mod.path, [JAVA_GLOB]);
  }
  for (const pkg of packages) {
    const dir = packageDirs.get(pkg.slug) ?? pkg.slug;
    result[pkg.slug] = await hashesUnder(projectRoot, dir, TS_GLOBS);
  }
  return result;
}
