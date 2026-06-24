import fs from "node:fs/promises";
import path from "node:path";
import {
  getDesignComponentsDir,
  getDesignDir,
  getDesignPagesDir,
  getDesignProfilePath,
  getFrameworkBindingsPath,
} from "./paths.js";
import type {
  DesignPageRecipe,
  DesignProfile,
  DesignPreferences,
  FrameworkBindingEntry,
  FrameworkBindingsFile,
  FrameworkBindingsMeta,
  BindingsCheckReport,
  BindingsCheckWarning,
  GenerateFrameworkBindingsOptions,
  GenerateFrameworkBindingsReport,
} from "./types.js";

export interface LibraryTemplate {
  framework: "react" | "vue";
  aliases: string[];
  bindings: Record<string, FrameworkBindingEntry>;
}

function vueEl(component: string, props?: Record<string, unknown>): FrameworkBindingEntry {
  return { vue: { import: "element-plus", component, props } };
}

function vueAdv(component: string, props?: Record<string, unknown>): FrameworkBindingEntry {
  return { vue: { import: "ant-design-vue", component, props } };
}

function reactAntd(component: string, props?: Record<string, unknown>): FrameworkBindingEntry {
  return { react: { import: "antd", component, props } };
}

function reactShadcn(component: string, props?: Record<string, unknown>): FrameworkBindingEntry {
  return {
    react: {
      import: `@/components/ui/${component.toLowerCase()}`,
      component,
      props,
      notes: "shadcn/ui local component path",
    },
  };
}

function reactMui(component: string, props?: Record<string, unknown>): FrameworkBindingEntry {
  return { react: { import: "@mui/material", component, props } };
}

