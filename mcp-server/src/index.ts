#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import { appendMissing, findContract, readDb, upsertContract } from "./db.js";
import { getProjectRoot, resolveTsPath } from "./paths.js";
import { regenerateIndexMd } from "./index-md.js";
import { handleQueryArch, handleSearchArch } from "./arch-query.js";
import { handleRegisterAsset, REGISTER_ASSET_KINDS } from "./register-asset.js";
import { handleAuditArchChanges } from "./audit-changes.js";
import { handleRefreshAsset, REFRESH_ASSET_KINDS } from "./refresh-asset.js";
import { handleRemoveAsset } from "./remove-asset.js";
import { handleSyncArchChanges } from "./sync-changes.js";
import { handleQueryDesign } from "./design-query.js";
import { handleSearchUi } from "./design-search.js";
import { handleReportDesignGap } from "./design-gap.js";

const projectRoot = getProjectRoot();

const server = new McpServer({
  name: "agent-protocol-mcp",
  version: "1.0.0",
});

server.tool(
  "query_contract",
  "Query dependency contract and TS type definition before development",
  { name: z.string().describe("Contract or component name") },
  async ({ name }) => {
    try {
      const db = await readDb(projectRoot);
      const contract = findContract(db, name);
      if (!contract) {
        return {
          content: [
            {
              type: "text" as const,
              text: "❌ Contract not found. You must call report_missing to block this task.",
            },
          ],
          isError: true,
        };
      }

      const absPath = resolveTsPath(projectRoot, contract.tsFilePath);
      let tsContent: string;
      try {
        tsContent = await fs.readFile(absPath, "utf-8");
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: "❌ TS file unreadable. You must call report_missing to block this task.",
            },
          ],
          isError: true,
        };
      }

      const payload = {
        description: contract.description,
        tsFilePath: contract.tsFilePath,
        tsContent,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: String(err) }],
        isError: true,
      };
    }
  }
);

server.tool(
  "register_contract",
  "Register a new contract after feature completion",
  {
    name: z.string(),
    description: z.string(),
    tsFilePath: z.string(),
  },
  async ({ name, description, tsFilePath }) => {
    try {
      const absPath = resolveTsPath(projectRoot, tsFilePath);
      try {
        await fs.access(absPath);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: "❌ TS file not found. Registration aborted.",
            },
          ],
          isError: true,
        };
      }

      const { updated } = await upsertContract(projectRoot, {
        name,
        description,
        tsFilePath,
        registeredAt: new Date().toISOString(),
      });
      await regenerateIndexMd(projectRoot);

      return {
        content: [
          {
            type: "text" as const,
            text: updated
              ? "✅ Contract updated and INDEX.md refreshed."
              : "✅ Contract registered and INDEX.md updated.",
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: String(err) }],
        isError: true,
      };
    }
  }
);

server.tool(
  "query_arch",
  "Browse architecture docs by path",
  {
    path: z
      .string()
      .optional()
      .describe("Arch path (e.g. backend/auth/api), optionally with #anchor"),
  },
  async ({ path: archPath }) => {
    try {
      const result = await handleQueryArch(projectRoot, archPath);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: String(err) }],
        isError: true,
      };
    }
  }
);

server.tool(
  "register_asset",
  "Register an architecture asset (component, util, enum, API, etc.) for semantic search",
  {
    kind: z.enum(REGISTER_ASSET_KINDS),
    name: z.string(),
    module: z.string().describe('Module slug, e.g. "base-common" or "ui"'),
    sourcePath: z.string().describe("Source file path relative to project root"),
    summary: z.string(),
    whenToUse: z.string(),
    howToUse: z.string(),
    exports: z.array(z.string()).optional(),
    related: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  },
  async (input) => {
    try {
      const result = await handleRegisterAsset(projectRoot, input);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: String(err) }],
        isError: true,
      };
    }
  }
);

