/**
 * Probe embedding + summarize APIs for a project (arch.config + arch.secrets).
 * Usage: node scripts/probe-maas.mjs <projectRoot>
 */
import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error("Usage: node scripts/probe-maas.mjs <projectRoot>");
  process.exit(1);
}

function mergeSecrets(config, secrets) {
  const merged = structuredClone(config);
  if (secrets?.embedding?.apiKey?.trim()) {
    merged.embedding.apiKey = secrets.embedding.apiKey.trim();
  }
  if (secrets?.chunking?.apiKey?.trim()) {
    merged.chunking.apiKey = secrets.chunking.apiKey.trim();
  }
  return merged;
}

function resolveKey(section) {
  const fromFile = section.apiKey?.trim();
  if (fromFile) return fromFile;
  const envName = section.apiKeyEnv?.trim();
  if (envName && process.env[envName]) return process.env[envName];
  throw new Error(`No API key for ${envName ?? "chunking/embedding"}`);
}

const SUMMARIZE_SYSTEM = `你是架构文档助手。只输出合法 JSON：{ "cards": [ ... ] }，每个 card 含 kind,name,summary,whenToUse,howToUse,exports,related,tags。`;

function minimalCandidates(n) {
  return Array.from({ length: n }, (_, i) => ({
    kind: "util",
    name: `ProbeUtil${i}`,
    moduleSlug: "base",
    filePath: `com/example/Probe${i}.java`,
    javadoc: "探测用",
    signatures: [`public static void m${i}()`],
    extra: {},
  }));
}

function buildUserPrompt(candidates) {
  const payload = candidates.map((c) => ({
    kind: c.kind,
    name: c.name,
    moduleSlug: c.moduleSlug,
    filePath: c.filePath,
    javadoc: c.javadoc,
    signatures: c.signatures,
    extra: c.extra,
  }));
  return [
    "Scope: backend",
    "Module: base",
    `Candidates (${candidates.length}):`,
    JSON.stringify(payload, null, 2),
    "",
    "请为每个 candidate 生成 AssetCard 字段。",
  ].join("\n");
}

async function probeEmbedding(config) {
  const key = resolveKey(config.embedding);
  const url = `${config.embedding.baseUrl.replace(/\/$/, "")}/embeddings`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: config.embedding.model,
      input: "arch-engine probe",
    }),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  return {
    name: "embedding",
    ok: res.ok,
    status: res.status,
    ms,
    bodyPreview: text.slice(0, 200),
    dims: res.ok ? JSON.parse(text).data?.[0]?.embedding?.length : undefined,
  };
}

async function probeSummarize(config, batchSize, { jsonMode }) {
  const key = resolveKey(config.chunking);
  const url = `${config.chunking.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const candidates = minimalCandidates(batchSize);
  const userPrompt = buildUserPrompt(candidates);
  const body = {
    model: config.chunking.chatModel,
    temperature: 0.1,
    max_tokens: config.chunking.summarizeMaxTokens ?? 4096,
    messages: [
      { role: "system", content: SUMMARIZE_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let parseOk = false;
  let cards = 0;
  let parseError = "";
  if (res.ok) {
    try {
      const data = JSON.parse(text);
      const content = data.choices?.[0]?.message?.content ?? "";
      let jsonText = content.trim().replace(/<\|[^>]*\|>/g, "");
      const s = jsonText.indexOf("{");
      const e = jsonText.lastIndexOf("}");
      if (s >= 0 && e > s) jsonText = jsonText.slice(s, e + 1);
      const parsed = JSON.parse(jsonText);
      const list = Array.isArray(parsed) ? parsed : parsed.cards;
      cards = Array.isArray(list) ? list.length : 0;
      parseOk = cards === batchSize;
      if (!parseOk) parseError = `card count ${cards} != ${batchSize}`;
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    name: `summarize×${batchSize}${jsonMode ? "+json_mode" : ""}`,
    ok: res.ok && parseOk,
    status: res.status,
    ms,
    promptChars: userPrompt.length,
    parseOk,
    cards,
    parseError: parseError || (res.ok ? "" : text.slice(0, 300)),
    bodyPreview: res.ok ? text.slice(0, 150) : text.slice(0, 300),
  };
}

const archDir = path.join(projectRoot, ".ai", "arch");
const config = mergeSecrets(
  JSON.parse(await fs.readFile(path.join(archDir, "arch.config.json"), "utf-8")),
  JSON.parse(await fs.readFile(path.join(archDir, "arch.secrets.json"), "utf-8"))
);

console.log("probe-maas", {
  projectRoot,
  embeddingModel: config.embedding.model,
  chunkingModel: config.chunking.chatModel,
  chunkingUrl: config.chunking.baseUrl,
});

const tests = [
  () => probeEmbedding(config),
  () => probeSummarize(config, 1, { jsonMode: false }),
  () => probeSummarize(config, 1, { jsonMode: true }),
  () => probeSummarize(config, 4, { jsonMode: false }),
  () => probeSummarize(config, 8, { jsonMode: false }),
];

function heavyCandidates(n, sigsPerCard) {
  const sigs = Array.from(
    { length: sigsPerCard },
    (_, i) =>
      `public static String method${i}(String a, String b, Map<String, Object> ctx)`
  );
  return Array.from({ length: n }, (_, i) => ({
    kind: "util",
    name: `HeavyUtil${i}`,
    moduleSlug: "base",
    filePath: `com/chongqing/base/util/Heavy${i}.java`,
    javadoc: "x".repeat(200),
    signatures: sigs,
    extra: { probe: true },
  }));
}

async function probeHeavySummarize(config, batchSize, sigsPerCard) {
  const key = resolveKey(config.chunking);
  const url = `${config.chunking.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const candidates = heavyCandidates(batchSize, sigsPerCard);
  const userPrompt = buildUserPrompt(candidates);
  const body = {
    model: config.chunking.chatModel,
    temperature: 0.1,
    max_tokens: 4096,
    messages: [
      { role: "system", content: SUMMARIZE_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  };
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  return {
    name: `summarize-heavy×${batchSize}×${sigsPerCard}sigs`,
    ok: res.ok,
    status: res.status,
    ms,
    promptChars: userPrompt.length,
    bodyPreview: text.slice(0, 280),
  };
}

for (const run of tests) {
  try {
    const r = await run();
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
  await new Promise((r) => setTimeout(r, 500));
}

for (const [batch, sigs] of [
  [8, 12],
  [8, 20],
  [4, 12],
]) {
  try {
    const r = await probeHeavySummarize(config, batch, sigs);
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
  await new Promise((r) => setTimeout(r, 800));
}
