import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanFrontend } from "../../src/scanners/frontend.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..", "fixtures", "frontend");

describe("frontend scanner", () => {
  it("scanFrontend discovers @demo/ui package with Button component and format util", async () => {
    const packages = await scanFrontend(frontendRoot);

    expect(packages).toHaveLength(1);

    const ui = packages[0];
    expect(ui.slug).toBe("ui");
    expect(ui.name).toBe("@demo/ui");
    expect(ui.description).toBe("Demo UI component library");
    expect(ui.framework).toBe("react");

    expect(ui.components).toEqual([
      { name: "Button", file: "src/components/Button.tsx" },
    ]);
    expect(ui.utils).toEqual([{ name: "format", file: "src/utils/format.ts" }]);
  });
});
