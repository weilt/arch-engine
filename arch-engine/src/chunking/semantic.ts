import { randomUUID } from "node:crypto";
import { resolveApiKey } from "../config.js";
import { archLog, readHttpErrorBody } from "../log.js";
import type { ArchChunk, ArchConfig, DocumentModel } from "../types.js";

export type SemanticSplitChunk = {
  title: string;
  text: string;
  keywords: string[];
};

const CHARS_PER_TOKEN = 4;
const MAX_RETRIES = 3;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Short docs that already fit in one chunk — no LLM call needed. */
export function shouldUseLocalSplit(
  markdown: string,
  maxChunkTokens: number
): boolean {
  return estimateTokens(markdown.trim()) <= maxChunkTokens;
}

export function localSingleChunk(
  markdown: string,
  context: { path: string }
): SemanticSplitChunk[] {
  const trimmed = markdown.trim();
  const title =
    trimmed.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    context.path.split("/").filter(Boolean).pop() ||
    "Overview";
  return [{ title, text: trimmed, keywords: [] }];
}

function normalizeSemanticChunks(raw: unknown): SemanticSplitChunk[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const list = record.chunks;
  if (!Array.isArray(list)) return [];

  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const chunk = item as Record<string, unknown>;
      const text = String(chunk.text ?? chunk.content ?? "").trim();
      if (!text) return null;
      const title = String(chunk.title ?? chunk.name ?? "Untitled").trim();
      const keywords = Array.isArray(chunk.keywords)
        ? chunk.keywords.map(String)
        : [];
      return { title: title || "Untitled", text, keywords };
    })
    .filter((c): c is SemanticSplitChunk => c !== null);
}

export function chunkStructuredEntities(model: DocumentModel): ArchChunk[] {
  const chunks: ArchChunk[] = [];

  for (const api of model.apis) {
    chunks.push({
      id: randomUUID(),
      path: `backend/${api.moduleSlug}/api`,
      anchor: api.id,
      kind: "api",
      title: `${api.method} ${api.path}`,
      text: `[kind:api][module:${api.moduleSlug}][tags:${api.tags.join(",")}][audience:${api.audience}]\n${api.method} ${api.path} — ${api.summary}`,
    });
  }

  for (const rpc of model.rpcs) {
    chunks.push({
      id: randomUUID(),
      path: `backend/${rpc.moduleSlug}/rpc`,
      anchor: rpc.id,
      kind: "rpc",
      title: rpc.name,
      text: `[kind:rpc][module:${rpc.moduleSlug}]\n${rpc.name} — ${rpc.summary}`,
    });
  }

  for (const pkg of model.packages) {
    for (const component of pkg.components) {
      chunks.push({
        id: randomUUID(),
        path: `frontend/${pkg.slug}/components`,
        anchor: component.name,
        kind: "component",
        title: component.name,
        text: `[kind:component][package:${pkg.slug}]\n${component.name} — File: ${component.file}`,
      });
    }

    for (const util of pkg.utils) {
      chunks.push({
        id: randomUUID(),
        path: `frontend/${pkg.slug}/utils`,
        anchor: util.name,
        kind: "util",
        title: util.name,
        text: `[kind:util][package:${pkg.slug}]\n${util.name} — File: ${util.file}`,
      });
    }
  }

  return chunks;
}

