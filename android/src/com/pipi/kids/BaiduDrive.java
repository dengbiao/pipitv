package com.pipi.kids;

import android.content.Context;
import android.os.SystemClock;
import android.util.AtomicFile;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** A read-only, account-scoped cloud source. Nothing here writes to the user's drive. */
final class BaiduDrive {
    static final class VideoUnavailable extends Exception {
        final int code;
        VideoUnavailable(int code) { super(BaiduStream.error(code)); this.code = code; }
    }
    interface VideoWait {
        boolean active(); boolean foreground(); void waiting(int seconds);
    }
    interface Transport {
        JSONObject json(String url, JSONObject body) throws Exception; byte[] download(String url, int limit) throws Exception;
        default BaiduHttp.StreamResponse stream(String url, String userAgent) throws Exception { return BaiduHttp.stream(url, userAgent); }
    }
    private static BaiduDrive instance;
    static synchronized BaiduDrive get(Context context) { if (instance == null) instance = new BaiduDrive(context.getApplicationContext(), new Transport() {
        public JSONObject json(String url, JSONObject body) throws Exception { return BaiduHttp.json(url, body); }
        public byte[] download(String url, int limit) throws Exception { return BaiduHttp.download(url, limit); }
    }); return instance; }
    private final Context context;
    private final Transport http;
    private final BaiduCredentials credentials;
    private final AtomicFile catalogFile;
    private final ExecutorService syncWorker = Executors.newSingleThreadExecutor();
    private final Object authLock = new Object();
    private volatile JSONObject auth = new JSONObject();
    private volatile JSONObject catalog = new JSONObject();
    private volatile Map<String, JSONObject> items = new LinkedHashMap<>();
    private volatile Map<String, String> artworkPaths = new HashMap<>();
    private final Map<String, String> thumbnails = new ConcurrentHashMap<>();
    private static final class VideoTicket {
        final String value; final long until;
        VideoTicket(String value) { this.value = value; until = SystemClock.elapsedRealtime() + 180000; }
    }
    private final Map<String, VideoTicket> videoTickets = new ConcurrentHashMap<>();
    private volatile boolean syncing;
    private volatile int scanned, generation;
    private volatile String syncError = "";
    private volatile String flowId = "", deviceCode = "";
    private volatile byte[] qr;
    private volatile int authGeneration;
    private long flowUntil, pollAfter;
    private int pollInterval = 10;

