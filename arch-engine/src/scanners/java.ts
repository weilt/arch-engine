import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { ApiEndpoint, ArchConfig, JavaModule, RpcEndpoint } from "../types.js";
import { parseFeignInterface } from "./java-feign.js";
import {
  applyPathRulesToEndpointPath,
  extractJavaPackage,
  resolveJavaPathRules,
  type ResolvedJavaPathRules,
} from "./java-path-rules.js";

export {
  resolveJavaPathRules,
  type ResolvedJavaPathRules,
  type ControllerPathPrefixRule,
} from "./java-path-rules.js";
export { antPackageMatch, applyPathRulesToEndpointPath } from "./java-path-rules.js";

export { discoverJavaCandidates } from "./java-assets.js";
export {
  discoverJavaStarterCandidates,
  isStarterModule,
} from "./java-starter.js";

const MODULE_POM = "**/pom.xml";

export async function findMavenModules(
  projectRoot: string,
  repoSlug?: string
): Promise<JavaModule[]> {
  const poms = await fg.glob(MODULE_POM, {
    cwd: projectRoot,
    absolute: true,
    ignore: ["**/node_modules/**", "**/target/**"],
  });
  return poms.map((p) => ({
    slug: path.basename(path.dirname(p)).toLowerCase(),
    name: path.basename(path.dirname(p)),
    path: path.relative(projectRoot, path.dirname(p)),
    repoSlug,
  }));
}

const MAPPING_RE =
  /@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;
const CLASS_MAPPING_RE = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/;

function buildRpcSummary(feign: ReturnType<typeof parseFeignInterface>): string {
  if (!feign) return "";
  const firstOp = feign.methods.find((m) => m.operationSummary)?.operationSummary;
  if (firstOp) {
    return `Feign ${feign.name} (${feign.clientRef}): ${firstOp}`;
  }
  if (feign.methods.length > 0) {
    const m = feign.methods[0];
    return `Feign ${feign.name} (${feign.clientRef}): ${m.httpMethod ?? "RPC"} ${m.path ?? ""}`.trim();
  }
  return `Feign client ${feign.name} (${feign.clientRef})`;
}

export async function scanJavaSources(
  projectRoot: string,
  modules: JavaModule[],
  pathRules?: ResolvedJavaPathRules,
  config?: ArchConfig
): Promise<{ apis: ApiEndpoint[]; rpcs: RpcEndpoint[] }> {
  const rules = pathRules ?? (await resolveJavaPathRules(projectRoot, config));
  const apis: ApiEndpoint[] = [];
  const rpcs: RpcEndpoint[] = [];
  const seenRpc = new Set<string>();

  for (const mod of modules) {
    const javaFiles = await fg.glob("**/*.java", {
      cwd: path.join(projectRoot, mod.path),
      absolute: true,
      ignore: ["**/target/**"],
    });
    for (const file of javaFiles) {
      const content = await fs.readFile(file, "utf-8");
      if (content.includes("@FeignClient")) {
        const feign = parseFeignInterface(content);
        if (feign && !seenRpc.has(`${mod.slug}:${feign.name}`)) {
          seenRpc.add(`${mod.slug}:${feign.name}`);
          rpcs.push({
            id: `feign-${feign.name}`,
            name: feign.name,
            summary: buildRpcSummary(feign),
            moduleSlug: mod.slug,
            source: "java",
          });
        }
      }
      let classBase = "";
      const cm = content.match(CLASS_MAPPING_RE);
      if (cm) classBase = cm[1];
      const pkg = extractJavaPackage(content);
      for (const m of content.matchAll(MAPPING_RE)) {
        const method = m[1].toUpperCase();
        const raw = `${classBase}${m[2]}`.replace("//", "/");
        const p = applyPathRulesToEndpointPath(rules, pkg, raw);
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
