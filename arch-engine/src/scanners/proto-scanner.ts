import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

export interface ProtoRpcMethod {
  name: string;
  requestType: string;
  responseType: string;
}

export interface ProtoService {
  serviceName: string;
  rpcs: ProtoRpcMethod[];
  filePath: string;
}

// A `service <Name> { ... }` block. Proto service bodies contain no nested
// braces, so a non-greedy body capture stops at the first closing brace.
const SERVICE_RE = /service\s+(\w+)\s*\{([^}]*)\}/g;

// An `rpc <Method>(<Req>) returns (<Resp>);` declaration. The optional
// `stream` keyword (client-streaming / server-streaming / bidi) is matched
// but not captured, so requestType/responseType always hold the bare type.
const RPC_RE =
  /rpc\s+(\w+)\s*\(\s*(?:stream\s+)?(\w+)\s*\)\s*returns\s*\(\s*(?:stream\s+)?(\w+)\s*\)/g;

/**
 * Parse proto service definitions from raw `.proto` source text. Pure and
 * file-system free so it can be unit-tested in isolation. `filePath` is the
 * repo-relative path attached to every service emitted from this content.
 */
export function parseProtoContent(
  content: string,
  filePath: string
): ProtoService[] {
  const services: ProtoService[] = [];

  for (const svcMatch of content.matchAll(SERVICE_RE)) {
    const serviceName = svcMatch[1];
    const body = svcMatch[2];

    const rpcs: ProtoRpcMethod[] = [];
    for (const rpcMatch of body.matchAll(RPC_RE)) {
      rpcs.push({
        name: rpcMatch[1],
        requestType: rpcMatch[2],
        responseType: rpcMatch[3],
      });
    }

    services.push({ serviceName, rpcs, filePath });
  }

  return services;
}

/**
 * Recursively scan `repoRoot` for `*.proto` files and extract all gRPC
 * service definitions. Each `filePath` is reported repo-relative with POSIX
 * separators, matching the convention used by the other scanners.
 */
export async function scanProtoServices(
  repoRoot: string
): Promise<ProtoService[]> {
  const protoFiles = await fg.glob("**/*.proto", {
    cwd: repoRoot,
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/target/**"],
  });

  const services: ProtoService[] = [];
  for (const absFile of protoFiles) {
    let content: string;
    try {
      content = await fs.readFile(absFile, "utf-8");
    } catch {
      // skip unreadable files, never degrade the rest of the scan
      continue;
    }
    const filePath = path
      .relative(repoRoot, absFile)
      .replace(/\\/g, "/");
    services.push(...parseProtoContent(content, filePath));
  }

  return services;
}
