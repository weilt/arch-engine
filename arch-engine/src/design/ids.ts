/** Safe slug for component/page ids used in filesystem paths under .ai/design/. */
const DESIGN_ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export class InvalidDesignIdError extends Error {
  constructor(id: string, kind: "component" | "page") {
    super(`Invalid design ${kind} id: ${id}`);
    this.name = "InvalidDesignIdError";
  }
}

export function isValidDesignId(id: string): boolean {
  return DESIGN_ID_RE.test(id);
}

export function assertDesignId(id: string, kind: "component" | "page"): void {
  if (!isValidDesignId(id)) {
    throw new InvalidDesignIdError(id, kind);
  }
}
