/**
 * Lightweight TS/TSX source analysis (regex-based, no AST) for arch scanning.
 */

export interface ExtractedEnum {
  name: string;
  description: string;
  members: string[];
}

export interface ExtractedSourceDoc {
  description: string;
  exports: string[];
  enums: ExtractedEnum[];
}

function parseJSDocBody(body: string): string {
  return body
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("@"))
    .join(" ")
    .trim();
}

function jsDocImmediatelyBefore(content: string, exportIndex: number): string {
  const before = content.slice(0, exportIndex);
  const match = before.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
  return match ? parseJSDocBody(match[1]) : "";
}

function parseEnumMembers(body: string): string[] {
  const members: string[] = [];
  for (const part of body.split(",")) {
    const trimmed = part.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const name = trimmed.split("=")[0]?.trim().split(/\s+/)[0];
    if (name) members.push(name);
  }
  return members;
}

function simplifyExportLine(kind: string, name: string, rest: string): string {
  const signature = rest.split("{")[0]?.split(";")[0]?.trim() ?? "";
  if (kind === "function" || kind === "async function") {
    return `export function ${name}${signature}`;
  }
  if (kind === "class") {
    return `export class ${name}${signature}`;
  }
  if (kind === "type" || kind === "interface") {
    return `export ${kind} ${name}${signature}`;
  }
  return `export const ${name}`;
}

export function extractFromSource(content: string, fileBaseName: string): ExtractedSourceDoc {
  const exports: string[] = [];
  const enums: ExtractedEnum[] = [];
  let primaryDescription = "";

  const enumRe =
    /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+(?:const\s+)?enum\s+(\w+)\s*\{([^}]*)\}/g;
  for (const match of content.matchAll(enumRe)) {
    const description = match[1] ? parseJSDocBody(match[1]) : "";
    const name = match[2]!;
    const members = parseEnumMembers(match[3] ?? "");
    enums.push({ name, description, members });
  }

  const exportPatterns: Array<{
    re: RegExp;
    kind: string;
  }> = [
    {
      re: /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+async\s+function\s+(\w+)\s*(\([^)]*\)[^{;]*)/g,
      kind: "async function",
    },
    {
      re: /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+function\s+(\w+)\s*(\([^)]*\)[^{;]*)/g,
      kind: "function",
    },
    {
      re: /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+class\s+(\w+)\s*([^{;]*)/g,
      kind: "class",
    },
    {
      re: /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+(?:type|interface)\s+(\w+)\s*([^{;]*)/g,
      kind: "type",
    },
    {
      re: /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+const\s+(\w+)\s*([^=;\n]+)?/g,
      kind: "const",
    },
  ];

  for (const { re, kind } of exportPatterns) {
    for (const match of content.matchAll(re)) {
      const inlineDoc = match[1] ? parseJSDocBody(match[1]) : "";
      const name = match[2]!;
      const rest = match[3] ?? "";
      const line = simplifyExportLine(kind, name, rest);
      if (!exports.includes(line)) exports.push(line);

      if (!primaryDescription && name === fileBaseName && inlineDoc) {
        primaryDescription = inlineDoc;
      }
    }
  }

  if (!primaryDescription) {
    const fileDoc = content.match(/^\s*\/\*\*([\s\S]*?)\*\//);
    if (fileDoc) primaryDescription = parseJSDocBody(fileDoc[1]);
  }

  if (!primaryDescription && exports.length > 0) {
    const firstExport = content.match(
      /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:async\s+)?(?:function|class|const|type|interface)\s+\w+/
    );
    if (firstExport) primaryDescription = parseJSDocBody(firstExport[1]);
  }

  return {
    description: primaryDescription,
    exports: exports.slice(0, 20),
    enums,
  };
}

export function extractVueScript(content: string): string {
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  return scriptMatch?.[1] ?? "";
}
