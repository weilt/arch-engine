package com.example.common.util;

/**
 * JSON 序列化与反序列化工具类。
 */
public class JsonUtils {

    public static String toJson(Object value) {
        return "{}";
    }

    public static <T> T fromJson(String json, Class<T> type) {
        return null;
    }
}
