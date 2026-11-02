package com.pipi.kids;

import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Only actual provider transcodes change bitrate; resizing the surface does not. */
final class BaiduStream {
    static final String DEFAULT = "480";
    static final String[] QUALITIES = {"480", "720", "original"};
    static String quality(String value) {
        for (String supported : QUALITIES) if (supported.equals(value)) return value;
        return DEFAULT;
    }
    static String label(String quality) {
        switch (quality) {
            case "480": return "流畅 480P";
            case "720": return "高清 720P";
            default: return "原画";
        }
    }
    static String type(String quality) throws Exception {
        if (!quality.equals(quality(quality)) || quality.equals("original")) throw new Exception("请选择有效的转码清晰度。");
        return "M3U8_AUTO_" + quality;
    }
    static String userAgent(String androidVersion) {
        return "xpanvideo;pipi-classroom;0.1.0;Android;" + androidVersion.replaceAll("[^A-Za-z0-9._-]", "") + ";ts";
    }
    static void validate(String body, String base) throws Exception {
        BaiduPolicy.https(base, false);
        if (body.startsWith("\ufeff")) body = body.substring(1);
        if (!body.trim().startsWith("#EXTM3U") || (!body.contains("#EXTINF:") && !body.contains("#EXT-X-STREAM-INF:")))
            throw new Exception("这个视频暂不支持该清晰度。");
        Pattern attributes = Pattern.compile("URI=\"([^\"]+)\"");
        for (String raw : body.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.isEmpty()) continue;
            if (!line.startsWith("#")) validateReference(base, line);
            else { Matcher match = attributes.matcher(line); while (match.find()) validateReference(base, match.group(1)); }
        }
    }
    private static void validateReference(String base, String value) throws Exception {
        BaiduPolicy.https(new URI(base).resolve(value).toString(), false);
    }
    static String error(int code) {
        switch (code) {
            case 133: return "百度网盘需要广告等待后才能转码播放。";
            case 31341: return "视频正在转码，请稍后重试。";
            case 31326: return "此清晰度暂时无法授权播放。";
            case 31304: case 31346: return "此视频暂不支持转码播放。";
            default: return "这个视频暂不支持该清晰度。";
        }
    }
    static int adWaitSeconds(int requested) throws Exception {
        if (requested < 1 || requested > 120) throw new Exception("百度网盘暂未提供可用的转码等待信息。");
        return requested;
    }
    private BaiduStream() {}
}
