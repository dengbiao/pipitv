package com.pipi.kids;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.UUID;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

final class Guard {
    private static Guard instance;
    static synchronized Guard get(Context context) { if (instance == null) instance = new Guard(context.getApplicationContext()); return instance; }
    private final SharedPreferences prefs;
    private final SharedPreferences debugPrefs;
    final TimePolicy policy = new TimePolicy();
    private String token = ""; private long authUntil;
    private boolean chinese = true;
    private Guard(Context context) {
        prefs = context.getSharedPreferences("pipikids", Context.MODE_PRIVATE);
        debugPrefs = context.getSharedPreferences("pipikids-debug", Context.MODE_PRIVATE);
        policy.day = prefs.getString("day", ""); policy.usedMs = prefs.getLong("usedMs", 0);
        policy.sessionMs = prefs.getLong("sessionMs", 0); policy.extraMs = prefs.getLong("extraMs", 0); policy.restUntil = prefs.getLong("restUntil", 0);
        readSettings(); tick();
    }
    private void readSettings() {
        policy.dailyMinutes = prefs.getInt("dailyMinutes", 30); policy.sessionMinutes = prefs.getInt("sessionMinutes", 15);
        policy.restMinutes = prefs.getInt("restMinutes", 10); policy.startHour = prefs.getInt("startHour", 8); policy.endHour = prefs.getInt("endHour", 20);
        chinese = prefs.getBoolean("chinese", true);
        policy.limitsSuspended = debugPrefs.getBoolean("limitsSuspended", false);
    }
    synchronized void tick() {
        policy.tick(System.currentTimeMillis(), SystemClock.elapsedRealtime());
        prefs.edit().putString("day", policy.day).putLong("usedMs", policy.usedMs).putLong("sessionMs", policy.sessionMs)
            .putLong("extraMs", policy.extraMs).putLong("restUntil", policy.restUntil).apply();
    }
    synchronized void foreground(boolean active) { tick(); policy.foreground = active; }
    synchronized void external(boolean active) {
        if (active || policy.external != active) tick();
        policy.external = active;
    }
    synchronized void learning(boolean active) throws Exception {
        tick(); if (active && !policy.reason(System.currentTimeMillis()).isEmpty()) throw new Exception("现在是休息时间。");
        policy.learning = active;
    }
    synchronized boolean blocked() { tick(); return !policy.reason(System.currentTimeMillis()).isEmpty(); }
    synchronized JSONObject settings() throws Exception {
        return new JSONObject().put("dailyMinutes", policy.dailyMinutes).put("sessionMinutes", policy.sessionMinutes).put("restMinutes", policy.restMinutes)
            .put("startHour", policy.startHour).put("endHour", policy.endHour).put("chinese", chinese);
    }
    synchronized JSONObject usage() throws Exception {
        tick(); return new JSONObject().put("day", policy.day).put("usedMs", policy.usedMs).put("sessionMs", policy.sessionMs)
            .put("extraMs", policy.extraMs).put("restUntil", policy.restUntil);
    }
    synchronized JSONObject access() throws Exception {
        tick(); long now = System.currentTimeMillis();
        return new JSONObject().put("reason", policy.reason(now)).put("remainingMs", policy.remaining(now))
            .put("dailyRemainingMs", policy.dailyRemaining()).put("restUntil", policy.restUntil).put("limitsSuspended", policy.limitsSuspended);
    }
    boolean pinSet() { return !prefs.getString("pinHash", "").isEmpty(); }
    int pinLength() {
        int length = prefs.getInt("pinLength", 0);
        return pinSet() && length >= 4 && length <= 8 ? length : 0;
    }
    private static String hex(byte[] bytes) { StringBuilder b = new StringBuilder(); for (byte value : bytes) b.append(String.format("%02x", value & 255)); return b.toString(); }
    private static byte[] unhex(String value) { byte[] b = new byte[value.length() / 2]; for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16); return b; }
    private static byte[] hash(String pin, byte[] salt) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), salt, 120000, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).getEncoded(); } finally { spec.clearPassword(); }
    }
    synchronized JSONObject unlock(String pin) throws Exception {
        if (prefs.getLong("lockUntil", 0) > System.currentTimeMillis()) throw new Exception("请稍候一分钟，再输入家长 PIN。");
        if (!PinPolicy.accepts(pin, pinSet())) throw new Exception(pinSet() ? "请输入原来的 PIN。" : "请输入 4 位数字 PIN。");
        if (!pinSet()) {
            writePin(pin);
        } else if (!MessageDigest.isEqual(hash(pin, unhex(prefs.getString("pinSalt", ""))), unhex(prefs.getString("pinHash", "")))) {
            int failures = prefs.getInt("failures", 0) + 1;
            prefs.edit().putInt("failures", failures >= 5 ? 0 : failures).putLong("lockUntil", failures >= 5 ? System.currentTimeMillis() + 60000 : 0).commit();
            throw new Exception("PIN 不正确，请再试一次。");
        }
        prefs.edit().putInt("failures", 0).putLong("lockUntil", 0).putInt("pinLength", pin.length()).apply();
        token = UUID.randomUUID().toString(); authUntil = System.currentTimeMillis() + 10 * 60000L;
        tick(); policy.parent = true; return new JSONObject().put("token", token);
    }
    private void writePin(String pin) throws Exception {
        byte[] salt = new byte[16]; new SecureRandom().nextBytes(salt);
        if (!prefs.edit().putString("pinSalt", hex(salt)).putString("pinHash", hex(hash(pin, salt)))
                .putInt("pinLength", PinPolicy.DIGITS).commit()) throw new Exception("无法保存 PIN，请重试。");
    }
    synchronized JSONObject changePin(String input, String pin) throws Exception {
        authorize(input);
        if (!PinPolicy.accepts(pin, false)) throw new Exception("请输入 4 位数字 PIN。");
        writePin(pin);
        prefs.edit().putInt("failures", 0).putLong("lockUntil", 0).apply();
        return new JSONObject().put("token", token);
    }
    synchronized void discardParent(String input) {
        if (input != null && !input.isEmpty() && input.equals(token)) leaveParent();
    }
    synchronized void authorize(String input) throws Exception {
        if (input.isEmpty() || !input.equals(token) || System.currentTimeMillis() > authUntil) throw new Exception("家长验证已过期，请重新输入 PIN。");
        authUntil = System.currentTimeMillis() + 10 * 60000L;
    }
    synchronized void leaveParent() { tick(); policy.parent = false; policy.learning = false; token = ""; authUntil = 0; }
    private static int bound(JSONObject value, String key, int fallback, int min, int max) { return Math.max(min, Math.min(max, value.optInt(key, fallback))); }
    synchronized void saveSettings(String input, JSONObject data) throws Exception {
        authorize(input); tick();
        prefs.edit().putInt("dailyMinutes", bound(data, "dailyMinutes", 30, 5, 180)).putInt("sessionMinutes", bound(data, "sessionMinutes", 15, 1, 60))
            .putInt("restMinutes", bound(data, "restMinutes", 10, 1, 60)).putInt("startHour", bound(data, "startHour", 8, 0, 23))
            .putInt("endHour", bound(data, "endHour", 20, 0, 24)).putBoolean("chinese", data.optBoolean("chinese", true)).commit(); readSettings();
        if (policy.sessionMs >= policy.sessionMinutes * 60000L && policy.restUntil <= System.currentTimeMillis()) policy.restUntil = System.currentTimeMillis() + policy.restMinutes * 60000L;
        tick();
    }
    synchronized void bonus(String input) throws Exception { authorize(input); tick(); policy.extraMs += 300000; policy.sessionMs = 0; policy.restUntil = 0; tick(); }
    synchronized JSONArray entries() throws Exception { return new JSONArray(prefs.getString("entries", "[]")); }
    synchronized boolean hasScanRoots() { return prefs.contains("scanRoots"); }
    synchronized JSONArray scanRoots() throws Exception { return new JSONArray(prefs.getString("scanRoots", "[]")); }
    synchronized void initializeScanRoots(JSONArray roots) { if (!hasScanRoots()) prefs.edit().putString("scanRoots", roots.toString()).commit(); }
    synchronized void saveScanRoots(String input, JSONArray roots) throws Exception { authorize(input); prefs.edit().putString("scanRoots", roots.toString()).commit(); }
    synchronized void applyCatalog(ContentDiscovery.Result catalog, java.util.List<String> roots) throws Exception {
        JSONArray current = entries(), next = new JSONArray();
        java.util.Map<String, JSONObject> discovered = new java.util.LinkedHashMap<>();
        for (ContentDiscovery.Candidate candidate : catalog.entries) {
            JSONObject entry = new JSONObject().put("id", "scan-" + hex(MessageDigest.getInstance("SHA-256").digest(candidate.path.getBytes("UTF-8"))).substring(0, 24))
                .put("path", candidate.path).put("title", (candidate.kind.equals("folder") ? candidate.name : candidate.name.replaceFirst("(?i)\\.[a-z0-9]+$", "")))
                .put("subtitle", "").put("kind", candidate.kind).put("cover", "animals").put("mediaCover", true).put("language", "other");
            discovered.put(candidate.path, entry.put("sourceRoot", candidate.sourceRoot).put("mediaCount", candidate.mediaCount));
        }
        for (int i = 0; i < current.length(); i++) {
            JSONObject entry = current.getJSONObject(i);
            if (BaiduPolicy.cloud(entry.optString("path"))) { next.put(entry); continue; }
            String path = new java.io.File(entry.getString("path")).getCanonicalPath();
            JSONObject match = discovered.remove(path); boolean inScope = false;
            for (String root : roots) if (ContentDiscovery.within(path, root)) inScope = true;
            boolean available = match != null || (!catalog.complete && inScope && new java.io.File(path).exists() && entry.optBoolean("available", true));
            entry.put("managed", true).put("available", available).put("catalogReason", available ? "" : !inScope ? "out_of_scope" : new java.io.File(path).exists() ? "empty" : "offline");
            if (match != null) entry.put("sourceRoot", match.getString("sourceRoot")).put("mediaCount", match.getInt("mediaCount"));
            next.put(entry);
        }
        for (JSONObject entry : discovered.values()) next.put(entry.put("managed", true).put("available", true).put("hidden", false).put("catalogReason", ""));
        if (!next.toString().equals(current.toString()) || !prefs.getString("entries", "[]").equals(next.toString())) initEntries(next);
    }
    synchronized JSONObject childEntry(String id) throws Exception {
        JSONObject entry = entry(id);
        if (entry.optBoolean("removed") || entry.optBoolean("hidden") || !entry.optBoolean("available", true) || !inScanRoots(entry.getString("path"))) throw new Exception("这个内容暂未显示，或存储尚未连接。");
        return entry;
    }
    synchronized boolean inScanRoots(String path) throws Exception {
        if (BaiduPolicy.cloud(path)) return true; // Cloud scope is validated by its own account/catalog.
        if (!hasScanRoots()) return true;
        JSONArray roots = scanRoots();
        for (int i = 0; i < roots.length(); i++) if (ContentDiscovery.within(path, roots.getString(i))) return true;
        return false;
    }
    synchronized JSONObject entry(String id) throws Exception {
        JSONArray all = entries();
        for (int i = 0; i < all.length(); i++) if (id.equals(all.getJSONObject(i).optString("id"))) return all.getJSONObject(i);
        throw new Exception("找不到这个系列，请返回首页重新选择。");
    }
    synchronized void applyCloudCatalog(JSONArray candidates, String account, boolean connected) throws Exception {
        JSONArray current = entries(), next = new JSONArray(); String previous = current.toString(); java.util.Map<String, JSONObject> found = new java.util.LinkedHashMap<>();
        for (int i = 0; i < candidates.length(); i++) { JSONObject item = candidates.getJSONObject(i); found.put(item.getString("id"), item); }
        for (int i = 0; i < current.length(); i++) {
            JSONObject entry = current.getJSONObject(i);
            if (!BaiduPolicy.cloud(entry.optString("path"))) { next.put(entry); continue; }
            JSONObject match = found.remove(entry.getString("id"));
            boolean available = connected && match != null && account.equals(entry.optString("account"));
            entry.put("available", available).put("catalogReason", available ? "" : connected ? "out_of_scope" : "disconnected");
            if (match != null) {
                for (String key : new String[]{"path", "displayPath", "sourceRoot", "mediaCount"}) entry.put(key, match.get(key));
                if (!entry.optBoolean("customTitle")) entry.put("title", match.getString("title"));
            }
            next.put(entry);
        }
        for (JSONObject entry : found.values()) next.put(entry.put("available", connected && account.equals(entry.optString("account"))));
        if (!next.toString().equals(previous)) initEntries(next);
    }
    synchronized boolean hasEntriesInitialized() { return prefs.contains("entries"); }
    synchronized void initEntries(JSONArray data) { prefs.edit().putString("entries", data.toString()).commit(); }
    synchronized boolean hasRelocation(String id) { return prefs.getBoolean("relocation:" + id, false); }
    synchronized void relocateContent(JSONObject setup) throws Exception {
        String id = setup.getString("id"); if (hasRelocation(id)) return;
        java.util.Map<String,String> moves = new java.util.HashMap<>();
        JSONArray rewrites = setup.getJSONArray("moves");
        for (int i = 0; i < rewrites.length(); i++) {
            JSONObject move = rewrites.getJSONObject(i); moves.put(move.getString("from"), move.getString("to"));
        }
        String mergedRoot = setup.optString("mergeFolder", "");
        JSONArray current = entries(), next = new JSONArray(); JSONObject merged = null;
        for (int i = 0; i < current.length(); i++) {
            JSONObject entry = new JSONObject(current.getJSONObject(i).toString());
            for (String field : new String[]{"path", "lastPlayedPath"}) {
                String value = entry.optString(field, "");
                if (moves.containsKey(value)) entry.put(field, moves.get(value));
            }
            if (!mergedRoot.isEmpty() && mergedRoot.equals(entry.optString("path")) && "folder".equals(entry.optString("kind"))) {
                if (merged == null) {
                    merged = entry; merged.put("title", setup.optString("title", "WOW English"))
                        .put("subtitle", setup.optString("subtitle", "英文学习内容")); next.put(merged);
                } else if (entry.optLong("lastPlayedAt") > merged.optLong("lastPlayedAt")) {
                    merged.put("lastPlayedPath", entry.optString("lastPlayedPath")).put("lastPlayedAt", entry.optLong("lastPlayedAt"));
                }
            } else next.put(entry);
        }
        if (!prefs.edit().putString("entries", next.toString()).putBoolean("relocation:" + id, true).commit())
            throw new java.io.IOException("无法保存更新后的内容入口。");
    }
    synchronized void applyInitialContent(String revision, JSONArray data) throws Exception {
        if (revision.equals(prefs.getString("contentRevision", ""))) return;
        JSONArray current = entries();
        // A signed setup update may replace the bundled examples, never later parent edits.
        if (current.length() != 3) return;
        for (int i = 0; i < current.length(); i++) {
            JSONObject entry = current.getJSONObject(i);
            if (!entry.optBoolean("demo") || !entry.optString("id").startsWith("demo-")) return;
        }
        prefs.edit().putString("entries", data.toString()).putString("contentRevision", revision).commit();
    }
    void recordPlayed(String id, String path, Storage storage) throws Exception {
        java.io.File file = storage.parentFile(path);
        JSONObject expected = entry(id);
        if (!storage.isFile(file) || !storage.belongsTo(file, expected)) return;
        synchronized (this) {
            JSONArray current = entries();
            for (int i = 0; i < current.length(); i++) {
                JSONObject entry = current.getJSONObject(i);
                if (entry.optString("id").equals(id) && entry.optString("path").equals(expected.optString("path"))) {
                    entry.put("lastPlayedPath", file.getCanonicalPath()).put("lastPlayedAt", System.currentTimeMillis());
                    initEntries(current); return;
                }
            }
        }
    }
    synchronized JSONObject saveEntry(String input, JSONObject source, Storage storage) throws Exception {
        authorize(input); String title = source.optString("title", "").trim();
        if (title.isEmpty()) throw new Exception("请填写入口名称。");
        String id = source.optString("id", ""); JSONArray all = entries();
        for (int i = 0; i < all.length(); i++) {
            JSONObject entry = all.getJSONObject(i); if (!id.equals(entry.optString("id"))) continue;
            String subtitle = source.optString("subtitle", "").trim();
            entry.put("title", title.substring(0, Math.min(title.length(), 40))).put("subtitle", subtitle.substring(0, Math.min(subtitle.length(), 80)))
                .put("language", "other".equals(source.optString("language")) ? "other" : "en").put("customTitle", true);
            initEntries(all); return entry;
        }
        throw new Exception("入口由扫描自动生成，请先设置扫描路径。");
    }
    synchronized void setEntryHidden(String input, String id, boolean hidden) throws Exception {
        authorize(input); JSONArray all = entries(); boolean found = false;
        for (int i = 0; i < all.length(); i++) if (id.equals(all.getJSONObject(i).optString("id"))) { all.getJSONObject(i).put("hidden", hidden); found = true; }
        if (!found) throw new Exception("找不到这个内容入口。");
        initEntries(all);
    }
    synchronized void removeEntry(String input, String id) throws Exception {
        setEntryRemoved(input, id, true);
    }
    synchronized void setEntryRemoved(String input, String id, boolean removed) throws Exception {
        authorize(input); JSONArray all = entries(); boolean found = false;
        for (int i = 0; i < all.length(); i++) {
            JSONObject entry = all.getJSONObject(i);
            if (id.equals(entry.optString("id"))) {
                entry.put("removed", removed); if (removed) entry.put("removedAt", System.currentTimeMillis()); else entry.remove("removedAt");
                found = true;
            }
        }
        if (!found) throw new Exception("找不到这个内容入口。");
        if (!prefs.edit().putString("entries", all.toString()).commit()) throw new Exception("未能保存，请重试。");
    }
    synchronized int clearStaleEntries(String input, String source, JSONArray ids) throws Exception {
        authorize(input);
        if (!source.equals("local") && !source.equals("baidu")) throw new Exception("请选择内容来源。");
        if (ids.length() < 1 || ids.length() > 1024) throw new Exception("请重新选择需要清理的入口。");
        java.util.Set<String> wanted = new java.util.HashSet<>();
        for (int i = 0; i < ids.length(); i++) wanted.add(ids.getString(i));
        JSONArray all = entries(); java.util.List<JSONObject> targets = new java.util.ArrayList<>();
        for (int i = 0; i < all.length(); i++) {
            JSONObject entry = all.getJSONObject(i); if (!wanted.remove(entry.optString("id"))) continue;
            if (entry.optBoolean("removed") || !entry.optString("catalogReason").equals("out_of_scope") ||
                    BaiduPolicy.cloud(entry.optString("path")) != source.equals("baidu")) throw new Exception("目录范围已变化，请重新确认要清理的入口。");
            targets.add(entry);
        }
        if (!wanted.isEmpty()) throw new Exception("入口已变化，请刷新后重试。");
        for (JSONObject entry : targets) entry.put("removed", true).put("removedAt", System.currentTimeMillis());
        if (!prefs.edit().putString("entries", all.toString()).commit()) throw new Exception("未能保存，请重试。");
        return targets.size();
    }
}
