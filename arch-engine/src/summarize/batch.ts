import { resolveApiKey } from "../config.js";
import { buildAssetId } from "../asset/id.js";
import { archLog, readHttpErrorBody } from "../log.js";
import type { ArchConfig, AssetCard, AssetKind, RawCandidate } from "../types.js";
import { buildFallbackCard } from "./fallback-card.js";
import {
  DEFAULT_MAX_SIGNATURES_PER_CANDIDATE,
  SUMMARIZE_SYSTEM_PROMPT,
  buildSummarizeUserPrompt,
} from "./prompt.js";

export type SummarizeFn = (
  config: ArchConfig,
  candidates: RawCandidate[],
  scope: "backend" | "frontend",
  moduleSlug: string
) => Promise<AssetCard[]>;

export interface SummarizeCandidatesOptions {
  batchSize?: number;
  summarizeFn?: SummarizeFn;
  scope?: "backend" | "frontend";
}

/** Smaller than early v2 default (20) — aligns with v1-style lighter MaaS payloads. */
export const DEFAULT_SUMMARIZE_BATCH_SIZE = 8;
/** Default batch for code-oriented MaaS models (astron-code-latest, etc.). */
export const DEFAULT_CODE_MODEL_SUMMARIZE_BATCH_SIZE = 4;
const DEFAULT_SUMMARIZE_MAX_RETRIES = 3;
const DEFAULT_SUMMARIZE_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_SUMMARIZE_MAX_TOKENS = 4096;
const DEFAULT_SUMMARIZE_BATCH_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveSummarizeBatchSize(config: ArchConfig): number {
  const n = config.chunking.summarizeBatchSize;
  if (n && n > 0) return n;
  if (/code/i.test(config.chunking.chatModel)) {
    return DEFAULT_CODE_MODEL_SUMMARIZE_BATCH_SIZE;
  }
  return DEFAULT_SUMMARIZE_BATCH_SIZE;
}

function resolveMaxSignaturesPerCandidate(config: ArchConfig): number {
  const n = config.chunking.maxSignaturesPerCandidate;
  return n && n > 0 ? n : DEFAULT_MAX_SIGNATURES_PER_CANDIDATE;
}

function isRetryableSummarizeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  if (/\((429|5\d{2})\)/.test(msg)) return true;
  if (/rate limit|timeout|unexpected eof|engineinternalerror|one_api_error/i.test(msg)) {
    return true;
  }
  if (
    /not valid json|unexpected token|json\.parse|missing cards array|card count mismatch|expected ','|after property value/i.test(
      msg
    )
  ) {
    return true;
  }
  return false;
}

/** Errors where retrying the same large batch often fails again — split instead.
 *  Only split for payload-size errors (500 EOF / EngineInternalError), NOT for
 *  rate limits (429) where splitting makes congestion worse.
 */
function isSplittableBatchError(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : error).toLowerCase();
  return /unexpected eof|engineinternalerror/.test(msg);
}

/** Strip code-model special tokens and isolate JSON object from noisy LLM output. */
export function sanitizeLlmJsonText(raw: string): string {
  let text = raw.trim();
  text = text.replace(/<\|[^>]*\|>/g, "");
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    text = text.slice(start, end + 1);
  }
  return text.trim();
}

export function useJsonResponseFormat(config: ArchConfig): boolean {
  const mode = config.chunking.summarizeJsonMode;
  const isCodeModel = /code/i.test(config.chunking.chatModel);
  if (mode === true) {
    if (isCodeModel) {
      archLog.warn(
        "summarizeJsonMode is true but chatModel looks like a code model; forcing json_mode off",
        { chatModel: config.chunking.chatModel }
      );
    }
    return !isCodeModel;
  }
  if (mode === false) return false;
  return !isCodeModel;
}

