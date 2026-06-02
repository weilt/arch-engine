import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { ApiEndpoint } from "../types.js";

export async function parseOpenApiFile(
  filePath: string,
  moduleSlug: string
): Promise<ApiEndpoint[]> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf-8"));
  const doc = raw.openapi ? raw : raw.data?.openapi ? raw.data : raw;
  const paths = doc.paths ?? {};
  const out: ApiEndpoint[] = [];
  for (const [p, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue;
    for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const operation = op as { summary?: string; tags?: string[]; operationId?: string };
      out.push({
        id: `${method.toUpperCase()}-${p}`,
        method: method.toUpperCase(),
        path: p,
        summary: operation.summary ?? operation.operationId ?? p,
        tags: operation.tags ?? [],
        audience: p.includes("/internal") ? "internal" : "frontend-facing",
        source: "openapi",
        moduleSlug,
      });
    }
  }
  return out;
}

export async function scanOpenApiGlobs(
  projectRoot: string,
  globs: string[]
): Promise<ApiEndpoint[]> {
  const files = await fg.glob(globs, { cwd: projectRoot, absolute: true });
  const all: ApiEndpoint[] = [];
  for (const f of files) {
    const moduleSlug = path
      .basename(path.dirname(f))
      .replace(/[^a-z0-9-]/gi, "-")
      .toLowerCase();
    all.push(...(await parseOpenApiFile(f, moduleSlug)));
  }
  return all;
}
