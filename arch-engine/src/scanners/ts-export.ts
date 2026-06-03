export type ExportKindHint = "component" | "util" | "enum";

export interface DiscoveredExport {
  name: string;
  kindHint: ExportKindHint;
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}

function isComponentFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return normalized.endsWith(".tsx") || normalized.endsWith(".vue");
}

function hasPropsSignal(content: string): boolean {
  return (
    /\bprops\s*:/i.test(content) ||
    /\bdefineProps\s*[<(]/.test(content) ||
    /\binterface\s+\w+Props\b/.test(content)
  );
}

function classifyExport(
  name: string,
  filePath: string,
  content: string,
  isDefault = false
): ExportKindHint {
  if (name.endsWith("Utils")) return "util";

  if (isComponentFile(filePath)) {
    if (isPascalCase(name)) return "component";
    if (isDefault && hasPropsSignal(content)) return "component";
    if (isDefault && isPascalCase(pathBaseName(filePath))) return "component";
  }

  return "util";
}

function pathBaseName(filePath: string): string {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  return base.replace(/\.(tsx|ts|vue)$/i, "");
}

function pushUnique(target: DiscoveredExport[], item: DiscoveredExport): void {
  if (!target.some((e) => e.name === item.name && e.kindHint === item.kindHint)) {
    target.push(item);
  }
}

export function discoverExports(fileContent: string, filePath: string): DiscoveredExport[] {
  const results: DiscoveredExport[] = [];
  const content = fileContent;

  const enumRe = /export\s+(?:const\s+)?enum\s+(\w+)/g;
  for (const match of content.matchAll(enumRe)) {
    pushUnique(results, { name: match[1]!, kindHint: "enum" });
  }

  const namedPatterns: Array<{ re: RegExp; isDefault?: boolean }> = [
    { re: /export\s+async\s+function\s+(\w+)/g },
    { re: /export\s+function\s+(\w+)/g },
    { re: /export\s+class\s+(\w+)/g },
    { re: /export\s+const\s+(\w+)/g },
    { re: /export\s+default\s+async\s+function\s+(\w+)/g, isDefault: true },
    { re: /export\s+default\s+function\s+(\w+)/g, isDefault: true },
  ];

  for (const { re, isDefault } of namedPatterns) {
    for (const match of content.matchAll(re)) {
      const name = match[1]!;
      const kindHint = classifyExport(name, filePath, content, isDefault);
      pushUnique(results, { name, kindHint });
    }
  }

  if (/export\s+default\s+function\s*(?:\(|<)/.test(content)) {
    const defaultName = pathBaseName(filePath);
    const kindHint = classifyExport(defaultName, filePath, content, true);
    pushUnique(results, { name: defaultName, kindHint });
  }

  if (isComponentFile(filePath) && /defineComponent\s*\(/.test(content)) {
    const name = pathBaseName(filePath);
    pushUnique(results, { name, kindHint: "component" });
  }

  if (
    isComponentFile(filePath) &&
    results.length === 0 &&
    (/<script[\s>]/i.test(content) || content.includes("defineProps"))
  ) {
    pushUnique(results, { name: pathBaseName(filePath), kindHint: "component" });
  }

  return results;
}