export const LIBRARY_TEMPLATES: Record<string, LibraryTemplate> = {
  "element-plus": {
    framework: "vue",
    aliases: ["elementplus", "el-plus"],
    bindings: {
      PrimaryButton: vueEl("ElButton", { type: "primary" }),
      SecondaryButton: vueEl("ElButton"),
      Card: vueEl("ElCard"),
      PageHeader: {
        vue: {
          import: "element-plus",
          component: "ElPageHeader",
          notes: "Or compose with ElBreadcrumb + title slot",
        },
      },
      Input: vueEl("ElInput"),
      Select: vueEl("ElSelect"),
      Checkbox: vueEl("ElCheckbox"),
      Radio: vueEl("ElRadio"),
      Switch: vueEl("ElSwitch"),
      Form: vueEl("ElForm"),
      Table: vueEl("ElTable"),
      Modal: vueEl("ElDialog"),
      Alert: vueEl("ElAlert"),
      EmptyState: vueEl("ElEmpty"),
      SkeletonList: vueEl("ElSkeleton", { rows: 4, animated: true }),
      Tabs: vueEl("ElTabs"),
      Breadcrumb: vueEl("ElBreadcrumb"),
      Pagination: vueEl("ElPagination"),
      Tag: vueEl("ElTag"),
      Tooltip: vueEl("ElTooltip"),
      Dropdown: vueEl("ElDropdown"),
      Toast: {
        vue: {
          import: "element-plus",
          component: "ElMessage",
          notes: "Use ElMessage.success / .error etc.",
        },
      },
    },
  },
  "ant-design-vue": {
    framework: "vue",
    aliases: ["antd-vue", "antdv"],
    bindings: {
      PrimaryButton: vueAdv("AButton", { type: "primary" }),
      SecondaryButton: vueAdv("AButton"),
      Card: vueAdv("ACard"),
      PageHeader: vueAdv("APageHeader"),
      Input: vueAdv("AInput"),
      Select: vueAdv("ASelect"),
      Checkbox: vueAdv("ACheckbox"),
      Radio: vueAdv("ARadio"),
      Switch: vueAdv("ASwitch"),
      Form: vueAdv("AForm"),
      Table: vueAdv("ATable"),
      Modal: vueAdv("AModal"),
      Alert: vueAdv("AAlert"),
      EmptyState: vueAdv("AEmpty"),
      SkeletonList: vueAdv("ASkeleton", { active: true }),
      Tabs: vueAdv("ATabs"),
      Breadcrumb: vueAdv("ABreadcrumb"),
      Pagination: vueAdv("APagination"),
      Tag: vueAdv("ATag"),
      Tooltip: vueAdv("ATooltip"),
      Dropdown: vueAdv("ADropdown"),
      Toast: {
        vue: {
          import: "ant-design-vue",
          component: "message",
          notes: "Use message.success / message.error",
        },
      },
    },
  },
  antd: {
    framework: "react",
    aliases: ["ant-design", "antd-react"],
    bindings: {
      PrimaryButton: reactAntd("Button", { type: "primary" }),
      SecondaryButton: reactAntd("Button"),
      Card: reactAntd("Card"),
      PageHeader: reactAntd("PageHeader"),
      Input: reactAntd("Input"),
      Select: reactAntd("Select"),
      Checkbox: reactAntd("Checkbox"),
      Radio: reactAntd("Radio"),
      Switch: reactAntd("Switch"),
      Form: reactAntd("Form"),
      Table: reactAntd("Table"),
      Modal: reactAntd("Modal"),
      Alert: reactAntd("Alert"),
      EmptyState: reactAntd("Empty"),
      SkeletonList: reactAntd("Skeleton", { active: true }),
      Tabs: reactAntd("Tabs"),
      Breadcrumb: reactAntd("Breadcrumb"),
      Pagination: reactAntd("Pagination"),
      Tag: reactAntd("Tag"),
      Tooltip: reactAntd("Tooltip"),
      Dropdown: reactAntd("Dropdown"),
      Toast: {
        react: {
          import: "antd",
          component: "message",
          notes: "Use message.success / message.error",
        },
      },
    },
  },
  "shadcn/ui": {
    framework: "react",
    aliases: ["shadcn", "shadcn-ui"],
    bindings: {
      PrimaryButton: reactShadcn("Button", { variant: "default" }),
      SecondaryButton: reactShadcn("Button", { variant: "secondary" }),
      Card: reactShadcn("Card"),
      PageHeader: {
        react: {
          import: "@/components/ui/page-header",
          component: "PageHeader",
          notes: "Compose or add local page-header primitive",
        },
      },
      Input: reactShadcn("Input"),
      Select: reactShadcn("Select"),
      Checkbox: reactShadcn("Checkbox"),
      Radio: reactShadcn("RadioGroup"),
      Switch: reactShadcn("Switch"),
      Form: reactShadcn("Form"),
      Table: reactShadcn("Table"),
      Modal: reactShadcn("Dialog"),
      Alert: reactShadcn("Alert"),
      EmptyState: {
        react: {
          import: "@/components/ui/empty",
          component: "Empty",
          notes: "Add empty state primitive if missing",
        },
      },
      SkeletonList: reactShadcn("Skeleton"),
      Tabs: reactShadcn("Tabs"),
      Breadcrumb: reactShadcn("Breadcrumb"),
      Pagination: {
        react: {
          import: "@/components/ui/pagination",
          component: "Pagination",
        },
      },
      Tag: reactShadcn("Badge"),
      Tooltip: reactShadcn("Tooltip"),
      Dropdown: reactShadcn("DropdownMenu"),
      Toast: {
        react: {
          import: "sonner",
          component: "toast",
          notes: "Or @/components/ui/sonner from shadcn",
        },
      },
    },
  },
  mui: {
    framework: "react",
    aliases: ["material-ui", "@mui/material"],
    bindings: {
      PrimaryButton: reactMui("Button", { variant: "contained", color: "primary" }),
      SecondaryButton: reactMui("Button", { variant: "outlined" }),
      Card: reactMui("Card"),
      PageHeader: {
        react: {
          import: "@mui/material",
          component: "Typography",
          props: { variant: "h4" },
          notes: "Compose Typography + Breadcrumbs for page header",
        },
      },
      Input: reactMui("TextField"),
      Select: reactMui("Select"),
      Checkbox: reactMui("Checkbox"),
      Radio: reactMui("Radio"),
      Switch: reactMui("Switch"),
      Form: {
        react: {
          import: "@mui/material",
          component: "Box",
          notes: "Use Box component='form' or native form with MUI inputs",
        },
      },
      Table: reactMui("Table"),
      Modal: reactMui("Dialog"),
      Alert: reactMui("Alert"),
      EmptyState: {
        react: {
          import: "@mui/material",
          component: "Typography",
          notes: "Compose empty state with Typography + optional illustration",
        },
      },
      SkeletonList: reactMui("Skeleton", { variant: "rectangular", height: 48 }),
      Tabs: reactMui("Tabs"),
      Breadcrumb: reactMui("Breadcrumbs"),
      Pagination: reactMui("Pagination"),
      Tag: reactMui("Chip"),
      Tooltip: reactMui("Tooltip"),
      Dropdown: reactMui("Menu"),
      Toast: {
        react: {
          import: "notistack",
          component: "enqueueSnackbar",
          notes: "Or @mui/material Snackbar with Alert",
        },
      },
    },
  },
};

