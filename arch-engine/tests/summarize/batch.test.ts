import { describe, expect, it, vi } from "vitest";
import type { ArchConfig, AssetCard, RawCandidate } from "../../src/types.js";
import {
  mergeCandidateWithCard,
  parseSummarizeResponse,
  resolveSummarizeBatchSize,
  sanitizeLlmJsonText,
  summarizeCandidates,
  useJsonResponseFormat,
  type SummarizeFn,
} from "../../src/summarize/batch.js";
import { buildFallbackCard } from "../../src/summarize/fallback-card.js";
import { SUMMARIZE_SYSTEM_PROMPT, buildSummarizeUserPrompt } from "../../src/summarize/prompt.js";

const config = {
  embedding: {
    baseUrl: "https://api.example.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    model: "text-embedding-3-small",
  },
  chunking: {
    baseUrl: "https://api.example.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    chatModel: "gpt-4o-mini",
    maxChunkTokens: 800,
    strategy: "semantic-only" as const,
  },
  apiSpecGlobs: [],
  scanners: { java: true, frontend: true },
} satisfies ArchConfig;

const candidates: RawCandidate[] = [
  {
    kind: "util",
    name: "JsonUtils",
    moduleSlug: "base-common",
    filePath: "base-common/src/main/java/com/example/JsonUtils.java",
    javadoc: "JSON 工具",
    signatures: ["public static String toJson(Object obj)"],
  },
  {
    kind: "enum",
    name: "CommonStatusEnum",
    moduleSlug: "base-common",
    filePath: "base-common/src/main/java/com/example/CommonStatusEnum.java",
    javadoc: "通用状态",
    signatures: ["ENABLE", "DISABLE"],
  },
];

function mockCard(candidate: RawCandidate, suffix: string): AssetCard {
  return mergeCandidateWithCard(
    candidate,
    {
      summary: `${candidate.name} 摘要 ${suffix}`,
      whenToUse: `使用 ${candidate.name} 的场景`,
      howToUse: `import ${candidate.name};`,
      exports: candidate.signatures,
      related: [],
      tags: ["test"],
    },
    "backend"
  );
}

describe("sanitizeLlmJsonText", () => {
  it("removes code-model special tokens and parses cards", () => {
    const raw = `{"cards": [<|code_suf|>{"kind":"util","name":"A","summary":"s","whenToUse":"w","howToUse":"h","exports":[],"related":[],"tags":[]}]}`;
    const cleaned = sanitizeLlmJsonText(raw);
    expect(cleaned).not.toContain("<|");
    const cards = parseSummarizeResponse(raw);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.name).toBe("A");
  });
});

describe("summarize prompt", () => {
  it("requires strict JSON AssetCard output in Chinese", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("JSON");
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("简体中文");
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("cards");

    const userPrompt = buildSummarizeUserPrompt("backend", "base-common", candidates);
    expect(userPrompt).toContain("Module: base-common");
    expect(userPrompt).toContain("JsonUtils");
    expect(userPrompt).toContain("CommonStatusEnum");
  });

  it("caps signatures in prompt to reduce MaaS payload", () => {
    const heavy: RawCandidate = {
      ...candidates[0]!,
      signatures: Array.from({ length: 30 }, (_, i) => `sig${i}`),
    };
    const prompt = buildSummarizeUserPrompt("backend", "base", [heavy], 12);
    expect(prompt).toContain("signatureNote");
    expect(prompt).toContain("共 30 条");
    expect(prompt.match(/sig11/)).toBeTruthy();
    expect(prompt.match(/sig12/)).toBeNull();
  });
});

describe("buildFallbackCard", () => {
  it("creates placeholder card with required fields", () => {
    const card = buildFallbackCard(candidates[0]!, "backend");
    expect(card.id).toBe("backend/base-common/util/JsonUtils");
    expect(card.summary).toBe("扫描失败，待人工补充");
    expect(card.whenToUse).toBe("暂无");
    expect(card.howToUse).toBe("暂无");
    expect(card.exports).toEqual(candidates[0]!.signatures);
    expect(card.source).toBe("scan");
    expect(card.updatedAt).toBeTruthy();
  });
});

describe("useJsonResponseFormat", () => {
  it("disables json_object for code models even when summarizeJsonMode is true", () => {
    const codeConfig = {
      ...config,
      chunking: {
        ...config.chunking,
        chatModel: "astron-code-latest",
        summarizeJsonMode: true,
      },
    } satisfies ArchConfig;
    expect(useJsonResponseFormat(codeConfig)).toBe(false);
  });

  it("uses smaller default batch size for code models", () => {
    const codeConfig = {
      ...config,
      chunking: { ...config.chunking, chatModel: "astron-code-latest" },
    } satisfies ArchConfig;
    expect(resolveSummarizeBatchSize(codeConfig)).toBe(4);
  });
});

