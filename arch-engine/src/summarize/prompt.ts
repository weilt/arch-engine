import type { RawCandidate } from "../types.js";

export const SUMMARIZE_SYSTEM_PROMPT = `你是架构文档助手。根据代码扫描候选生成 AssetCard JSON。

要求：
1. 只输出合法 JSON，不要 markdown 代码块或解释文字
2. 顶层结构：{ "cards": [ ... ] }
3. 每个 card 必须包含全部字段：kind, name, summary, whenToUse, howToUse, exports, related, tags
4. summary / whenToUse / howToUse 使用简体中文；缺信息时填「暂无」，不要省略键
5. exports / related / tags 为字符串数组，无内容时用 []
6. cards 顺序与输入 candidates 一致，数量必须相同
7. 不要输出 id、module、path、source、updatedAt（由系统填充）`;

export const DEFAULT_MAX_SIGNATURES_PER_CANDIDATE = 12;

export function buildSummarizeUserPrompt(
  scope: "backend" | "frontend",
  moduleSlug: string,
  candidates: RawCandidate[],
  maxSignaturesPerCandidate = DEFAULT_MAX_SIGNATURES_PER_CANDIDATE
): string {
  const payload = candidates.map((c) => {
    const total = c.signatures.length;
    const signatures =
      total > maxSignaturesPerCandidate
        ? c.signatures.slice(0, maxSignaturesPerCandidate)
        : c.signatures;
    const entry: Record<string, unknown> = {
      kind: c.kind,
      name: c.name,
      moduleSlug: c.moduleSlug,
      filePath: c.filePath,
      javadoc: c.javadoc || "暂无",
      signatures,
      extra: c.extra ?? {},
    };
    if (total > signatures.length) {
      entry.signatureNote = `仅展示前 ${signatures.length} 条签名，共 ${total} 条`;
    }
    return entry;
  });

  return [
    `Scope: ${scope}`,
    `Module: ${moduleSlug}`,
    `Candidates (${candidates.length}):`,
    JSON.stringify(payload, null, 2),
    "",
    "请为每个 candidate 生成 AssetCard 字段（kind, name, summary, whenToUse, howToUse, exports, related, tags）。",
  ].join("\n");
}
