import type { ApiEndpoint, DocumentModel } from "../types.js";

export function mergeDocumentModel(
  javaApis: ApiEndpoint[],
  openApis: ApiEndpoint[],
  rpcs: DocumentModel["rpcs"],
  modules: DocumentModel["modules"],
  packages: DocumentModel["packages"]
): DocumentModel {
  const openApiKeys = new Set(openApis.map((a) => `${a.method}:${a.path}`));
  const javaOnly = javaApis.filter((a) => !openApiKeys.has(`${a.method}:${a.path}`));
  return {
    modules,
    apis: [...openApis, ...javaOnly],
    rpcs,
    packages,
  };
}
