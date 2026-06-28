import type { SpecRisk } from "./types.js";

// High-risk keywords (ASCII English forms only). The Chinese synonyms from
// spec section 6.2 are intentionally omitted to keep this file ASCII-only and
// avoid Windows codepage corruption. Each English keyword already maps one to
// one with the spec's risk category, so risk-category coverage is preserved.
export const HIGH_RISK_KEYWORDS: readonly string[] = [
  "mcp-server",
  "new MCP tool",
  "arch-engine",
  "arch pipeline",
  "breaking API",
  "new public contract",
];

// Short-circuits to "high" on the first matching rule, otherwise "low".
// Rule order (spec section 6.2):
//   1. frontmatter.risk === "high" (manual override)
//   2. body text contains any HIGH_RISK_KEYWORDS entry
//   3. changedFilesEstimate is a number greater than 8
//   4. else low
// Note: a "low" frontmatter risk never short-circuits, so a present keyword
// still wins over an explicit "low" override (keyword beats manual low).
export function classifySpecRisk(spec: {
  frontmatter?: Record<string, unknown>;
  text: string;
  changedFilesEstimate?: number;
}): SpecRisk {
  // Rule 1: explicit manual override to high.
  if (spec.frontmatter?.risk === "high") {
    return "high";
  }

  // Rule 2: any high-risk keyword in the body text.
  const body = spec.text ?? "";
  for (const keyword of HIGH_RISK_KEYWORDS) {
    if (body.includes(keyword)) {
      return "high";
    }
  }

  // Rule 3: large change footprint.
  if (
    typeof spec.changedFilesEstimate === "number" &&
    spec.changedFilesEstimate > 8
  ) {
    return "high";
  }

  return "low";
}