server.tool(
  "audit_arch_changes",
  "Report architecture asset changes since last scan (modified, new, deleted, unregistered)",
  {
    since: z
      .string()
      .optional()
      .describe('Anchor commit or "last-scan" (default uses last-scan.json commit)'),
    paths: z
      .array(z.string())
      .optional()
      .describe("Limit audit to these relative source paths"),
  },
  async ({ since, paths }) => {
    try {
      const result = await handleAuditArchChanges(projectRoot, {
        since: since ?? "last-scan",
        paths,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `❌ ${String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "refresh_asset",
  "Re-index a single architecture asset from source via AI summarize (use after code changes)",
  {
    sourcePath: z.string().describe("Source file path relative to project root"),
    kind: z.enum(REFRESH_ASSET_KINDS).optional(),
    name: z.string().optional(),
    module: z.string().optional().describe('Module slug, e.g. "base-common"'),
  },
  async (input) => {
    try {
      const result = await handleRefreshAsset(projectRoot, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `❌ ${String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "remove_asset",
  "Remove an architecture asset from markdown, index, and vector store",
  {
    assetId: z.string().optional().describe("Stable asset id, e.g. backend/demo/util/JsonUtils"),
    sourcePath: z
      .string()
      .optional()
      .describe("Source file path (used when assetId omitted)"),
  },
  async (input) => {
    try {
      if (!input.assetId && !input.sourcePath) {
        return {
          content: [
            {
              type: "text" as const,
              text: "❌ Either assetId or sourcePath is required",
            },
          ],
          isError: true,
        };
      }
      const result = await handleRemoveAsset(projectRoot, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `❌ ${String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "sync_arch_changes",
  "Audit architecture changes and optionally batch refresh/remove (same as sync-changes CLI)",
  {
    dryRun: z
      .boolean()
      .optional()
      .describe("If true, only report audit results without writes"),
    since: z.string().optional().describe('Anchor: "last-scan" or git commit'),
    paths: z.array(z.string()).optional().describe("Limit to these source paths"),
  },
  async ({ dryRun, since, paths }) => {
    try {
      const result = await handleSyncArchChanges(projectRoot, {
        dryRun: dryRun ?? false,
        since,
        paths,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `❌ ${String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "query_design",
  "Query project design profile: global tokens/style, page recipe, or semantic component",
  {
    scope: z.literal("global").optional().describe('Use "global" for tokens and style.md'),
    page: z.string().optional().describe("Page recipe slug, e.g. user-settings"),
    component: z.string().optional().describe("Semantic component id, e.g. PrimaryButton"),
  },
  async ({ scope, page, component }) => {
    try {
      const result = await handleQueryDesign(projectRoot, { scope, page, component });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `❌ ${String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "search_ui",
  "Search semantic UI components and page recipes in .ai/design/",
  {
    query: z.string().describe("Natural language or keyword query"),
    limit: z.number().optional().describe("Max results (default 5)"),
    filter: z
      .object({ kind: z.enum(["component", "page"]).optional() })
      .optional()
      .describe("Limit to components or pages"),
  },
  async ({ query, limit, filter }) => {
    try {
      const results = await handleSearchUi(projectRoot, { query, limit, filter });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `❌ ${String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "report_design_gap",
  "Report missing design definition and block UI implementation",
  {
    need: z.string().describe("Missing semantic component or page pattern"),
    reason: z.string(),
    page: z.string().optional().describe("Page slug context"),
  },
  async ({ need, reason, page }) => {
    try {
      const text = await handleReportDesignGap(projectRoot, { need, reason, page });
      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: String(err) }],
        isError: true,
      };
    }
  }
);

server.tool(
  "search_arch",
  "Semantic search architecture",
  {
    query: z.string().describe("Natural language or keyword query"),
    limit: z.number().optional().describe("Max results (default 5)"),
    filter: z
      .object({ kind: z.string().optional() })
      .optional()
      .describe(
        'Optional kind filter: "api", "rpc", "component", "util", "enum", "starter", "pojo", "module"'
      ),
  },
  async ({ query, limit, filter }) => {
    try {
      const results = await handleSearchArch(projectRoot, query, limit, filter);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: String(err) }],
        isError: true,
      };
    }
  }
);

server.tool(
  "report_missing",
  "Report missing dependency and block current task",
  {
    missingName: z.string(),
    reason: z.string(),
  },
  async ({ missingName, reason }) => {
    try {
      await appendMissing(projectRoot, {
        missingName,
        reason,
        reportedAt: new Date().toISOString(),
      });
      await regenerateIndexMd(projectRoot);

      return {
        content: [
          {
            type: "text" as const,
            text: "🚫 TASK BLOCKED. Missing dependency reported to Manager Agent. Stop current work immediately and wait for resolution.",
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: String(err) }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
