import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { JavaModule, RawCandidate } from "../types.js";

const ARTIFACT_ID_RE = /<artifactId>([^<]+)<\/artifactId>/;
const AUTO_CONFIG_CLASS_RE = /(?:public\s+)?(?:class|interface)\s+(\w+)/;
const CONFIGURATION_RE = /@Configuration\b/;
const AUTO_CONFIGURATION_ANNOTATION_RE = /@AutoConfiguration\b/;

export async function readModuleArtifactId(
  projectRoot: string,
  module: JavaModule
): Promise<string | null> {
  const pomPath = path.join(projectRoot, module.path, "pom.xml");
  try {
    const content = await fs.readFile(pomPath, "utf-8");
    const match = content.match(ARTIFACT_ID_RE);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function isStarterModule(
  projectRoot: string,
  module: JavaModule
): Promise<boolean> {
  if (module.name.endsWith("-starter") || module.slug.endsWith("-starter")) {
    return true;
  }
  const artifactId = await readModuleArtifactId(projectRoot, module);
  return artifactId?.endsWith("-starter") ?? false;
}

async function readAutoConfigurationImports(moduleDir: string): Promise<string[]> {
  const importsPath = path.join(
    moduleDir,
    "src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports"
  );
  try {
    const content = await fs.readFile(importsPath, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function parseSpringFactoriesEnableAutoConfiguration(content: string): string[] {
  const lines = content.split("\n");
  const classes: string[] = [];
  let inEnableAutoConfig = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("org.springframework.boot.autoconfigure.EnableAutoConfiguration=")) {
      inEnableAutoConfig = true;
      const inline = line.split("=")[1]?.replace(/\\$/, "").trim();
      if (inline) {
        classes.push(...inline.split(",").map((c) => c.trim()).filter(Boolean));
      }
      continue;
    }

    if (inEnableAutoConfig) {
      if (!line || line.includes("=")) {
        inEnableAutoConfig = false;
        continue;
      }
      classes.push(...line.replace(/\\$/, "").split(",").map((c) => c.trim()).filter(Boolean));
    }
  }

  return classes;
}

async function readSpringFactoriesAutoConfiguration(moduleDir: string): Promise<string[]> {
  const factoriesPath = path.join(moduleDir, "src/main/resources/META-INF/spring.factories");
  try {
    const content = await fs.readFile(factoriesPath, "utf-8");
    return parseSpringFactoriesEnableAutoConfiguration(content);
  } catch {
    return [];
  }
}

function extractConfigurationSignatures(content: string): string[] {
  const sigs: string[] = [];
  if (!CONFIGURATION_RE.test(content) && !AUTO_CONFIGURATION_ANNOTATION_RE.test(content)) {
    return sigs;
  }

  const classMatch = content.match(AUTO_CONFIG_CLASS_RE);
  if (!classMatch) return sigs;

  const className = classMatch[1];
  if (AUTO_CONFIGURATION_ANNOTATION_RE.test(content)) {
    sigs.push(`@AutoConfiguration ${className}`);
  } else if (CONFIGURATION_RE.test(content)) {
    sigs.push(`@Configuration ${className}`);
  }

  return sigs;
}

async function readPomDescription(projectRoot: string, module: JavaModule): Promise<string> {
  const pomPath = path.join(projectRoot, module.path, "pom.xml");
  try {
    const content = await fs.readFile(pomPath, "utf-8");
    const match = content.match(/<description>([\s\S]*?)<\/description>/);
    return match?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

export function isConfigurationJavaFile(content: string): boolean {
  if (!CONFIGURATION_RE.test(content) && !AUTO_CONFIGURATION_ANNOTATION_RE.test(content)) {
    return false;
  }
  return AUTO_CONFIG_CLASS_RE.test(content);
}

export async function discoverJavaStarterCandidates(
  projectRoot: string,
  module: JavaModule
): Promise<RawCandidate[]> {
  if (!(await isStarterModule(projectRoot, module))) {
    return [];
  }

  const moduleDir = path.join(projectRoot, module.path);
  const imports = await readAutoConfigurationImports(moduleDir);
  const factories = await readSpringFactoriesAutoConfiguration(moduleDir);

  const autoConfigClasses = [...new Set([...imports, ...factories])].sort((a, b) =>
    a.localeCompare(b)
  );

  const configSignatures: string[] = [];
  const javaFiles = await fg.glob("**/*.java", {
    cwd: moduleDir,
    absolute: true,
    ignore: ["**/target/**"],
  });

  for (const absFile of javaFiles) {
    const content = await fs.readFile(absFile, "utf-8");
    configSignatures.push(...extractConfigurationSignatures(content));
  }

  const signatures = [
    ...autoConfigClasses,
    ...configSignatures.sort((a, b) => a.localeCompare(b)),
  ];

  const artifactId = (await readModuleArtifactId(projectRoot, module)) ?? module.name;
  const description = await readPomDescription(projectRoot, module);

  return [
    {
      kind: "starter",
      name: artifactId,
      moduleSlug: module.slug,
      filePath: path.join(module.path, "pom.xml").replace(/\\/g, "/"),
      javadoc: description,
      signatures,
      extra: {
        autoConfigurationCount: String(autoConfigClasses.length),
      },
    },
  ];
}
