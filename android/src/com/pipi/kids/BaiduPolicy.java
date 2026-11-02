package com.pipi.kids;

import java.net.URI;
import java.util.Locale;

/** Provider paths and virtual IDs are deliberately separate from local storage paths. */
final class BaiduPolicy {
    static final String ROOT = "/apps/皮皮课堂";
    static final String DISPLAY_ROOT = "/我的应用数据/皮皮课堂";
    static boolean cloud(String path) { return path != null && path.startsWith("/baidu/"); }
    static boolean within(String path, String root) { return path.equals(root) || path.startsWith(root + "/"); }
    static String remote(String path) throws Exception {
        if (path == null || path.length() > 4096 || !within(path, ROOT)) throw new Exception("请选择皮皮课堂应用目录内的文件夹。");
        for (String part : path.substring(1).split("/", -1))
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.indexOf('\\') >= 0 || java.util.regex.Pattern.compile("[\\x00-\\x1f\\x7f]").matcher(part).find())
                throw new Exception("网盘路径无效。");
        return path;
    }
    static String account(String value) throws Exception {
        if (value == null || !value.matches("[0-9a-f]{64}")) throw new Exception("网盘账号信息无效，请重新连接。");
        return value;
    }
    static String segment(long id, String name, boolean folder) throws Exception {
        if (id <= 0) throw new Exception("网盘文件标识无效。");
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        if (!folder && !extension.matches("[a-z0-9]{1,10}")) throw new Exception("网盘文件格式无效。");
        return Long.toString(id) + (folder ? "" : "." + extension);
    }
    static String https(String address, boolean oauthOnly) throws Exception {
        URI uri;
        try { uri = new URI(address); } catch (Exception error) { throw new Exception("网盘返回了无效地址。"); }
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        boolean allowed = oauthOnly ? host.equals("openapi.baidu.com") : host.equals("baidu.com") || host.endsWith(".baidu.com") || host.equals("baidupcs.com") || host.endsWith(".baidupcs.com");
        if (!"https".equalsIgnoreCase(uri.getScheme()) || !allowed || uri.getUserInfo() != null || uri.getFragment() != null || (uri.getPort() != -1 && uri.getPort() != 443))
            throw new Exception("网盘返回的地址无法使用。");
        return address;
    }
    private BaiduPolicy() {}
}
