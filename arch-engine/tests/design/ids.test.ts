import { describe, expect, it } from "vitest";
import { assertDesignId, isValidDesignId } from "../../src/design/ids.js";
import { InvalidDesignIdError } from "../../src/design/errors.js";

describe("design ids", () => {
  it("accepts safe slugs", () => {
    expect(isValidDesignId("PrimaryButton")).toBe(true);
    expect(isValidDesignId("user-settings")).toBe(true);
    assertDesignId("Card", "component");
  });

  it("rejects path traversal", () => {
    expect(isValidDesignId("../profile")).toBe(false);
    expect(isValidDesignId("..")).toBe(false);
    expect(isValidDesignId("a/b")).toBe(false);
    expect(() => assertDesignId("../x", "page")).toThrow(InvalidDesignIdError);
  });
});
