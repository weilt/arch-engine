package com.example.framework.web.config;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@AutoConfiguration
@EnableConfigurationProperties(WebProperties.class)
public class BaseWebAutoConfiguration {
}
