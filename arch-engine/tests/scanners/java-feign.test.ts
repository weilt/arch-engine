import { describe, it, expect } from "vitest";
import { parseFeignInterface } from "../../src/scanners/java-feign.js";

const dictDataCommonApi = `
package com.example.common.api;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import io.swagger.v3.oas.annotations.Operation;

@FeignClient(name = RpcConstants.SYSTEM_NAME)
public interface DictDataCommonApi {

    @GetMapping("/dict/data")
    @Operation(summary = "查询字典数据")
    List<DictDataResp> getDictData();
}
`;

describe("parseFeignInterface", () => {
  it("parses interface name, clientRef constant, and GetMapping method", () => {
    const result = parseFeignInterface(dictDataCommonApi);

    expect(result).not.toBeNull();
    expect(result?.name).toBe("DictDataCommonApi");
    expect(result?.clientRef).toBe("RpcConstants.SYSTEM_NAME");
    expect(result?.methods.length).toBeGreaterThanOrEqual(1);
    expect(result?.methods[0].httpMethod).toBe("GET");
    expect(result?.methods[0].path).toBe("/dict/data");
    expect(result?.methods[0].operationSummary).toBe("查询字典数据");
  });

  it("parses value= literal", () => {
    const content = `
@FeignClient(value = "order-service")
public interface OrderClient {
  @PostMapping("/orders")
  void create();
}
`;
    const result = parseFeignInterface(content);
    expect(result?.name).toBe("OrderClient");
    expect(result?.clientRef).toBe("order-service");
    expect(result?.methods[0].httpMethod).toBe("POST");
  });

  it("parses shorthand @FeignClient(\"name\")", () => {
    const content = `
@FeignClient("user-service")
public interface UserClient {}
`;
    const result = parseFeignInterface(content);
    expect(result?.name).toBe("UserClient");
    expect(result?.clientRef).toBe("user-service");
  });
});
