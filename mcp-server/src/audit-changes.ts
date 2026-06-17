import {
  auditArchChanges,
  type AuditArchChangesOptions,
  type AuditArchChangesResult,
} from "@apt/arch-engine";

export async function handleAuditArchChanges(
  projectRoot: string,
  options: AuditArchChangesOptions = {}
): Promise<AuditArchChangesResult> {
  return auditArchChanges(projectRoot, options);
}
