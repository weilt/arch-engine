import fs from "node:fs/promises";
import { getAiDir, getDbPath } from "./paths.js";

export interface Contract {
  name: string;
  description: string;
  tsFilePath: string;
  registeredAt: string;
}

export interface MissingRequest {
  missingName: string;
  reason: string;
  reportedAt: string;
}

export interface AptDb {
  contracts: Contract[];
  missingRequests: MissingRequest[];
}

export function emptyDb(): AptDb {
  return { contracts: [], missingRequests: [] };
}

function assertValidDb(data: unknown): AptDb {
  if (!data || typeof data !== "object") {
    throw new Error("❌ Invalid db.json: root must be an object.");
  }
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.contracts) || !Array.isArray(record.missingRequests)) {
    throw new Error(
      "❌ Invalid db.json: contracts and missingRequests must be arrays."
    );
  }
  return {
    contracts: record.contracts as Contract[],
    missingRequests: record.missingRequests as MissingRequest[],
  };
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export async function readDb(projectRoot: string): Promise<AptDb> {
  const dbPath = getDbPath(projectRoot);
  try {
    const raw = stripUtf8Bom(await fs.readFile(dbPath, "utf-8"));
    return assertValidDb(JSON.parse(raw));
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error("❌ .ai/db.json not found. Run agent-init first.");
    }
    throw new Error(`❌ Failed to read db.json: ${String(err)}`);
  }
}

export async function writeDb(projectRoot: string, db: AptDb): Promise<void> {
  const aiDir = getAiDir(projectRoot);
  await fs.mkdir(aiDir, { recursive: true });
  await fs.writeFile(getDbPath(projectRoot), JSON.stringify(db, null, 2), "utf-8");
}

export function findContract(db: AptDb, name: string): Contract | undefined {
  return db.contracts.find((c) => c.name === name);
}

export async function appendContract(
  projectRoot: string,
  contract: Contract
): Promise<void> {
  const db = await readDb(projectRoot);
  if (findContract(db, contract.name)) {
    throw new Error(
      `❌ Contract '${contract.name}' already exists. Registration aborted.`
    );
  }
  db.contracts.push(contract);
  await writeDb(projectRoot, db);
}

/** Insert or update a contract by name. Returns { updated: true } when an existing entry was replaced. */
export async function upsertContract(
  projectRoot: string,
  contract: Contract
): Promise<{ updated: boolean }> {
  const db = await readDb(projectRoot);
  const idx = db.contracts.findIndex((c) => c.name === contract.name);
  if (idx >= 0) {
    db.contracts[idx] = contract;
    await writeDb(projectRoot, db);
    return { updated: true };
  }
  db.contracts.push(contract);
  await writeDb(projectRoot, db);
  return { updated: false };
}

export async function appendMissing(
  projectRoot: string,
  req: MissingRequest
): Promise<void> {
  const db = await readDb(projectRoot);
  db.missingRequests.push(req);
  await writeDb(projectRoot, db);
}
