#!/usr/bin/env node
import path from "node:path";
import {
  checkFrameworkBindings,
  generateFrameworkBindings,
  listSupportedLibraries,
  resolveLibraryTemplate,
} from "./design/bindings.js";
import { readDesignProfile } from "./design/query.js";

function printHelp(): void {
  console.log(`Usage: design-bindings [projectRoot] [options]

Generate .ai/design/framework-bindings.json from a UI library template,
or validate existing bindings against components/ and pages/.

Options:
  --framework <react|vue>   Target framework (required for generate)
  --library <name>          UI library (required for generate)
                            Supported: ${listSupportedLibraries().join(", ")}
  --product-type <text>     Optional product/module type label
  --style-notes <text>      Optional style preference notes
  --dry-run                 Report without writing files
  --check                   Validate bindings vs components/ and pages/
  --strict                  Exit non-zero when --check finds issues
  -h, --help                Show this help

Examples:
  design-bindings --framework vue --library element-plus
  design-bindings --framework react --library antd --product-type admin
  design-bindings --check
  design-bindings --check --strict
`);
}

function parseArgs(argv: string[]): {
  projectRoot: string;
  framework?: "react" | "vue";
  library?: string;
  productType?: string;
  styleNotes?: string;
  dryRun: boolean;
  check: boolean;
  strict: boolean;
} {
  const args = [...argv];
  let dryRun = false;
  let check = false;
  let strict = false;
  let framework: "react" | "vue" | undefined;
  let library: string | undefined;
  let productType: string | undefined;
  let styleNotes: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--check") {
      check = true;
      continue;
    }
    if (a === "--strict") {
      strict = true;
      continue;
    }
    if (a === "--framework") {
      const v = args[++i];
      if (v !== "react" && v !== "vue") {
        throw new Error('--framework must be "react" or "vue"');
      }
      framework = v;
      continue;
    }
    if (a === "--library") {
      library = args[++i];
      continue;
    }
    if (a === "--product-type") {
      productType = args[++i];
      continue;
    }
    if (a === "--style-notes") {
      styleNotes = args[++i];
      continue;
    }
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    if (!a.startsWith("-")) positional.push(a);
  }

  const projectRoot = positional[0] ? path.resolve(positional[0]) : process.cwd();
  return { projectRoot, framework, library, productType, styleNotes, dryRun, check, strict };
}

async function main(): Promise<void> {
  const { projectRoot, framework, library, productType, styleNotes, dryRun, check, strict } =
    parseArgs(process.argv.slice(2));

  if (check) {
    await readDesignProfile(projectRoot);
    const report = await checkFrameworkBindings(projectRoot);
    console.log(JSON.stringify(report, null, 2));
    if (strict && !report.ok) process.exit(1);
    return;
  }

  if (!framework || !library) {
    printHelp();
    process.exit(1);
  }

  await readDesignProfile(projectRoot);
  resolveLibraryTemplate(library);

  const report = await generateFrameworkBindings(projectRoot, {
    framework,
    library,
    productType,
    styleNotes,
    dryRun,
  });

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
