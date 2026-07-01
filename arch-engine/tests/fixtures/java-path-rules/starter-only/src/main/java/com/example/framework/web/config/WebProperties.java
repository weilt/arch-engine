package com.example.framework.web.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "base.web")
public class WebProperties {
    private Api adminApi = new Api("/admin-api", "**.controller.admin.**");
    private Api appApi = new Api("/app-api", "**.controller.app.**");

    public static class Api {
        public Api(String prefix, String controller) {}
    }
}