interface PartialAssetCard {
  kind?: AssetKind;
  name?: string;
  summary?: string;
  whenToUse?: string;
  howToUse?: string;
  exports?: string[];
  related?: string[];
  tags?: string[];
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeCardFields(raw: PartialAssetCard): {
  summary: string;
  whenToUse: string;
  howToUse: string;
  exports: string[];
  related: string[];
  tags: string[];
} {
  return {
    summary: String(raw.summary ?? "").trim() || "暂无",
    whenToUse: String(raw.whenToUse ?? "").trim() || "暂无",
    howToUse: String(raw.howToUse ?? "").trim() || "暂无",
    exports: normalizeStringArray(raw.exports),
    related: normalizeStringArray(raw.related),
    tags: normalizeStringArray(raw.tags),
  };
}

export function mergeCandidateWithCard(
  candidate: RawCandidate,
  raw: PartialAssetCard,
  scope: "backend" | "frontend"
): AssetCard {
  const fields = normalizeCardFields(raw);
  return {
    id: buildAssetId(scope, candidate.moduleSlug, candidate.kind, candidate.name),
    kind: (raw.kind as AssetKind | undefined) ?? candidate.kind,
    name: String(raw.name ?? candidate.name),
    module: candidate.moduleSlug,
    path: candidate.filePath,
    ...fields,
    exports:
      fields.exports.length > 0 ? fields.exports : candidate.signatures.slice(0, 20),
    source: "scan",
    updatedAt: new Date().toISOString(),
  };
}

export function parseSummarizeResponse(text: string): PartialAssetCard[] {
  const jsonText = sanitizeLlmJsonText(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Summarize response is not valid JSON: ${msg}`);
  }
  if (Array.isArray(parsed)) return parsed as PartialAssetCard[];
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.cards)) return record.cards as PartialAssetCard[];
  }
  throw new Error("Summarize response missing cards array");
}

export async function defaultSummarizeFn(
  config: ArchConfig,
  candidates: RawCandidate[],
  scope: "backend" | "frontend",
  moduleSlug: string
): Promise<AssetCard[]> {
  const apiKey = resolveApiKey(config, "chunking");
  const url = `${config.chunking.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const maxSignatures = resolveMaxSignaturesPerCandidate(config);
  const userPrompt = buildSummarizeUserPrompt(
    scope,
    moduleSlug,
    candidates,
    maxSignatures
  );
  const maxTokens = config.chunking.summarizeMaxTokens ?? DEFAULT_SUMMARIZE_MAX_TOKENS;
  const jsonMode = useJsonResponseFormat(config);
  archLog.info("summarize request", {
    moduleSlug,
    candidates: candidates.length,
    promptChars: userPrompt.length,
    jsonMode,
    model: config.chunking.chatModel,
  });

  const body: Record<string, unknown> = {
    model: config.chunking.chatModel,
    temperature: 0.1,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const body = await readHttpErrorBody(response);
    throw new Error(`Summarize failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Summarize response missing message content");

  const partials = parseSummarizeResponse(content);
  if (partials.length !== candidates.length) {
    throw new Error(
      `Summarize card count mismatch: expected ${candidates.length}, got ${partials.length}`
    );
  }

  return candidates.map((candidate, index) =>
    mergeCandidateWithCard(candidate, partials[index]!, scope)
  );
}

async function summarizeBatchWithRetry(
  config: ArchConfig,
  batch: RawCandidate[],
  scope: "backend" | "frontend",
  moduleSlug: string,
  summarizeFn: SummarizeFn,
  attempt = 0
): Promise<AssetCard[]> {
  const maxRetries = config.chunking.summarizeMaxRetries ?? DEFAULT_SUMMARIZE_MAX_RETRIES;
  const baseDelayMs =
    config.chunking.summarizeRetryBaseDelayMs ?? DEFAULT_SUMMARIZE_RETRY_BASE_DELAY_MS;

  try {
    return await summarizeFn(config, batch, scope, moduleSlug);
  } catch (error) {
    if (isSplittableBatchError(error) && batch.length > 1) {
      const mid = Math.ceil(batch.length / 2);
      archLog.warn("summarize batch split after failure", {
        moduleSlug,
        batchSize: batch.length,
        left: mid,
        right: batch.length - mid,
        error: error instanceof Error ? error.message : String(error),
      });
      const left = await summarizeBatchWithRetry(
        config,
        batch.slice(0, mid),
        scope,
        moduleSlug,
        summarizeFn,
        attempt
      );
      const right = await summarizeBatchWithRetry(
        config,
        batch.slice(mid),
        scope,
        moduleSlug,
        summarizeFn,
        attempt
      );
      return [...left, ...right];
    }

    if (isRetryableSummarizeError(error) && attempt < maxRetries) {
      const delayMs = baseDelayMs * 2 ** attempt;
      archLog.warn("summarize batch failed, retrying", {
        moduleSlug,
        batchSize: batch.length,
        attempt: attempt + 1,
        maxRetries,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
      return summarizeBatchWithRetry(
        config,
        batch,
        scope,
        moduleSlug,
        summarizeFn,
        attempt + 1
      );
    }

    archLog.warn("summarize batch failed after retries, using fallback cards", {
      moduleSlug,
      batchSize: batch.length,
      attempts: attempt + 1,
      error: error instanceof Error ? error.message : String(error),
    });
    return batch.map((candidate) => buildFallbackCard(candidate, scope));
  }
}

export async function summarizeCandidates(
  config: ArchConfig,
  candidates: RawCandidate[],
  moduleSlug: string,
  options: SummarizeCandidatesOptions = {}
): Promise<AssetCard[]> {
  if (candidates.length === 0) return [];

  const batchSize = options.batchSize ?? resolveSummarizeBatchSize(config);
  const scope = options.scope ?? "backend";
  const summarizeFn = options.summarizeFn ?? defaultSummarizeFn;
  const batchDelayMs =
    config.chunking.summarizeBatchDelayMs ?? DEFAULT_SUMMARIZE_BATCH_DELAY_MS;

  const cards: AssetCard[] = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    if (i > 0 && batchDelayMs > 0) {
      await sleep(batchDelayMs);
    }
    const batch = candidates.slice(i, i + batchSize);
    const batchCards = await summarizeBatchWithRetry(
      config,
      batch,
      scope,
      moduleSlug,
      summarizeFn
    );
    cards.push(...batchCards);
  }

  return cards;
}
