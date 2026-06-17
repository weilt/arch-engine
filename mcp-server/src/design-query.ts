import {
  queryDesign,
  type QueryDesignOptions,
  type QueryDesignResult,
} from "@apt/arch-engine";

export async function handleQueryDesign(
  projectRoot: string,
  options: QueryDesignOptions
): Promise<QueryDesignResult> {
  const hasPage = Boolean(options.page);
  const hasComponent = Boolean(options.component);
  if (hasPage && hasComponent) {
    throw new Error("query_design: specify only one of page or component");
  }
  if (options.scope === "global" && (hasPage || hasComponent)) {
    throw new Error("query_design: scope global cannot be combined with page or component");
  }
  if (options.scope === "global" || (!hasPage && !hasComponent)) {
    return queryDesign(projectRoot, { scope: "global" });
  }
  if (options.page) {
    return queryDesign(projectRoot, { page: options.page });
  }
  return queryDesign(projectRoot, { component: options.component! });
}
