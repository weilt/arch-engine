package com.example.common.enums;

/**
 * 通用业务状态枚举。
 */
public enum CommonStatusEnum {
    ENABLED(1, "启用"),
    DISABLED(0, "禁用");

    private final int code;
    private final String label;

    CommonStatusEnum(int code, String label) {
        this.code = code;
        this.label = label;
    }
}
