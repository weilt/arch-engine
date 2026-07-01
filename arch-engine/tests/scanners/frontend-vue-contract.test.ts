import { describe, expect, it } from "vitest";
import { extractVueContract } from "../../src/scanners/frontend-vue-contract.js";

describe("extractVueContract", () => {
  it("extracts props, emits and template tags from a <script setup> SFC", () => {
    const sfc = [
      "<script setup lang=\"ts\">",
      "interface TProps { title: string; count: number; visible: boolean }",
      "defineProps<TProps>();",
      'const emit = defineEmits(["login", "logout"]);',
      "</script>",
      "<template>",
      "  <el-card>",
      "    <UserWidget />",
      "    <div>{{ title }}</div>",
      "  </el-card>",
      "</template>",
      "",
    ].join("\n");
    const contract = extractVueContract(sfc);
    expect(contract).not.toBeNull();
    expect(contract!.isComponent).toBe(true);
    expect(contract!.props).toEqual(expect.arrayContaining(["title", "count", "visible"]));
    expect(contract!.emits).toEqual(expect.arrayContaining(["login", "logout"]));
    expect(contract!.templateTags).toEqual(expect.arrayContaining(["UserWidget", "el-card"]));
    expect(contract!.templateTags).not.toContain("div");
  });

  it("returns a component for a template-only SFC with empty props/emits", () => {
    const sfc = [
      "<template>",
      "  <h1>Hi</h1>",
      "  <UserBadge />",
      "</template>",
      "",
    ].join("\n");
    const contract = extractVueContract(sfc);
    expect(contract).not.toBeNull();
    expect(contract!.isComponent).toBe(true);
    expect(contract!.props).toEqual([]);
    expect(contract!.emits).toEqual([]);
    expect(contract!.templateTags).toContain("UserBadge");
    expect(contract!.templateTags).not.toContain("h1");
  });

  it("extracts Options API props and emits from defineComponent", () => {
    const sfc = [
      "<script>",
      "export default defineComponent({",
      "  props: { foo: String, bar: { type: String } },",
      '  emits: ["x"],',
      "});",
      "</script>",
      "",
    ].join("\n");
    const contract = extractVueContract(sfc);
    expect(contract).not.toBeNull();
    expect(contract!.props).toEqual(expect.arrayContaining(["foo", "bar"]));
    expect(contract!.props).not.toContain("type");
    expect(contract!.emits).toEqual(expect.arrayContaining(["x"]));
  });

  it("extracts props from withDefaults(defineProps<{...}>(), {...})", () => {
    const sfc = [
      "<script setup lang=\"ts\">",
      "withDefaults(defineProps<{ a: number; b: string }>(), { a: 0 });",
      "</script>",
      "",
    ].join("\n");
    const contract = extractVueContract(sfc);
    expect(contract).not.toBeNull();
    expect(contract!.props).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("captures defineModel names and this.$emit events", () => {
    const sfc = [
      "<script setup lang=\"ts\">",
      'const count = defineModel<number>("count");',
      'const title = defineModel("title");',
      "function close() {",
      '  this.$emit("close");',
      "}",
      "</script>",
      "",
    ].join("\n");
    const contract = extractVueContract(sfc);
    expect(contract).not.toBeNull();
    expect(contract!.props).toEqual(expect.arrayContaining(["count", "title"]));
    expect(contract!.emits).toEqual(expect.arrayContaining(["close"]));
  });

  it("returns null for empty/whitespace input", () => {
    expect(extractVueContract("")).toBeNull();
    expect(extractVueContract("   \n\t  ")).toBeNull();
  });
});
