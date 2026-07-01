import { describe, expect, it } from "vitest";
import { discoverExports } from "../../src/scanners/ts-export.js";

describe("discoverExports", () => {
  it("classifies PascalCase .tsx named export as component", () => {
    const source = `
/**
 * Primary action button for forms and dialogs.
 */
export function Button() {
  return <button type="button">Click</button>;
}
`;
    const exports = discoverExports(source, "src/components/Button.tsx");
    expect(exports).toContainEqual({ name: "Button", kindHint: "component" });
  });

  it("classifies export default function with props in .tsx as component", () => {
    const source = `
interface ButtonProps {
  label: string;
}

export default function Button(props: ButtonProps) {
  return <button>{props.label}</button>;
}
`;
    const exports = discoverExports(source, "src/components/Button.tsx");
    expect(exports.some((e) => e.kindHint === "component")).toBe(true);
  });

  it("classifies export enum as enum", () => {
    const source = `
export enum OrderStatus {
  Pending = "pending",
  Paid = "paid",
}
`;
    const exports = discoverExports(source, "src/enums/OrderStatus.ts");
    expect(exports).toContainEqual({ name: "OrderStatus", kindHint: "enum" });
  });

  it("classifies named function exports as util", () => {
    const source = `
export function formatLabel(value: string): string {
  return value.trim();
}
`;
    const exports = discoverExports(source, "src/utils/format.ts");
    expect(exports).toContainEqual({ name: "formatLabel", kindHint: "util" });
  });

  it("classifies *Utils exports as util", () => {
    const source = `
export class DateUtils {
  static parse(value: string): Date {
    return new Date(value);
  }
}
`;
    const exports = discoverExports(source, "src/utils/DateUtils.ts");
    expect(exports).toContainEqual({ name: "DateUtils", kindHint: "util" });
  });

  it("classifies PascalCase .vue SFC export as component", () => {
    const source = `
<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template><h1>{{ title }}</h1></template>
`;
    const exports = discoverExports(source, "src/components/PageHeader.vue");
    expect(exports.some((e) => e.kindHint === "component")).toBe(true);
  });
});
describe("discoverExports P0-1 (script setup SFC)", () => {
  it("registers a stripped <script setup> SFC without defineProps as a component", () => {
    // Production callers (frontend.ts readSourceContent) pass the STRIPPED
    // script text from ts-doc.extractVueScript for .vue files, so the <script>
    // tag is already gone. The fix keys off the .vue extension.
    const strippedScript = [
      'import { ref } from "vue";',
      "const count = ref(0);",
      "",
    ].join("\n");
    const exports = discoverExports(strippedScript, "src/components/Counter.vue");
    expect(exports).toContainEqual({ name: "Counter", kindHint: "component" });
  });
  it("registers a raw <script setup> SFC without defineProps as a component", () => {
    const source = [
      "<script setup lang=\"ts\">",
      'import { ref } from "vue";',
      "const count = ref(0);",
      "<\/script>",
      "<template><button>{{ count }}</button></template>",
      "",
    ].join("\n");
    const exports = discoverExports(source, "src/components/Counter.vue");
    expect(exports.some((e) => e.kindHint === "component")).toBe(true);
  });
  it("still registers a .vue SFC with defineProps from stripped script", () => {
    const strippedScript = "defineProps<{ title: string; visible: boolean }>();";
    const exports = discoverExports(strippedScript, "src/components/PageHeader.vue");
    expect(exports.some((e) => e.kindHint === "component")).toBe(true);
  });
  it("does not register an empty .tsx file as a component (tsx path unchanged)", () => {
    const exports = discoverExports("// nothing exported\n", "src/components/Empty.tsx");
    expect(exports).toEqual([]);
  });
});
