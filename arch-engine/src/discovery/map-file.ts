import fs from "node:fs/promises";
import path from "node:path";
import { classifyJavaFile } from "../scanners/java-assets.js";
import { parseFeignInterface } from "../scanners/java-feign.js";
import type { RawCandidate } from "../types.js";

function firstPathSegment(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  const idx = normalized.indexOf("/");
  return idx === -1 ? normalized : normalized.slice(0, idx);
}

export async function mapFileToCandidate(
  projectRoot: string,
  sourcePath: string,
  moduleSlug?: string
): Promise<RawCandidate | null> {
  const rel = sourcePath.replace(/\\/g, "/");
  const abs = path.resolve(projectRoot, rel);
  let content: string;
  try {
    content = await fs.readFile(abs, "utf-8");
  } catch {
    return null;
  }

  const slug = moduleSlug ?? firstPathSegment(rel);

  if (rel.endsWith(".java")) {
    const classified = classifyJavaFile(content, abs);
    if (!classified) return null;
    const extra: Record<string, string> = {};
    if (classified.kind === "rpc") {
      const feign = parseFeignInterface(content);
      if (feign?.clientRef) extra.clientRef = feign.clientRef;
    }
    if (classified.tags?.length) {
      extra.tags = classified.tags.join(",");
    }
    return {
      kind: classified.kind,
      name: classified.name,
      moduleSlug: slug,
      filePath: rel,
      javadoc: "",
      signatures: [],
      extra,
    };
  }

  if (/\.(tsx?|jsx?)$/.test(rel)) {
    const base = path.basename(rel, path.extname(rel));
    if (!/^[A-Z]/.test(base)) return null;
    return {
      kind: "component",
      name: base,
      moduleSlug: slug,
      filePath: rel,
      javadoc: "",
      signatures: [],
      extra: {},
    };
  }

  return null;
}
