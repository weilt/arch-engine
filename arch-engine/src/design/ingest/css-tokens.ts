import fs from "node:fs/promises";
import path from "node:path";

const TOKEN_FILE_RULES: { file: string; test: (name: string) => boolean }[] = [
  { file: "colors.json", test: (n) => /^color/i.test(n) || /^(bg|foreground|border)/i.test(n) },
  {
    file: "typography.json",
    test: (n) => /^font/i.test(n) || /line-height|letter-spacing/i.test(n),
  },
  {
    file: "spacing.json",
    test: (n) => /spacing|gap|padding|margin|size/i.test(n),
  },
  {
    file: "radii.json",
    test: (n) => /radius|shadow|elevation/i.test(n),
  },
];

export async function readCssText(cssPath: string): Promise<string> {
  let text = await fs.readFile(cssPath, "utf-8");
  const importRe = /@import\s+["']([^"']+)["']\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(text)) !== null) {
    const imported = path.resolve(path.dirname(cssPath), match[1]!);
    try {
      text += "\n" + (await fs.readFile(imported, "utf-8"));
    } catch {
      // skip missing imports
    }
  }
  return text;
}

export function extractCssCustomProperties(css: string): Record<string, string> {
  const props: Record<string, string> = {};
  const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    props[m[1]!] = m[2]!.trim();
  }
  return props;
}

export function bucketTokens(props: Record<string, string>): Record<string, Record<string, string>> {
  const buckets: Record<string, Record<string, string>> = {
    colors: {},
    typography: {},
    spacing: {},
    radii: {},
    other: {},
  };

  for (const [name, value] of Object.entries(props)) {
    const rule = TOKEN_FILE_RULES.find((r) => r.test(name));
    const bucket = rule?.file.replace(".json", "") ?? "other";
    buckets[bucket]![name] = value;
  }

  return buckets;
}

export async function tokensFromStylesheet(stylesPath: string): Promise<Record<string, Record<string, string>>> {
  const css = await readCssText(stylesPath);
  return bucketTokens(extractCssCustomProperties(css));
}
