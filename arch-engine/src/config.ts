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

export async function loadOrInitConfig(
  projectRoot: string
): Promise<{ config: ArchConfig; created: boolean }> {
  const p = getArchConfigPath(projectRoot);
  try {
    const raw = await fs.readFile(p, "utf-8");
    let config = JSON.parse(raw) as ArchConfig;
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
