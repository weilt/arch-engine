import {
  registerAssetInArch,
  type RegisterAssetInput,
  type RegisterAssetResult,
} from "@apt/arch-engine";

const REGISTER_ASSET_KINDS = [
  "component",
  "util",
  "enum",
  "starter",
  "api",
  "rpc",
  "pojo",
] as const;

export type RegisterAssetToolInput = {
  kind: (typeof REGISTER_ASSET_KINDS)[number];
  name: string;
  module: string;
  sourcePath: string;
  summary: string;
  whenToUse: string;
  howToUse: string;
  exports?: string[];
  related?: string[];
  tags?: string[];
};

export async function handleRegisterAsset(
  projectRoot: string,
  input: RegisterAssetToolInput
): Promise<RegisterAssetResult> {
  return registerAssetInArch(projectRoot, input as RegisterAssetInput);
}

export { REGISTER_ASSET_KINDS };
