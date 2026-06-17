import { searchUi, type SearchUiOptions, type SearchUiHit } from "@apt/arch-engine";

export async function handleSearchUi(
  projectRoot: string,
  options: SearchUiOptions
): Promise<SearchUiHit[]> {
  return searchUi(projectRoot, options);
}
