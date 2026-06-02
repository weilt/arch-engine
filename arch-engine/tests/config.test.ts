import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  loadOrInitConfig,
  resolveApiKey,
} from "../src/config.js";
import { getArchConfigPath } from "../src/paths.js";

describe("arch config", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("loadOrInitConfig creates file when missing", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "arch-config-"));
    const configPath = getArchConfigPath(tmpDir);

    const first = await loadOrInitConfig(tmpDir);
    expect(first.created).toBe(true);
    expect(first.config).toEqual(DEFAULT_CONFIG);
    await expect(fs.access(configPath)).resolves.toBeUndefined();
  });

  it("loadOrInitConfig returns created=false on second load", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "arch-config-"));

    const first = await loadOrInitConfig(tmpDir);
    expect(first.created).toBe(true);

    const second = await loadOrInitConfig(tmpDir);
    expect(second.created).toBe(false);
    expect(second.config).toEqual(DEFAULT_CONFIG);
  });

  it("resolveApiKey throws when env missing", () => {
    const envName = DEFAULT_CONFIG.embedding.apiKeyEnv;
    delete process.env[envName];

    expect(() => resolveApiKey(DEFAULT_CONFIG, "embedding")).toThrow(
      `Missing API key for embedding`
    );
  });

  it("resolveApiKey prefers inline apiKey over env", () => {
    const envName = DEFAULT_CONFIG.embedding.apiKeyEnv;
    process.env[envName] = "from-env";

    const config = {
      ...DEFAULT_CONFIG,
      embedding: { ...DEFAULT_CONFIG.embedding, apiKey: "from-config" },
    };
    expect(resolveApiKey(config, "embedding")).toBe("from-config");

    delete process.env[envName];
  });

  it("loadOrInitConfig merges apiKey from arch.secrets.json", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "arch-config-"));
    const archDir = path.join(tmpDir, ".ai", "arch");
    await fs.mkdir(archDir, { recursive: true });
    await fs.writeFile(
      path.join(archDir, "arch.config.json"),
      JSON.stringify(DEFAULT_CONFIG, null, 2),
      "utf-8"
    );
    await fs.writeFile(
      path.join(archDir, "arch.secrets.json"),
      JSON.stringify(
        {
          embedding: { apiKey: "secret-embed" },
          chunking: { apiKey: "secret-chunk" },
        },
        null,
        2
      ),
      "utf-8"
    );

    const { config, created } = await loadOrInitConfig(tmpDir);
    expect(created).toBe(false);
    expect(config.embedding.apiKey).toBe("secret-embed");
    expect(config.chunking.apiKey).toBe("secret-chunk");
    expect(resolveApiKey(config, "embedding")).toBe("secret-embed");
    expect(resolveApiKey(config, "chunking")).toBe("secret-chunk");
  });

  it("resolveApiKey returns key when env set", () => {
    const envName = DEFAULT_CONFIG.embedding.apiKeyEnv;
    process.env[envName] = "test-key-123";

    expect(resolveApiKey(DEFAULT_CONFIG, "embedding")).toBe("test-key-123");

    delete process.env[envName];
  });
});
