package com.example.common.api;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import io.swagger.v3.oas.annotations.Operation;

import java.util.List;

@FeignClient(name = RpcConstants.SYSTEM_NAME)
public interface DictDataCommonApi {

    @GetMapping("/dict/data")
    @Operation(summary = "查询字典数据")
    List<DictDataResp> getDictData();
}