    BaiduDrive(Context context, Transport transport) {
        this.context = context; http = transport; credentials = new BaiduCredentials(context);
        catalogFile = new AtomicFile(new File(context.getNoBackupFilesDir(), "baidu-catalog.json"));
        try { auth = credentials.read(); } catch (Exception error) { credentials.clear(); }
        try (InputStream input = catalogFile.openRead()) {
            JSONObject saved = new JSONObject(new String(BaiduHttp.read(input, 16 * 1024 * 1024), "UTF-8"));
            if (account().equals(saved.optString("account")) && !account().isEmpty()) installCatalog(saved);
        } catch (Exception ignored) {}
    }
    private String account() { return auth.optString("account"); }
    boolean connected() { return !auth.optString("access_token").isEmpty(); }
    JSONObject status() throws Exception {
        JSONObject selection = catalog.optJSONObject("selection");
        return new JSONObject().put("supported", android.os.Build.VERSION.SDK_INT >= 23).put("connected", connected())
            .put("syncing", syncing).put("scanned", scanned).put("error", syncError)
            .put("root", BaiduPolicy.ROOT).put("displayRoot", BaiduPolicy.DISPLAY_ROOT)
            .put("selectedFolder", selection == null ? "" : display(selection.optString("path")))
            .put("lastSync", catalog.optLong("syncedAt")).put("seriesCount", catalog.optJSONArray("entries") == null ? 0 : catalog.getJSONArray("entries").length());
    }
    static String display(String path) { return path.startsWith(BaiduPolicy.ROOT) ? BaiduPolicy.DISPLAY_ROOT + path.substring(BaiduPolicy.ROOT.length()) : path; }
    private static JSONObject copy(JSONObject value) throws Exception { return new JSONObject(value.toString()); }
    static String digest(String value) throws Exception {
        StringBuilder text = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(value.getBytes("UTF-8"))) text.append(String.format(Locale.ROOT, "%02x", b & 255));
        return text.toString();
    }
    private JSONObject broker(String path, JSONObject body) throws Exception { return http.json(BaiduHttp.BROKER + path, body); }
    JSONObject startAuth() throws Exception {
        cancelAuth(); final int requestedGeneration = authGeneration;
        if (android.os.Build.VERSION.SDK_INT < 23) throw new Exception("连接网盘需要 Android 6.0 或更新版本。");
        JSONObject result = broker("/oauth/device/code", new JSONObject());
        if (result.has("error")) throw new Exception(result.optString("error").equals("not_found") ? "授权服务尚未更新，请先部署电视扫码接口。" : "暂时无法生成二维码，请稍后重试。");
        String code = result.getString("device_code"), userCode = result.getString("user_code");
        if (code.isEmpty() || code.length() > 2048 || !userCode.matches("[a-zA-Z0-9-]{1,128}")) throw new Exception("二维码信息无效，请重试。");
        String url = BaiduPolicy.https(result.getString("qrcode_url"), true);
        if (!new java.net.URI(url).getPath().startsWith("/device/qrcode/")) throw new Exception("二维码信息无效，请重试。");
        byte[] picture = http.download(url, 1024 * 1024);
        android.graphics.Bitmap decodedQr = android.graphics.BitmapFactory.decodeByteArray(picture, 0, picture.length);
        if (decodedQr == null) throw new Exception("二维码暂时无法显示，请重试。"); decodedQr.recycle();
        synchronized (this) {
        if (requestedGeneration != authGeneration) throw new Exception("扫码已取消。");
        flowId = UUID.randomUUID().toString(); deviceCode = code; qr = picture;
        long expires = Math.max(1, Math.min(3600, result.getLong("expires_in")));
        flowUntil = SystemClock.elapsedRealtime() + expires * 1000; pollInterval = Math.max(10, Math.min(120, result.optInt("interval", 10))); pollAfter = 0;
        return new JSONObject().put("id", flowId).put("userCode", userCode).put("qrSrc", "baidu-auth/" + flowId + ".png")
            .put("expiresAt", System.currentTimeMillis() + expires * 1000).put("interval", pollInterval);
        }
    }
    synchronized void cancelAuth() { authGeneration++; flowId = ""; deviceCode = ""; qr = null; flowUntil = 0; }
    synchronized InputStream qrImage(String id) throws Exception {
        if (!id.equals(flowId) || qr == null || SystemClock.elapsedRealtime() >= flowUntil) throw new FileNotFoundException();
        return new ByteArrayInputStream(qr);
    }
    JSONObject pollAuth(String id, Guard guard) throws Exception {
        final int requestedGeneration = authGeneration;
        long now = SystemClock.elapsedRealtime();
        if (!id.equals(flowId) || deviceCode.isEmpty() || now >= flowUntil) { cancelAuth(); return new JSONObject().put("state", "expired"); }
        if (now < pollAfter) return new JSONObject().put("state", "pending").put("interval", pollInterval);
        pollAfter = now + pollInterval * 1000L;
        JSONObject result = broker("/oauth/token", new JSONObject().put("grant_type", "device_token").put("code", deviceCode));
        String error = result.optString("error");
        if (error.equals("authorization_pending") || error.equals("rate_limited")) return new JSONObject().put("state", "pending").put("interval", error.equals("rate_limited") ? 60 : pollInterval);
        if (error.equals("slow_down")) { pollInterval = Math.min(120, pollInterval + 5); return new JSONObject().put("state", "pending").put("interval", pollInterval); }
        if (error.equals("authorization_declined") || error.equals("access_denied") || error.equals("expired_token")) { cancelAuth(); return new JSONObject().put("state", "expired"); }
        if (!error.isEmpty()) throw new Exception("授权暂时未完成，请稍后重试或刷新二维码。");
        validateTokens(result);
        // basic scope supplies an application-specific stable account identity, never a display name.
        JSONObject user = http.json(BaiduHttp.query("https://openapi.baidu.com/rest/2.0/passport/users/getInfo", "access_token", result.getString("access_token")), null);
        String openId = user.optString("openid");
        if (openId.isEmpty() || openId.length() > 512) { cancelAuth(); throw new Exception("无法确认网盘账号，请重新扫码。"); }
        String namespace = digest(openId), previous = account();
        result.put("account", namespace).put("expiresAt", System.currentTimeMillis() + result.getLong("expires_in") * 1000L);
        synchronized (this) {
        if (requestedGeneration != authGeneration || !id.equals(flowId)) return new JSONObject().put("state", "expired");
        credentials.write(result); auth = result; generation++; videoTickets.clear(); syncError = "";
        if (!namespace.equals(previous)) { catalogFile.delete(); installCatalog(new JSONObject()); guard.applyCloudCatalog(new JSONArray(), namespace, false); }
        else guard.applyCloudCatalog(catalog.optJSONArray("entries") == null ? new JSONArray() : catalog.getJSONArray("entries"), namespace, true);
        cancelAuth(); return new JSONObject().put("state", "connected");
        }
    }
    private void validateTokens(JSONObject value) throws Exception {
        for (String key : new String[]{"access_token", "refresh_token"}) {
            String token = value.optString(key); if (token.isEmpty() || token.length() > 8192 || java.util.regex.Pattern.compile("[\\x00-\\x20\\x7f]").matcher(token).find()) throw new Exception("授权返回信息无效，请重新连接。");
        }
        if (value.optLong("expires_in") <= 0 || value.optLong("expires_in") > 366L * 86400 || !Arrays.asList(value.optString("scope", "basic netdisk").split("[ ,]+")).contains("netdisk")) throw new Exception("未获得网盘访问权限，请重新连接。");
    }
    private String accessToken() throws Exception {
        synchronized (authLock) {
            if (!connected()) throw new Exception("请家长重新连接百度网盘。");
            if (auth.optLong("expiresAt") > System.currentTimeMillis() + 300000) return auth.getString("access_token");
            JSONObject old = auth; final int revision = generation; boolean preserved = false;
            // A consumed refresh token must never be replayed after a process death or lost response.
            credentials.clear();
            try {
                JSONObject next = broker("/oauth/token", new JSONObject().put("grant_type", "refresh_token").put("refresh_token", old.getString("refresh_token")));
                synchronized (this) {
                if (revision != generation) throw new Exception("网盘连接已变更。");
                String error = next.optString("error");
                if (error.equals("rate_limited") || error.equals("service_unavailable")) { credentials.write(old); auth = old; preserved = true; throw new Exception("网盘授权服务繁忙，请稍后重试。"); }
                validateTokens(next); next.put("account", old.getString("account")).put("expiresAt", System.currentTimeMillis() + next.getLong("expires_in") * 1000L);
                credentials.write(next); auth = next; return next.getString("access_token");
                }
            } catch (Exception error) {
                synchronized (this) { if (revision == generation && !preserved) { credentials.clear(); auth = new JSONObject(); } }
                throw new Exception(connected() ? "网盘授权服务繁忙，请稍后重试。" : "网盘授权已失效，请家长重新扫码连接。");
            }
        }
    }
    private JSONObject api(String base, String... pairs) throws Exception {
        final int revision = generation;
        String[] withToken = Arrays.copyOf(pairs, pairs.length + 2); withToken[pairs.length] = "access_token"; withToken[pairs.length + 1] = accessToken();
        JSONObject result = http.json(BaiduHttp.query(base, withToken), null);
        if (revision != generation) throw new Exception("网盘连接已变更，请重试。");
        long errno = result.optLong("errno", result.optLong("error_code"));
        if (result.has("error") || errno != 0) {
            if (errno == 110 || errno == 111 || errno == -6 || errno == 31045) {
                synchronized (this) { if (revision == generation && withToken[pairs.length + 1].equals(auth.optString("access_token"))) { credentials.clear(); auth = new JSONObject(); } }
                throw new Exception("网盘授权已失效，请家长重新连接。");
            }
            if (errno == 31066 || errno == -9) throw new Exception("网盘文件夹已不存在，请家长重新选择。");
            if (errno == 20011 || errno == 20013) throw new Exception("当前百度应用没有这个目录的读取权限。");
            throw new Exception("网盘暂时无法读取，请稍后重试。");
        }
        return result;
    }
    private List<JSONObject> directory(String path) throws Exception {
        BaiduPolicy.remote(path); List<JSONObject> all = new ArrayList<>(); Set<Long> seen = new HashSet<>();
        int start = 0;
        for (int page = 0; page < 100; page++) {
            JSONObject result = api("https://pan.baidu.com/rest/2.0/xpan/file", "method", "list", "dir", path,
                "order", "name", "desc", "0", "start", Integer.toString(start), "limit", "1000", "web", "1");
            JSONArray list = result.getJSONArray("list");
            for (int i = 0; i < list.length(); i++) {
                JSONObject item = list.getJSONObject(i); String child = BaiduPolicy.remote(item.getString("path")), name = item.getString("server_filename");
                long id = item.getLong("fs_id");
                if (!child.equals(path + "/" + name) || name.contains("/") || id <= 0 || !seen.add(id) || item.optLong("size") < 0) throw new Exception("网盘目录返回信息不完整，请重试。");
                all.add(item);
            }
            boolean more = result.has("has_more") ? Boolean.TRUE.equals(result.opt("has_more")) || result.optInt("has_more") != 0 : list.length() >= 1000;
            if (!more) return all;
            if (list.length() == 0) throw new Exception("网盘目录分页异常，请重试。");
            start += list.length();
        }
        throw new Exception("文件夹内容较多，请选择更具体的子文件夹。");
    }
    JSONObject folders(String path) throws Exception {
        BaiduPolicy.remote(path); JSONArray folders = new JSONArray();
        for (JSONObject file : directory(path)) if (file.optInt("isdir") == 1) folders.put(new JSONObject().put("path", file.getString("path")).put("id", file.getLong("fs_id")).put("name", file.getString("server_filename")));
        return new JSONObject().put("path", path).put("displayPath", display(path)).put("items", folders);
    }
    synchronized JSONObject startSync(JSONObject selection, Guard guard) throws Exception {
        if (!connected()) throw new Exception("请先连接百度网盘。");
        if (syncing) return status();
        JSONObject root = selection == null ? catalog.optJSONObject("selection") : copy(selection);
        if (root == null) throw new Exception("请先选择一个网盘文件夹。");
        BaiduPolicy.remote(root.getString("path"));
        if (root.optLong("id") <= 0 && !BaiduPolicy.ROOT.equals(root.getString("path"))) throw new Exception("请选择有效的网盘文件夹。");
        syncing = true; scanned = 0; syncError = ""; final int revision = generation;
        syncWorker.execute(() -> {
            try { sync(root, guard, revision); }
            catch (Exception error) { if (revision == generation) syncError = error.getMessage() == null ? "同步失败，请稍后重试。" : error.getMessage(); }
            finally { syncing = false; }
        }); return status();
    }
    synchronized void refreshIfStale(Guard guard) {
        if (!connected() || syncing || !catalog.has("selection") || System.currentTimeMillis() - catalog.optLong("syncedAt") < 10 * 60000L) return;
        try { startSync(null, guard); } catch (Exception ignored) {}
    }
    private void sync(JSONObject selection, Guard guard, int revision) throws Exception {
        String namespace = BaiduPolicy.account(account()), root = selection.getString("path");
        String virtual = "/baidu/" + namespace + "/" + Math.max(1, selection.optLong("id"));
        Map<String, JSONObject> next = new LinkedHashMap<>();
        next.put(virtual, new JSONObject().put("path", virtual).put("remotePath", root).put("name", root.substring(root.lastIndexOf('/') + 1)).put("kind", "folder").put("fsId", Math.max(1, selection.optLong("id"))));
        ArrayDeque<String[]> pending = new ArrayDeque<>(); pending.add(new String[]{root, virtual, "0"}); Set<Long> seen = new HashSet<>();
        while (!pending.isEmpty()) {
            if (revision != generation) throw new Exception("同步已取消。");
            String[] parent = pending.remove(); int depth = Integer.parseInt(parent[2]);
            if (depth > 32 || next.size() > 20000) throw new Exception("文件夹内容较多，请选择更具体的子文件夹。");
            for (JSONObject raw : directory(parent[0])) {
                String name = raw.getString("server_filename"); boolean folder = raw.optInt("isdir") == 1;
                String kind = folder ? "folder" : Storage.kind(name); if (name.startsWith(".") || kind.isEmpty()) continue;
                long id = raw.getLong("fs_id"); if (!seen.add(id)) throw new Exception("网盘目录含有重复文件标识，请重试。");
                String path = parent[1] + "/" + BaiduPolicy.segment(id, name, folder);
                JSONObject item = new JSONObject().put("path", path).put("remotePath", raw.getString("path")).put("name", name).put("kind", kind)
                    .put("fsId", id).put("size", raw.optLong("size")).put("modified", raw.optLong("server_mtime"));
                next.put(path, item); scanned++;
                String thumbnail = thumb(raw); if (!thumbnail.isEmpty()) thumbnails.put(path, thumbnail);
                if (folder) pending.add(new String[]{raw.getString("path"), path, Integer.toString(depth + 1)});
            }
        }
        List<JSONObject> series = new ArrayList<>(); boolean direct = false;
        for (JSONObject item : next.values()) if (!item.getString("kind").equals("folder") && parent(item.getString("path")).equals(virtual)) direct = true;
        if (direct) series.add(next.get(virtual));
        else for (JSONObject item : next.values()) if (item.getString("kind").equals("folder") && parent(item.getString("path")).equals(virtual)) series.add(item);
        series.sort((a, b) -> Storage.naturalCompare(a.optString("name"), b.optString("name")));
        JSONArray entries = new JSONArray(); Map<String, JSONObject> published = new LinkedHashMap<>();
        for (JSONObject folder : series) {
            int count = 0; for (JSONObject item : next.values()) if (!item.optString("kind").equals("folder") && BaiduPolicy.within(item.getString("path"), folder.getString("path"))) count++;
            if (count == 0) continue;
            String oldRoot = folder.getString("path"), stableRoot = "/baidu/" + namespace + "/" + folder.getLong("fsId");
            for (JSONObject item : next.values()) if (BaiduPolicy.within(item.getString("path"), oldRoot)) {
                String oldPath = item.getString("path"), stable = stableRoot + oldPath.substring(oldRoot.length());
                published.put(stable, copy(item).put("path", stable));
                String thumbnail = thumbnails.get(oldPath); if (thumbnail != null) thumbnails.put(stable, thumbnail);
            }
            entries.put(new JSONObject().put("id", "baidu-" + namespace.substring(0, 16) + "-" + folder.getLong("fsId"))
                .put("path", stableRoot).put("displayPath", display(folder.getString("remotePath"))).put("title", folder.getString("name"))
                .put("kind", "folder").put("source", "baidu").put("account", namespace).put("mediaCount", count).put("sourceRoot", display(root))
                .put("cover", "animals").put("mediaCover", true).put("language", "other").put("subtitle", "").put("available", true).put("hidden", false));
        }
        JSONObject saved = new JSONObject().put("account", namespace).put("selection", selection).put("syncedAt", System.currentTimeMillis()).put("entries", entries).put("items", new JSONArray(published.values()));
        synchronized (this) {
            if (revision != generation || !namespace.equals(account()) || !connected()) throw new Exception("同步已取消。");
            FileOutputStream output = catalogFile.startWrite();
            try { output.write(saved.toString().getBytes("UTF-8")); catalogFile.finishWrite(output); } catch (Exception error) { catalogFile.failWrite(output); throw error; }
            installCatalog(saved); guard.applyCloudCatalog(entries, namespace, true);
        }
    }
    private synchronized void installCatalog(JSONObject saved) throws Exception {
        Map<String, JSONObject> next = new LinkedHashMap<>(); JSONArray list = saved.optJSONArray("items");
        if (list != null) for (int i = 0; i < list.length(); i++) { JSONObject item = list.getJSONObject(i); BaiduPolicy.remote(item.getString("remotePath")); next.put(item.getString("path"), item); }
        Map<String, String> artwork = new HashMap<>(); for (String path : next.keySet()) artwork.put(digest(path), path);
        catalog = saved; items = next; artworkPaths = artwork;
    }
    synchronized void reconcile(Guard guard) throws Exception { guard.applyCloudCatalog(catalog.optJSONArray("entries") == null ? new JSONArray() : catalog.getJSONArray("entries"), account(), connected()); }
    JSONObject item(String path) throws Exception {
        JSONObject item = items.get(path);
        if (!connected() || !path.startsWith("/baidu/" + account() + "/") || item == null) throw new Exception("网盘内容暂不可用，请家长检查连接或更新目录。");
        return copy(item);
    }
    static String parent(String path) { return path.substring(0, path.lastIndexOf('/')); }
    private static boolean timed(JSONObject item) { return item.optString("kind").equals("video") || item.optString("kind").equals("audio"); }
    synchronized List<File> playable(JSONObject entry) throws Exception {
        String root = entry.getString("path"); item(root); List<JSONObject> found = new ArrayList<>();
        for (JSONObject item : items.values()) if (timed(item) && BaiduPolicy.within(item.optString("path"), root)) found.add(item);
        found.sort((a, b) -> Storage.naturalCompare(a.optString("remotePath"), b.optString("remotePath")));
        List<File> result = new ArrayList<>(); for (JSONObject item : found) result.add(new File(item.getString("path"))); return result;
    }
    synchronized JSONObject list(String path, Guard guard, String token) throws Exception {
        if (!token.isEmpty()) guard.authorize(token); else requireChild(path, guard);
        JSONObject folder = item(path); if (!folder.getString("kind").equals("folder")) throw new Exception("请选择文件夹。");
        List<JSONObject> children = new ArrayList<>();
        for (JSONObject child : items.values()) if (!child.optString("path").equals(path) && parent(child.optString("path")).equals(path)) children.add(copy(child));
        children.sort((a, b) -> { boolean af = a.optString("kind").equals("folder"), bf = b.optString("kind").equals("folder"); return af != bf ? af ? -1 : 1 : Storage.naturalCompare(a.optString("name"), b.optString("name")); });
        JSONArray visible = new JSONArray();
        for (JSONObject child : children) { child.remove("remotePath"); if (!child.optString("kind").equals("folder")) child.put("src", "baidu-art/" + digest(child.getString("path")) + ".jpg"); visible.put(child); }
        JSONArray crumbs = new JSONArray(); String cursor = path;
        while (items.containsKey(cursor)) { JSONObject part = items.get(cursor); crumbs.put(new JSONObject().put("path", cursor).put("name", part.getString("name"))); cursor = parent(cursor); }
        JSONArray ordered = new JSONArray(); for (int i = crumbs.length() - 1; i >= 0; i--) ordered.put(crumbs.get(i));
        return new JSONObject().put("path", path).put("name", folder.getString("name")).put("items", visible).put("breadcrumbs", ordered).put("truncated", false);
    }
    synchronized void requireChild(String path, Guard guard) throws Exception {
        item(path); JSONArray entries = guard.entries();
        for (int i = 0; i < entries.length(); i++) { JSONObject entry = entries.getJSONObject(i); if (BaiduPolicy.cloud(entry.optString("path")) && BaiduPolicy.within(path, entry.getString("path"))) { guard.childEntry(entry.getString("id")); return; } }
        throw new Exception("这个位置需要家长打开。");
    }
    private JSONObject metadata(String path) throws Exception {
        JSONObject file = item(path);
        JSONObject response = api("https://pan.baidu.com/rest/2.0/xpan/multimedia", "method", "filemetas", "fsids", "[" + file.getLong("fsId") + "]", "dlink", "1", "thumb", "1", "needmedia", "1");
        JSONArray list = response.getJSONArray("list"); if (list.length() != 1) throw new Exception("这个网盘文件暂时无法读取。");
        JSONObject metadata = list.getJSONObject(0);
        if (metadata.getLong("fs_id") != file.getLong("fsId") || !metadata.getString("path").equals(file.getString("remotePath"))) throw new Exception("网盘文件已移动，请家长更新目录。");
        String thumbnail = thumb(metadata); if (!thumbnail.isEmpty()) thumbnails.put(path, thumbnail);
        return metadata;
    }
    String resolve(String path) throws Exception {
        final int revision = generation;
        JSONObject data = metadata(path); String link = BaiduPolicy.https(data.getString("dlink"), false);
        if (link.matches("(?i).*[?&]access_token=.*")) throw new Exception("网盘返回的播放地址无效。");
        String token = accessToken(); if (revision != generation) throw new Exception("网盘连接已变更，请重试。");
        return link + (link.contains("?") ? "&" : "?") + "access_token=" + BaiduHttp.encode(token);
    }
    String resolveVideo(String path, String quality) throws Exception {
        return resolveVideo(path, quality, null);
    }
    String resolveVideo(String path, String quality, VideoWait progress) throws Exception {
        if (quality.equals("original")) return resolve(path);
        final int revision = generation; JSONObject file = item(path);
        if (!file.getString("kind").equals("video")) throw new Exception("只有网盘视频支持切换清晰度。");
        String baseUrl = BaiduHttp.query("https://pan.baidu.com/rest/2.0/xpan/file", "method", "streaming", "access_token", accessToken(),
            "path", BaiduPolicy.remote(file.getString("remotePath")), "type", BaiduStream.type(quality));
        long now = SystemClock.elapsedRealtime();
        videoTickets.entrySet().removeIf(entry -> entry.getValue().until <= now);
        String ticketKey = revision + ":" + path; VideoTicket ticket = videoTickets.get(ticketKey);
        String url = baseUrl + (ticket == null ? "" : "&adToken=" + BaiduHttp.encode(ticket.value)); String completedTicket = "";
        BaiduHttp.StreamResponse response = http.stream(url, BaiduStream.userAgent(android.os.Build.VERSION.RELEASE));
        if (response.body.trim().startsWith("{")) {
            JSONObject error = new JSONObject(response.body); int code = error.optInt("errno", error.optInt("error_code", -1));
            if (code != 133 || progress == null) throw new VideoUnavailable(code);
            videoTickets.remove(ticketKey);
            String adToken = error.optString("adToken"); int seconds = BaiduStream.adWaitSeconds(error.optInt("adTime"));
            // Honor the provider's actual waiting period. Never fast-forward or fabricate it.
            if (adToken.isEmpty() || adToken.length() > 8192 || error.has("adUrl") || error.has("ad_url")) throw new VideoUnavailable(133);
            long left = seconds * 1000L;
            while (left > 0) {
                if (revision != generation || !progress.active() || Thread.currentThread().isInterrupted()) throw new CancellationException();
                progress.waiting((int) ((left + 999) / 1000));
                long before = SystemClock.elapsedRealtime(); boolean visible = progress.foreground(); Thread.sleep(Math.min(250, left));
                if (visible && progress.foreground()) left -= SystemClock.elapsedRealtime() - before;
            }
            url = baseUrl + "&adToken=" + BaiduHttp.encode(adToken);
            response = http.stream(url, BaiduStream.userAgent(android.os.Build.VERSION.RELEASE));
            if (response.body.trim().startsWith("{")) { JSONObject retry = new JSONObject(response.body); throw new VideoUnavailable(retry.optInt("errno", retry.optInt("error_code", -1))); }
            completedTicket = adToken;
        }
        if (response.status != 200) throw new VideoUnavailable(response.status);
        BaiduStream.validate(response.body, response.url);
        if (revision != generation) throw new Exception("网盘连接已变更，请重试。");
        if (progress != null && !progress.active()) throw new CancellationException();
        if (!completedTicket.isEmpty()) synchronized (this) {
            if (revision != generation) throw new CancellationException();
            if (videoTickets.size() >= 32) videoTickets.remove(videoTickets.keySet().iterator().next());
            videoTickets.put(ticketKey, new VideoTicket(completedTicket));
        }
        item(path); return response.url;
    }
    private static String thumb(JSONObject raw) {
        JSONObject thumbs = raw.optJSONObject("thumbs"); if (thumbs == null) return "";
        for (String key : new String[]{"url3", "url2", "url1", "icon"}) {
            String address = thumbs.optString(key); if (!address.isEmpty()) try { return BaiduPolicy.https(address, false); } catch (Exception ignored) {}
        }
        return "";
    }
    File thumbnail(String path) throws Exception {
        final int revision = generation;
        JSONObject file = item(path); String name = digest(path + ":" + file.optLong("size") + ":" + file.optLong("modified"));
        File directory = new File(context.getCacheDir(), "baidu-thumbnails"); directory.mkdirs(); File cached = new File(directory, name + ".jpg");
        if (cached.isFile()) { cached.setLastModified(System.currentTimeMillis()); return cached; }
        String address = thumbnails.get(path); if (address == null) { metadata(path); address = thumbnails.get(path); }
        if (address == null) throw new FileNotFoundException();
        byte[] bytes;
        try { bytes = http.download(address, 4 * 1024 * 1024); }
        catch (Exception expired) { metadata(path); address = thumbnails.get(path); if (address == null) throw new FileNotFoundException(); bytes = http.download(address, 4 * 1024 * 1024); }
        android.graphics.Bitmap decoded = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (decoded == null) throw new IOException(); decoded.recycle();
        synchronized (this) {
        if (revision != generation) throw new IOException("网盘连接已变更。");
        File temporary = File.createTempFile("thumbnail-", ".tmp", directory);
        try { try (FileOutputStream output = new FileOutputStream(temporary)) { output.write(bytes); } if (!temporary.renameTo(cached)) throw new IOException(); }
        finally { temporary.delete(); }
        trimCache(directory, 48L * 1024 * 1024, cached); return cached;
        }
    }
    synchronized String artPath(String key) throws Exception {
        String path = artworkPaths.get(key); if (path == null) throw new FileNotFoundException(); return path;
    }
    InputStream cover(JSONObject entry) throws Exception {
        String last = entry.optString("lastPlayedPath");
        if (!last.isEmpty()) try { if (BaiduPolicy.within(last, entry.getString("path"))) return new FileInputStream(thumbnail(last)); } catch (Exception ignored) {}
        List<File> files = playable(entry);
        if (files.isEmpty()) throw new FileNotFoundException();
        return new FileInputStream(thumbnail(files.get(0).getPath()));
    }
    File materialize(String path) throws Exception {
        final int revision = generation;
        JSONObject item = item(path); if (!item.optString("kind").equals("image") && !item.optString("kind").equals("pdf")) throw new IOException();
        if (item.optLong("size") > 32L * 1024 * 1024) throw new Exception("这份图片或绘本较大，请先下载到 U 盘打开。");
        File folder = new File(context.getCacheDir(), "baidu-documents"); folder.mkdirs(); File cached = new File(folder, digest(path + item.optLong("size") + ":" + item.optLong("modified")));
        if (!cached.isFile()) { byte[] bytes = http.download(resolve(path), 32 * 1024 * 1024); if (item.optLong("size") > 0 && bytes.length != item.optLong("size")) throw new IOException("下载未完成，请重试。");
            synchronized (this) { if (revision != generation) throw new IOException("网盘连接已变更。");
            File temporary = File.createTempFile("document-", ".tmp", folder); try { try (FileOutputStream output = new FileOutputStream(temporary)) { output.write(bytes); } if (!temporary.renameTo(cached)) throw new IOException(); } finally { temporary.delete(); } } }
        cached.setLastModified(System.currentTimeMillis()); trimCache(folder, 128L * 1024 * 1024, cached);
        return cached;
    }
    private static void trimCache(File folder, long limit, File keep) {
        File[] files = folder.listFiles(file -> file.isFile() && !file.getName().endsWith(".tmp")); if (files == null) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified)); long bytes = 0; for (File file : files) bytes += file.length();
        for (File file : files) { if (bytes <= limit) break; if (!file.equals(keep)) { long length = file.length(); if (file.delete()) bytes -= length; } }
    }
    synchronized void disconnect(Guard guard) throws Exception {
        generation++; cancelAuth(); credentials.clear(); auth = new JSONObject(); catalogFile.delete(); installCatalog(new JSONObject()); thumbnails.clear(); videoTickets.clear(); syncError = "";
        guard.applyCloudCatalog(new JSONArray(), "", false);
        for (String name : new String[]{"baidu-thumbnails", "baidu-documents"}) { File[] all = new File(context.getCacheDir(), name).listFiles(); if (all != null) for (File file : all) file.delete(); }
    }
}
