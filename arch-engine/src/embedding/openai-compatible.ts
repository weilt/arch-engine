import { resolveApiKey } from "../config.js";
import { archLog, readHttpErrorBody } from "../log.js";
import type { ArchConfig } from "../types.js";

const DEFAULT_BATCH_SIZE = 64;
const DASHSCOPE_BATCH_SIZE = 10;
const MAX_RETRIES = 3;

export function resolveEmbeddingBatchSize(config: ArchConfig): number {
  if (config.embedding.batchSize && config.embedding.batchSize > 0) {
    return config.embedding.batchSize;
  }
  if (config.embedding.baseUrl.toLowerCase().includes("dashscope.aliyuncs.com")) {
    return DASHSCOPE_BATCH_SIZE;
  }
  return DEFAULT_BATCH_SIZE;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchEmbeddingsBatch(
  config: ArchConfig,
  texts: string[],
  batchIndex: number,
  attempt = 0
): Promise<number[][]> {
  const apiKey = resolveApiKey(config, "embedding");
  const url = `${config.embedding.baseUrl}/embeddings`;

  archLog.info("embedding: calling API", {
    batchIndex,
    batchSize: texts.length,
    model: config.embedding.model,
    baseUrl: config.embedding.baseUrl,
    attempt: attempt + 1,
  });

  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: config.embedding.model, input: texts }),
  });

  const elapsedMs = Date.now() - started;

  if (!res.ok) {
    const body = await readHttpErrorBody(res);
    archLog.warn("embedding: API error", {
      batchIndex,
      status: res.status,
      statusText: res.statusText,
      model: config.embedding.model,
      baseUrl: config.embedding.baseUrl,
      batchSize: texts.length,
      attempt: attempt + 1,
      elapsedMs,
      body,
    });

    if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
      const delayMs = 2 ** attempt * 1000;
      archLog.info("embedding: retrying after delay", {
        batchIndex,
        status: res.status,
        delayMs,
        nextAttempt: attempt + 2,
      });
      await sleep(delayMs);
      return fetchEmbeddingsBatch(config, texts, batchIndex, attempt + 1);
    }

    throw new Error(
      `Embedding failed: ${res.status} ${res.statusText} (model=${config.embedding.model}, batchSize=${texts.length})\n${body}`
    );
  }

  const data = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };

  archLog.debug("embedding: batch ok", {
    batchIndex,
    count: data.data.length,
    elapsedMs,
  });

  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export async function embedTexts(
  config: ArchConfig,
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const batchSize = resolveEmbeddingBatchSize(config);
  const batchCount = Math.ceil(texts.length / batchSize);
  archLog.info("embedding: start", {
    totalTexts: texts.length,
    batchSize,
    batchCount,
    model: config.embedding.model,
  });

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batchIndex = Math.floor(i / batchSize) + 1;
    const batch = texts.slice(i, i + batchSize);
    const batchEmbeddings = await fetchEmbeddingsBatch(
      config,
      batch,
      batchIndex
    );
    results.push(...batchEmbeddings);
    archLog.info("embedding: batch progress", {
      batchIndex,
      batchCount,
      embeddedSoFar: results.length,
      total: texts.length,
    });
  }

  archLog.info("embedding: complete", { total: results.length });
  return results;
}

export async function embedQuery(
  config: ArchConfig,
  text: string
): Promise<number[]> {
  const [embedding] = await embedTexts(config, [text]);
  return embedding;
}
