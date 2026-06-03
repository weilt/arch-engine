import fs from "node:fs/promises";
import path from "node:path";
import { getArchDir } from "../paths.js";
import type { AssetCard, AssetKind } from "../types.js";

const BACKEND_KIND_FILES: Partial<Record<AssetKind, string>> = {
  util: "utils.md",
  enum: "enums.md",
  pojo: "pojo.md",
  rpc: "rpc.md",
  starter: "starter.md",
  api: "api.md",
};

const FRONTEND_KIND_FILES: Partial<Record<AssetKind, string>> = {
  component: "components.md",
  util: "utils.md",
  enum: "enums.md",
  starter: "starter.md",
};

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function slugifyAnchor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function renderAssetCard(card: AssetCard): string {
  const exportsValue =
    card.exports.length > 0 ? card.exports.join(", ") : "暂无";
  const relatedValue =
    card.related.length > 0 ? card.related.join(", ") : "暂无";
  const tagsValue = card.tags.length > 0 ? card.tags.join(", ") : "暂无";

  const rows = [
    ["Summary", card.summary],
    ["When to use", card.whenToUse],
    ["How to use", card.howToUse],
    ["Exports", exportsValue],
    ["Related", relatedValue],
    ["Tags", tagsValue],
    ["Source", card.source],
    ["Path", card.path],
    ["Updated", card.updatedAt],
  ];

  const table = [
    "| Field | Value |",
    "|-------|-------|",
    ...rows.map(([field, value]) => `| ${field} | ${escapeCell(value)} |`),
  ].join("\n");

  return `## ${card.name}\n\n${table}\n`;
}

function renderKindFile(kind: AssetKind, cards: AssetCard[]): string {
  const title =
    kind === "enum"
      ? "Enums"
      : kind === "util"
        ? "Utils"
        : kind.charAt(0).toUpperCase() + kind.slice(1);
  const lines = [`# ${title}`, ""];
  if (cards.length === 0) {
    lines.push(`_No ${title.toLowerCase()} discovered._`);
    lines.push("");
    return lines.join("\n");
  }
  for (const card of cards) {
    lines.push(renderAssetCard(card));
  }
  return lines.join("\n").trimEnd() + "\n";
}

async function writeFileEnsuringDir(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

export async function writeModuleAssetDocs(
  projectRoot: string,
  moduleSlug: string,
  cards: AssetCard[],
  scope: "backend" | "frontend" = "backend"
): Promise<void> {
  const modDir = path.join(getArchDir(projectRoot), scope, moduleSlug);
  const kindFiles = scope === "frontend" ? FRONTEND_KIND_FILES : BACKEND_KIND_FILES;
  const byKind = new Map<AssetKind, AssetCard[]>();

  for (const card of cards) {
    const list = byKind.get(card.kind) ?? [];
    list.push(card);
    byKind.set(card.kind, list);
  }

  for (const [kind, kindCards] of byKind) {
    const fileName = kindFiles[kind];
    if (!fileName) continue;
    await writeFileEnsuringDir(
      path.join(modDir, fileName),
      renderKindFile(kind, kindCards)
    );
  }
}

export function groupAssetCardsByModule(
  cards: AssetCard[]
): Record<string, AssetCard[]> {
  const grouped: Record<string, AssetCard[]> = {};
  for (const card of cards) {
    const list = grouped[card.module] ?? [];
    list.push(card);
    grouped[card.module] = list;
  }
  return grouped;
}

export function getAssetDocRelativePath(
  scope: "backend" | "frontend",
  moduleSlug: string,
  kind: AssetKind
): string | undefined {
  const kindFiles = scope === "frontend" ? FRONTEND_KIND_FILES : BACKEND_KIND_FILES;
  const fileName = kindFiles[kind];
  if (!fileName) return undefined;
  return `${scope}/${moduleSlug}/${fileName}`;
}

/** Replace or append a single asset section in an existing kind markdown file. */
export function upsertAssetSectionInMarkdown(existingMd: string, card: AssetCard): string {
  const section = renderAssetCard(card).trimEnd();
  const header = `## ${card.name}`;
  const lines = existingMd.split("\n");
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === header) {
      start = i;
      continue;
    }
    if (start !== -1 && (/^## /.test(line) || /^# /.test(line))) {
      end = i;
      break;
    }
  }

  if (start !== -1) {
    const before = lines.slice(0, start).join("\n");
    const after = lines.slice(end).join("\n");
    const parts = [before.trimEnd(), section, after.trimStart()].filter((p) => p.length > 0);
    return `${parts.join("\n\n")}\n`;
  }

  const trimmed = existingMd.trimEnd();
  return trimmed.length > 0 ? `${trimmed}\n\n${section}\n` : `${section}\n`;
}

export async function upsertAssetCardInModuleDoc(
  projectRoot: string,
  card: AssetCard,
  scope: "backend" | "frontend"
): Promise<string> {
  const docRel = getAssetDocRelativePath(scope, card.module, card.kind);
  if (!docRel) {
    throw new Error(`Unsupported asset kind for ${scope}: ${card.kind}`);
  }
  const filePath = path.join(getArchDir(projectRoot), docRel);
  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf-8");
  } catch {
    existing = renderKindFile(card.kind, []);
  }
  const updated = upsertAssetSectionInMarkdown(existing, card);
  await writeFileEnsuringDir(filePath, updated);
  return docRel.replace(/\.md$/, "");
}