export function resolveLibraryTemplate(library: string): { key: string; template: LibraryTemplate } {
  const normalized = library.trim().toLowerCase();
  for (const [key, template] of Object.entries(LIBRARY_TEMPLATES)) {
    if (key.toLowerCase() === normalized) return { key, template };
    if (template.aliases.some((a) => a.toLowerCase() === normalized)) return { key, template };
  }
  const supported = Object.keys(LIBRARY_TEMPLATES).join(", ");
  throw new Error(`Unknown UI library "${library}". Supported: ${supported}`);
}

export function listSupportedLibraries(): string[] {
  return Object.keys(LIBRARY_TEMPLATES);
}

export async function readFrameworkBindings(
  projectRoot: string
): Promise<FrameworkBindingsFile | null> {
  const bindingsPath = getFrameworkBindingsPath(projectRoot);
  try {
    const raw = await fs.readFile(bindingsPath, "utf-8");
    return JSON.parse(raw) as FrameworkBindingsFile;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function buildBindingsFile(
  template: LibraryTemplate,
  libraryKey: string,
  options: Pick<GenerateFrameworkBindingsOptions, "framework" | "productType" | "styleNotes">
): FrameworkBindingsFile {
  const meta: FrameworkBindingsMeta = {
    framework: options.framework,
    library: libraryKey,
    generatedAt: new Date().toISOString(),
  };
  if (options.productType) meta.productType = options.productType;
  if (options.styleNotes) meta.styleNotes = options.styleNotes;

  const file: FrameworkBindingsFile = { _meta: meta };
  for (const [semanticId, entry] of Object.entries(template.bindings)) {
    file[semanticId] = entry;
  }
  return file;
}

async function updateProfilePreferences(
  projectRoot: string,
  preferences: DesignPreferences
): Promise<DesignProfile> {
  const profilePath = getDesignProfilePath(projectRoot);
  let profile: DesignProfile;
  try {
    profile = JSON.parse(await fs.readFile(profilePath, "utf-8")) as DesignProfile;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "No .ai/design/profile.json found. Run design-sync before design-bindings."
      );
    }
    throw e;
  }
  profile.preferences = { ...profile.preferences, ...preferences };
  await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), "utf-8");
  return profile;
}

