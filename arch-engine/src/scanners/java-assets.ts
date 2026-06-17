import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { AssetKind, JavaModule, RawCandidate } from "../types.js";
import { parseFeignInterface } from "./java-feign.js";
import { isConfigurationJavaFile, isStarterModule } from "./java-starter.js";

const JAVADOC_RE = /\/\*\*([\s\S]*?)\*\//;
const PUBLIC_METHOD_RE =
  /public\s+(?:static\s+)?[\w<>,\s\[\]]+\s+(\w+)\s*\([^;{]*\)\s*[;{]/g;
const ENUM_RE = /public\s+enum\s+(\w+)/;
const CLASS_RE = /public\s+(?:abstract\s+)?class\s+(\w+)/;
const INTERFACE_RE = /public\s+interface\s+(\w+)/;

const POJO_NAME_RE = /(DTO|Req|Resp|Param|Result)$/i;
const UTIL_NAME_RE = /(Utils|Helper|Constants)$/i;

function firstJavadocParagraph(content: string): string {
  const match = content.match(JAVADOC_RE);
  if (!match) return "";
  return match[1]
    .replace(/^\s*\*\s?/gm, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("@"))
    .join(" ")
    .trim();
}

function extractPublicSignatures(content: string): string[] {
  const sigs: string[] = [];
  for (const m of content.matchAll(PUBLIC_METHOD_RE)) {
    const line = m[0].replace(/\s+/g, " ").trim();
    if (!line.includes("(")) continue;
    sigs.push(line);
  }
  return sigs;
}

export function classifyJavaFile(
  content: string,
  filePath: string
): { kind: AssetKind; name: string; tags?: string[] } | null {
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();

  const enumMatch = content.match(ENUM_RE);
  if (enumMatch) {
    return { kind: "enum", name: enumMatch[1] };
  }

  if (content.includes("@FeignClient")) {
    const feign = parseFeignInterface(content);
    if (feign) return { kind: "rpc", name: feign.name };
  }

  const classMatch = content.match(CLASS_RE);
  if (classMatch) {
    const name = classMatch[1];
    if (UTIL_NAME_RE.test(name)) {
      const tags = name.endsWith("Constants") ? ["constants"] : undefined;
      return { kind: "util", name, tags };
    }
    if (POJO_NAME_RE.test(name) || normalizedPath.includes("/pojo/")) {
      return { kind: "pojo", name };
    }
    if (normalizedPath.includes("/util/")) {
      return { kind: "util", name };
    }
  }

  const ifaceMatch = content.match(INTERFACE_RE);
  if (ifaceMatch && !content.includes("@FeignClient")) {
    return null;
  }

  return null;
}

export async function discoverJavaCandidates(
  projectRoot: string,
  module: JavaModule
): Promise<RawCandidate[]> {
  const candidates: RawCandidate[] = [];
  const moduleDir = path.join(projectRoot, module.path);
  const starterModule = await isStarterModule(projectRoot, module);
  const javaFiles = await fg.glob("**/*.java", {
    cwd: moduleDir,
    absolute: true,
    ignore: ["**/target/**"],
  });

  for (const absFile of javaFiles) {
    const content = await fs.readFile(absFile, "utf-8");
    if (starterModule && isConfigurationJavaFile(content)) {
      continue;
    }
    const classified = classifyJavaFile(content, absFile);
    if (!classified) continue;

    const relPath = path.relative(projectRoot, absFile).replace(/\\/g, "/");
    const extra: Record<string, string> = {};

    if (classified.kind === "rpc") {
      const feign = parseFeignInterface(content);
      if (feign) {
        extra.clientRef = feign.clientRef;
        if (feign.methods.length > 0) {
          extra.firstMethod = feign.methods[0].name;
          if (feign.methods[0].operationSummary) {
            extra.operationSummary = feign.methods[0].operationSummary;
          }
        }
      }
    }

    candidates.push({
      kind: classified.kind,
      name: classified.name,
      moduleSlug: module.slug,
      filePath: relPath,
      javadoc: firstJavadocParagraph(content),
      signatures: extractPublicSignatures(content),
      extra: { ...extra, ...(classified.tags ? { tags: classified.tags.join(",") } : {}) },
    });
  }

  return candidates;
}
