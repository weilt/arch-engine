import type { AssetKind } from "../types.js";

export function buildAssetId(
  scope: string,
  module: string,
  kind: AssetKind,
  name: string
): string {
  return `${scope}/${module}/${kind}/${name}`;
}
