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
