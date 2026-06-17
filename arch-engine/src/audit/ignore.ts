const IGNORE_SEGMENTS = ["/.ai/", "/node_modules/", "/target/", "/dist/", "/.git/"];

export function shouldIgnoreAuditPath(relPath: string): boolean {
  const p = `/${relPath.replace(/\\/g, "/")}/`;
  return IGNORE_SEGMENTS.some((seg) => p.includes(seg));
}
