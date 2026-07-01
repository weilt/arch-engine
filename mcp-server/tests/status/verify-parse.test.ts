import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  latestVerifyPath,
  parseVerifyReport,
  readLatestVerify,
} from "../../src/status/verify-parse.js";

describe("parseVerifyReport", () => {
  it("parses a PASS report with bold Overall marker", () => {
    const text = [
      "# Verify Report",
      "",
      "**Overall:** PASS",
      "",
      "- contracts: ok",
      "- tests: green",
    ].join("\n");
    expect(parseVerifyReport(text)).toEqual({ result: "PASS" });
  });

  it("parses a FAIL report with non-bold Overall", () => {
    const text = ["# Verify Report", "", "Overall: FAIL", "", "2 failing tests."].join(
      "\n"
    );
    expect(parseVerifyReport(text)).toEqual({ result: "FAIL" });
  });

  it("parses a BLOCKED report", () => {
    const text = "## Summary\n\nOverall: BLOCKED\nblocked by missing contract.";
    expect(parseVerifyReport(text)).toEqual({ result: "BLOCKED" });
  });

  it("returns none when there is no Overall line", () => {
    const text = "# Some Report\n\nNo overall verdict in this body.";
    expect(parseVerifyReport(text)).toEqual({ result: "none" });
  });

  it("tolerates asterisks between the colon and the keyword", () => {
    expect(parseVerifyReport("Overall:**PASS")).toEqual({ result: "PASS" });
    expect(parseVerifyReport("Overall: ** FAIL")).toEqual({ result: "FAIL" });
  });

  it("is case-insensitive on the keyword", () => {
    expect(parseVerifyReport("Overall: pass")).toEqual({ result: "PASS" });
    expect(parseVerifyReport("Overall: Fail")).toEqual({ result: "FAIL" });
    expect(parseVerifyReport("Overall: blocked")).toEqual({ result: "BLOCKED" });
  });

  it("ignores a keyword that is only a substring of another word", () => {
    // "Overall: PASSED" must NOT be read as PASS.
    expect(parseVerifyReport("Overall: PASSED")).toEqual({ result: "none" });
  });
});

describe("readLatestVerify", () => {
  it("returns none with an absolute path when latest.md is missing", async () => {
    const root = path.join(os.tmpdir(), `apt-status-missing-${process.pid}`);
    const result = await readLatestVerify(root);
    expect(result.result).toBe("none");
    expect(result.path).toBe(latestVerifyPath(root));
    expect(path.isAbsolute(result.path)).toBe(true);
    expect(result.path).toContain(".apt");
    // Normalize separators: path.join yields backslashes on Windows.
    expect(result.path.replace(/\\/g, "/").endsWith("verify/latest.md")).toBe(true);
  });
});
