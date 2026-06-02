import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { ApiEndpoint, JavaModule, RpcEndpoint } from "../types.js";

const MODULE_POM = "**/pom.xml";

export async function findMavenModules(projectRoot: string): Promise<JavaModule[]> {
  const poms = await fg.glob(MODULE_POM, {
    cwd: projectRoot,
    absolute: true,
    ignore: ["**/node_modules/**", "**/target/**"],
  });
  return poms.map((p) => ({
    slug: path.basename(path.dirname(p)).toLowerCase(),
    name: path.basename(path.dirname(p)),
    path: path.relative(projectRoot, path.dirname(p)),
  }));
}

const MAPPING_RE =
  /@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;
const CLASS_MAPPING_RE = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/;
const FEIGN_RE = /@FeignClient\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;

export async function scanJavaSources(
  projectRoot: string,
  modules: JavaModule[]
): Promise<{ apis: ApiEndpoint[]; rpcs: RpcEndpoint[] }> {
  const apis: ApiEndpoint[] = [];
  const rpcs: RpcEndpoint[] = [];
  for (const mod of modules) {
    const javaFiles = await fg.glob("**/*.java", {
      cwd: path.join(projectRoot, mod.path),
      absolute: true,
      ignore: ["**/target/**"],
    });
    for (const file of javaFiles) {
      const content = await fs.readFile(file, "utf-8");
      if (content.includes("@FeignClient")) {
        for (const m of content.matchAll(FEIGN_RE)) {
          rpcs.push({
            id: `feign-${m[1]}`,
            name: m[1],
            summary: `Feign client ${m[1]}`,
            moduleSlug: mod.slug,
            source: "java",
          });
        }
      }
      let classBase = "";
      const cm = content.match(CLASS_MAPPING_RE);
      if (cm) classBase = cm[1];
      for (const m of content.matchAll(MAPPING_RE)) {
        const method = m[1].toUpperCase();
        const p = `${classBase}${m[2]}`.replace("//", "/");
        apis.push({
          id: `${method}-${p}`,
          method,
          path: p,
          summary: `${method} ${p}`,
          tags: [],
          audience: p.includes("/internal") ? "internal" : "frontend-facing",
          source: "java",
          moduleSlug: mod.slug,
        });
      }
    }
  }
  return { apis, rpcs };
}
