#!/usr/bin/env node
import path from "node:path";
import { setArchLogVerbose } from "./log.js";
import { runStartInit } from "./pipeline.js";

if (process.argv.includes("--verbose") || process.argv.includes("-v")) {
  setArchLogVerbose(true);
}

function isEmbeddingError(message: string): boolean {
  return (
    message.includes("Missing API key") ||
    message.includes("Missing env") ||
    message.includes("Embedding failed") ||
    message.includes("Semantic split failed")
  );
}

function isConfigError(message: string): boolean {
  return message.includes("JSON") || message.includes("config");
}

function resolveProjectRoot(): string {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  return args[0] ? path.resolve(args[0]) : process.cwd();
}

async function main(): Promise<void> {
  const root = resolveProjectRoot();
  const full = process.argv.includes("--full");
  const report = await runStartInit(root, {}, { full });

  if (report.status === "config-created") {
    console.log(
      "✅ Created arch.config.json — add apiKey in arch.config.json or arch.secrets.json (or set OPENAI_API_KEY), then re-run start-init"
    );
    process.exit(0);
  }

  console.log(
    `✅ start-init complete: ${report.apiCount} APIs, ${report.moduleCount} modules, ${report.chunkCount} chunks`
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  if (err instanceof Error && err.cause) {
    console.error("Cause:", err.cause);
  }
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }

  if (isEmbeddingError(message)) {
    process.exit(1);
  }
  if (isConfigError(message)) {
    process.exit(2);
  }
  process.exit(1);
});