describe("summarizeCandidates", () => {
  it("maps 2 candidates to 2 AssetCards via injected summarizeFn", async () => {
    const summarizeFn: SummarizeFn = vi.fn(async (_cfg, batch) =>
      batch.map((c, i) => mockCard(c, String(i)))
    );

    const cards = await summarizeCandidates(config, candidates, "base-common", {
      summarizeFn,
      batchSize: 20,
    });

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      id: "backend/base-common/util/JsonUtils",
      kind: "util",
      name: "JsonUtils",
      module: "base-common",
      summary: "JsonUtils 摘要 0",
      whenToUse: "使用 JsonUtils 的场景",
      howToUse: "import JsonUtils;",
      source: "scan",
    });
    expect(cards[1]?.name).toBe("CommonStatusEnum");
    expect(summarizeFn).toHaveBeenCalledTimes(1);
  });

  it("retries on invalid JSON errors then uses fallback cards", async () => {
    const retryConfig = {
      ...config,
      chunking: {
        ...config.chunking,
        summarizeRetryBaseDelayMs: 0,
        summarizeBatchDelayMs: 0,
      },
    } satisfies ArchConfig;
    const summarizeFn: SummarizeFn = vi.fn(async () => {
      throw new Error("Summarize response is not valid JSON: Unexpected token");
    });

    const cards = await summarizeCandidates(
      retryConfig,
      [candidates[0]!],
      "base-common",
      {
        summarizeFn,
        batchSize: 20,
      }
    );

    expect(summarizeFn).toHaveBeenCalledTimes(4);
    expect(cards.every((c) => c.summary === "扫描失败，待人工补充")).toBe(true);
  });

  it("splits batch on 500 EOF instead of retrying the same large payload", async () => {
    const retryConfig = {
      ...config,
      chunking: {
        ...config.chunking,
        summarizeRetryBaseDelayMs: 0,
        summarizeBatchDelayMs: 0,
      },
    } satisfies ArchConfig;
    const summarizeFn: SummarizeFn = vi.fn(async (_cfg, batch) => {
      if (batch.length > 2) {
        throw new Error(
          'Summarize failed (500): {"error":{"message":"EngineInternalError:Unexpected EOF"}}'
        );
      }
      return batch.map((c) => mockCard(c, "ok"));
    });

    const four = Array.from({ length: 4 }, (_, i) => ({
      ...candidates[0]!,
      name: `Util${i}`,
    }));

    const cards = await summarizeCandidates(retryConfig, four, "base", {
      summarizeFn,
      batchSize: 4,
    });

    expect(cards).toHaveLength(4);
    expect(cards.every((c) => c.summary !== "扫描失败，待人工补充")).toBe(true);
    expect(summarizeFn).toHaveBeenCalledTimes(3);
  });

  it("retries with backoff then uses fallback cards when summarizeFn keeps failing", async () => {
    const retryConfig = {
      ...config,
      chunking: {
        ...config.chunking,
        summarizeRetryBaseDelayMs: 0,
        summarizeBatchDelayMs: 0,
      },
    } satisfies ArchConfig;
    const summarizeFn: SummarizeFn = vi.fn(async () => {
      throw new Error("Summarize failed (500): EngineInternalError");
    });

    const cards = await summarizeCandidates(
      retryConfig,
      [candidates[0]!],
      "base-common",
      {
        summarizeFn,
        batchSize: 20,
      }
    );

    expect(summarizeFn).toHaveBeenCalledTimes(4);
    expect(cards).toHaveLength(1);
    expect(cards.every((c) => c.summary === "扫描失败，待人工补充")).toBe(true);
    expect(cards[0]?.id).toBe("backend/base-common/util/JsonUtils");
  });

  it("splits large candidate lists by batchSize", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      ...candidates[0]!,
      name: `Util${i}`,
    }));
    const summarizeFn: SummarizeFn = vi.fn(async (_cfg, batch) =>
      batch.map((c) => mockCard(c, "batch"))
    );

    const cards = await summarizeCandidates(config, many, "base-common", {
      summarizeFn,
      batchSize: 20,
    });

    expect(cards).toHaveLength(25);
    expect(summarizeFn).toHaveBeenCalledTimes(2);
  });
});
