package com.pipi.kids;

import java.io.*;
import java.net.*;
import java.util.*;
import org.json.JSONObject;

/** Bounded HTTPS requests with no URL/error logging and an explicit redirect boundary. */
final class BaiduHttp {
    static final class StreamResponse {
        final String url, body; final int status;
        StreamResponse(String url, String body, int status) { this.url = url; this.body = body; this.status = status; }
    }
    static StreamResponse stream(String url, String userAgent) throws Exception {
        String next = url;
        for (int hop = 0; hop < 6; hop++) {
            BaiduPolicy.https(next, false);
            HttpURLConnection connection = (HttpURLConnection) new URL(next).openConnection();
            try {
                connection.setConnectTimeout(10000); connection.setReadTimeout(15000); connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("User-Agent", userAgent);
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) { String location = connection.getHeaderField("Location"); if (location == null) throw new IOException(); next = new URL(new URL(next), location).toString(); continue; }
                try (InputStream input = status < 400 ? connection.getInputStream() : connection.getErrorStream()) {
                    if (input == null) throw new IOException();
                    return new StreamResponse(next, new String(read(input, 1024 * 1024), "UTF-8"), status);
                }
            } finally { connection.disconnect(); }
        }
        throw new Exception("这个视频暂不支持该清晰度。");
    }
    static final String BROKER = "https://oauth.dreamcanvas.site";
    static String encode(String value) throws Exception { return URLEncoder.encode(value, "UTF-8").replace("+", "%20"); }
    static String query(String base, String... pairs) throws Exception {
        StringBuilder result = new StringBuilder(base);
        for (int i = 0; i < pairs.length; i += 2) result.append(i == 0 ? '?' : '&').append(encode(pairs[i])).append('=').append(encode(pairs[i + 1]));
        return result.toString();
    }
    static JSONObject broker(String endpoint, JSONObject body) throws Exception {
        if (!endpoint.equals("/oauth/token") && !endpoint.equals("/oauth/device/code")) throw new IOException();
        return json(BROKER + endpoint, body);
    }
    static JSONObject json(String url, JSONObject body) throws Exception {
        if (!url.startsWith(BROKER + "/oauth/")) BaiduPolicy.https(url, false);
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(10000); connection.setReadTimeout(20000); connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "pan.baidu.com"); connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cache-Control", "no-store");
            if (body != null) {
                connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] bytes = body.toString().getBytes("UTF-8"); connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            if (stream == null) throw new IOException();
            JSONObject result;
            try (InputStream input = stream) { result = new JSONObject(new String(read(input, 4 * 1024 * 1024), "UTF-8")); }
            if (status >= 400 && !result.has("error")) result.put("error", status == 429 ? "rate_limited" : "service_unavailable");
            return result;
        } catch (Exception error) { throw new Exception("暂时无法连接网盘，请检查网络后重试。"); }
        finally { if (connection != null) connection.disconnect(); }
    }
    static byte[] read(InputStream input, int limit) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[32768]; int count;
        while ((count = input.read(buffer)) != -1) { if (bytes.size() + count > limit) throw new IOException("内容超过读取限制。"); bytes.write(buffer, 0, count); }
        return bytes.toByteArray();
    }
    static byte[] download(String url, int limit) throws Exception {
        String next = url;
        for (int hop = 0; hop < 6; hop++) {
            BaiduPolicy.https(next, false);
            HttpURLConnection connection = (HttpURLConnection) new URL(next).openConnection();
            try {
                connection.setConnectTimeout(10000); connection.setReadTimeout(20000); connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("User-Agent", "pan.baidu.com");
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) { String location = connection.getHeaderField("Location"); if (location == null) throw new IOException(); next = new URL(new URL(next), location).toString(); continue; }
                if (status != 200 || connection.getContentLengthLong() > limit) throw new IOException();
                try (InputStream input = connection.getInputStream()) { return read(input, limit); }
            } finally { connection.disconnect(); }
        }
        throw new Exception("网盘内容暂时无法读取，请重试。");
    }
}
