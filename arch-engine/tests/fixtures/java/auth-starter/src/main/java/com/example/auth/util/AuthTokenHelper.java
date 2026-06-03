package com.example.auth.util;

/**
 * Token parsing helpers for auth starter consumers.
 */
public class AuthTokenHelper {
  public static String parseBearer(String header) {
    return header == null ? "" : header.replace("Bearer ", "");
  }
}
