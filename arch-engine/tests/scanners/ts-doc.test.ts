import { describe, expect, it } from "vitest";
import { extractFromSource } from "../../src/scanners/ts-doc.js";

describe("extractFromSource", () => {
  it("extracts JSDoc, exports, and enum members", () => {
    const source = `
/**
 * Shared order states.
 */
export enum OrderStatus {
  Pending = "pending",
  Paid = "paid",
}

/** Format currency for display. */
export function formatMoney(amount: number): string {
  return String(amount);
}
`;
    const doc = extractFromSource(source, "OrderStatus");
    expect(doc.enums).toHaveLength(1);
    expect(doc.enums[0]?.name).toBe("OrderStatus");
    expect(doc.enums[0]?.description).toContain("Shared order states");
    expect(doc.enums[0]?.members).toEqual(["Pending", "Paid"]);
    expect(doc.exports.some((e) => e.includes("formatMoney"))).toBe(true);
  });
});
