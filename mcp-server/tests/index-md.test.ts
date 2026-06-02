import { describe, it, expect } from "vitest";
import { renderIndexMd } from "../src/index-md.js";
import type { AptDb } from "../src/db.js";

describe("index-md", () => {
  it("renders contracts and missing tables", () => {
    const db: AptDb = {
      contracts: [
        {
          name: "Foo",
          description: "desc",
          tsFilePath: "src/foo.ts",
          registeredAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      missingRequests: [
        {
          missingName: "Bar",
          reason: "need it",
          reportedAt: "2026-06-01T01:00:00.000Z",
        },
      ],
    };
    const md = renderIndexMd(db);
    expect(md).toContain("# Agent Protocol Contract Index");
    expect(md).toContain("| Foo |");
    expect(md).toContain("| Bar |");
  });

  it("renders _None._ when empty", () => {
    const md = renderIndexMd({ contracts: [], missingRequests: [] });
    expect(md).toContain("_None._");
  });
});
