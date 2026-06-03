import { describe, it, expect } from "vitest";
import { buildAssetId } from "../../src/asset/id.js";

describe("buildAssetId", () => {
  it("builds backend util id", () => {
    expect(buildAssetId("backend", "base-common", "util", "JsonUtils")).toBe(
      "backend/base-common/util/JsonUtils"
    );
  });

  it("builds frontend component id", () => {
    expect(buildAssetId("frontend", "ui", "component", "Button")).toBe(
      "frontend/ui/component/Button"
    );
  });
});
