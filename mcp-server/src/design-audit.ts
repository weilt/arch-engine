import {
  auditDesignChanges,
  type AuditDesignChangesOptions,
  type AuditDesignChangesResult,
} from "@apt/arch-engine";

export async function handleAuditDesignChanges(
  projectRoot: string,
  options: AuditDesignChangesOptions = {}
): Promise<AuditDesignChangesResult> {
  return auditDesignChanges(projectRoot, options);
}
