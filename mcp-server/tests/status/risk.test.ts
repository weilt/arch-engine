import { describe, expect, it } from "vitest";
import { classifySpecRisk, HIGH_RISK_KEYWORDS } from "../../src/status/risk.js";

describe("HIGH_RISK_KEYWORDS", () => {
  it("exposes the expected ASCII keyword list", () => {
    expect(Array.isArray(HIGH_RISK_KEYWORDS)).toBe(true);
    expect(HIGH_RISK_KEYWORDS).toContain("mcp-server");
    expect(HIGH_RISK_KEYWORDS).toContain("breaking API");
    expect(HIGH_RISK_KEYWORDS).toContain("new public contract");
  });
});

describe("classifySpecRisk", () => {
  it("defaults to low when no trigger is present", () => {
    expect(classifySpecRisk({ text: "a normal feature with no risk signals" })).toBe(
      "low"
    );
  });

  it("rule 1: frontmatter risk high forces high", () => {
    expect(
      classifySpecRisk({ frontmatter: { risk: "high" }, text: "nothing special" })
    ).toBe("high");
  });

  it.each(HIGH_RISK_KEYWORDS)("rule 2: keyword %s triggers high", (keyword) => {
    expect(classifySpecRisk({ text: `some text ${keyword} more text` })).toBe("high");
  });

  it("rule 3: changedFilesEstimate greater than 8 triggers high", () => {
    expect(classifySpecRisk({ text: "big change", changedFilesEstimate: 12 })).toBe(
      "high"
    );
  });

  it("boundary: exactly 8 files stays low", () => {
    expect(classifySpecRisk({ text: "eight files", changedFilesEstimate: 8 })).toBe(
      "low"
    );
  });

  it("boundary: exactly 9 files is high", () => {
    expect(classifySpecRisk({ text: "nine files", changedFilesEstimate: 9 })).toBe(
      "high"
    );
  });

  it("frontmatter risk low does NOT suppress a keyword (keyword wins)", () => {
    expect(
      classifySpecRisk({
        frontmatter: { risk: "low" },
        text: "this touches mcp-server internals",
      })
    ).toBe("high");
  });

  it("frontmatter risk low with no other triggers stays low", () => {
    expect(
      classifySpecRisk({ frontmatter: { risk: "low" }, text: "small safe change" })
    ).toBe("low");
  });

  it("ignores unknown frontmatter risk values", () => {
    expect(
      classifySpecRisk({ frontmatter: { risk: "medium" }, text: "normal text" })
    ).toBe("low");
  });
});
