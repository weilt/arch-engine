/**
 * Quick API health check — embedding + summarize (no json_mode) only.
 * Usage: node scripts/probe-maas-quick.mjs <projectRoot>
 */
import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error("Usage: node scripts/probe-maas-quick.mjs <projectRoot>");
  process.exit(1);
}

function mergeSecrets(config, secrets) {
  const merged = structuredClone(config);
  if (secrets?.embedding?.apiKey?.trim()) merged.embedding.apiKey = secrets.embedding.apiKey.trim();
  if (secrets?.chunking?.apiKey?.trim()) merged.chunking.apiKey = secrets.chunking.apiKey.trim();
  return merged;
}

function resolveKey(section) {
  const fromFile = section.apiKey?.trim();
  if (fromFile) return fromFile;
  const envName = section.apiKeyEnv?.trim();
  if (envName && process.env[envName]) return process.env[envName];
  throw new Error(`No API key (${envName ?? "?"})`);
}

const archDir = path.join(projectRoot, ".ai", "arch");
const config = mergeSecrets(
  JSON.parse(await fs.readFile(path.join(archDir, "arch.config.json"), "utf-8")),
  JSON.parse(await fs.readFile(path.join(archDir, "arch.secrets.json"), "utf-8"))
);

const results = [];

async function run(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, ...detail });
  } catch (e) {
    results.push({
      name,
      ok: false,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

await run("embedding", async () => {
  const key = resolveKey(config.embedding);
  const url = `${config.embedding.baseUrl.replace(/\/$/, "")}/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: config.embedding.model, input: "probe" }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
  const dims = JSON.parse(text).data?.[0]?.embedding?.length;
  return { status: res.status, dims };
});

await run("summarize-no-json-mode", async () => {
  const key = resolveKey(config.chunking);
  const url = `${config.chunking.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: config.chunking.chatModel,
    temperature: 0.1,
    max_tokens: 512,
    messages: [
      {
        role: "system",
        content:
          '只输出 JSON: {"cards":[{"kind":"util","name":"P","summary":"s","whenToUse":"w","howToUse":"h","exports":[],"related":[],"tags":[]}]}',
      },
      { role: "user", content: "1 candidate ProbeUtil" },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const content = JSON.parse(text).choices?.[0]?.message?.content ?? "";
  let j = content.replace(/<\|[^>]*\|>/g, "");
  const s = j.indexOf("{");
  const e = j.lastIndexOf("}");
  if (s >= 0 && e > s) j = j.slice(s, e + 1);
  JSON.parse(j);
  return { status: res.status };
});

await run("summarize-json-mode-must-not-parse", async () => {
  const key = resolveKey(config.chunking);
  const url = `${config.chunking.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: config.chunking.chatModel,
    temperature: 0.1,
    max_tokens: 512,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "output json cards" },
      { role: "user", content: "1 candidate" },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return { status: res.status, note: "HTTP error also proves json_mode unsafe" };
  }
  const content = JSON.parse(text).choices?.[0]?.message?.content ?? "";
  try {
    JSON.parse(content.trim());
    throw new Error("json_object returned parseable JSON — astron-code-latest may have changed");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/unexpected token|not valid json|after json|property value/i.test(msg)) {
      return { note: "json_mode output is broken as expected", parseError: msg.slice(0, 80) };
    }
    throw e;
  }
});

const deployed = await fs.stat("C:/Users/ASUS/.apt/arch-engine/dist/summarize/batch.js").catch(
  () => null
);

const embeddingOk = results.find((r) => r.name === "embedding")?.ok === true;
const summarizeOk = results.find((r) => r.name === "summarize-no-json-mode")?.ok === true;
const jsonModeProbe = results.find((r) => r.name === "summarize-json-mode-must-not-parse");
const jsonModeUsuallyBroken = jsonModeProbe?.ok === true;
const warnings = [];
if (!jsonModeUsuallyBroken) {
  warnings.push(
    "json_object probe was flaky (sometimes parses); engine still forces jsonMode=false for code models"
  );
}

const summary = {
  time: new Date().toISOString(),
  projectRoot,
  models: {
    embedding: config.embedding.model,
    chunking: config.chunking.chatModel,
  },
  chunkingConfig: {
    summarizeBatchSize: config.chunking.summarizeBatchSize ?? "(default 4 for code model)",
    summarizeJsonMode: config.chunking.summarizeJsonMode ?? "(auto false for code model)",
    summarizeMaxRetries: config.chunking.summarizeMaxRetries ?? 3,
  },
  deployedBatchJsMtime: deployed?.mtime?.toISOString() ?? "missing",
  checks: results,
  warnings,
  verdict: embeddingOk && summarizeOk ? "READY_FOR_START_INIT" : "FIX_BEFORE_SCAN",
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.verdict === "READY_FOR_START_INIT" ? 0 : 1);
