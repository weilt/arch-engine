export class MissingDesignProfileError extends Error {
  constructor() {
    super(
      "No .ai/design/profile.json found. Run design-sync or /design-system first."
    );
    this.name = "MissingDesignProfileError";
  }
}

export class DesignComponentNotFoundError extends Error {
  constructor(id: string) {
    super(`Design component not found: ${id}. Try search_ui or report_design_gap.`);
    this.name = "DesignComponentNotFoundError";
  }
}

export class DesignPageNotFoundError extends Error {
  constructor(id: string) {
    super(`Design page recipe not found: ${id}. Try search_ui.`);
    this.name = "DesignPageNotFoundError";
  }
}

export { InvalidDesignIdError } from "./ids.js";
