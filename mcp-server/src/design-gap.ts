import { appendDesignGap } from "@apt/arch-engine";

export async function handleReportDesignGap(
  projectRoot: string,
  input: { need: string; reason: string; page?: string }
): Promise<string> {
  await appendDesignGap(projectRoot, input);
  return "🚫 TASK BLOCKED. Design gap reported. Stop UI implementation and resolve design definition first.";
}
