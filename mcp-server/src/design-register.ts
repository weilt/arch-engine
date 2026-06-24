import { registerUiPattern, type RegisterUiPatternResult } from "@apt/arch-engine";

export type RegisterUiPatternToolInput = {
  page: string;
  sourcePath: string;
  componentsUsed: string[];
  notes?: string;
};

export async function handleRegisterUiPattern(
  projectRoot: string,
  input: RegisterUiPatternToolInput
): Promise<RegisterUiPatternResult> {
  return registerUiPattern(projectRoot, input);
}