async function requestSemanticSplit(
  config: ArchConfig,
  markdown: string,
  context: { path: string; kind: string },
  attempt = 0
): Promise<SemanticSplitChunk[]> {
  const apiKey = resolveApiKey(config, "chunking");
  const url = `${config.chunking.baseUrl}/chat/completions`;
  const inputChars = markdown.length;
  const inputTokens = estimateTokens(markdown);

  archLog.info("semantic split: calling chat API", {
    path: context.path,
    kind: context.kind,
    model: config.chunking.chatModel,
    baseUrl: config.chunking.baseUrl,
    inputChars,
    inputTokens,
    attempt: attempt + 1,
  });

  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.chunking.chatModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Split documentation into semantic chunks. Never cut mid-sentence. Return JSON { chunks: [{ title, text, keywords }] }.",
        },
        {
          role: "user",
          content: `Context path: ${context.path}\nContext kind: ${context.kind}\n\n${markdown}`,
        },
      ],
    }),
  });

  const elapsedMs = Date.now() - started;
  archLog.debug("semantic split: response received", {
    path: context.path,
    status: res.status,
    elapsedMs,
  });

  if (!res.ok) {
    const body = await readHttpErrorBody(res);
    archLog.warn("semantic split: API error", {
      path: context.path,
      status: res.status,
      statusText: res.statusText,
      model: config.chunking.chatModel,
      baseUrl: config.chunking.baseUrl,
      inputChars,
      inputTokens,
      attempt: attempt + 1,
      elapsedMs,
      body,
    });

    if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
      const delayMs = 2 ** attempt * 1000;
      archLog.info("semantic split: retrying after delay", {
        path: context.path,
        status: res.status,
        delayMs,
        nextAttempt: attempt + 2,
      });
      await sleep(delayMs);
      return requestSemanticSplit(config, markdown, context, attempt + 1);
    }

    throw new Error(
      `Semantic split failed: ${res.status} ${res.statusText} (path=${context.path}, model=${config.chunking.chatModel}, inputChars=${inputChars})\n${body}`
    );
  }

  let data: { choices: { message: { content: string } }[] };
  try {
    data = (await res.json()) as { choices: { message: { content: string } }[] };
  } catch (parseErr) {
    const body = await readHttpErrorBody(res);
    archLog.warn("semantic split: invalid JSON response", {
      path: context.path,
      elapsedMs,
      body,
    });
    throw new Error(
      `Semantic split failed: invalid JSON response (path=${context.path})\n${body}`,
      { cause: parseErr }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data.choices[0].message.content);
  } catch (parseErr) {
    archLog.warn("semantic split: model returned non-JSON content", {
      path: context.path,
      contentPreview: data.choices[0]?.message?.content?.slice(0, 500),
    });
    throw new Error(
      `Semantic split failed: model content is not valid JSON (path=${context.path})`,
      { cause: parseErr }
    );
  }

  const chunks = normalizeSemanticChunks(parsed);
  if (chunks.length === 0) {
    archLog.warn("semantic split: empty or invalid chunks, using local fallback", {
      path: context.path,
      parsedKeys:
        parsed && typeof parsed === "object"
          ? Object.keys(parsed as object)
          : [],
      rawContentPreview: data.choices[0]?.message?.content?.slice(0, 500),
    });
    return localSingleChunk(markdown, context);
  }

  archLog.info("semantic split: ok", {
    path: context.path,
    chunkCount: chunks.length,
    elapsedMs,
  });

  return chunks;
}

export async function callSemanticSplit(
  config: ArchConfig,
  markdown: string,
  context: { path: string; kind: string }
): Promise<SemanticSplitChunk[]> {
  if (shouldUseLocalSplit(markdown, config.chunking.maxChunkTokens)) {
    archLog.info("semantic split: using local single chunk (no LLM)", {
      path: context.path,
      inputChars: markdown.length,
      inputTokens: estimateTokens(markdown),
      maxChunkTokens: config.chunking.maxChunkTokens,
    });
    return localSingleChunk(markdown, context);
  }
  return requestSemanticSplit(config, markdown, context);
}

export async function splitOversizedChunks(
  config: ArchConfig,
  chunks: SemanticSplitChunk[],
  maxTokens: number,
  context: { path: string; kind: string }
): Promise<SemanticSplitChunk[]> {
  const result: SemanticSplitChunk[] = [];

  for (const chunk of chunks) {
    const tokens = estimateTokens(chunk.text);
    if (tokens <= maxTokens) {
      result.push(chunk);
      continue;
    }

    archLog.info("semantic split: chunk exceeds max tokens, subdividing", {
      path: context.path,
      title: chunk.title,
      tokens,
      maxTokens,
    });

    const subChunks = await callSemanticSplit(config, chunk.text, context);
    const resized = await splitOversizedChunks(
      config,
      subChunks,
      maxTokens,
      context
    );
    result.push(...resized);
  }

  return result;
}

export async function buildAllChunks(
  config: ArchConfig,
  model: DocumentModel,
  overviewMarkdowns: Map<string, string>
): Promise<ArchChunk[]> {
  const l1 = chunkStructuredEntities(model);
  archLog.info("chunking: L1 structured chunks ready", { count: l1.length });

  const overviewChunks: ArchChunk[] = [];
  const overviewEntries = [...overviewMarkdowns.entries()].filter(([, md]) =>
    md.trim()
  );

  archLog.info("chunking: processing overview documents", {
    count: overviewEntries.length,
    maxChunkTokens: config.chunking.maxChunkTokens,
    chatModel: config.chunking.chatModel,
  });

  for (let i = 0; i < overviewEntries.length; i++) {
    const [pathKey, markdown] = overviewEntries[i]!;
    const context = { path: pathKey, kind: "overview" };

    archLog.info("chunking: overview document", {
      index: i + 1,
      total: overviewEntries.length,
      path: pathKey,
      inputChars: markdown.length,
    });

    const splits = await callSemanticSplit(config, markdown, context);
    const sized = await splitOversizedChunks(
      config,
      splits,
      config.chunking.maxChunkTokens,
      context
    );

    for (const split of sized) {
      overviewChunks.push({
        id: randomUUID(),
        path: pathKey,
        kind: "overview",
        title: split.title,
        text: `[kind:overview][path:${pathKey}]\n${split.text}`,
      });
    }

    archLog.info("chunking: overview document done", {
      path: pathKey,
      chunkCount: sized.length,
    });
  }

  archLog.info("chunking: complete", {
    l1Count: l1.length,
    overviewCount: overviewChunks.length,
    total: l1.length + overviewChunks.length,
  });

  return [...l1, ...overviewChunks];
}
