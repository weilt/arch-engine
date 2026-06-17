import {
  removeAssetFromArch,
  type RemoveAssetInput,
  type RemoveAssetResult,
} from "@apt/arch-engine";

export type RemoveAssetToolInput = {
  assetId?: string;
  sourcePath?: string;
};

export async function handleRemoveAsset(
  projectRoot: string,
  input: RemoveAssetToolInput
): Promise<RemoveAssetResult> {
  return removeAssetFromArch(projectRoot, input as RemoveAssetInput);
}
