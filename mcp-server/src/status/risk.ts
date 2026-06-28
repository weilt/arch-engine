import type { SpecRisk } from "./types.js";

// High-risk keywords (English forms AND their Chinese synonyms per spec
// section 6.2). The Chinese synonyms are required because real specs in this
// repo are written in Chinese; without them a spec body like "破坏性 API"
// would be misclassified as low and bypass human review. The shared Chinese
// synonym "新 MCP" (for mcp-server / new MCP tool) and "arch 管线" (for
// arch-engine / arch pipeline) are listed only once to avoid duplicates.
export const HIGH_RISK_KEYWORDS: readonly string[] = [
  "mcp-server",
  "new MCP tool",
  "arch-engine",
  "arch pipeline",
  "breaking API",
  "new public contract",
  "新 MCP",
  "arch 管线",
  "破坏性 API",
  "新对外契约",
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