export async function generateFrameworkBindings(
  projectRoot: string,
  options: GenerateFrameworkBindingsOptions
): Promise<GenerateFrameworkBindingsReport> {
  const { key, template } = resolveLibraryTemplate(options.library);
  if (template.framework !== options.framework) {
    throw new Error(
      `Library "${key}" requires framework "${template.framework}", got "${options.framework}".`
    );
  }

  const bindings = buildBindingsFile(template, key, options);
  const bindingsPath = getFrameworkBindingsPath(projectRoot);
  const componentMappings = Object.keys(template.bindings).length;

  if (!options.dryRun) {
    await fs.mkdir(getDesignDir(projectRoot), { recursive: true });
    await fs.writeFile(bindingsPath, JSON.stringify(bindings, null, 2), "utf-8");
    await updateProfilePreferences(projectRoot, {
      framework: options.framework,
      uiLibrary: key,
      productType: options.productType,
      styleNotes: options.styleNotes,
    });
  }

  return {
    path: path.relative(projectRoot, bindingsPath).replace(/\\/g, "/"),
    framework: options.framework,
    library: key,
    componentMappings,
    dryRun: Boolean(options.dryRun),
  };
}

function isBindingEntry(value: unknown): value is FrameworkBindingEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as FrameworkBindingEntry;
  return Boolean(v.react || v.vue);
}

export function resolveComponentBinding(
  bindings: FrameworkBindingsFile | null,
  componentId: string
): FrameworkBindingEntry | null {
  if (!bindings) return null;
  const entry = bindings[componentId];
  if (!entry || !isBindingEntry(entry)) return null;
  return entry;
}

async function listJsonIds(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function collectPageComponentIds(pages: DesignPageRecipe[]): string[] {
  const ids = new Set<string>();
  for (const page of pages) {
    for (const region of page.regions ?? []) {
      for (const cid of region.components ?? []) ids.add(cid);
    }
    for (const cid of Object.values(page.states ?? {})) {
      if (cid) ids.add(cid);
    }
  }
  return [...ids];
}

export async function checkFrameworkBindings(projectRoot: string): Promise<BindingsCheckReport> {
  const profile = JSON.parse(
    await fs.readFile(getDesignProfilePath(projectRoot), "utf-8")
  ) as DesignProfile;
  const uiLibrary = profile.preferences?.uiLibrary;
  const framework = profile.preferences?.framework;

  if (!uiLibrary) {
    return {
      ok: true,
      warnings: [
        {
          code: "ui_library_not_set",
          message: "profile.preferences.uiLibrary not set; skipping binding validation",
        },
      ],
    };
  }

  const bindings = await readFrameworkBindings(projectRoot);
  const warnings: BindingsCheckWarning[] = [];
  const resolvedFramework = framework ?? bindings?._meta.framework;

  if (!bindings) {
    return {
      ok: false,
      warnings: [
        {
          code: "no_bindings_file",
          message: "framework-bindings.json missing but preferences.uiLibrary is set",
        },
      ],
      uiLibrary,
      framework: resolvedFramework,
    };
  }

  const componentIds = new Set(await listJsonIds(getDesignComponentsDir(projectRoot)));
  const bindingIds = Object.keys(bindings).filter((k) => k !== "_meta");

  const orphanBindings = bindingIds.filter((id) => !componentIds.has(id));
  if (orphanBindings.length > 0) {
    warnings.push({
      code: "orphan_bindings",
      message: "Binding semantic ids not found in components/",
      ids: orphanBindings.sort(),
    });
  }

  const pagesDir = getDesignPagesDir(projectRoot);
  const pageIds = await listJsonIds(pagesDir);
  const pages: DesignPageRecipe[] = [];
  for (const id of pageIds) {
    const page = await readJsonFile<DesignPageRecipe>(path.join(pagesDir, `${id}.json`));
    if (page) pages.push(page);
  }

  const referencedIds = collectPageComponentIds(pages);
  const missingBindings = referencedIds.filter((id) => !bindingIds.includes(id));
  if (missingBindings.length > 0) {
    warnings.push({
      code: "missing_bindings",
      message: "Page-referenced semantic ids missing from framework-bindings.json",
      ids: missingBindings.sort(),
    });
  }

  return {
    ok: warnings.length === 0,
    warnings,
    uiLibrary,
    framework: resolvedFramework,
  };
}
