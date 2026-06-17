import {
  refreshAssetInArch,
  type RefreshAssetInput,
  type RefreshAssetResult,
} from "@apt/arch-engine";

const REFRESH_ASSET_KINDS = [
  "component",
  "util",
  "enum",
  "starter",
  "api",
  "rpc",
  "pojo",
] as const;

export type RefreshAssetToolInput = {
  sourcePath: string;
  kind?: (typeof REFRESH_ASSET_KINDS)[number];
  name?: string;
  module?: string;
};

export async function handleRefreshAsset(
  projectRoot: string,
  input: RefreshAssetToolInput
): Promise<RefreshAssetResult> {
  return refreshAssetInArch(projectRoot, input as RefreshAssetInput);
}

export { REFRESH_ASSET_KINDS };
