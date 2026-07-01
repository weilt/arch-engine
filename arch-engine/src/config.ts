import fs from "node:fs/promises";
import path from "node:path";
import type { ArchConfig } from "./types.js";
import { getArchConfigPath, getArchSecretsPath } from "./paths.js";

export const DEFAULT_CONFIG: ArchConfig = {
  embedding: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    model: "text-embedding-3-small",
  },
  chunking: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    chatModel: "gpt-4o-mini",
    maxChunkTokens: 800,
    strategy: "semantic-only",
  },
  apiSpecGlobs: ["docs/**/*.json", "**/openapi.json", "**/swagger.json"],
 designSystemPackages: [],
  frontendPackages: [],
  projectMeta: null,
 scanners: { java: true, frontend: true },
};

/** Optional overlay: only apiKey fields are merged from arch.secrets.json */
export interface ArchSecretsPartial {
  embedding?: { apiKey?: string };
  chunking?: { apiKey?: string };
}

function mergeSecrets(config: ArchConfig, secrets: ArchSecretsPartial): ArchConfig {
  const merged: ArchConfig = {
    ...config,
    embedding: { ...config.embedding },
    chunking: { ...config.chunking },
  };

  const embeddingKey = secrets.embedding?.apiKey?.trim();
  if (embeddingKey) merged.embedding.apiKey = embeddingKey;

  const chunkingKey = secrets.chunking?.apiKey?.trim();
  if (chunkingKey) merged.chunking.apiKey = chunkingKey;

  return merged;
}

async function loadSecretsOverlay(projectRoot: string): Promise<ArchSecretsPartial | null> {
  const secretsPath = getArchSecretsPath(projectRoot);
  try {
    const raw = await fs.readFile(secretsPath, "utf-8");
    return JSON.parse(raw) as ArchSecretsPartial;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function assertValidJavaSection(java: unknown): void {
  if (java === undefined || java === null) return;
  if (typeof java !== "object" || Array.isArray(java)) {
    throw new Error("Invalid arch.config.json: java must be an object");
  }
  const j = java as Record<string, unknown>;
  const prefixes = j.controllerPathPrefixes;
  if (prefixes === undefined) return;
  if (!Array.isArray(prefixes)) {
    throw new Error(
      "Invalid arch.config.json: java.controllerPathPrefixes must be an array"
    );
  }
  for (const entry of prefixes) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(
        "Invalid arch.config.json: java.controllerPathPrefixes entries must be objects"
      );
    }
    const prefix = (entry as Record<string, unknown>).prefix;
    if (typeof prefix === "string" && prefix.length > 0 && !prefix.startsWith("/")) {
      throw new Error(
        `Invalid arch.config.json: java.controllerPathPrefixes[].prefix must start with "/" (got: ${prefix})`
      );
    }
  }
}

function assertValidConfig(data: unknown): ArchConfig {
  const c = data as Record<string, unknown>;
  const e = c.embedding as Record<string, unknown> | undefined;
  const k = c.chunking as Record<string, unknown> | undefined;
  if (!e?.baseUrl || !e?.model || !k?.baseUrl || !k?.chatModel) {
    throw new Error(
      "Invalid arch.config.json: missing required fields " +
        "(embedding.baseUrl, embedding.model, chunking.baseUrl, chunking.chatModel)"
    );
  }
  assertValidJavaSection(c.java);
  return data as ArchConfig;
}

export async function loadOrInitConfig(
  projectRoot: string
): Promise<{ config: ArchConfig; created: boolean }> {
  const p = getArchConfigPath(projectRoot);
  try {
    const raw = await fs.readFile(p, "utf-8");
    let config = assertValidConfig(JSON.parse(raw));
    const secrets = await loadSecretsOverlay(projectRoot);
    if (secrets) config = mergeSecrets(config, secrets);
    return { config, created: false };
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
      return { config: DEFAULT_CONFIG, created: true };
    }
    throw e;
  }
}

export function resolveApiKey(
  config: ArchConfig,
  section: "embedding" | "chunking"
): string {
  const sectionConfig = config[section];
  const inlineKey = sectionConfig.apiKey?.trim();
  if (inlineKey) return inlineKey;

  const envName = sectionConfig.apiKeyEnv;
  const key = process.env[envName];
  if (!key) {
    throw new Error(
      `Missing API key for ${section}: set ${section}.apiKey in .ai/arch/arch.config.json or .ai/arch/arch.secrets.json, or set env ${envName}`
    );
  }
  return key;
}
