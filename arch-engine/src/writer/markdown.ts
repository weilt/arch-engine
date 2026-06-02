import fs from "node:fs/promises";
import path from "node:path";
import { getArchDir } from "../paths.js";
import type { ApiEndpoint, DocumentModel, FrontendPackage, RpcEndpoint } from "../types.js";

function renderModuleOverview(name: string, modulePath: string): string {
  return `# ${name}

Module path: \`${modulePath}\`
`;
}

function renderApiMd(apis: ApiEndpoint[]): string {
  const lines = ["# API", ""];
  for (const api of apis) {
    lines.push(`## ${api.method} ${api.path}`);
    lines.push("");
    lines.push(api.summary);
    if (api.tags.length > 0) {
      lines.push("");
      lines.push(`Tags: ${api.tags.join(", ")}`);
    }
    lines.push("");
    lines.push(`Audience: ${api.audience}`);
    lines.push(`Source: ${api.source}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderRpcMd(rpcs: RpcEndpoint[]): string {
  const lines = ["# RPC", ""];
  if (rpcs.length === 0) {
    lines.push("_No RPC endpoints discovered._");
    lines.push("");
    return lines.join("\n");
  }
  for (const rpc of rpcs) {
    lines.push(`## ${rpc.name}`);
    lines.push("");
    lines.push(rpc.summary);
    lines.push("");
    lines.push(`Source: ${rpc.source}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderPackageOverview(pkg: FrontendPackage): string {
  const lines = [`# ${pkg.name}`, ""];
  if (pkg.description) {
    lines.push(pkg.description);
    lines.push("");
  }
  if (pkg.framework) {
    lines.push(`Framework: ${pkg.framework}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderComponentsMd(pkg: FrontendPackage): string {
  const lines = ["# Components", ""];
  if (pkg.components.length === 0) {
    lines.push("_No components discovered._");
    lines.push("");
    return lines.join("\n");
  }
  for (const c of pkg.components) {
    lines.push(`## ${c.name}`);
    lines.push("");
    lines.push(`File: \`${c.file}\``);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderUtilsMd(pkg: FrontendPackage): string {
  const lines = ["# Utils", ""];
  if (pkg.utils.length === 0) {
    lines.push("_No utils discovered._");
    lines.push("");
    return lines.join("\n");
  }
  for (const u of pkg.utils) {
    lines.push(`## ${u.name}`);
    lines.push("");
    lines.push(`File: \`${u.file}\``);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

async function writeFileEnsuringDir(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

export async function writeMarkdownTree(
  projectRoot: string,
  model: DocumentModel
): Promise<void> {
  const archDir = getArchDir(projectRoot);

  for (const mod of model.modules) {
    const modDir = path.join(archDir, "backend", mod.slug);
    const moduleApis = model.apis.filter((a) => a.moduleSlug === mod.slug);
    const moduleRpcs = model.rpcs.filter((r) => r.moduleSlug === mod.slug);

    await writeFileEnsuringDir(
      path.join(modDir, "overview.md"),
      renderModuleOverview(mod.name, mod.path)
    );
    await writeFileEnsuringDir(path.join(modDir, "api.md"), renderApiMd(moduleApis));
    await writeFileEnsuringDir(path.join(modDir, "rpc.md"), renderRpcMd(moduleRpcs));
  }

  for (const pkg of model.packages) {
    const pkgDir = path.join(archDir, "frontend", pkg.slug);
    await writeFileEnsuringDir(
      path.join(pkgDir, "overview.md"),
      renderPackageOverview(pkg)
    );
    await writeFileEnsuringDir(
      path.join(pkgDir, "components.md"),
      renderComponentsMd(pkg)
    );
    await writeFileEnsuringDir(path.join(pkgDir, "utils.md"), renderUtilsMd(pkg));
  }
}
